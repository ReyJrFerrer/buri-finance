import type { MonthActivity, NewTransaction, TransactionRow } from '../../shared/ipc'
import {
  assertBalanced,
  describeTransaction,
  expenseSplits,
  incomeSplits,
  systemAccounts,
  transferSplits,
  type Split
} from '../ledger/posting'
import { addMonths, monthEnd, monthStart } from '../ledger/budgets'
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

// shortcut: loads history for client-side paging; move paging to SQL if large ledgers become slow.
export function listTransactions(db: Db): TransactionRow[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.date, t.payee, t.memo, a.name AS accountName, s.amount_minor AS amountMinor, s.currency,
         COALESCE((SELECT c.name FROM splits cs JOIN categories c ON c.id = cs.category_id
                   WHERE cs.transaction_id = t.id LIMIT 1), '') AS category,
         (SELECT cs.account_id FROM splits cs JOIN accounts ca ON ca.id = cs.account_id
          WHERE cs.transaction_id = t.id AND cs.deleted_at IS NULL
            AND ca.type NOT IN ('asset', 'liability') LIMIT 1) AS counterId
       FROM (SELECT * FROM transactions WHERE deleted_at IS NULL
             ORDER BY date DESC, id DESC) t
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
    counterId: string | null
  })[]
  const byId = new Map<string, typeof rows>()
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row])
  return [...byId.values()].map((splits) => {
    const { id, date, payee, memo, category, counterId } = splits[0]
    return {
      id,
      date,
      payee,
      memo,
      category,
      ...describeTransaction(splits),
      kind: transactionKind(counterId)
    }
  })
}

// What a transaction is, from the first split outside the user's own accounts.
function transactionKind(counterId: string | null): TransactionRow['kind'] {
  if (counterId === null || counterId === systemAccounts.exchange) return 'transfer'
  if (counterId === systemAccounts.expense) return 'expense'
  if (counterId === systemAccounts.income) return 'income'
  if (counterId === systemAccounts.opening) return 'opening'
  return 'other'
}

// Puts an expense in a budget category.
export function categorizeTransaction(db: Db, id: string, categoryId: string): void {
  db.transaction(() => {
    const category = db
      .prepare('SELECT 1 FROM categories WHERE id = ? AND deleted_at IS NULL')
      .get(categoryId)
    if (!category) throw new Error('Category not found')
    const { changes } = db
      .prepare(
        `UPDATE splits SET category_id = ?, updated_at = ?
         WHERE transaction_id = ? AND account_id = ? AND deleted_at IS NULL`
      )
      .run(categoryId, new Date().toISOString(), id, systemAccounts.expense)
    if (changes === 0) throw new Error('Only an expense can be categorized')
  })()
}

// Income minus spending per day in the base currency, for walking net worth back in time.
export function dailyFlows(db: Db): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT t.date, -SUM(s.amount_minor) AS flowMinor
       FROM transactions t
       JOIN splits s ON s.transaction_id = t.id AND s.deleted_at IS NULL
       WHERE t.deleted_at IS NULL AND s.account_id IN (?, ?) AND s.currency = ?
       GROUP BY t.date`
    )
    .all(systemAccounts.income, systemAccounts.expense, baseCurrency) as {
    date: string
    flowMinor: number
  }[]
  return new Map(rows.map((r) => [r.date, r.flowMinor]))
}

export function firstTransactionDate(db: Db): string | null {
  const row = db
    .prepare('SELECT MIN(date) AS date FROM transactions WHERE deleted_at IS NULL')
    .get() as { date: string | null }
  return row.date
}

// Income and spending per day of the month containing `date`. Transfers, opening balances and
// investment trades are neither, so they only count as transactions.
// shortcut: amounts cover the base currency only; add per-currency totals when income or
// spending in another currency needs to show here.
export function monthActivity(db: Db, date: string): MonthActivity {
  const start = monthStart(date)
  const end = monthEnd(date)
  const days = db
    .prepare(
      `SELECT t.date,
         COALESCE(SUM(CASE WHEN a.type = 'income' AND s.currency = ? THEN -s.amount_minor END), 0) AS incomeMinor,
         COALESCE(SUM(CASE WHEN a.type = 'expense' AND s.currency = ? THEN s.amount_minor END), 0) AS expenseMinor,
         COUNT(DISTINCT t.id) AS count
       FROM transactions t
       JOIN splits s ON s.transaction_id = t.id AND s.deleted_at IS NULL
       JOIN accounts a ON a.id = s.account_id
       WHERE t.deleted_at IS NULL AND t.date BETWEEN ? AND ?
       GROUP BY t.date ORDER BY t.date`
    )
    .all(baseCurrency, baseCurrency, start, end) as MonthActivity['days']
  const total = (pick: (day: MonthActivity['days'][number]) => number): number =>
    days.reduce((sum, day) => sum + pick(day), 0)
  const counts = db
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN s.account_id = ? THEN t.id END) AS incomeCount,
         COUNT(DISTINCT CASE WHEN s.account_id = ? THEN t.id END) AS expenseCount,
         COUNT(DISTINCT CASE WHEN s.account_id = ? AND s.category_id IS NULL THEN t.id END)
           AS uncategorizedCount,
         COALESCE(SUM(CASE WHEN s.account_id = ? AND s.category_id IS NULL THEN s.amount_minor END), 0)
           AS uncategorizedMinor
       FROM transactions t
       JOIN splits s ON s.transaction_id = t.id AND s.deleted_at IS NULL
       WHERE t.deleted_at IS NULL AND s.currency = ? AND t.date BETWEEN ? AND ?`
    )
    .get(
      systemAccounts.income,
      systemAccounts.expense,
      systemAccounts.expense,
      systemAccounts.expense,
      baseCurrency,
      start,
      end
    ) as Pick<
    MonthActivity,
    'incomeCount' | 'expenseCount' | 'uncategorizedCount' | 'uncategorizedMinor'
  >
  const openingDates = (
    db
      .prepare(
        `SELECT DISTINCT t.date FROM transactions t
         JOIN splits s ON s.transaction_id = t.id AND s.deleted_at IS NULL
         WHERE t.deleted_at IS NULL AND s.account_id = ? AND t.date BETWEEN ? AND ?
         ORDER BY t.date`
      )
      .all(systemAccounts.opening, start, end) as { date: string }[]
  ).map((r) => r.date)
  return {
    start,
    end,
    previous: addMonths(start, -1),
    next: addMonths(start, 1),
    currency: baseCurrency,
    incomeMinor: total((d) => d.incomeMinor),
    expenseMinor: total((d) => d.expenseMinor),
    count: total((d) => d.count),
    ...counts,
    openingDates,
    days
  }
}

export function hasTransactionOn(db: Db, date: string): boolean {
  return !!db
    .prepare('SELECT 1 FROM transactions WHERE date = ? AND deleted_at IS NULL LIMIT 1')
    .get(date)
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
