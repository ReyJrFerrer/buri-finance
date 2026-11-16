import type { NewTransaction, TransactionRow } from '../../shared/ipc'
import {
  assertBalanced,
  describeTransaction,
  expenseSplits,
  incomeSplits,
  transferSplits,
  type Split
} from '../ledger/posting'
import { getLedgerAccount } from './accounts'
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
    `INSERT INTO splits (id, transaction_id, account_id, amount_minor, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  db.transaction(() => {
    db.prepare(
      'INSERT INTO transactions (id, date, payee, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, header.date, header.payee, header.memo, now, now)
    for (const s of splits) {
      insertSplit.run(uuidv7(), id, s.accountId, s.amountMinor, s.currency, now, now)
    }
  })()
  return id
}

export function createTransaction(db: Db, input: NewTransaction): void {
  if (input.kind === 'transfer') {
    const splits = transferSplits(
      getLedgerAccount(db, input.fromAccountId),
      getLedgerAccount(db, input.toAccountId),
      input.amountMinor,
      input.receivedMinor
    )
    insertTransaction(db, { date: input.date, payee: 'Transfer', memo: input.memo }, splits)
    return
  }
  const account = getLedgerAccount(db, input.accountId)
  const splits =
    input.kind === 'expense'
      ? expenseSplits(account, input.amountMinor)
      : incomeSplits(account, input.amountMinor)
  insertTransaction(db, input, splits)
}

// shortcut: newest 500 only, no paging; add paging or a date filter when lists outgrow it.
export function listTransactions(db: Db): TransactionRow[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.date, t.payee, t.memo, a.name AS accountName, s.amount_minor AS amountMinor, s.currency
       FROM (SELECT * FROM transactions WHERE deleted_at IS NULL
             ORDER BY date DESC, id DESC LIMIT 500) t
       JOIN splits s ON s.transaction_id = t.id AND s.deleted_at IS NULL
       JOIN accounts a ON a.id = s.account_id AND a.type IN ('asset', 'liability')
       ORDER BY t.date DESC, t.id DESC`
    )
    .all() as (Header & {
    id: string
    accountName: string
    amountMinor: number
    currency: string
  })[]
  const byId = new Map<string, typeof rows>()
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row])
  return [...byId.values()].map((splits) => {
    const { id, date, payee, memo } = splits[0]
    return { id, date, payee, memo, ...describeTransaction(splits) }
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
