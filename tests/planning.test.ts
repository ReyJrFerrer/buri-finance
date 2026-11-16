import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createAccount, listAccounts } from '../src/main/db/accounts'
import {
  createCategory,
  createRule,
  deleteCategory,
  getBudget,
  listCategories,
  listRules,
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
import { createTransaction, listTransactions } from '../src/main/db/transactions'
import {
  budgetStatus,
  goalProgress,
  proposeAllocation,
  prorateMonth,
  weekRange
} from '../src/main/ledger/budgets'
import { convertMinor, mulDiv, valueMinor } from '../src/main/ledger/decimal'
import { netWorth } from '../src/main/ledger/posting'
import { ipcContract, type Account } from '../src/shared/ipc'
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
): void =>
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
    const rows = [{ month: '2026-01', amountMinor: 10000, rollover: true }]
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
    const noRollover = [{ month: '2026-01', amountMinor: 10000, rollover: false }]
    expect(budgetStatus(noRollover, new Map(), '2026-02').carriedMinor).toBe(0)
    // Crosses a year boundary
    const december = [{ month: '2025-12', amountMinor: 500, rollover: true }]
    expect(budgetStatus(december, new Map(), '2026-01').availableMinor).toBe(500)
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
    setBudget(db, { categoryId: food, month: '2026-02-10', amountMinor: 1000000, rollover: true })
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
    setBudget(db, { categoryId: food, month: '2026-02-01', amountMinor: 500000, rollover: false })
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
    setBudget(db, { categoryId: food, month: '2026-02-01', amountMinor: 10000, rollover: false })
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
    setBudget(db, { categoryId: food, month: '2026-03-01', amountMinor: 31000, rollover: false })
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

describe('goals database', () => {
  it('measures a goal against its account or its category', () => {
    const db = open()
    const gotyme = account(db, 'GoTyme', 'PHP', 4000000)
    const travel = category(db, 'Travel')
    setBudget(db, { categoryId: travel, month: '2026-03-01', amountMinor: 250000, rollover: true })
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

    setFxRate(db, 'USD', '57.00', '2026-01-01')
    setFxRate(db, 'USD', '58.125', '2026-02-01')
    expect(() => setFxRate(db, 'PHP', '1', '2026-02-01')).toThrow('base currency')
    const result = netWorth(listAccounts(db), latestRates(db))
    expect(result.converted).toEqual({
      currency: 'PHP',
      netMinor: 1000000 + 581250,
      rates: [{ currency: 'USD', rate: '58.125', date: '2026-02-01' }]
    })
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
