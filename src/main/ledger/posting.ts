import { baseCurrency } from '../../shared/presets'
import type { NetWorth } from '../../shared/ipc'

export const systemAccounts = {
  income: '00000000-0000-7000-8000-000000000001',
  expense: '00000000-0000-7000-8000-000000000002',
  opening: '00000000-0000-7000-8000-000000000003',
  exchange: '00000000-0000-7000-8000-000000000004'
} as const

export interface LedgerAccount {
  id: string
  type: string
  currency: string
}

export interface Split {
  accountId: string
  amountMinor: number
  currency: string
}

// Sign convention: positive raises an asset; negative raises a liability, income or equity.

// The double-entry invariant: two or more splits that sum to zero in every currency.
export function assertBalanced(splits: Split[]): void {
  if (splits.length < 2) throw new Error('A transaction needs at least two splits')
  const sums = new Map<string, number>()
  for (const s of splits) {
    if (!Number.isSafeInteger(s.amountMinor) || s.amountMinor === 0) {
      throw new Error('Split amounts must be non-zero whole minor units')
    }
    sums.set(s.currency, (sums.get(s.currency) ?? 0) + s.amountMinor)
  }
  for (const sum of sums.values()) {
    if (sum !== 0) throw new Error('Splits must sum to zero per currency')
  }
}

function assertUserAccount(account: LedgerAccount): void {
  if (account.type !== 'asset' && account.type !== 'liability') {
    throw new Error('Not one of your accounts')
  }
}

function assertPositive(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Amount must be a positive whole number of minor units')
  }
}

function pair(account: LedgerAccount, amountMinor: number, counterId: string): Split[] {
  assertUserAccount(account)
  const { id, currency } = account
  return [
    { accountId: id, amountMinor, currency },
    { accountId: counterId, amountMinor: -amountMinor, currency }
  ]
}

export function expenseSplits(account: LedgerAccount, amountMinor: number): Split[] {
  assertPositive(amountMinor)
  return pair(account, -amountMinor, systemAccounts.expense)
}

export function incomeSplits(account: LedgerAccount, amountMinor: number): Split[] {
  assertPositive(amountMinor)
  return pair(account, amountMinor, systemAccounts.income)
}

// amountMinor is what the account holds (asset) or owes (liability).
export function openingSplits(account: LedgerAccount, amountMinor: number): Split[] {
  assertPositive(amountMinor)
  const signed = account.type === 'liability' ? -amountMinor : amountMinor
  return pair(account, signed, systemAccounts.opening)
}

// A transfer between the user's own accounts is never income or expense. Across currencies both
// entered amounts are kept, balanced per currency through the Currency Exchange equity account.
export function transferSplits(
  from: LedgerAccount,
  to: LedgerAccount,
  sentMinor: number,
  receivedMinor?: number
): Split[] {
  assertUserAccount(from)
  assertUserAccount(to)
  assertPositive(sentMinor)
  if (from.id === to.id) throw new Error('Choose two different accounts')
  if (from.currency === to.currency) {
    if (receivedMinor !== undefined && receivedMinor !== sentMinor) {
      throw new Error('Amounts must match when both accounts use the same currency')
    }
    return [
      { accountId: from.id, amountMinor: -sentMinor, currency: from.currency },
      { accountId: to.id, amountMinor: sentMinor, currency: to.currency }
    ]
  }
  if (receivedMinor === undefined) {
    throw new Error('Enter the amount received for a transfer between currencies')
  }
  assertPositive(receivedMinor)
  return [
    { accountId: from.id, amountMinor: -sentMinor, currency: from.currency },
    { accountId: systemAccounts.exchange, amountMinor: sentMinor, currency: from.currency },
    { accountId: to.id, amountMinor: receivedMinor, currency: to.currency },
    { accountId: systemAccounts.exchange, amountMinor: -receivedMinor, currency: to.currency }
  ]
}

// Totals per currency, never converted: there is no stored FX rate to convert with yet.
export function netWorth(
  accounts: { type: string; currency: string; balanceMinor: number }[]
): NetWorth {
  const totals = new Map<string, NetWorth[number]>()
  for (const a of accounts) {
    const t = totals.get(a.currency) ?? {
      currency: a.currency,
      assetsMinor: 0,
      liabilitiesMinor: 0,
      netMinor: 0
    }
    if (a.type === 'asset') t.assetsMinor += a.balanceMinor
    else t.liabilitiesMinor -= a.balanceMinor
    t.netMinor += a.balanceMinor
    totals.set(a.currency, t)
  }
  const rank = (currency: string): number => (currency === baseCurrency ? 0 : 1)
  return [...totals.values()].sort(
    (a, b) => rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency)
  )
}

interface UserSplit {
  accountName: string
  amountMinor: number
  currency: string
}

// Describes a transaction from its splits on the user's own accounts (one, or two for a transfer).
export function describeTransaction(splits: UserSplit[]): {
  accountLabel: string
  amountMinor: number
  currency: string
} {
  if (splits.length === 2) {
    const [from, to] = [...splits].sort((a, b) => a.amountMinor - b.amountMinor)
    return {
      accountLabel: `${from.accountName} → ${to.accountName}`,
      amountMinor: to.amountMinor,
      currency: to.currency
    }
  }
  const [only] = splits
  return { accountLabel: only.accountName, amountMinor: only.amountMinor, currency: only.currency }
}
