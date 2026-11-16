import { mulDiv } from './decimal'

// Dates are ISO YYYY-MM-DD strings with no time zone; UTC is used only for calendar arithmetic.
const toDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`)
const toIso = (date: Date): string => date.toISOString().slice(0, 10)

export function addDays(iso: string, days: number): string {
  const date = toDate(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return toIso(date)
}

export const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`

export function addMonths(monthStartIso: string, months: number): string {
  const date = toDate(monthStartIso)
  date.setUTCMonth(date.getUTCMonth() + months)
  return toIso(date)
}

export const monthEnd = (iso: string): string => addDays(addMonths(monthStart(iso), 1), -1)

const daysBetween = (from: string, to: string): number =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000)

export interface DateRange {
  start: string
  end: string
}

// The week containing `iso`. weekStart: 0 = Sunday ... 6 = Saturday.
export function weekRange(iso: string, weekStart: number): DateRange {
  const start = addDays(iso, -((toDate(iso).getUTCDay() - weekStart + 7) % 7))
  return { start, end: addDays(start, 6) }
}

// Splits a monthly amount across the month's weeks by days. The last week takes the remainder
// centavos so the parts add up to the monthly amount exactly.
export function prorateMonth(
  amountMinor: number,
  month: string,
  weekStart: number
): (DateRange & { amountMinor: number })[] {
  const first = monthStart(month)
  const last = monthEnd(month)
  const daysInMonth = daysBetween(first, last) + 1
  const parts: (DateRange & { amountMinor: number })[] = []
  let allocated = 0
  for (let start = first; start <= last;) {
    const weekEnd = weekRange(start, weekStart).end
    const end = weekEnd < last ? weekEnd : last
    const isLast = end === last
    const share = isLast
      ? amountMinor - allocated
      : Math.floor((amountMinor * (daysBetween(start, end) + 1)) / daysInMonth)
    allocated += share
    parts.push({ start, end, amountMinor: share })
    start = addDays(end, 1)
  }
  return parts
}

export interface AllocationRule {
  categoryId: string
  kind: 'percent' | 'fixed'
  value: number // basis points for percent, minor units for fixed
}

// Proposes how to divide incoming money. Rules apply in order; each takes its share of the income
// (percent rounded half-even), capped by what is left. Never proposes more than the income.
export function proposeAllocation(
  incomeMinor: number,
  rules: AllocationRule[]
): { categoryId: string; amountMinor: number }[] {
  let remaining = incomeMinor
  const totals = new Map<string, number>()
  for (const rule of rules) {
    const wanted = rule.kind === 'fixed' ? rule.value : mulDiv(incomeMinor, rule.value, 10_000)
    const amount = Math.min(wanted, remaining)
    if (amount <= 0) continue
    remaining -= amount
    totals.set(rule.categoryId, (totals.get(rule.categoryId) ?? 0) + amount)
  }
  return [...totals].map(([categoryId, amountMinor]) => ({ categoryId, amountMinor }))
}

export interface BudgetStatus {
  budgetedMinor: number
  carriedMinor: number
  spentMinor: number
  availableMinor: number
  rollover: boolean
}

// A category's month: budget + money rolled over from earlier months - spending. Unspent money
// carries into the next month while the rollover flag is set; overspending is not carried.
// A month without its own budget row keeps the previous row's flag. Months are 'YYYY-MM'.
export function budgetStatus(
  rows: { month: string; amountMinor: number; rollover: boolean }[],
  spentByMonth: Map<string, number>,
  targetMonth: string
): BudgetStatus {
  const byMonth = new Map(rows.map((r) => [r.month, r]))
  const firstMonth = [...byMonth.keys(), ...spentByMonth.keys(), targetMonth].sort()[0]
  let status: BudgetStatus = {
    budgetedMinor: 0,
    carriedMinor: 0,
    spentMinor: 0,
    availableMinor: 0,
    rollover: false
  }
  for (
    let month = firstMonth;
    month <= targetMonth;
    month = addMonths(`${month}-01`, 1).slice(0, 7)
  ) {
    const row = byMonth.get(month)
    const rollover = row ? row.rollover : status.rollover
    const carriedMinor = status.rollover ? Math.max(0, status.availableMinor) : 0
    const budgetedMinor = row?.amountMinor ?? 0
    const spentMinor = spentByMonth.get(month) ?? 0
    status = {
      budgetedMinor,
      carriedMinor,
      spentMinor,
      availableMinor: budgetedMinor + carriedMinor - spentMinor,
      rollover
    }
  }
  return status
}

export interface GoalProgress {
  remainingMinor: number
  percent: number
  perPeriodMinor: number | null
}

// What is left to save and how much each remaining period needs. The current period counts, and
// a target date that has passed leaves one period. No target date means no per-period figure.
export function goalProgress(
  targetMinor: number,
  savedMinor: number,
  today: string,
  targetDate: string | null,
  period: 'weekly' | 'monthly'
): GoalProgress {
  const remainingMinor = Math.max(0, targetMinor - savedMinor)
  const percent = Math.min(100, Math.max(0, Math.floor((savedMinor * 100) / targetMinor)))
  if (targetDate === null) return { remainingMinor, percent, perPeriodMinor: null }
  const periods =
    period === 'weekly'
      ? Math.floor(daysBetween(today, targetDate) / 7) + 1
      : (Number(targetDate.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
        Number(targetDate.slice(5, 7)) -
        Number(today.slice(5, 7)) +
        1
  // Rounded up so the last period never falls a centavo short.
  return {
    remainingMinor,
    percent,
    perPeriodMinor: Math.ceil(remainingMinor / Math.max(1, periods))
  }
}
