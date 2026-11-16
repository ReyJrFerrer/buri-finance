import type { NewTransaction, TransactionRow } from '../../shared/ipc'
import {
  assertBalanced,
  describeTransaction,
  expenseSplits,
  incomeSplits,
  systemAccounts,
  transferSplits,
  type Split
} from '../ledger/posting'
import { baseCurrency } from '../../shared/presets'
import { getLedgerAccount } from './accounts'
import { addToBudget } from './budgets'
import type { Db } from './connection'
import { uuidv7 } from './id'

interface Header {
  date: string
  payee: string
  memo: string
}

export function insertTransaction(db: Db, header: Header, splits: Split[]): string {
  assertBalanced(splits)
  const id = uuidv7()
  const now = new Date().toISOString()
  const insertSplit = db.prepare(
    `INSERT INTO splits (id, transaction_id, account_id, amount_minor, currency, category_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  db.transaction(() => {
    db.prepare(
      'INSERT INTO transactions (id, date, payee, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, header.date, header.payee, header.memo, now, now)
    for (const s of splits) {
      insertSplit.run(
        uuidv7(),
        id,
        s.accountId,
        s.amountMinor,
        s.currency,
        s.categoryId ?? null,
        now,
        now
      )
    }
  })()
  return id
}

// Returns the new transaction's id.
export function createTransaction(db: Db, input: NewTransaction): string {
  return db.transaction(() => {
    if (input.kind === 'transfer') {
      const splits = transferSplits(
        getLedgerAccount(db, input.fromAccountId),
        getLedgerAccount(db, input.toAccountId),
        input.amountMinor,
        input.receivedMinor
      )
      return insertTransaction(
        db,
        { date: input.date, payee: 'Transfer', memo: input.memo },
        splits
      )
    }
    const account = getLedgerAccount(db, input.accountId)
    if (input.kind === 'expense') {
      const splits = expenseSplits(account, input.amountMinor).map((s) =>
        s.accountId === systemAccounts.expense ? { ...s, categoryId: input.categoryId } : s
      )
      return insertTransaction(db, input, splits)
    }
    const id = insertTransaction(db, input, incomeSplits(account, input.amountMinor))
    const allocated = input.allocations.reduce((sum, a) => sum + a.amountMinor, 0)
    if (allocated > input.amountMinor) throw new Error('Allocations exceed the income amount')
    if (allocated > 0 && account.currency !== baseCurrency) {
      throw new Error(`Only ${baseCurrency} income can be allocated to budgets`)
    }
    for (const a of input.allocations) addToBudget(db, a.categoryId, input.date, a.amountMinor)
    return id
  })()
}

// shortcut: newest 500 only, no paging; add paging or a date filter when lists outgrow it.
export function listTransactions(db: Db): TransactionRow[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.date, t.payee, t.memo, a.name AS accountName, s.amount_minor AS amountMinor, s.currency,
         COALESCE((SELECT c.name FROM splits cs JOIN categories c ON c.id = cs.category_id
                   WHERE cs.transaction_id = t.id LIMIT 1), '') AS category
       FROM (SELECT * FROM transactions WHERE deleted_at IS NULL
             ORDER BY date DESC, id DESC LIMIT 500) t
       JOIN splits s ON s.transaction_id = t.id AND s.deleted_at IS NULL
       JOIN accounts a ON a.id = s.account_id AND a.type IN ('asset', 'liability')
       ORDER BY t.date DESC, t.id DESC`
    )
    .all() as (Header & {
    id: string
    category: string
    accountName: string
    amountMinor: number
    currency: string
  })[]
  const byId = new Map<string, typeof rows>()
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row])
  return [...byId.values()].map((splits) => {
    const { id, date, payee, memo, category } = splits[0]
    return { id, date, payee, memo, category, ...describeTransaction(splits) }
  })
}

// Soft delete, so the deletion can sync later.
export function deleteTransaction(db: Db, id: string): void {
  const now = new Date().toISOString()
  db.transaction(() => {
    const { changes } = db
      .prepare(
        'UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      )
      .run(now, now, id)
    if (changes === 0) throw new Error('Transaction not found')
    db.prepare('UPDATE splits SET deleted_at = ?, updated_at = ? WHERE transaction_id = ?').run(
      now,
      now,
      id
    )
  })()
}
