import { z } from 'zod'
import { isDecimalString } from './money'

export const themeModeSchema = z.enum(['system', 'light', 'dark'])
export const budgetPeriodSchema = z.enum(['monthly', 'weekly'])
export const settingsSchema = z.object({
  themeMode: themeModeSchema,
  budgetPeriod: budgetPeriodSchema,
  weekStart: z.int().min(0).max(6), // 0 = Sunday
  // An evening system notification on days with no transaction recorded.
  logReminder: z.boolean()
})
export type Settings = z.infer<typeof settingsSchema>

const id = z.uuid()
const isoDate = z.iso.date()
const currency = z.string().regex(/^[A-Z]{3}$/)
const minor = z.int()
const positiveMinor = z.int().positive()
export const transactionTextSchema = z.string().trim().max(200)
const name = z.string().trim().min(1).max(100)
const decimalString = z.string().refine(isDecimalString)
const quantityE8 = z.int().positive()

export const userAccountTypeSchema = z.enum(['asset', 'liability'])

// Accounts the user owns (assets and liabilities). balanceMinor is in the account's currency.
export const accountSchema = z.object({
  id,
  name: z.string(),
  type: userAccountTypeSchema,
  institution: z.string().nullable(),
  currency,
  parentId: id.nullable(),
  balanceMinor: minor,
  // Market value of holdings in the account, on top of the cash balance.
  holdingsMinor: minor,
  // Cash plus holdings in the base currency at the latest stored rate; null when there is none.
  baseMinor: minor.nullable()
})
export type Account = z.infer<typeof accountSchema>

export const newAccountSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  type: userAccountTypeSchema,
  institution: z.string().trim().min(1).max(100).nullable(),
  currency,
  parentId: id.nullable(),
  // What the account holds (asset) or owes (liability) on openingDate; 0 for none.
  openingBalanceMinor: z.int().nonnegative(),
  openingDate: isoDate
})
export type NewAccount = z.infer<typeof newAccountSchema>

// Only labels are editable: type, currency and balances would rewrite the ledger.
export const accountUpdateSchema = z.strictObject({
  id,
  name: newAccountSchema.shape.name,
  institution: newAccountSchema.shape.institution
})
export type AccountUpdate = z.infer<typeof accountUpdateSchema>

const categoryAmount = z.strictObject({ categoryId: id, amountMinor: positiveMinor })

export const newTransactionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('expense'),
    accountId: id,
    amountMinor: positiveMinor,
    date: isoDate,
    payee: transactionTextSchema,
    memo: transactionTextSchema,
    categoryId: id.nullable()
  }),
  z.strictObject({
    kind: z.literal('income'),
    accountId: id,
    amountMinor: positiveMinor,
    date: isoDate,
    payee: transactionTextSchema,
    memo: transactionTextSchema,
    // Confirmed split of this income across budget categories, added to that month's budgets.
    allocations: z.array(categoryAmount)
  }),
  z.strictObject({
    kind: z.literal('transfer'),
    fromAccountId: id,
    toAccountId: id,
    amountMinor: positiveMinor,
    // Amount that arrived, required when the two accounts use different currencies.
    receivedMinor: positiveMinor.optional(),
    date: isoDate,
    memo: transactionTextSchema
  })
])
export type NewTransaction = z.infer<typeof newTransactionSchema>

// One row per transaction, described from the side of the user's own accounts.
export const transactionRowSchema = z.object({
  id,
  date: isoDate,
  payee: z.string(),
  memo: z.string(),
  category: z.string(),
  accountLabel: z.string(),
  amountMinor: minor,
  currency,
  kind: z.enum(['expense', 'income', 'transfer', 'opening', 'other'])
})
export type TransactionRow = z.infer<typeof transactionRowSchema>

const dayActivity = z.object({ incomeMinor: minor, expenseMinor: minor, count: z.int() })
// Income and spending in one month, in the base currency, with a row per day that has any.
export const monthActivitySchema = dayActivity.extend({
  start: isoDate,
  end: isoDate,
  // A date inside the month before and after this one, for stepping through months.
  previous: isoDate,
  next: isoDate,
  currency,
  incomeCount: z.int(),
  expenseCount: z.int(),
  // Expenses not yet in a budget category.
  uncategorizedMinor: minor,
  uncategorizedCount: z.int(),
  // Days in the month with an opening balance recorded.
  openingDates: z.array(isoDate),
  days: z.array(dayActivity.extend({ date: isoDate }))
})
export type MonthActivity = z.infer<typeof monthActivitySchema>

const currencyTotal = z.object({
  currency,
  assetsMinor: minor,
  liabilitiesMinor: minor,
  netMinor: minor
})
const fxRate = z.object({ currency, rate: z.string(), date: isoDate })

export const netWorthSchema = z.object({
  totals: z.array(currencyTotal),
  // Everything in the base currency, shown only when each other currency has a stored rate.
  converted: z
    .object({
      currency,
      netMinor: minor,
      rates: z.array(fxRate),
      // Each currency's net in the base currency, in the order of totals.
      parts: z.array(z.object({ currency, netMinor: minor }))
    })
    .nullable()
})
export type NetWorth = z.infer<typeof netWorthSchema>

// Base-currency net worth at the end of each day since the first transaction, through today.
export const netWorthHistorySchema = z.object({
  currency,
  points: z.array(z.object({ date: isoDate, netMinor: minor }))
})
export type NetWorthHistory = z.infer<typeof netWorthHistorySchema>

export const categorySchema = z.object({
  id,
  name: z.string(),
  cadence: budgetPeriodSchema,
  isPercent: z.boolean() // budgeted as a share of income, so income is not added to it
})
export type Category = z.infer<typeof categorySchema>

export const budgetSchema = z.object({
  period: budgetPeriodSchema,
  start: isoDate,
  end: isoDate,
  // A date inside the period before and after this one, for stepping through periods.
  previous: isoDate,
  next: isoDate,
  currency,
  // The planned income for this period, and the plan it comes from: an amount per month or per
  // week that applies until changed. Null until income is planned.
  incomeMinor: minor.nullable(),
  income: z.object({ cadence: budgetPeriodSchema, amountMinor: minor }).nullable(),
  rows: z.array(
    z.object({
      categoryId: id,
      name: z.string(),
      // How often this category is budgeted, and its amount for that month or week.
      cadence: budgetPeriodSchema,
      setMinor: minor,
      percentBp: z.int().nullable(), // a share of income in basis points instead of an amount
      budgetedMinor: minor,
      carriedMinor: minor,
      spentMinor: minor,
      availableMinor: minor,
      rollover: z.boolean()
    })
  )
})
export type Budget = z.infer<typeof budgetSchema>

const repeat = z.enum(['none', 'weekly', 'monthly'])
export const newBillSchema = z.strictObject({
  name,
  amountMinor: positiveMinor,
  categoryId: id,
  dueDate: isoDate,
  repeat
})
export const billsSchema = z.object({
  start: isoDate,
  end: isoDate,
  currency,
  // One entry per due date in the range; paid once an expense has been recorded for it.
  dues: z.array(
    z.object({
      billId: id,
      name: z.string(),
      categoryName: z.string(),
      amountMinor: minor,
      dueDate: isoDate,
      repeat,
      paidTransactionId: id.nullable()
    })
  )
})
export type Bills = z.infer<typeof billsSchema>

const ruleKind = z.enum(['percent', 'fixed'])
export const ruleSchema = z.object({
  id,
  categoryId: id,
  categoryName: z.string(),
  kind: ruleKind,
  value: z.int() // basis points for percent, minor units for fixed
})
export type Rule = z.infer<typeof ruleSchema>

const proposalSchema = z.array(z.object({ categoryId: id, name: z.string(), amountMinor: minor }))
export type Proposal = z.infer<typeof proposalSchema>

export const goalSchema = z.object({
  id,
  name: z.string(),
  linkLabel: z.string(),
  accountId: id.nullable(), // the linked account; null when the goal follows a category
  currency,
  targetMinor: minor,
  targetDate: isoDate.nullable(),
  savedMinor: minor,
  remainingMinor: minor,
  percent: z.int(),
  period: budgetPeriodSchema,
  perPeriodMinor: minor.nullable()
})
export type Goal = z.infer<typeof goalSchema>

export const newGoalSchema = z
  .strictObject({
    name,
    targetMinor: positiveMinor,
    targetDate: isoDate.nullable(),
    accountId: id.nullable(),
    categoryId: id.nullable()
  })
  .refine((g) => (g.accountId === null) !== (g.categoryId === null))
export type NewGoal = z.infer<typeof newGoalSchema>

export const investmentsSchema = z.object({
  holdings: z.array(
    z.object({
      lotId: id,
      accountName: z.string(),
      symbol: z.string(),
      currency,
      quantityE8: minor,
      acquiredDate: isoDate,
      costMinor: minor,
      price: z.string(),
      priceDate: isoDate,
      valueMinor: minor,
      gainMinor: minor
    })
  ),
  securities: z.array(
    z.object({
      id,
      symbol: z.string(),
      name: z.string(),
      currency,
      price: z.string().nullable(),
      priceDate: isoDate.nullable()
    })
  ),
  fxRates: z.array(fxRate)
})
export type Investments = z.infer<typeof investmentsSchema>
export type Holding = Investments['holdings'][number]
export type Security = Investments['securities'][number]

export const buySchema = z.strictObject({
  accountId: id,
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9.]{1,12}$/),
  name: z.string().trim().max(100),
  quantityE8,
  price: decimalString,
  date: isoDate,
  // Take the cost out of the account's cash. Off for holdings owned before tracking began.
  payFromCash: z.boolean()
})
export type Buy = z.infer<typeof buySchema>

export const sellSchema = z.strictObject({
  lotId: id,
  quantityE8,
  price: decimalString,
  date: isoDate
})
export type Sell = z.infer<typeof sellSchema>

// Every IPC channel with the schemas for its input and output. Main parses both.
export const ipcContract = {
  'settings:get': { input: z.undefined(), output: settingsSchema },
  'settings:update': { input: settingsSchema.partial().strict(), output: settingsSchema },
  'accounts:list': { input: z.undefined(), output: z.array(accountSchema) },
  'accounts:create': { input: newAccountSchema, output: accountSchema },
  'accounts:update': { input: accountUpdateSchema, output: z.null() },
  'accounts:delete': {
    // deleteGoals: the user confirmed that goals linked to the account are deleted with it.
    input: z.strictObject({ id, deleteGoals: z.boolean() }),
    output: z.null()
  },
  'transactions:list': { input: z.undefined(), output: z.array(transactionRowSchema) },
  'transactions:create': { input: newTransactionSchema, output: z.null() },
  'transactions:month': { input: z.strictObject({ date: isoDate }), output: monthActivitySchema },
  'transactions:delete': { input: z.strictObject({ id }), output: z.null() },
  'transactions:categorize': {
    input: z.strictObject({ id, categoryId: id }),
    output: z.null()
  },
  'networth:get': { input: z.undefined(), output: netWorthSchema },
  'networth:history': { input: z.undefined(), output: netWorthHistorySchema },
  'categories:list': { input: z.undefined(), output: z.array(categorySchema) },
  'categories:create': { input: z.strictObject({ name }), output: z.null() },
  'categories:delete': { input: z.strictObject({ id }), output: z.null() },
  'budgets:get': {
    input: z.strictObject({ period: budgetPeriodSchema, date: isoDate }),
    output: budgetSchema
  },
  'budgets:set': {
    input: z.strictObject({
      categoryId: id,
      date: isoDate,
      amountMinor: z.int().nonnegative(),
      percentBp: z.int().min(1).max(10_000).nullable(),
      rollover: z.boolean(),
      cadence: budgetPeriodSchema
    }),
    output: z.null()
  },
  'budgets:plan': {
    input: z.strictObject({
      period: budgetPeriodSchema,
      date: isoDate,
      incomeMinor: z.int().nonnegative(),
      allocations: z.array(z.strictObject({ categoryId: id, amountMinor: z.int().nonnegative() }))
    }),
    output: z.null()
  },
  'bills:list': { input: z.strictObject({ date: isoDate }), output: billsSchema },
  'bills:create': { input: newBillSchema, output: z.null() },
  'bills:delete': { input: z.strictObject({ id }), output: z.null() },
  'bills:pay': {
    input: z.strictObject({ billId: id, dueDate: isoDate, accountId: id, date: isoDate }),
    output: z.null()
  },
  'budgets:propose': {
    input: z.strictObject({ amountMinor: positiveMinor }),
    output: proposalSchema
  },
  'rules:list': { input: z.undefined(), output: z.array(ruleSchema) },
  'rules:create': {
    input: z.strictObject({ categoryId: id, kind: ruleKind, value: positiveMinor }),
    output: z.null()
  },
  'rules:delete': { input: z.strictObject({ id }), output: z.null() },
  'goals:list': { input: z.undefined(), output: z.array(goalSchema) },
  'goals:create': { input: newGoalSchema, output: z.null() },
  'goals:delete': { input: z.strictObject({ id }), output: z.null() },
  'investments:get': { input: z.undefined(), output: investmentsSchema },
  'investments:buy': { input: buySchema, output: z.null() },
  'investments:sell': { input: sellSchema, output: z.null() },
  'investments:deleteLot': { input: z.strictObject({ id }), output: z.null() },
  'prices:set': {
    input: z.strictObject({ securityId: id, price: decimalString, date: isoDate }),
    output: z.null()
  },
  'fx:set': {
    input: z.strictObject({ currency, rate: decimalString, date: isoDate }),
    output: z.null()
  },
  'fx:refresh': { input: z.undefined(), output: z.null() },
  'prices:status': {
    input: z.undefined(),
    output: z.object({
      hasKey: z.boolean(),
      symbolCount: z.int().nonnegative(),
      listUpdated: isoDate.nullable()
    })
  },
  'prices:setKey': {
    input: z.strictObject({
      key: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9]{8,64}$/)
        .nullable()
    }),
    // How many US symbols the new key downloaded; 0 when the key is removed.
    output: z.int().nonnegative()
  },
  'prices:search': {
    input: z.strictObject({ query: z.string().trim().min(1).max(50) }),
    output: z.array(
      z.object({ symbol: z.string(), name: z.string(), kind: z.enum(['Stock', 'ETF']) })
    )
  },
  'prices:refresh': {
    input: z.undefined(),
    output: z.object({ updated: z.int().nonnegative(), failed: z.array(z.string()) })
  }
} as const

export type Channel = keyof typeof ipcContract
export type IpcInput<C extends Channel> = z.input<(typeof ipcContract)[C]['input']>
export type IpcOutput<C extends Channel> = z.output<(typeof ipcContract)[C]['output']>
