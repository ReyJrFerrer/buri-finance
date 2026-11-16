import type { Budget, Category, Proposal, Rule } from '../../shared/ipc'
import { baseCurrency } from '../../shared/presets'
import {
  addDays,
  budgetStatus,
  monthEnd,
  monthStart,
  proposeAllocation,
  prorateMonth,
  weekRange
} from '../ledger/budgets'
import { systemAccounts } from '../ledger/posting'
import type { Db } from './connection'
import { uuidv7 } from './id'

// Budgets are kept per category per month, in the base currency. Weekly figures are derived.

export function listCategories(db: Db): Category[] {
  return db
    .prepare(
      'SELECT id, name FROM categories WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE'
    )
    .all() as Category[]
}

export function createCategory(db: Db, name: string): void {
  const now = new Date().toISOString()
  db.prepare('INSERT INTO categories (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    uuidv7(),
    name,
    now,
    now
  )
}

function softDelete(db: Db, table: 'categories' | 'allocation_rules', id: string): void {
  const now = new Date().toISOString()
  const { changes } = db
    .prepare(
      `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
    )
    .run(now, now, id)
  if (changes === 0) throw new Error('Not found')
}

// Spending already recorded keeps its category; the category just leaves budgets and pickers.
export const deleteCategory = (db: Db, id: string): void => softDelete(db, 'categories', id)
export const deleteRule = (db: Db, id: string): void => softDelete(db, 'allocation_rules', id)

function monthlyPeriodId(db: Db, date: string): string {
  const start = monthStart(date)
  const existing = db
    .prepare("SELECT id FROM budget_periods WHERE kind = 'monthly' AND start_date = ?")
    .get(start) as { id: string } | undefined
  if (existing) return existing.id
  const id = uuidv7()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO budget_periods (id, kind, start_date, end_date, created_at, updated_at)
     VALUES (?, 'monthly', ?, ?, ?, ?)`
  ).run(id, start, monthEnd(date), now, now)
  return id
}

interface BudgetInput {
  categoryId: string
  month: string
  amountMinor: number
  rollover: boolean
}

export function setBudget(db: Db, input: BudgetInput): void {
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO budget_allocations (id, category_id, period_id, amount_minor, currency, rollover, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (category_id, period_id) DO UPDATE SET
         amount_minor = excluded.amount_minor, rollover = excluded.rollover, updated_at = excluded.updated_at`
    ).run(
      uuidv7(),
      input.categoryId,
      monthlyPeriodId(db, input.month),
      input.amountMinor,
      baseCurrency,
      input.rollover ? 1 : 0,
      now,
      now
    )
  })()
}

interface AllocationRow {
  categoryId: string
  month: string
  amountMinor: number
  rollover: boolean
}

function allocations(db: Db): AllocationRow[] {
  const rows = db
    .prepare(
      `SELECT a.category_id AS categoryId, substr(p.start_date, 1, 7) AS month,
              a.amount_minor AS amountMinor, a.rollover
       FROM budget_allocations a JOIN budget_periods p ON p.id = a.period_id
       WHERE p.kind = 'monthly' AND a.deleted_at IS NULL`
    )
    .all() as (Omit<AllocationRow, 'rollover'> & { rollover: number })[]
  return rows.map((r) => ({ ...r, rollover: r.rollover === 1 }))
}

// Adds confirmed income to a category's budget for the month of `date`.
export function addToBudget(db: Db, categoryId: string, date: string, amountMinor: number): void {
  const month = date.slice(0, 7)
  const rows = allocations(db).filter((r) => r.categoryId === categoryId && r.month <= month)
  const latest = rows.sort((a, b) => b.month.localeCompare(a.month))[0]
  setBudget(db, {
    categoryId,
    month: date,
    amountMinor: (latest?.month === month ? latest.amountMinor : 0) + amountMinor,
    rollover: latest?.rollover ?? false
  })
}

// Spending per category: the expense side of splits in the base currency, by month or date range.
const spendingSql = (groupByMonth: boolean): string => `
  SELECT s.category_id AS categoryId, ${groupByMonth ? 'substr(t.date, 1, 7)' : "''"} AS month,
         SUM(s.amount_minor) AS spentMinor
  FROM splits s JOIN transactions t ON t.id = s.transaction_id
  WHERE s.category_id IS NOT NULL AND s.deleted_at IS NULL
    AND s.account_id = ? AND s.currency = ? AND t.date BETWEEN ? AND ?
  GROUP BY 1, 2`

interface Spending {
  categoryId: string
  month: string
  spentMinor: number
}

export function getBudget(
  db: Db,
  period: 'monthly' | 'weekly',
  date: string,
  weekStart: number
): Budget {
  const range =
    period === 'monthly'
      ? { start: monthStart(date), end: monthEnd(date) }
      : weekRange(date, weekStart)
  const allocated = allocations(db)
  const spending = db
    .prepare(spendingSql(period === 'monthly'))
    .all(
      systemAccounts.expense,
      baseCurrency,
      period === 'monthly' ? '0000-01-01' : range.start,
      range.end
    ) as Spending[]

  const rows = listCategories(db).map(({ id, name }) => {
    const mine = allocated.filter((a) => a.categoryId === id)
    const spent = spending.filter((s) => s.categoryId === id)
    if (period === 'monthly') {
      const spentByMonth = new Map(spent.map((s) => [s.month, s.spentMinor]))
      return { categoryId: id, name, ...budgetStatus(mine, spentByMonth, date.slice(0, 7)) }
    }
    // A week can straddle two months; take that week's share of each month's budget.
    const months = [...new Set([range.start.slice(0, 7), range.end.slice(0, 7)])]
    const budgetedMinor = months.reduce((sum, month) => {
      const amount = mine.find((a) => a.month === month)?.amountMinor ?? 0
      const part = prorateMonth(amount, `${month}-01`, weekStart).find(
        (p) => p.start >= range.start && p.end <= range.end
      )
      return sum + (part?.amountMinor ?? 0)
    }, 0)
    const spentMinor = spent[0]?.spentMinor ?? 0
    return {
      categoryId: id,
      name,
      budgetedMinor,
      carriedMinor: 0,
      spentMinor,
      availableMinor: budgetedMinor - spentMinor,
      rollover: mine.find((a) => a.month === date.slice(0, 7))?.rollover ?? false
    }
  })
  return {
    period,
    ...range,
    previous: addDays(range.start, -1),
    next: addDays(range.end, 1),
    currency: baseCurrency,
    rows
  }
}

export function listRules(db: Db): Rule[] {
  return db
    .prepare(
      `SELECT r.id, r.category_id AS categoryId, c.name AS categoryName, r.kind, r.value
       FROM allocation_rules r JOIN categories c ON c.id = r.category_id
       WHERE r.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY r.position, r.id`
    )
    .all() as Rule[]
}

export function createRule(db: Db, rule: Pick<Rule, 'categoryId' | 'kind' | 'value'>): void {
  if (rule.kind === 'percent' && rule.value > 10_000) throw new Error('A rule cannot exceed 100%')
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO allocation_rules (id, category_id, kind, value, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM allocation_rules), ?, ?)`
  ).run(uuidv7(), rule.categoryId, rule.kind, rule.value, now, now)
}

export function propose(db: Db, amountMinor: number): Proposal {
  const rules = listRules(db)
  return proposeAllocation(amountMinor, rules).map((p) => ({
    ...p,
    name: rules.find((r) => r.categoryId === p.categoryId)?.categoryName ?? ''
  }))
}
