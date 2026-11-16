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

// The weeks that overlap a month: each week's start date and how many of its days fall in it.
export function weeksInMonth(month: string, weekStart: number): { start: string; days: number }[] {
  const last = monthEnd(month)
  const weeks: { start: string; days: number }[] = []
  for (let day = monthStart(month); day <= last;) {
    const week = weekRange(day, weekStart)
    const end = week.end < last ? week.end : last
    weeks.push({ start: week.start, days: daysBetween(day, end) + 1 })
    day = addDays(end, 1)
  }
  return weeks
}

// A weekly amount viewed over a month: each overlapping week counts for its days in the month,
// rounded half-even per week. A display figure; the weekly amounts stay the stored budget.
export function weeklyInMonth(
  amountForWeek: (weekStartIso: string) => number,
  month: string,
  weekStart: number
): number {
  return weeksInMonth(month, weekStart).reduce(
    (sum, w) => sum + mulDiv(amountForWeek(w.start), w.days, 7),
    0
  )
}

// A monthly amount viewed over a week: the week's pro-rated share of each month it touches.
export function monthlyInWeek(
  amountForMonth: (month: string) => number,
  week: DateRange,
  weekStart: number
): number {
  return [...new Set([week.start.slice(0, 7), week.end.slice(0, 7)])].reduce((sum, month) => {
    const part = prorateMonth(amountForMonth(month), `${month}-01`, weekStart).find(
      (p) => p.start >= week.start && p.end <= week.end
    )
    return sum + (part?.amountMinor ?? 0)
  }, 0)
}

// The due dates of a bill between start and end, inclusive. A monthly bill due on the 29th-31st
// falls on the last day of shorter months.
export function billOccurrences(
  dueDate: string,
  repeat: 'none' | 'weekly' | 'monthly',
  start: string,
  end: string
): string[] {
  const dates: string[] = []
  if (repeat === 'none') return dueDate >= start && dueDate <= end ? [dueDate] : []
  if (repeat === 'weekly') {
    const skip = dueDate < start ? Math.ceil(daysBetween(dueDate, start) / 7) * 7 : 0
    for (let d = addDays(dueDate, skip); d <= end; d = addDays(d, 7)) dates.push(d)
    return dates
  }
  const day = Number(dueDate.slice(8, 10))
  const from = dueDate > start ? dueDate : start
  for (let m = monthStart(from); m <= end; m = addMonths(m, 1)) {
    const last = monthEnd(m)
    const d = `${m.slice(0, 8)}${String(Math.min(day, Number(last.slice(8)))).padStart(2, '0')}`
    if (d >= from && d <= end) dates.push(d)
  }
  return dates
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

// A category's period: budget + money rolled over from earlier periods - spending. Unspent money
// carries into the next period while the rollover flag is set; overspending is not carried.
// A period without its own budget row keeps the previous row's flag. A monthly budget is set per
// month ('YYYY-MM' keys); a weekly budget repeats every week until changed (week-start date keys).
// A percentage budget (percentBp) repeats in either cadence and is that share of the period's
// income from `incomeFor`, rounded half-even.
export function budgetStatus(
  rows: { period: string; amountMinor: number; percentBp?: number | null; rollover: boolean }[],
  spentByPeriod: Map<string, number>,
  target: string,
  cadence: 'monthly' | 'weekly' = 'monthly',
  incomeFor: (period: string) => number = () => 0
): BudgetStatus {
  const byPeriod = new Map(rows.map((r) => [r.period, r]))
  const first = [...byPeriod.keys(), ...spentByPeriod.keys(), target].sort()[0]
  const step = (p: string): string =>
    cadence === 'weekly' ? addDays(p, 7) : addMonths(`${p}-01`, 1).slice(0, 7)
  let status: BudgetStatus = {
    budgetedMinor: 0,
    carriedMinor: 0,
    spentMinor: 0,
    availableMinor: 0,
    rollover: false
  }
  let current: (typeof rows)[number] | undefined
  for (let period = first; period <= target; period = step(period)) {
    const own = byPeriod.get(period)
    if (own) current = own
    else if (cadence === 'monthly' && !current?.percentBp) current = undefined
    const rollover = current ? current.rollover : status.rollover
    const carriedMinor = status.rollover ? Math.max(0, status.availableMinor) : 0
    const budgetedMinor = !current
      ? 0
      : current.percentBp
        ? mulDiv(incomeFor(period), current.percentBp, 10_000)
        : current.amountMinor
    const spentMinor = spentByPeriod.get(period) ?? 0
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
