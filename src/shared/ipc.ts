import { z } from 'zod'

export const themeModeSchema = z.enum(['system', 'light', 'dark'])
export const settingsSchema = z.object({ themeMode: themeModeSchema })
export type Settings = z.infer<typeof settingsSchema>

const id = z.uuid()
const isoDate = z.iso.date()
const currency = z.string().regex(/^[A-Z]{3}$/)
const minor = z.int()
const positiveMinor = z.int().positive()
const shortText = z.string().trim().max(200)

export const userAccountTypeSchema = z.enum(['asset', 'liability'])

// Accounts the user owns (assets and liabilities). balanceMinor is in the account's currency.
export const accountSchema = z.object({
  id,
  name: z.string(),
  type: userAccountTypeSchema,
  institution: z.string().nullable(),
  currency,
  parentId: id.nullable(),
  balanceMinor: minor
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

export const newTransactionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['expense', 'income']),
    accountId: id,
    amountMinor: positiveMinor,
    date: isoDate,
    payee: shortText,
    memo: shortText
  }),
  z.strictObject({
    kind: z.literal('transfer'),
    fromAccountId: id,
    toAccountId: id,
    amountMinor: positiveMinor,
    // Amount that arrived, required when the two accounts use different currencies.
    receivedMinor: positiveMinor.optional(),
    date: isoDate,
    memo: shortText
  })
])
export type NewTransaction = z.infer<typeof newTransactionSchema>

// One row per transaction, described from the side of the user's own accounts.
export const transactionRowSchema = z.object({
  id,
  date: isoDate,
  payee: z.string(),
  memo: z.string(),
  accountLabel: z.string(),
  amountMinor: minor,
  currency
})
export type TransactionRow = z.infer<typeof transactionRowSchema>

export const netWorthSchema = z.array(
  z.object({ currency, assetsMinor: minor, liabilitiesMinor: minor, netMinor: minor })
)
export type NetWorth = z.infer<typeof netWorthSchema>

// Every IPC channel with the schemas for its input and output. Main parses both.
export const ipcContract = {
  'settings:get': { input: z.undefined(), output: settingsSchema },
  'settings:update': { input: settingsSchema.partial().strict(), output: settingsSchema },
  'accounts:list': { input: z.undefined(), output: z.array(accountSchema) },
  'accounts:create': { input: newAccountSchema, output: accountSchema },
  'transactions:list': { input: z.undefined(), output: z.array(transactionRowSchema) },
  'transactions:create': { input: newTransactionSchema, output: z.null() },
  'transactions:delete': { input: z.strictObject({ id }), output: z.null() },
  'networth:get': { input: z.undefined(), output: netWorthSchema }
} as const

export type Channel = keyof typeof ipcContract
export type IpcInput<C extends Channel> = z.input<(typeof ipcContract)[C]['input']>
export type IpcOutput<C extends Channel> = z.output<(typeof ipcContract)[C]['output']>
