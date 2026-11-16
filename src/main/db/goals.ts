import type { Goal, NewGoal } from '../../shared/ipc'
import { baseCurrency } from '../../shared/presets'
import { goalProgress } from '../ledger/budgets'
import { getLedgerAccount, listAccounts } from './accounts'
import { getBudget } from './budgets'
import type { Db } from './connection'
import { uuidv7 } from './id'

interface GoalRow {
  id: string
  name: string
  targetMinor: number
  currency: string
  targetDate: string | null
  accountId: string | null
  categoryId: string | null
}

// A goal's saved amount is its linked account's value, or its linked category's available budget.
export function listGoals(db: Db, today: string, period: 'weekly' | 'monthly'): Goal[] {
  const goals = db
    .prepare(
      `SELECT id, name, target_minor AS targetMinor, currency, target_date AS targetDate,
              account_id AS accountId, category_id AS categoryId
       FROM goals WHERE deleted_at IS NULL ORDER BY id`
    )
    .all() as GoalRow[]
  const accounts = listAccounts(db)
  const categories = getBudget(db, 'monthly', today, 1).rows
  return goals.map(({ accountId, categoryId, ...goal }) => {
    const account = accounts.find((a) => a.id === accountId)
    const category = categories.find((c) => c.categoryId === categoryId)
    const savedMinor = account
      ? account.balanceMinor + account.holdingsMinor
      : (category?.availableMinor ?? 0)
    return {
      ...goal,
      linkLabel: account?.name ?? category?.name ?? '',
      savedMinor,
      period,
      ...goalProgress(goal.targetMinor, savedMinor, today, goal.targetDate, period)
    }
  })
}

export function createGoal(db: Db, input: NewGoal): void {
  const currency = input.accountId ? getLedgerAccount(db, input.accountId).currency : baseCurrency
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO goals (id, name, target_minor, currency, target_date, account_id, category_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuidv7(),
    input.name,
    input.targetMinor,
    currency,
    input.targetDate,
    input.accountId,
    input.categoryId,
    now,
    now
  )
}

export function deleteGoal(db: Db, id: string): void {
  const now = new Date().toISOString()
  const { changes } = db
    .prepare('UPDATE goals SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(now, now, id)
  if (changes === 0) throw new Error('Goal not found')
}
