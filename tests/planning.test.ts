import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createAccount, listAccounts } from '../src/main/db/accounts'
import { createBill, deleteBill, listBills, payBill } from '../src/main/db/bills'
import {
  createCategory,
  createRule,
  deleteCategory,
  getBudget,
  listCategories,
  listRules,
  planIncome,
  propose,
  setBudget
} from '../src/main/db/budgets'
import { openDatabase, type Db } from '../src/main/db/connection'
import { createGoal, listGoals } from '../src/main/db/goals'
import {
  buy,
  deleteLot,
  getInvestments,
  latestRates,
  sell,
  setFxRate,
  setPrice
} from '../src/main/db/investments'
import { migrate, migrations } from '../src/main/db/migrate'
import {
  categorizeTransaction,
  createTransaction,
  dailyFlows,
  deleteTransaction,
  firstTransactionDate,
  hasTransactionOn,
  listTransactions,
  monthActivity
} from '../src/main/db/transactions'
import { shouldRemind } from '../src/main/ledger/reminders'
import {
  addDays,
  billOccurrences,
  budgetStatus,
  monthlyInWeek,
  goalProgress,
  proposeAllocation,
  prorateMonth,
  weekRange,
  weeklyInMonth,
  weeksInMonth
} from '../src/main/ledger/budgets'
import { convertMinor, mulDiv, valueMinor } from '../src/main/ledger/decimal'
import { netWorth } from '../src/main/ledger/posting'
import { refreshFxRates } from '../src/main/prices/fx'
import { ipcContract, type Account, type Budget } from '../src/shared/ipc'
import { formatQuantity, isDecimalString, parseQuantityE8 } from '../src/shared/money'

const open = (): Db => {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'buri-')), 'p.db'), 'a'.repeat(64))
  migrate(db, migrations)
  return db
}
const account = (db: Db, name: string, currency = 'PHP', openingBalanceMinor = 0): Account =>
  createAccount(db, {
    name,
    type: 'asset',
    institution: null,
    currency,
    parentId: null,
    openingBalanceMinor,
    openingDate: '2026-01-01'
  })
const category = (db: Db, name: string): string => {
  createCategory(db, name)
  return listCategories(db).find((c) => c.name === name)!.id
}
const spend = (
  db: Db,
  accountId: string,
  categoryId: string,
  amountMinor: number,
  date: string
): string =>
  createTransaction(db, {
    kind: 'expense',
    accountId,
    amountMinor,
    date,
    payee: '',
    memo: '',
    categoryId
  })
const sum = (parts: { amountMinor: number }[]): number =>
  parts.reduce((s, p) => s + p.amountMinor, 0)

describe('decimal maths', () => {
  it('rounds half-even, once', () => {
    expect(mulDiv(5, 1, 2)).toBe(2) // 2.5 -> 2
    expect(mulDiv(7, 1, 2)).toBe(4) // 3.5 -> 4
    expect(mulDiv(100000, 3333, 10000)).toBe(33330)
    expect(valueMinor(1e8, '0.125')).toBe(12) // 12.5 -> 12
    expect(valueMinor(1e8, '0.135')).toBe(14) // 13.5 -> 14
  })

  it('values fractional shares exactly', () => {
    expect(valueMinor(parseQuantityE8('0.12345678')!, '187.45')).toBe(2314) // 23.1419...
    expect(valueMinor(parseQuantityE8('1500')!, '128.50')).toBe(19275000)
    expect(valueMinor(3e7, '0.1')).toBe(3) // 0.3 * 0.1 = 0.03 exactly, not 0.030000000000000002
    expect(convertMinor(10000, '58.125')).toBe(581250)
  })

  it('parses and formats quantities and decimal strings', () => {
    expect(parseQuantityE8('0.5')).toBe(50000000)
    expect(parseQuantityE8('1.123456789')).toBeNull()
    expect(parseQuantityE8('-1')).toBeNull()
    expect(formatQuantity(150000000000)).toBe('1,500')
    expect(formatQuantity(12345678)).toBe('0.12345678')
    expect(isDecimalString('58.25')).toBe(true)
    for (const bad of ['0', '0.00', '-1', '1e5', '1.', 'abc', '']) {
      expect(isDecimalString(bad)).toBe(false)
    }
  })
})

describe('budget maths', () => {
  it('finds the week for any week start', () => {
    // 2026-02-11 is a Wednesday
    expect(weekRange('2026-02-11', 1)).toEqual({ start: '2026-02-09', end: '2026-02-15' })
    expect(weekRange('2026-02-11', 0)).toEqual({ start: '2026-02-08', end: '2026-02-14' })
    expect(weekRange('2026-02-09', 1).start).toBe('2026-02-09')
  })

  it('pro-rates a month by days and gives the remainder to the last week', () => {
    // February 2026 starts on a Sunday: 1 day, then four full weeks minus one day.
    const parts = prorateMonth(10000, '2026-02-01', 1)
    expect(parts.map((p) => [p.start, p.end])).toEqual([
      ['2026-02-01', '2026-02-01'],
      ['2026-02-02', '2026-02-08'],
      ['2026-02-09', '2026-02-15'],
      ['2026-02-16', '2026-02-22'],
      ['2026-02-23', '2026-02-28']
    ])
    expect(parts.map((p) => p.amountMinor)).toEqual([357, 2500, 2500, 2500, 2143])
    expect(sum(parts)).toBe(10000)
  })

  it('always adds up to the monthly amount', () => {
    for (const amount of [0, 1, 99, 100001, 123456789]) {
      for (const month of ['2026-01-01', '2026-02-01', '2028-02-01', '2026-04-01']) {
        for (const weekStart of [0, 1, 6]) {
          const parts = prorateMonth(amount, month, weekStart)
          expect(sum(parts)).toBe(amount)
          expect(parts.every((p) => p.amountMinor >= 0)).toBe(true)
        }
      }
    }
  })

  it('proposes allocations in order, rounding half-even and never exceeding the income', () => {
    const rules = [
      { categoryId: 'rent', kind: 'fixed' as const, value: 1500000 },
      { categoryId: 'save', kind: 'percent' as const, value: 2000 },
      { categoryId: 'fun', kind: 'percent' as const, value: 1000 }
    ]
    expect(proposeAllocation(5000000, rules)).toEqual([
      { categoryId: 'rent', amountMinor: 1500000 },
      { categoryId: 'save', amountMinor: 1000000 },
      { categoryId: 'fun', amountMinor: 500000 }
    ])
    // Income smaller than the rules ask for: later rules get what is left, then nothing.
    expect(proposeAllocation(1600000, rules)).toEqual([
      { categoryId: 'rent', amountMinor: 1500000 },
      { categoryId: 'save', amountMinor: 100000 }
    ])
    // 12.5% of 0.05 is 0.625 centavos -> 1; of 0.20 is 2.5 centavos -> 2 (half-even)
    expect(
      proposeAllocation(5, [{ categoryId: 'a', kind: 'percent', value: 1250 }])[0].amountMinor
    ).toBe(1)
    expect(
      proposeAllocation(20, [{ categoryId: 'a', kind: 'percent', value: 1250 }])[0].amountMinor
    ).toBe(2)
    expect(proposeAllocation(100, [])).toEqual([])
  })

  it('rolls unspent money over only while the flag is set, and never carries overspending', () => {
    const spent = new Map([
      ['2026-01', 3000],
      ['2026-02', 12000]
    ])
    const rows = [{ period: '2026-01', amountMinor: 10000, rollover: true }]
    expect(budgetStatus(rows, spent, '2026-01')).toMatchObject({
      carriedMinor: 0,
      availableMinor: 7000
    })
    // February has no row: keeps the flag, carries 7,000, overspends by 5,000
    expect(budgetStatus(rows, spent, '2026-02')).toMatchObject({
      budgetedMinor: 0,
      carriedMinor: 7000,
      availableMinor: -5000,
      rollover: true
    })
    expect(budgetStatus(rows, spent, '2026-03')).toMatchObject({
      carriedMinor: 0,
      availableMinor: 0
    })
    const noRollover = [{ period: '2026-01', amountMinor: 10000, rollover: false }]
    expect(budgetStatus(noRollover, new Map(), '2026-02').carriedMinor).toBe(0)
    // Crosses a year boundary
    const december = [{ period: '2025-12', amountMinor: 500, rollover: true }]
    expect(budgetStatus(december, new Map(), '2026-01').availableMinor).toBe(500)
  })

  it('repeats a weekly budget until it changes, rolling unspent money week to week', () => {
    const rows = [
      { period: '2026-02-02', amountMinor: 1000, rollover: true },
      { period: '2026-02-23', amountMinor: 500, rollover: true }
    ]
    const spent = new Map([
      ['2026-02-02', 400],
      ['2026-02-09', 1500]
    ])
    const week = (target: string): object => budgetStatus(rows, spent, target, 'weekly')
    expect(week('2026-02-02')).toMatchObject({ budgetedMinor: 1000, availableMinor: 600 })
    expect(week('2026-02-09')).toMatchObject({
      budgetedMinor: 1000,
      carriedMinor: 600,
      availableMinor: 100
    })
    expect(week('2026-02-16')).toMatchObject({ budgetedMinor: 1000, availableMinor: 1100 })
    expect(week('2026-03-02')).toMatchObject({ budgetedMinor: 500, carriedMinor: 1600 })
  })

  it('views a weekly amount over a month by the days of each week in it', () => {
    // February 2026 starts on a Sunday; weeks start on Monday
    expect(weeksInMonth('2026-02-01', 1)).toEqual([
      { start: '2026-01-26', days: 1 },
      { start: '2026-02-02', days: 7 },
      { start: '2026-02-09', days: 7 },
      { start: '2026-02-16', days: 7 },
      { start: '2026-02-23', days: 6 }
    ])
    // 1000 * 1/7 = 142.86 -> 143 and 1000 * 6/7 = 857.14 -> 857, so 28 days come to 4000
    expect(weeklyInMonth(() => 1000, '2026-02-01', 1)).toBe(4000)
    // Rounded per week: 4 * 1/7 = 0.57 -> 1 and 4 * 6/7 = 3.43 -> 3
    expect(weeklyInMonth(() => 4, '2026-02-01', 1)).toBe(16)
    expect(weeklyInMonth((w) => (w >= '2026-02-09' ? 700 : 0), '2026-02-01', 1)).toBe(2000)
  })

  it('lists the due dates of one-off, weekly and monthly bills', () => {
    expect(billOccurrences('2026-01-31', 'monthly', '2026-02-01', '2026-04-30')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30'
    ])
    expect(billOccurrences('2028-01-31', 'monthly', '2028-02-01', '2028-02-29')).toEqual([
      '2028-02-29'
    ])
    // Nothing before the first due date
    expect(billOccurrences('2026-03-15', 'monthly', '2026-02-01', '2026-03-31')).toEqual([
      '2026-03-15'
    ])
    expect(billOccurrences('2026-01-05', 'weekly', '2026-02-01', '2026-02-28')).toEqual([
      '2026-02-02',
      '2026-02-09',
      '2026-02-16',
      '2026-02-23'
    ])
    expect(billOccurrences('2026-02-20', 'weekly', '2026-02-01', '2026-02-28')).toEqual([
      '2026-02-20',
      '2026-02-27'
    ])
    expect(billOccurrences('2026-02-10', 'none', '2026-02-01', '2026-02-28')).toEqual([
      '2026-02-10'
    ])
    expect(billOccurrences('2026-03-10', 'none', '2026-02-01', '2026-02-28')).toEqual([])
  })

  it('makes a percentage budget follow the income and carry into later months', () => {
    const rows = [{ period: '2026-01', amountMinor: 0, percentBp: 2000, rollover: true }]
    const income = (p: string): number => (p === '2026-02' ? 50001 : 100000)
    expect(budgetStatus(rows, new Map(), '2026-01', 'monthly', income)).toMatchObject({
      budgetedMinor: 20000
    })
    // 20% of 500.01 is 100.002, rounded half-even to 100.00, plus January's unspent 200.00
    expect(budgetStatus(rows, new Map(), '2026-02', 'monthly', income)).toMatchObject({
      budgetedMinor: 10000,
      carriedMinor: 20000,
      availableMinor: 30000
    })
    // A fixed monthly row after it stops the carry-forward the next month
    const fixed = [
      ...rows,
      { period: '2026-03', amountMinor: 700, percentBp: null, rollover: false }
    ]
    expect(budgetStatus(fixed, new Map(), '2026-03', 'monthly', income).budgetedMinor).toBe(700)
    expect(budgetStatus(fixed, new Map(), '2026-04', 'monthly', income).budgetedMinor).toBe(0)
  })

  it('views a monthly amount over a week as its share of each month the week touches', () => {
    // Feb 23 to Mar 1 (weeks from Monday): 6/28 of February and 1/31 of March
    const week = { start: '2026-02-23', end: '2026-03-01' }
    expect(monthlyInWeek((m) => (m === '2026-02' ? 28000 : 31000), week, 1)).toBe(7000)
    // The weeks of a month add up to the month exactly
    const weeks = ['2026-02-02', '2026-02-09', '2026-02-16'].map((start) => ({
      start,
      end: addDays(start, 6)
    }))
    const parts = [{ start: '2026-01-26', end: '2026-02-01' }, ...weeks, week].map((w) =>
      monthlyInWeek((m) => (m === '2026-02' ? 10001 : 0), w, 1)
    )
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10001)
  })

  it('derives what a goal needs per period', () => {
    // 100,000 target, 40,000 saved, due in the 4th month from now: 60,000 over 4 months
    expect(goalProgress(10000000, 4000000, '2026-03-15', '2026-06-30', 'monthly')).toEqual({
      remainingMinor: 6000000,
      percent: 40,
      perPeriodMinor: 1500000
    })
    // Rounds up so the goal is not missed by a centavo: 100 / 3 -> 34
    expect(goalProgress(100, 0, '2026-01-01', '2026-03-01', 'monthly').perPeriodMinor).toBe(34)
    expect(goalProgress(1000, 0, '2026-01-01', '2026-01-15', 'weekly').perPeriodMinor).toBe(334)
    expect(goalProgress(1000, 0, '2026-05-01', '2026-01-01', 'monthly').perPeriodMinor).toBe(1000)
    expect(goalProgress(1000, 0, '2026-05-01', null, 'monthly').perPeriodMinor).toBeNull()
    expect(goalProgress(1000, 2500, '2026-01-01', '2026-12-01', 'monthly')).toEqual({
      remainingMinor: 0,
      percent: 100,
      perPeriodMinor: 0
    })
  })
})

describe('budgets database', () => {
  it('tracks budget, spending and rollover per category', () => {
    const db = open()
    const gotyme = account(db, 'GoTyme', 'PHP', 10000000)
    const food = category(db, 'Food')
    const fun = category(db, 'Fun')
    setBudget(db, { categoryId: food, date: '2026-02-10', amountMinor: 1000000, rollover: true })
    spend(db, gotyme.id, food, 250000, '2026-02-03')
    spend(db, gotyme.id, food, 50000, '2026-02-20')
    spend(db, gotyme.id, fun, 9900, '2026-02-20')

    const february = getBudget(db, 'monthly', '2026-02-15', 1)
    expect(february).toMatchObject({ start: '2026-02-01', end: '2026-02-28', currency: 'PHP' })
    expect(february.rows.find((r) => r.name === 'Food')).toMatchObject({
      budgetedMinor: 1000000,
      spentMinor: 300000,
      availableMinor: 700000
    })
    expect(february.rows.find((r) => r.name === 'Fun')).toMatchObject({ availableMinor: -9900 })
    expect(
      getBudget(db, 'monthly', '2026-03-01', 1).rows.find((r) => r.name === 'Food')
    ).toMatchObject({
      carriedMinor: 700000,
      availableMinor: 700000
    })
    expect(ipcContract['budgets:get'].output.safeParse(february).success).toBe(true)
    expect(listTransactions(db).find((t) => t.amountMinor === -9900)?.category).toBe('Fun')

    // Setting the same month again replaces the amount
    setBudget(db, { categoryId: food, date: '2026-02-01', amountMinor: 500000, rollover: false })
    expect(
      getBudget(db, 'monthly', '2026-02-15', 1).rows.find((r) => r.name === 'Food')?.budgetedMinor
    ).toBe(500000)

    deleteCategory(db, fun)
    expect(getBudget(db, 'monthly', '2026-02-15', 1).rows.map((r) => r.name)).toEqual(['Food'])
  })

  it('shows a week as its pro-rated share, with weekly parts adding up to the month', () => {
    const db = open()
    const gotyme = account(db, 'GoTyme', 'PHP', 10000000)
    const food = category(db, 'Food')
    setBudget(db, { categoryId: food, date: '2026-02-01', amountMinor: 10000, rollover: false })
    spend(db, gotyme.id, food, 1200, '2026-02-10')
    const week = getBudget(db, 'weekly', '2026-02-11', 1)
    expect(week).toMatchObject({ start: '2026-02-09', end: '2026-02-15' })
    expect(week.rows[0]).toMatchObject({
      budgetedMinor: 2500,
      spentMinor: 1200,
      availableMinor: 1300
    })
    const weeks = ['2026-02-01', '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23']
    expect(weeks.reduce((s, d) => s + getBudget(db, 'weekly', d, 1).rows[0].budgetedMinor, 0)).toBe(
      10000
    )
    // A week across two months takes a share of each
    setBudget(db, { categoryId: food, date: '2026-03-01', amountMinor: 31000, rollover: false })
    // Feb 23-28 share is 2143, Mar 1 share is 1000
    expect(getBudget(db, 'weekly', '2026-02-25', 1).rows[0].budgetedMinor).toBe(3143)
  })

  it('proposes an income split from the rules and adds the confirmed split to budgets', () => {
    const db = open()
    const gotyme = account(db, 'GoTyme')
    const gotrade = account(db, 'GoTrade', 'USD')
    const rent = category(db, 'Rent')
    const savings = category(db, 'Savings')
    createRule(db, { categoryId: rent, kind: 'fixed', value: 1500000 })
    createRule(db, { categoryId: savings, kind: 'percent', value: 2000 })
    expect(() => createRule(db, { categoryId: rent, kind: 'percent', value: 10001 })).toThrow(
      '100%'
    )
    expect(listRules(db).map((r) => r.categoryName)).toEqual(['Rent', 'Savings'])
    expect(propose(db, 5000000)).toEqual([
      { categoryId: rent, name: 'Rent', amountMinor: 1500000 },
      { categoryId: savings, name: 'Savings', amountMinor: 1000000 }
    ])

    const income = {
      kind: 'income' as const,
      amountMinor: 5000000,
      date: '2026-02-05',
      payee: 'Salary',
      memo: ''
    }
    // The user edited the proposal before confirming
    createTransaction(db, {
      ...income,
      accountId: gotyme.id,
      allocations: [
        { categoryId: rent, amountMinor: 1500000 },
        { categoryId: savings, amountMinor: 800000 }
      ]
    })
    createTransaction(db, {
      ...income,
      accountId: gotyme.id,
      allocations: [{ categoryId: savings, amountMinor: 100 }]
    })
    const rows = getBudget(db, 'monthly', '2026-02-01', 1).rows
    expect(rows.map((r) => [r.name, r.budgetedMinor])).toEqual([
      ['Rent', 1500000],
      ['Savings', 800100]
    ])

    // Over-allocating or allocating foreign income is refused, and the income is not recorded
    const before = listTransactions(db).length
    expect(() =>
      createTransaction(db, {
        ...income,
        accountId: gotyme.id,
        allocations: [{ categoryId: rent, amountMinor: 5000001 }]
      })
    ).toThrow('exceed')
    expect(() =>
      createTransaction(db, {
        ...income,
        accountId: gotrade.id,
        allocations: [{ categoryId: rent, amountMinor: 100 }]
      })
    ).toThrow('PHP')
    expect(listTransactions(db)).toHaveLength(before)
  })
})

describe('weekly budgets, income plans and bills', () => {
  const week = (db: Db, date: string): Budget['rows'][number] =>
    getBudget(db, 'weekly', date, 1).rows[0]

  it('upgrades a database with budgets from before weekly budgets and bills', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'buri-')), 'u.db'), 'a'.repeat(64))
    migrate(db, migrations.slice(0, 5))
    const now = '2026-01-01T00:00:00.000Z'
    db.prepare('INSERT INTO categories (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      'c1',
      'Food',
      now,
      now
    )
    db.prepare(
      `INSERT INTO budget_periods (id, kind, start_date, end_date, created_at, updated_at)
       VALUES ('p1', 'monthly', '2026-02-01', '2026-02-28', ?, ?)`
    ).run(now, now)
    db.prepare(
      `INSERT INTO budget_allocations (id, category_id, period_id, amount_minor, currency, rollover, created_at, updated_at)
       VALUES ('a1', 'c1', 'p1', 500000, 'PHP', 0, ?, ?)`
    ).run(now, now)

    migrate(db, migrations)
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
    expect(getBudget(db, 'monthly', '2026-02-10', 1)).toMatchObject({
      incomeMinor: null,
      rows: [{ name: 'Food', cadence: 'monthly', budgetedMinor: 500000 }]
    })
    planIncome(db, {
      period: 'monthly',
      date: '2026-02-10',
      incomeMinor: 600000,
      allocations: [{ categoryId: 'c1', amountMinor: 550000 }]
    })
    expect(listBills(db, '2026-02-10').dues).toEqual([])
  })

  it('shows planned income per month or per week, and percentage budgets from it', () => {
    const db = open()
    const food = category(db, 'Food')
    const invest = category(db, 'Investments')
    planIncome(db, { period: 'monthly', date: '2026-02-10', incomeMinor: 6000000, allocations: [] })
    // 28 days in February: a full week is a quarter of the month
    expect(getBudget(db, 'weekly', '2026-02-11', 1)).toMatchObject({
      incomeMinor: 1500000,
      income: { cadence: 'monthly', amountMinor: 6000000 }
    })
    expect(getBudget(db, 'monthly', '2026-04-20', 1).incomeMinor).toBe(6000000)

    // 20% of income, set once in February
    setBudget(db, {
      categoryId: invest,
      date: '2026-02-01',
      amountMinor: 0,
      percentBp: 2000,
      rollover: false
    })
    const investIn = (period: 'monthly' | 'weekly', date: string): Budget['rows'][number] =>
      getBudget(db, period, date, 1).rows.find((r) => r.name === 'Investments')!
    expect(investIn('monthly', '2026-02-10')).toMatchObject({
      percentBp: 2000,
      budgetedMinor: 1200000
    })
    expect(investIn('monthly', '2026-05-10').budgetedMinor).toBe(1200000)
    expect(investIn('weekly', '2026-02-11').budgetedMinor).toBe(300000)
    expect(listCategories(db).find((c) => c.id === invest)?.isPercent).toBe(true)
    expect(listCategories(db).find((c) => c.id === food)?.isPercent).toBe(false)

    // Changing the income moves the percentage budget with it
    planIncome(db, { period: 'monthly', date: '2026-05-01', incomeMinor: 7000000, allocations: [] })
    expect(investIn('monthly', '2026-05-10').budgetedMinor).toBe(1400000)
    expect(investIn('monthly', '2026-04-10').budgetedMinor).toBe(1200000)

    // Planning per week from June: the June month view adds up the weeks by their days
    planIncome(db, { period: 'weekly', date: '2026-06-01', incomeMinor: 1400000, allocations: [] })
    const june = getBudget(db, 'monthly', '2026-06-10', 1)
    expect(june.income).toEqual({ cadence: 'weekly', amountMinor: 1400000 })
    expect(june.incomeMinor).toBe(6000000) // 30 days at 14,000 a week
    expect(investIn('monthly', '2026-06-10').budgetedMinor).toBe(1200000)

    // Income cannot be put on top of a percentage budget
    expect(() =>
      planIncome(db, {
        period: 'monthly',
        date: '2026-06-10',
        incomeMinor: 100,
        allocations: [{ categoryId: invest, amountMinor: 1 }]
      })
    ).toThrow('percentage')
    const gotyme = account(db, 'GoTyme')
    expect(() =>
      createTransaction(db, {
        kind: 'income',
        accountId: gotyme.id,
        amountMinor: 100,
        date: '2026-06-10',
        payee: '',
        memo: '',
        allocations: [{ categoryId: invest, amountMinor: 1 }]
      })
    ).toThrow('Investments is budgeted as a percentage of income')

    // Back to a fixed amount
    setBudget(db, { categoryId: invest, date: '2026-07-01', amountMinor: 5000, rollover: false })
    expect(investIn('monthly', '2026-07-10')).toMatchObject({
      percentBp: null,
      budgetedMinor: 5000
    })
  })

  it('switches a weekly income back to a monthly one in the same month', () => {
    const db = open()
    const plan = (period: 'monthly' | 'weekly', date: string, incomeMinor: number): void =>
      planIncome(db, { period, date, incomeMinor, allocations: [] })
    plan('weekly', '2026-11-16', 6000000)
    plan('monthly', '2026-11-16', 6000000)
    expect(getBudget(db, 'monthly', '2026-11-16', 1)).toMatchObject({
      incomeMinor: 6000000,
      income: { cadence: 'monthly', amountMinor: 6000000 }
    })
    expect(getBudget(db, 'weekly', '2026-11-25', 1).income).toEqual({
      cadence: 'monthly',
      amountMinor: 6000000
    })
    // And back to weekly from a later week
    plan('weekly', '2026-11-23', 1400000)
    expect(getBudget(db, 'weekly', '2026-11-25', 1).incomeMinor).toBe(1400000)
    expect(getBudget(db, 'weekly', '2026-11-18', 1).income?.cadence).toBe('monthly')
  })

  it('keeps each month on the plan in force when it starts, around a week across two months', () => {
    const db = open()
    const plan = (period: 'monthly' | 'weekly', date: string, incomeMinor: number): void =>
      planIncome(db, { period, date, incomeMinor, allocations: [] })
    // Only a weekly plan from mid-November: November counts its weeks from then (Nov 16-30)
    plan('weekly', '2026-11-16', 700000)
    expect(getBudget(db, 'monthly', '2026-11-10', 1).incomeMinor).toBe(1500000)
    plan('monthly', '2026-11-01', 6000000)
    // The week of Nov 30 to Dec 6 runs into December; December is planned per month again
    plan('weekly', '2026-11-30', 1400000)
    plan('monthly', '2026-12-01', 6200000)
    expect(getBudget(db, 'monthly', '2026-11-10', 1).incomeMinor).toBe(6000000)
    expect(getBudget(db, 'weekly', '2026-12-02', 1).incomeMinor).toBe(1400000)
    expect(getBudget(db, 'monthly', '2026-12-10', 1)).toMatchObject({
      incomeMinor: 6200000,
      income: { cadence: 'monthly' }
    })
  })

  it('budgets a weekly category every week until changed, with rollover and a monthly view', () => {
    const db = open()
    const gotyme = account(db, 'GoTyme', 'PHP', 10000000)
    const food = category(db, 'Food')
    setBudget(db, {
      categoryId: food,
      date: '2026-02-04',
      amountMinor: 70000,
      rollover: true,
      cadence: 'weekly'
    })
    spend(db, gotyme.id, food, 30000, '2026-02-05')
    expect(listCategories(db)[0].cadence).toBe('weekly')
    expect(week(db, '2026-02-04')).toMatchObject({
      cadence: 'weekly',
      setMinor: 70000,
      budgetedMinor: 70000,
      spentMinor: 30000,
      availableMinor: 40000
    })
    expect(week(db, '2026-02-11')).toMatchObject({
      budgetedMinor: 70000,
      carriedMinor: 40000,
      availableMinor: 110000
    })
    // The month holds 3 full weeks and 6 days of the week of Feb 23; the week of Jan 26 had none
    expect(getBudget(db, 'monthly', '2026-02-15', 1).rows[0]).toMatchObject({
      budgetedMinor: 270000,
      carriedMinor: 0,
      spentMinor: 30000,
      availableMinor: 240000
    })

    // A new amount applies from its week on
    setBudget(db, { categoryId: food, date: '2026-02-16', amountMinor: 50000, rollover: false })
    expect(week(db, '2026-02-11').budgetedMinor).toBe(70000)
    expect(week(db, '2026-03-04').budgetedMinor).toBe(50000)

    // Income allocated to a weekly category adds to that week only
    createTransaction(db, {
      kind: 'income',
      accountId: gotyme.id,
      amountMinor: 100000,
      date: '2026-03-04',
      payee: '',
      memo: '',
      allocations: [{ categoryId: food, amountMinor: 10000 }]
    })
    expect(week(db, '2026-03-04').budgetedMinor).toBe(60000)
    expect(week(db, '2026-03-11').budgetedMinor).toBe(50000)
    expect(week(db, '2026-03-25').budgetedMinor).toBe(50000)

    // Switching back to monthly leaves the weekly rows unused
    setBudget(db, {
      categoryId: food,
      date: '2026-03-01',
      amountMinor: 200000,
      rollover: false,
      cadence: 'monthly'
    })
    expect(getBudget(db, 'monthly', '2026-03-01', 1).rows[0]).toMatchObject({
      cadence: 'monthly',
      budgetedMinor: 200000
    })
  })

  it('plans expected income into the period budgets without touching any account', () => {
    const db = open()
    const food = category(db, 'Food')
    const transport = category(db, 'Transport')
    setBudget(db, {
      categoryId: transport,
      date: '2026-02-02',
      amountMinor: 50000,
      rollover: false,
      cadence: 'weekly'
    })
    const plan = { period: 'monthly' as const, date: '2026-02-10' }
    planIncome(db, {
      ...plan,
      incomeMinor: 3000000,
      allocations: [{ categoryId: food, amountMinor: 1200000 }]
    })
    const february = getBudget(db, 'monthly', '2026-02-10', 1)
    expect(february.incomeMinor).toBe(3000000)
    expect(february.rows.find((r) => r.name === 'Food')?.budgetedMinor).toBe(1200000)
    expect(ipcContract['budgets:get'].output.safeParse(february).success).toBe(true)
    expect(listTransactions(db)).toHaveLength(0)

    // Planning again replaces the estimate and the budgets rather than adding to them
    planIncome(db, {
      ...plan,
      incomeMinor: 2500000,
      allocations: [{ categoryId: food, amountMinor: 1000000 }]
    })
    expect(getBudget(db, 'monthly', '2026-02-28', 1)).toMatchObject({ incomeMinor: 2500000 })
    expect(getBudget(db, 'monthly', '2026-02-28', 1).rows[0].budgetedMinor).toBe(1000000)
    // The plan carries into later months until it changes
    expect(getBudget(db, 'monthly', '2026-03-01', 1).incomeMinor).toBe(2500000)
    expect(getBudget(db, 'monthly', '2026-01-01', 1).incomeMinor).toBeNull()

    expect(() =>
      planIncome(db, {
        ...plan,
        incomeMinor: 100,
        allocations: [{ categoryId: food, amountMinor: 101 }]
      })
    ).toThrow('more than')
    expect(() =>
      planIncome(db, {
        ...plan,
        incomeMinor: 100,
        allocations: [{ categoryId: transport, amountMinor: 1 }]
      })
    ).toThrow('monthly categories')
    expect(getBudget(db, 'monthly', '2026-02-28', 1).incomeMinor).toBe(2500000)

    // A weekly plan sets the weekly categories for that week on
    planIncome(db, {
      period: 'weekly',
      date: '2026-02-10',
      incomeMinor: 500000,
      allocations: [{ categoryId: transport, amountMinor: 80000 }]
    })
    const weekly = getBudget(db, 'weekly', '2026-02-10', 1)
    expect(weekly.incomeMinor).toBe(500000)
    expect(weekly.rows.find((r) => r.name === 'Transport')?.budgetedMinor).toBe(80000)
    // Food stays monthly: its share of the week of Feb 2 is a quarter of 1,000,000
    expect(week(db, '2026-02-03').budgetedMinor).toBe(250000)
  })

  it('lists bill due dates in a month and records the expense when one is paid', () => {
    const db = open()
    const gotyme = account(db, 'GoTyme', 'PHP', 10000000)
    const gotrade = account(db, 'GoTrade', 'USD')
    const rent = category(db, 'Rent')
    createBill(db, {
      name: 'Rent',
      amountMinor: 1200000,
      categoryId: rent,
      dueDate: '2026-01-31',
      repeat: 'monthly'
    })
    createBill(db, {
      name: 'Gym',
      amountMinor: 150000,
      categoryId: rent,
      dueDate: '2026-02-10',
      repeat: 'none'
    })
    const february = listBills(db, '2026-02-15')
    expect(february.dues.map((d) => [d.name, d.dueDate])).toEqual([
      ['Gym', '2026-02-10'],
      ['Rent', '2026-02-28']
    ])
    expect(ipcContract['bills:list'].output.safeParse(february).success).toBe(true)

    const { billId } = february.dues[1]
    const pay = { billId, dueDate: '2026-02-28', accountId: gotyme.id, date: '2026-02-27' }
    expect(() => payBill(db, { ...pay, dueDate: '2026-02-27' })).toThrow('not due')
    expect(() => payBill(db, { ...pay, accountId: gotrade.id })).toThrow('PHP account')
    expect(listTransactions(db).filter((t) => t.payee === 'Rent')).toHaveLength(0)

    payBill(db, pay)
    const paid = listBills(db, '2026-02-15').dues[1]
    expect(paid.paidTransactionId).not.toBeNull()
    expect(listTransactions(db).find((t) => t.payee === 'Rent')).toMatchObject({
      amountMinor: -1200000,
      category: 'Rent',
      date: '2026-02-27'
    })
    expect(getBudget(db, 'monthly', '2026-02-01', 1).rows[0].spentMinor).toBe(1200000)
    expect(() => payBill(db, pay)).toThrow('Already paid')

    // Deleting the expense makes the due date unpaid again
    deleteTransaction(db, paid.paidTransactionId!)
    expect(listBills(db, '2026-02-15').dues[1].paidTransactionId).toBeNull()

    deleteBill(db, billId)
    expect(listBills(db, '2026-03-01').dues).toEqual([])
  })
})

describe('goals database', () => {
  it('measures a goal against its account or its category', () => {
    const db = open()
    const gotyme = account(db, 'GoTyme', 'PHP', 4000000)
    const travel = category(db, 'Travel')
    setBudget(db, { categoryId: travel, date: '2026-03-01', amountMinor: 250000, rollover: true })
    createGoal(db, {
      name: 'Emergency fund',
      targetMinor: 10000000,
      targetDate: '2026-06-30',
      accountId: gotyme.id,
      categoryId: null
    })
    createGoal(db, {
      name: 'Trip',
      targetMinor: 1000000,
      targetDate: null,
      accountId: null,
      categoryId: travel
    })

    const goals = listGoals(db, '2026-03-15', 'monthly')
    expect(goals[0]).toMatchObject({
      name: 'Emergency fund',
      linkLabel: 'GoTyme',
      currency: 'PHP',
      savedMinor: 4000000,
      remainingMinor: 6000000,
      percent: 40,
      perPeriodMinor: 1500000
    })
    expect(goals[1]).toMatchObject({
      linkLabel: 'Travel',
      savedMinor: 250000,
      percent: 25,
      perPeriodMinor: null
    })
    expect(ipcContract['goals:list'].output.safeParse(goals).success).toBe(true)
    const bothLinks = {
      name: 'x',
      targetMinor: 1,
      targetDate: null,
      accountId: gotyme.id,
      categoryId: travel
    }
    expect(ipcContract['goals:create'].input.safeParse(bothLinks).success).toBe(false)
  })
})

describe('investments database', () => {
  const lot = (db: Db): string => getInvestments(db).holdings[0].lotId
  const cash = (db: Db, name: string): number =>
    listAccounts(db).find((a) => a.name === name)!.balanceMinor
  const ledgerIsBalanced = (db: Db): boolean =>
    db
      .prepare(
        `SELECT 1 FROM splits WHERE deleted_at IS NULL
         GROUP BY transaction_id, currency HAVING SUM(amount_minor) <> 0`
      )
      .all().length === 0

  it('buys with cash, values holdings at the latest price, and counts them in net worth', () => {
    const db = open()
    const dragonfi = account(db, 'DragonFi', 'PHP', 30000000)
    buy(db, {
      accountId: dragonfi.id,
      symbol: 'BDO',
      name: 'BDO Unibank',
      quantityE8: 1000e8,
      price: '128.50',
      date: '2026-02-02',
      payFromCash: true
    })
    expect(cash(db, 'DragonFi')).toBe(30000000 - 12850000)
    expect(getInvestments(db).holdings[0]).toMatchObject({
      symbol: 'BDO',
      costMinor: 12850000,
      price: '128.50',
      valueMinor: 12850000,
      gainMinor: 0
    })

    setPrice(db, getInvestments(db).securities[0].id, '140.25', '2026-03-01')
    setPrice(db, getInvestments(db).securities[0].id, '999', '2026-01-01') // older, ignored
    const holding = getInvestments(db).holdings[0]
    expect(holding).toMatchObject({
      price: '140.25',
      priceDate: '2026-03-01',
      valueMinor: 14025000,
      gainMinor: 1175000
    })
    expect(listAccounts(db)[0]).toMatchObject({ balanceMinor: 17150000, holdingsMinor: 14025000 })
    expect(netWorth(listAccounts(db), []).totals[0].netMinor).toBe(31175000)
    expect(ipcContract['investments:get'].output.safeParse(getInvestments(db)).success).toBe(true)
    expect(ledgerIsBalanced(db)).toBe(true)
  })

  it('adds holdings owned before tracking without touching cash', () => {
    const db = open()
    const gotrade = account(db, 'GoTrade', 'USD', 5000)
    buy(db, {
      accountId: gotrade.id,
      symbol: 'AAPL',
      name: '',
      quantityE8: 12345678,
      price: '187.45',
      date: '2026-02-02',
      payFromCash: false
    })
    expect(cash(db, 'GoTrade')).toBe(5000)
    expect(getInvestments(db).holdings[0]).toMatchObject({
      currency: 'USD',
      quantityE8: 12345678,
      costMinor: 2314
    })
    deleteLot(db, lot(db))
    expect(getInvestments(db).holdings).toEqual([])
  })

  it('sells part of a lot, then the rest', () => {
    const db = open()
    const dragonfi = account(db, 'DragonFi', 'PHP', 100000)
    buy(db, {
      accountId: dragonfi.id,
      symbol: 'JFC',
      name: '',
      quantityE8: 3e8,
      price: '100.01',
      date: '2026-02-02',
      payFromCash: true
    })
    expect(cash(db, 'DragonFi')).toBe(100000 - 30003)
    expect(() =>
      sell(db, { lotId: lot(db), quantityE8: 4e8, price: '1', date: '2026-02-03' })
    ).toThrow('more than')

    sell(db, { lotId: lot(db), quantityE8: 1e8, price: '120', date: '2026-02-03' })
    expect(cash(db, 'DragonFi')).toBe(100000 - 30003 + 12000)
    // A third of 300.03 cost leaves the lot: 100.01
    expect(getInvestments(db).holdings[0]).toMatchObject({
      quantityE8: 2e8,
      costMinor: 20002,
      valueMinor: 24000
    })

    sell(db, { lotId: lot(db), quantityE8: 2e8, price: '120', date: '2026-02-04' })
    expect(getInvestments(db).holdings).toEqual([])
    expect(listAccounts(db)[0]).toMatchObject({
      balanceMinor: 100000 - 30003 + 36000,
      holdingsMinor: 0
    })
    expect(ledgerIsBalanced(db)).toBe(true)
  })

  it('gives the cash back when a bought lot is deleted', () => {
    const db = open()
    const dragonfi = account(db, 'DragonFi', 'PHP', 100000)
    buy(db, {
      accountId: dragonfi.id,
      symbol: 'JFC',
      name: '',
      quantityE8: 1e8,
      price: '250',
      date: '2026-02-02',
      payFromCash: true
    })
    deleteLot(db, lot(db))
    expect(listAccounts(db)[0]).toMatchObject({ balanceMinor: 100000, holdingsMinor: 0 })
  })

  it('converts net worth only with a stored rate, and reports the rate used', () => {
    const db = open()
    account(db, 'GoTyme', 'PHP', 1000000)
    account(db, 'GoTrade', 'USD', 10000)
    expect(netWorth(listAccounts(db), latestRates(db)).converted).toBeNull()
    expect(listAccounts(db).map((a) => [a.name, a.baseMinor])).toEqual([
      ['GoTrade', null],
      ['GoTyme', 1000000]
    ])

    setFxRate(db, 'USD', '57.00', '2026-01-01')
    setFxRate(db, 'USD', '58.125', '2026-02-01')
    expect(() => setFxRate(db, 'PHP', '1', '2026-02-01')).toThrow('base currency')
    const result = netWorth(listAccounts(db), latestRates(db))
    expect(result.converted).toEqual({
      currency: 'PHP',
      netMinor: 1000000 + 581250,
      rates: [{ currency: 'USD', rate: '58.125', date: '2026-02-01' }],
      parts: [
        { currency: 'PHP', netMinor: 1000000 },
        { currency: 'USD', netMinor: 581250 }
      ]
    })
    expect(listAccounts(db).find((a) => a.name === 'GoTrade')?.baseMinor).toBe(581250)
    // The original amounts are untouched
    expect(result.totals.map((t) => [t.currency, t.netMinor])).toEqual([
      ['PHP', 1000000],
      ['USD', 10000]
    ])
    expect(ipcContract['networth:get'].output.safeParse(result).success).toBe(true)
  })

  it('rejects float prices and bad symbols at the IPC boundary', () => {
    const input = ipcContract['investments:buy'].input
    const ok = {
      accountId: '00000000-0000-7000-8000-000000000001',
      symbol: 'bdo',
      name: '',
      quantityE8: 1e8,
      price: '128.50',
      date: '2026-02-02',
      payFromCash: true
    }
    expect(input.parse(ok).symbol).toBe('BDO')
    expect(input.safeParse({ ...ok, price: 128.5 }).success).toBe(false)
    expect(input.safeParse({ ...ok, price: '0' }).success).toBe(false)
    expect(input.safeParse({ ...ok, quantityE8: 0.5 }).success).toBe(false)
    expect(input.safeParse({ ...ok, symbol: 'DROP TABLE' }).success).toBe(false)
  })
})

describe('automatic exchange rates', () => {
  const service =
    (rates: Record<string, number>): typeof fetch =>
    async (url) => {
      const base = new URL(String(url)).searchParams.get('base')!
      return base in rates
        ? Response.json({ base, date: '2026-11-16', rates: { PHP: rates[base] } })
        : Response.json({ message: 'not found' }, { status: 404 })
    }

  it('stores the fetched rate as the decimal the service sent', async () => {
    const db = open()
    account(db, 'GoTyme')
    account(db, 'GoTrade', 'USD')
    await refreshFxRates(db, service({ USD: 63.954 }))
    expect(latestRates(db)).toEqual([{ currency: 'USD', rate: '63.954', date: '2026-11-16' }])
  })

  it('makes no request when every account is in the base currency', async () => {
    const db = open()
    account(db, 'GoTyme')
    await refreshFxRates(db, () => Promise.reject(new Error('called')))
  })

  it('keeps the rates that arrive and reports the currency that has none', async () => {
    const db = open()
    account(db, 'GoTrade', 'USD')
    account(db, 'Other', 'XXX')
    await expect(refreshFxRates(db, service({ USD: 63.954 }))).rejects.toThrow(
      'No exchange rate is available for XXX.'
    )
    expect(latestRates(db).map((r) => r.currency)).toEqual(['USD'])
  })

  it('keeps the saved rate and reports when the service is unreachable', async () => {
    const db = open()
    account(db, 'GoTrade', 'USD')
    setFxRate(db, 'USD', '58.125', '2026-02-01')
    await expect(
      refreshFxRates(db, () => Promise.reject(new TypeError('offline')))
    ).rejects.toThrow('Could not reach the exchange rate service.')
    expect(latestRates(db)[0].rate).toBe('58.125')
  })
})

describe('month activity', () => {
  it('totals income and spending per day and leaves out transfers and opening balances', () => {
    const db = open()
    const bank = account(db, 'GoTyme', 'PHP', 1000000) // opening balance dated 2026-01-01
    const wallet = account(db, 'GCash')
    const usd = account(db, 'GoTrade', 'USD')
    const food = category(db, 'Food')
    const income = { kind: 'income' as const, payee: '', memo: '', allocations: [] }
    createTransaction(db, {
      ...income,
      accountId: bank.id,
      amountMinor: 5000000,
      date: '2026-01-15'
    })
    createTransaction(db, { ...income, accountId: usd.id, amountMinor: 10000, date: '2026-01-15' })
    spend(db, bank.id, food, 12345, '2026-01-15')
    spend(db, bank.id, food, 55, '2026-01-31')
    const gone = spend(db, bank.id, food, 999, '2026-01-31')
    deleteTransaction(db, gone)
    spend(db, bank.id, food, 777, '2026-02-01')
    createTransaction(db, {
      kind: 'transfer',
      fromAccountId: bank.id,
      toAccountId: wallet.id,
      amountMinor: 20000,
      date: '2026-01-20',
      memo: ''
    })

    const result = monthActivity(db, '2026-01-20')
    expect(result).toMatchObject({
      start: '2026-01-01',
      end: '2026-01-31',
      previous: '2025-12-01',
      next: '2026-02-01',
      currency: 'PHP',
      incomeMinor: 5000000,
      expenseMinor: 12400,
      // The USD income is outside the base currency, so it is not counted
      incomeCount: 1,
      expenseCount: 2,
      uncategorizedCount: 0,
      openingDates: ['2026-01-01']
    })
    expect(listTransactions(db).find((t) => t.payee === 'Transfer')?.kind).toBe('transfer')
    expect(result.days).toEqual([
      { date: '2026-01-01', incomeMinor: 0, expenseMinor: 0, count: 1 },
      { date: '2026-01-15', incomeMinor: 5000000, expenseMinor: 12345, count: 3 },
      { date: '2026-01-20', incomeMinor: 0, expenseMinor: 0, count: 1 },
      { date: '2026-01-31', incomeMinor: 0, expenseMinor: 55, count: 1 }
    ])
    expect(ipcContract['transactions:month'].output.safeParse(result).success).toBe(true)
    expect(monthActivity(db, '2026-03-10')).toMatchObject({ incomeMinor: 0, days: [] })
    expect(hasTransactionOn(db, '2026-01-31')).toBe(true)
    expect(hasTransactionOn(db, '2026-01-30')).toBe(false)
  })
})

describe('categorizing', () => {
  it('counts uncategorized spending until it is put in a category', () => {
    const db = open()
    const bank = account(db, 'GoTyme', 'PHP', 1000000)
    const rent = category(db, 'Rent')
    const id = createTransaction(db, {
      kind: 'expense',
      accountId: bank.id,
      amountMinor: 2500000,
      date: '2026-01-18',
      payee: 'Mamu',
      memo: '',
      categoryId: null
    })
    expect(monthActivity(db, '2026-01-20')).toMatchObject({
      expenseCount: 1,
      uncategorizedCount: 1,
      uncategorizedMinor: 2500000
    })
    expect(listTransactions(db).map((t) => t.kind)).toEqual(['expense', 'opening'])

    categorizeTransaction(db, id, rent)
    expect(monthActivity(db, '2026-01-20')).toMatchObject({
      uncategorizedCount: 0,
      uncategorizedMinor: 0
    })
    expect(listTransactions(db)[0].category).toBe('Rent')
    expect(getBudget(db, 'monthly', '2026-01-20', 1).rows[0].spentMinor).toBe(2500000)

    const opening = listTransactions(db)[1]
    expect(() => categorizeTransaction(db, opening.id, rent)).toThrow('Only an expense')
    expect(() => categorizeTransaction(db, id, bank.id)).toThrow('Category not found')
  })

  it('lists daily income minus spending for the net worth history', () => {
    const db = open()
    expect(firstTransactionDate(db)).toBeNull()
    const bank = account(db, 'GoTyme', 'PHP', 1000000)
    const food = category(db, 'Food')
    createTransaction(db, {
      kind: 'income',
      accountId: bank.id,
      amountMinor: 5000,
      date: '2026-01-01',
      payee: '',
      memo: '',
      allocations: []
    })
    spend(db, bank.id, food, 1234, '2026-01-01')
    spend(db, bank.id, food, 100, '2026-01-03')
    // Opening balances and transfers are not flows
    expect(dailyFlows(db)).toEqual(
      new Map([
        ['2026-01-01', 5000 - 1234],
        ['2026-01-03', -100]
      ])
    )
    expect(firstTransactionDate(db)).toBe('2026-01-01')
  })
})

describe('log reminder', () => {
  const due = {
    isEnabled: true,
    hasAccounts: true,
    hasLoggedToday: false,
    hour: 20,
    today: '2026-11-17',
    lastReminded: '2026-11-16'
  }
  it('reminds once in the evening of a day with nothing recorded', () => {
    expect(shouldRemind(due)).toBe(true)
    expect(shouldRemind({ ...due, hour: 19 })).toBe(false)
    expect(shouldRemind({ ...due, hasLoggedToday: true })).toBe(false)
    expect(shouldRemind({ ...due, lastReminded: '2026-11-17' })).toBe(false)
    expect(shouldRemind({ ...due, isEnabled: false })).toBe(false)
    expect(shouldRemind({ ...due, hasAccounts: false })).toBe(false)
  })
})
