import type { Bills } from '../../shared/ipc'
import { baseCurrency } from '../../shared/presets'
import { billOccurrences, monthEnd, monthStart } from '../ledger/budgets'
import { getLedgerAccount } from './accounts'
import type { Db } from './connection'
import { uuidv7 } from './id'
import { createTransaction } from './transactions'

type Repeat = 'none' | 'weekly' | 'monthly'

interface NewBill {
  name: string
  amountMinor: number
  categoryId: string
  dueDate: string
  repeat: Repeat
}

// Bills are in the base currency, like budgets.
export function createBill(db: Db, bill: NewBill): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO bills (id, name, amount_minor, currency, category_id, due_date, repeat, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuidv7(),
    bill.name,
    bill.amountMinor,
    baseCurrency,
    bill.categoryId,
    bill.dueDate,
    bill.repeat,
    now,
    now
  )
}

// Expenses already recorded for the bill stay in the ledger.
export function deleteBill(db: Db, id: string): void {
  const now = new Date().toISOString()
  const { changes } = db
    .prepare('UPDATE bills SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(now, now, id)
  if (changes === 0) throw new Error('Not found')
}

interface BillRow {
  id: string
  name: string
  categoryId: string
  categoryName: string
  amountMinor: number
  dueDate: string
  repeat: Repeat
}

const selectBills = `
  SELECT b.id, b.name, b.category_id AS categoryId, c.name AS categoryName, b.amount_minor AS amountMinor,
         b.due_date AS dueDate, b.repeat
  FROM bills b JOIN categories c ON c.id = b.category_id
  WHERE b.deleted_at IS NULL`

// A payment counts while its expense has not been deleted.
function paymentFor(db: Db, billId: string, dueDate: string): string | null {
  const row = db
    .prepare(
      `SELECT p.transaction_id AS id FROM bill_payments p
       JOIN transactions t ON t.id = p.transaction_id AND t.deleted_at IS NULL
       WHERE p.bill_id = ? AND p.due_date = ? AND p.deleted_at IS NULL`
    )
    .get(billId, dueDate) as { id: string } | undefined
  return row?.id ?? null
}

// Every due date in the month containing `date`.
export function listBills(db: Db, date: string): Bills {
  const start = monthStart(date)
  const end = monthEnd(date)
  const bills = db.prepare(selectBills).all() as BillRow[]
  const dues = bills
    .flatMap((b) =>
      billOccurrences(b.dueDate, b.repeat, start, end).map((dueDate) => ({
        billId: b.id,
        name: b.name,
        categoryName: b.categoryName,
        amountMinor: b.amountMinor,
        dueDate,
        repeat: b.repeat,
        paidTransactionId: paymentFor(db, b.id, dueDate)
      }))
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name))
  return { start, end, currency: baseCurrency, dues }
}

interface Payment {
  billId: string
  dueDate: string
  accountId: string
  date: string
}

// Records the bill's expense from an account, in the bill's category, and marks that due date paid.
export function payBill(db: Db, payment: Payment): void {
  db.transaction(() => {
    const bill = db.prepare(`${selectBills} AND b.id = ?`).get(payment.billId) as
      BillRow | undefined
    if (!bill) throw new Error('Bill not found')
    if (billOccurrences(bill.dueDate, bill.repeat, payment.dueDate, payment.dueDate).length === 0) {
      throw new Error('The bill is not due on that date')
    }
    if (paymentFor(db, bill.id, payment.dueDate)) throw new Error('Already paid')
    if (getLedgerAccount(db, payment.accountId).currency !== baseCurrency) {
      throw new Error(`Pay bills from a ${baseCurrency} account`)
    }
    const transactionId = createTransaction(db, {
      kind: 'expense',
      accountId: payment.accountId,
      amountMinor: bill.amountMinor,
      date: payment.date,
      payee: bill.name,
      memo: '',
      categoryId: bill.categoryId
    })
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO bill_payments (id, bill_id, due_date, transaction_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uuidv7(), bill.id, payment.dueDate, transactionId, now, now)
  })()
}
