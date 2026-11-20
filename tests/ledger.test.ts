import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createAccount, deleteAccount, listAccounts, updateAccount } from '../src/main/db/accounts'
import { createGoal, listGoals } from '../src/main/db/goals'
import { openDatabase, type Db } from '../src/main/db/connection'
import { uuidv7 } from '../src/main/db/id'
import { migrate, migrations } from '../src/main/db/migrate'
import { createTransaction, deleteTransaction, listTransactions } from '../src/main/db/transactions'
import {
  assertBalanced,
  describeTransaction,
  expenseSplits,
  incomeSplits,
  netWorth,
  openingSplits,
  netWorthHistory,
  systemAccounts,
  transferSplits,
  type Split
} from '../src/main/ledger/posting'
import { ipcContract, type NewAccount } from '../src/shared/ipc'
import { formatMinor, formatMoney, parseAmountToMinor } from '../src/shared/money'

const php = { id: 'php-1', type: 'asset', currency: 'PHP' }
const php2 = { id: 'php-2', type: 'asset', currency: 'PHP' }
const usd = { id: 'usd-1', type: 'asset', currency: 'USD' }
const card = { id: 'card-1', type: 'liability', currency: 'PHP' }

describe('money', () => {
  it('parses amounts to minor units without float error', () => {
    expect(parseAmountToMinor('1,234.5')).toBe(123450)
    expect(parseAmountToMinor('0.07')).toBe(7)
    expect(parseAmountToMinor('19.99')).toBe(1999) // 19.99 * 100 is 1998.9999999999998 in floats
    expect(parseAmountToMinor(' 100 ')).toBe(10000)
  })

  it('rejects anything that is not a plain positive amount', () => {
    for (const bad of ['', '-5', '1.234', '1,23', 'abc', '1e3', '99999999999999999999']) {
      expect(parseAmountToMinor(bad)).toBeNull()
    }
  })

  it('formats with the currency and a minus sign', () => {
    expect(formatMinor(123450, 'PHP')).toBe('PHP 1,234.50')
    expect(formatMinor(-7, 'USD')).toBe('-USD 0.07')
    expect(formatMinor(0, 'PHP')).toBe('PHP 0.00')
    expect(formatMoney(11793985, 'PHP')).toBe('₱117,939.85')
    expect(formatMoney(-2500000, 'PHP')).toBe('−₱25,000.00')
    expect(formatMoney(60292, 'USD')).toBe('$602.92')
    expect(formatMoney(500, 'EUR')).toBe('EUR 5.00')
  })
})

describe('posting rules', () => {
  it('rejects unbalanced, single or zero splits', () => {
    const split = (amountMinor: number, currency = 'PHP'): Split => ({
      accountId: 'a',
      amountMinor,
      currency
    })
    expect(() => assertBalanced([split(100), split(-99)])).toThrow('sum to zero')
    expect(() => assertBalanced([split(100)])).toThrow('at least two')
    expect(() => assertBalanced([split(0), split(0)])).toThrow('non-zero')
    expect(() => assertBalanced([split(1.5), split(-1.5)])).toThrow('whole minor units')
    // Balanced overall but not per currency
    expect(() => assertBalanced([split(100, 'PHP'), split(-100, 'USD')])).toThrow('sum to zero')
  })

  it('posts expenses and income against the system accounts', () => {
    expect(expenseSplits(php, 500)).toEqual([
      { accountId: 'php-1', amountMinor: -500, currency: 'PHP' },
      { accountId: systemAccounts.expense, amountMinor: 500, currency: 'PHP' }
    ])
    expect(incomeSplits(usd, 500)).toEqual([
      { accountId: 'usd-1', amountMinor: 500, currency: 'USD' },
      { accountId: systemAccounts.income, amountMinor: -500, currency: 'USD' }
    ])
    expect(() => expenseSplits(php, 0)).toThrow()
    expect(() => expenseSplits({ ...php, type: 'equity' }, 100)).toThrow()
  })

  it('opens liabilities as money owed', () => {
    expect(openingSplits(card, 900)[0].amountMinor).toBe(-900)
    expect(openingSplits(php, 900)[0].amountMinor).toBe(900)
  })

  it('posts a same-currency transfer as two asset splits', () => {
    const splits = transferSplits(php, php2, 1000)
    expect(splits).toEqual([
      { accountId: 'php-1', amountMinor: -1000, currency: 'PHP' },
      { accountId: 'php-2', amountMinor: 1000, currency: 'PHP' }
    ])
    expect(() => transferSplits(php, php, 1000)).toThrow('different accounts')
    expect(() => transferSplits(php, php2, 1000, 999)).toThrow('must match')
  })

  it('keeps both entered amounts in a cross-currency transfer and balances each currency', () => {
    const splits = transferSplits(php, usd, 580000, 10000)
    expect(() => assertBalanced(splits)).not.toThrow()
    expect(splits.find((s) => s.accountId === 'php-1')?.amountMinor).toBe(-580000)
    expect(splits.find((s) => s.accountId === 'usd-1')?.amountMinor).toBe(10000)
    expect(splits.filter((s) => s.accountId === systemAccounts.exchange)).toHaveLength(2)
    expect(() => transferSplits(php, usd, 580000)).toThrow('amount received')
  })

  it('totals net worth per currency without converting', () => {
    expect(
      netWorth(
        [
          { type: 'asset', currency: 'USD', balanceMinor: 10000, holdingsMinor: 0 },
          { type: 'asset', currency: 'PHP', balanceMinor: 500000, holdingsMinor: 0 },
          { type: 'liability', currency: 'PHP', balanceMinor: -120000, holdingsMinor: 0 }
        ],
        []
      )
    ).toEqual({
      totals: [
        { currency: 'PHP', assetsMinor: 500000, liabilitiesMinor: 120000, netMinor: 380000 },
        { currency: 'USD', assetsMinor: 10000, liabilitiesMinor: 0, netMinor: 10000 }
      ],
      converted: null
    })
    expect(netWorth([], [])).toEqual({ totals: [], converted: null })
  })

  it('walks net worth back day by day by undoing later income and spending', () => {
    const flows = new Map([
      ['2026-11-16', 6881900],
      ['2026-11-18', -2500000]
    ])
    expect(netWorthHistory(11793985, flows, '2026-11-16', '2026-11-19')).toEqual([
      { date: '2026-11-16', netMinor: 14293985 },
      { date: '2026-11-17', netMinor: 14293985 },
      { date: '2026-11-18', netMinor: 11793985 },
      { date: '2026-11-19', netMinor: 11793985 }
    ])
    // Across a month end, and a single day
    expect(netWorthHistory(100, new Map([['2026-12-01', 40]]), '2026-11-30', '2026-12-01')).toEqual(
      [
        { date: '2026-11-30', netMinor: 60 },
        { date: '2026-12-01', netMinor: 100 }
      ]
    )
    expect(netWorthHistory(100, new Map(), '2026-11-30', '2026-11-30')).toEqual([
      { date: '2026-11-30', netMinor: 100 }
    ])
  })

  it('describes a transfer by where the money went', () => {
    expect(
      describeTransaction([
        { accountName: 'GoTrade', amountMinor: 10000, currency: 'USD' },
        { accountName: 'GoTyme', amountMinor: -580000, currency: 'PHP' }
      ])
    ).toEqual({ accountLabel: 'GoTyme → GoTrade', amountMinor: 10000, currency: 'USD' })
  })
})

describe('ledger database', () => {
  const open = (): Db => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'buri-')), 'l.db'), 'a'.repeat(64))
    migrate(db, migrations)
    return db
  }
  const account = (over: Partial<NewAccount>): NewAccount => ({
    name: 'GoTyme',
    type: 'asset',
    institution: 'GoTyme',
    currency: 'PHP',
    parentId: null,
    openingBalanceMinor: 0,
    openingDate: '2026-01-01',
    ...over
  })
  const balances = (db: Db): Record<string, number> =>
    Object.fromEntries(listAccounts(db).map((a) => [a.name, a.balanceMinor]))
  const ledgerIsBalanced = (db: Db): boolean =>
    db
      .prepare(
        `SELECT 1 FROM splits WHERE deleted_at IS NULL
         GROUP BY transaction_id, currency HAVING SUM(amount_minor) <> 0`
      )
      .all().length === 0

  it('generates sortable UUIDv7 ids that pass the IPC schema', () => {
    const id = uuidv7()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(ipcContract['transactions:delete'].input.safeParse({ id }).success).toBe(true)
    const burst = Array.from({ length: 1000 }, uuidv7)
    expect([...burst].sort()).toEqual(burst)
  })

  it('renames, deletes with its own transactions, and refuses accounts with transfers', () => {
    const db = open()
    const a = createAccount(db, account({ openingBalanceMinor: 1000 }))
    const b = createAccount(db, account({ name: 'GCash' }))
    updateAccount(db, { id: a.id, name: 'Renamed', institution: null })
    expect(listAccounts(db).map((x) => x.name)).toContain('Renamed')

    createTransaction(db, {
      date: '2026-02-01',
      memo: '',
      kind: 'transfer',
      amountMinor: 100,
      fromAccountId: a.id,
      toAccountId: b.id
    })
    expect(() => deleteAccount(db, a.id)).toThrow(/transfers/)

    const c = createAccount(db, account({ name: 'Solo', openingBalanceMinor: 500 }))
    deleteAccount(db, c.id)
    expect(listAccounts(db).map((x) => x.id)).not.toContain(c.id)
    expect(ledgerIsBalanced(db)).toBe(true)
    expect(() => deleteAccount(db, c.id)).toThrow()
  })

  it('deletes goals linked to an account only when asked to', () => {
    const db = open()
    const a = createAccount(db, account({ name: 'Savings', openingBalanceMinor: 1000 }))
    const other = createAccount(db, account({ name: 'Wallet' }))
    const goal = { targetMinor: 5000, targetDate: null, categoryId: null }
    createGoal(db, { ...goal, name: 'Trip', accountId: a.id })
    createGoal(db, { ...goal, name: 'Phone', accountId: other.id })
    expect(listGoals(db, '2026-01-01', 'monthly').find((g) => g.name === 'Trip')?.accountId).toBe(
      a.id
    )

    expect(() => deleteAccount(db, a.id)).toThrow('A goal is linked')
    expect(listAccounts(db).map((x) => x.name)).toContain('Savings')

    deleteAccount(db, a.id, true)
    expect(listAccounts(db).map((x) => x.name)).toEqual(['Wallet'])
    expect(listGoals(db, '2026-01-01', 'monthly').map((g) => g.name)).toEqual(['Phone'])
    expect(ledgerIsBalanced(db)).toBe(true)
  })

  it('creates accounts with opening balances and hides system accounts', () => {
    const db = open()
    expect(listAccounts(db)).toEqual([])
    const created = createAccount(db, account({ openingBalanceMinor: 1000000 }))
    createAccount(db, account({ name: 'Card', type: 'liability', openingBalanceMinor: 250000 }))
    expect(created.balanceMinor).toBe(1000000)
    expect(balances(db)).toEqual({ GoTyme: 1000000, Card: -250000 })
    expect(ipcContract['accounts:list'].output.safeParse(listAccounts(db)).success).toBe(true)
    expect(ledgerIsBalanced(db)).toBe(true)
  })

  it('records expense, income and transfers, and keeps every transaction balanced', () => {
    const db = open()
    const gotyme = createAccount(db, account({ openingBalanceMinor: 1000000 }))
    const gcash = createAccount(db, account({ name: 'GCash' }))
    const gotrade = createAccount(db, account({ name: 'GoTrade', currency: 'USD' }))
    const base = { date: '2026-02-01', memo: '' }

    createTransaction(db, {
      ...base,
      kind: 'expense',
      accountId: gotyme.id,
      amountMinor: 1999,
      payee: 'Lunch',
      categoryId: null
    })
    createTransaction(db, {
      ...base,
      kind: 'income',
      accountId: gotyme.id,
      amountMinor: 5000000,
      payee: 'Salary',
      allocations: []
    })
    createTransaction(db, {
      ...base,
      kind: 'transfer',
      fromAccountId: gotyme.id,
      toAccountId: gcash.id,
      amountMinor: 100000
    })
    createTransaction(db, {
      ...base,
      kind: 'transfer',
      fromAccountId: gotyme.id,
      toAccountId: gotrade.id,
      amountMinor: 580000,
      receivedMinor: 10000
    })

    expect(balances(db)).toEqual({
      GoTyme: 1000000 - 1999 + 5000000 - 100000 - 580000,
      GCash: 100000,
      GoTrade: 10000
    })
    expect(ledgerIsBalanced(db)).toBe(true)

    const rows = listTransactions(db)
    expect(rows).toHaveLength(5)
    expect(ipcContract['transactions:list'].output.safeParse(rows).success).toBe(true)
    expect(rows.find((r) => r.payee === 'Lunch')).toMatchObject({
      accountLabel: 'GoTyme',
      amountMinor: -1999,
      currency: 'PHP'
    })
    expect(
      rows
        .filter((r) => r.payee === 'Transfer')
        .map((r) => r.accountLabel)
        .sort()
    ).toEqual(['GoTyme → GCash', 'GoTyme → GoTrade'])
    // Transfers are never income or expense
    const incomeAndExpense = db
      .prepare('SELECT SUM(ABS(amount_minor)) AS n FROM splits WHERE account_id IN (?, ?)')
      .get(systemAccounts.income, systemAccounts.expense)
    expect(incomeAndExpense).toEqual({ n: 1999 + 5000000 })
  })

  it('rejects bad transfers without writing anything', () => {
    const db = open()
    const gotyme = createAccount(db, account({}))
    const gotrade = createAccount(db, account({ name: 'GoTrade', currency: 'USD' }))
    const base = { date: '2026-02-01', memo: '', kind: 'transfer' as const, amountMinor: 100 }
    expect(() =>
      createTransaction(db, { ...base, fromAccountId: gotyme.id, toAccountId: gotyme.id })
    ).toThrow()
    expect(() =>
      createTransaction(db, { ...base, fromAccountId: gotyme.id, toAccountId: gotrade.id })
    ).toThrow()
    expect(() =>
      createTransaction(db, { ...base, fromAccountId: gotyme.id, toAccountId: uuidv7() })
    ).toThrow('not found')
    expect(() =>
      createTransaction(db, {
        ...base,
        fromAccountId: gotyme.id,
        toAccountId: systemAccounts.income
      })
    ).toThrow()
    expect(listTransactions(db)).toEqual([])
  })

  it('soft-deletes a transaction and restores the balance', () => {
    const db = open()
    const gotyme = createAccount(db, account({}))
    createTransaction(db, {
      kind: 'expense',
      accountId: gotyme.id,
      amountMinor: 500,
      date: '2026-02-01',
      payee: 'x',
      memo: '',
      categoryId: null
    })
    const [row] = listTransactions(db)
    deleteTransaction(db, row.id)
    expect(balances(db)).toEqual({ GoTyme: 0 })
    expect(listTransactions(db)).toEqual([])
    expect(db.prepare('SELECT count(*) AS n FROM transactions').get()).toEqual({ n: 1 })
    expect(() => deleteTransaction(db, row.id)).toThrow('not found')
  })
})

describe('ledger ipc schemas', () => {
  it('rejects floats, negatives and bad dates', () => {
    const input = ipcContract['transactions:create'].input
    const ok = {
      categoryId: null,
      kind: 'expense',
      accountId: uuidv7(),
      amountMinor: 100,
      date: '2026-02-01',
      payee: '',
      memo: ''
    }
    expect(input.safeParse(ok).success).toBe(true)
    expect(input.safeParse({ ...ok, amountMinor: 1.5 }).success).toBe(false)
    expect(input.safeParse({ ...ok, amountMinor: -100 }).success).toBe(false)
    expect(input.safeParse({ ...ok, date: '2026-02-30' }).success).toBe(false)
    expect(input.safeParse({ ...ok, accountId: 'x' }).success).toBe(false)
    expect(input.safeParse({ ...ok, extra: 1 }).success).toBe(false)
  })
})
