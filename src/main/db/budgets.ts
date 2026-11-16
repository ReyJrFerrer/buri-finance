import type { Budget, Category, Proposal, Rule } from '../../shared/ipc'
import { baseCurrency } from '../../shared/presets'
import {
  addDays,
  budgetStatus,
  monthEnd,
  monthStart,
  monthlyInWeek,
  proposeAllocation,
  weekRange,
  weeklyInMonth,
  type DateRange
} from '../ledger/budgets'
import { mulDiv } from '../ledger/decimal'
import { systemAccounts } from '../ledger/posting'
import type { Db } from './connection'
import { uuidv7 } from './id'
import { getSettings } from './settings'

// Budgets are kept per category per month or per week (the category's cadence), in the base
// currency. Viewing a category in the other cadence shows a derived share.

// isPercent: the category's latest budget is a share of income, so income cannot be added to it.
export function listCategories(db: Db): Category[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.cadence,
              (SELECT a.percent_bp IS NOT NULL
               FROM budget_allocations a JOIN budget_periods p ON p.id = a.period_id
               WHERE a.category_id = c.id AND a.deleted_at IS NULL AND p.kind = c.cadence
               ORDER BY p.start_date DESC LIMIT 1) AS isPercent
       FROM categories c WHERE c.deleted_at IS NULL ORDER BY c.name COLLATE NOCASE`
    )
    .all() as (Omit<Category, 'isPercent'> & { isPercent: number | null })[]
  return rows.map((c) => ({ ...c, isPercent: c.isPercent === 1 }))
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

type Cadence = 'monthly' | 'weekly'

function periodId(db: Db, kind: Cadence, range: DateRange): string {
  const existing = db
    .prepare('SELECT id FROM budget_periods WHERE kind = ? AND start_date = ?')
    .get(kind, range.start) as { id: string } | undefined
  if (existing) return existing.id
  const id = uuidv7()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO budget_periods (id, kind, start_date, end_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, kind, range.start, range.end, now, now)
  return id
}

const periodRange = (kind: Cadence, date: string, weekStart: number): DateRange =>
  kind === 'monthly' ? { start: monthStart(date), end: monthEnd(date) } : weekRange(date, weekStart)

// Monthly rows are keyed 'YYYY-MM', weekly rows by the start of their week.
const periodKey = (kind: Cadence, date: string, weekStart: number): string =>
  kind === 'monthly' ? date.slice(0, 7) : weekRange(date, weekStart).start

function cadenceOf(db: Db, categoryId: string): Cadence {
  const row = db
    .prepare('SELECT cadence FROM categories WHERE id = ? AND deleted_at IS NULL')
    .get(categoryId) as { cadence: Cadence } | undefined
  if (!row) throw new Error('Category not found')
  return row.cadence
}

interface AllocationRow {
  categoryId: string
  kind: Cadence
  start: string
  amountMinor: number
  percentBp: number | null
  rollover: boolean
}

function allocations(db: Db): AllocationRow[] {
  const rows = db
    .prepare(
      `SELECT a.category_id AS categoryId, p.kind, p.start_date AS start,
              a.amount_minor AS amountMinor, a.percent_bp AS percentBp, a.rollover
       FROM budget_allocations a JOIN budget_periods p ON p.id = a.period_id
       WHERE a.deleted_at IS NULL`
    )
    .all() as (Omit<AllocationRow, 'rollover'> & { rollover: number })[]
  return rows.map((r) => ({ ...r, rollover: r.rollover === 1 }))
}

// A category's latest budget row at or before the period containing `date`, in its cadence.
function latestRow(
  db: Db,
  categoryId: string,
  cadence: Cadence,
  date: string,
  weekStart: number
): { key: string; latest: (AllocationRow & { key: string }) | undefined } {
  const key = periodKey(cadence, date, weekStart)
  const rows = allocations(db)
    .filter((a) => a.categoryId === categoryId && a.kind === cadence)
    .map((a) => ({ ...a, key: periodKey(cadence, a.start, weekStart) }))
    .filter((a) => a.key <= key)
  return { key, latest: rows.sort((a, b) => b.key.localeCompare(a.key))[0] }
}

interface BudgetInput {
  categoryId: string
  date: string
  amountMinor: number
  percentBp?: number | null // a share of the period's income instead of a fixed amount
  rollover?: boolean // kept from the latest budget row when omitted
  cadence?: Cadence // changes how often the category is budgeted
}

// Sets the budget of the period (month or week, by the category's cadence) containing `date`.
// A weekly budget applies to that week and every later week until it is set again.
export function setBudget(db: Db, input: BudgetInput): void {
  const now = new Date().toISOString()
  const { weekStart } = getSettings(db)
  db.transaction(() => {
    if (input.cadence) {
      db.prepare('UPDATE categories SET cadence = ?, updated_at = ? WHERE id = ?').run(
        input.cadence,
        now,
        input.categoryId
      )
    }
    const cadence = cadenceOf(db, input.categoryId)
    const rollover =
      input.rollover ??
      latestRow(db, input.categoryId, cadence, input.date, weekStart).latest?.rollover
    db.prepare(
      `INSERT INTO budget_allocations (id, category_id, period_id, amount_minor, percent_bp, currency, rollover, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (category_id, period_id) DO UPDATE SET
         amount_minor = excluded.amount_minor, percent_bp = excluded.percent_bp,
         rollover = excluded.rollover, updated_at = excluded.updated_at`
    ).run(
      uuidv7(),
      input.categoryId,
      periodId(db, cadence, periodRange(cadence, input.date, weekStart)),
      input.percentBp ? 0 : input.amountMinor,
      input.percentBp ?? null,
      baseCurrency,
      rollover ? 1 : 0,
      now,
      now
    )
  })()
}

// A percentage budget follows the income, so a fixed amount cannot be put on top of it.
function assertNotPercent(latest: AllocationRow | undefined, categoryId: string, db: Db): void {
  if (!latest?.percentBp) return
  const { name } = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as {
    name: string
  }
  throw new Error(`${name} is budgeted as a percentage of income`)
}

// Adds confirmed income to a category's budget for the month or week of `date`.
export function addToBudget(db: Db, categoryId: string, date: string, amountMinor: number): void {
  const cadence = cadenceOf(db, categoryId)
  const { weekStart } = getSettings(db)
  const { key, latest } = latestRow(db, categoryId, cadence, date, weekStart)
  assertNotPercent(latest, categoryId, db)
  // A weekly budget carries forward, so this week starts from the latest weekly amount, and the
  // next week is held at that amount so the extra money is for this week only.
  const current = latest && (latest.key === key || cadence === 'weekly') ? latest.amountMinor : 0
  db.transaction(() => {
    const nextWeek = addDays(key, 7)
    if (
      cadence === 'weekly' &&
      latestRow(db, categoryId, cadence, nextWeek, weekStart).latest?.key !== nextWeek
    ) {
      setBudget(db, { categoryId, date: nextWeek, amountMinor: current })
    }
    setBudget(db, { categoryId, date, amountMinor: current + amountMinor })
  })()
}

interface Plan {
  period: Cadence
  date: string
  incomeMinor: number
  allocations: { categoryId: string; amountMinor: number }[]
}

// Saves the income expected per month or week (the plan's period) from that period on, and sets
// the fixed budgets of that period's categories. Categories budgeted in the other cadence, and
// percentage budgets, are left alone.
export function planIncome(db: Db, plan: Plan): void {
  const allocated = plan.allocations.reduce((sum, a) => sum + a.amountMinor, 0)
  if (allocated > plan.incomeMinor) throw new Error('The split is more than the expected income')
  const now = new Date().toISOString()
  const range = periodRange(plan.period, plan.date, getSettings(db).weekStart)
  db.transaction(() => {
    db.prepare(
      `INSERT INTO income_estimates (id, period_id, amount_minor, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (period_id) DO UPDATE SET
         amount_minor = excluded.amount_minor, updated_at = excluded.updated_at, deleted_at = NULL`
    ).run(uuidv7(), periodId(db, plan.period, range), plan.incomeMinor, baseCurrency, now, now)
    // The newest plan wins: a plan in the other cadence starting in this period or later would
    // otherwise outrank it, since the latest start decides.
    db.prepare(
      `UPDATE income_estimates SET deleted_at = ?, updated_at = ?
       WHERE deleted_at IS NULL AND period_id IN
         (SELECT id FROM budget_periods WHERE kind <> ? AND start_date >= ?)`
    ).run(now, now, plan.period, range.start)
    for (const a of plan.allocations) {
      if (cadenceOf(db, a.categoryId) !== plan.period) {
        throw new Error(`Only ${plan.period} categories can be planned in this view`)
      }
      const { weekStart } = getSettings(db)
      assertNotPercent(
        latestRow(db, a.categoryId, plan.period, plan.date, weekStart).latest,
        a.categoryId,
        db
      )
      setBudget(db, { categoryId: a.categoryId, date: plan.date, amountMinor: a.amountMinor })
    }
  })()
}

interface Estimate {
  kind: Cadence
  start: string
  amountMinor: number
}

function estimates(db: Db): Estimate[] {
  return db
    .prepare(
      `SELECT p.kind, p.start_date AS start, e.amount_minor AS amountMinor
       FROM income_estimates e JOIN budget_periods p ON p.id = e.period_id
       WHERE e.deleted_at IS NULL ORDER BY p.start_date`
    )
    .all() as Estimate[]
}

// The planned income for a period. An estimate applies from its month or week until the next
// one; the one in force when the period starts decides whether income is planned per month or
// per week, and the other view shows its share. Null when nothing is planned yet.
function incomeIn(
  all: Estimate[],
  period: Cadence,
  range: DateRange,
  weekStart: number
): { minor: number; setting: Estimate } | null {
  // The plan in force on the period's first day; else the first one starting within the period.
  const setting =
    all.filter((e) => e.start <= range.start).slice(-1)[0] ?? all.find((e) => e.start <= range.end)
  if (!setting) return null
  const same = all.filter((e) => e.kind === setting.kind)
  const amountAt = (key: string): number =>
    same.filter((e) => periodKey(setting.kind, e.start, weekStart) <= key).slice(-1)[0]
      ?.amountMinor ?? 0
  const minor =
    setting.kind === period
      ? amountAt(periodKey(period, range.start, weekStart))
      : period === 'monthly'
        ? weeklyInMonth(amountAt, range.start, weekStart)
        : monthlyInWeek(amountAt, range, weekStart)
  return { minor, setting }
}

// Spending per category per day: the expense side of splits in the base currency.
const spendingSql = `
  SELECT s.category_id AS categoryId, t.date, SUM(s.amount_minor) AS spentMinor
  FROM splits s JOIN transactions t ON t.id = s.transaction_id
  WHERE s.category_id IS NOT NULL AND s.deleted_at IS NULL
    AND s.account_id = ? AND s.currency = ? AND t.date <= ?
  GROUP BY 1, 2`

interface Spending {
  categoryId: string
  date: string
  spentMinor: number
}

export function getBudget(db: Db, period: Cadence, date: string, weekStart: number): Budget {
  const range = periodRange(period, date, weekStart)
  const allocated = allocations(db)
  const plans = estimates(db)
  const income = incomeIn(plans, period, range, weekStart)
  const spending = db
    .prepare(spendingSql)
    .all(systemAccounts.expense, baseCurrency, range.end) as Spending[]

  const rows = listCategories(db).map(({ id, name, cadence }) => {
    const key = (d: string): string => periodKey(cadence, d, weekStart)
    const incomeFor = (k: string): number =>
      incomeIn(
        plans,
        cadence,
        periodRange(cadence, k.length === 7 ? `${k}-01` : k, weekStart),
        weekStart
      )?.minor ?? 0
    const mine = allocated
      .filter((a) => a.categoryId === id && a.kind === cadence)
      .map((a) => ({ ...a, period: key(a.start) }))
      .sort((a, b) => a.period.localeCompare(b.period))
    // The row in force for a period: its own, else a carried-forward weekly or percentage row.
    const rowAt = (k: string): (typeof mine)[number] | undefined => {
      const latest = mine.filter((m) => m.period <= k).slice(-1)[0]
      return latest && (latest.period === k || cadence === 'weekly' || latest.percentBp)
        ? latest
        : undefined
    }
    const spent = spending.filter((s) => s.categoryId === id)
    const spentByPeriod = new Map<string, number>()
    for (const s of spent) {
      spentByPeriod.set(key(s.date), (spentByPeriod.get(key(s.date)) ?? 0) + s.spentMinor)
    }
    // The category in its own cadence, for the period containing `date`.
    const own = budgetStatus(mine, spentByPeriod, key(date), cadence, incomeFor)
    const percentBp = rowAt(key(date))?.percentBp ?? null
    const row = { categoryId: id, name, cadence, percentBp, setMinor: own.budgetedMinor }
    if (cadence === period) return { ...row, ...own }

    // Viewed in the other cadence: that period's share of the budget, without rollover. A
    // percentage is taken of this period's income.
    const fixedAt = (k: string): number => {
      const r = rowAt(k)
      return r && !r.percentBp ? r.amountMinor : 0
    }
    const viewPercent = rowAt(key(range.start))?.percentBp
    const budgetedMinor = viewPercent
      ? mulDiv(income?.minor ?? 0, viewPercent, 10_000)
      : period === 'monthly'
        ? weeklyInMonth(fixedAt, date, weekStart)
        : monthlyInWeek(fixedAt, range, weekStart)
    const spentMinor = spent
      .filter((s) => s.date >= range.start)
      .reduce((sum, s) => sum + s.spentMinor, 0)
    return {
      ...row,
      budgetedMinor,
      carriedMinor: 0,
      spentMinor,
      availableMinor: budgetedMinor - spentMinor,
      rollover: own.rollover
    }
  })
  return {
    period,
    ...range,
    previous: addDays(range.start, -1),
    next: addDays(range.end, 1),
    currency: baseCurrency,
    incomeMinor: income?.minor ?? null,
    income: income
      ? { cadence: income.setting.kind, amountMinor: income.setting.amountMinor }
      : null,
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
