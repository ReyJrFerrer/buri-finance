import { transactionTextSchema, type Account } from './ipc'
import { parseAmountToMinor } from './money'

export interface QuickAdd {
  kind: 'expense' | 'income'
  amountMinor: number
  payee: string
  account: Account
}

// "120 coffee" or "+5,000 salary @gotyme": a leading + records income, a trailing @name picks
// the account by name (prefix first, then anywhere in it), otherwise the first account is used.
export function parseQuickAdd(text: string, accounts: Account[]): QuickAdd | null {
  const at = text.lastIndexOf('@')
  const head = (at < 0 ? text : text.slice(0, at)).trim()
  const accountQuery =
    at < 0
      ? ''
      : text
          .slice(at + 1)
          .trim()
          .toLowerCase()
  const match = /^([+-]?)\s*(\S+)\s+(.+)$/.exec(head)
  if (!match) return null
  const amountMinor = parseAmountToMinor(match[2])
  const payee = match[3].trim()
  if (!amountMinor || !transactionTextSchema.safeParse(payee).success) return null
  const name = (a: Account): string => a.name.toLowerCase()
  const account = accountQuery
    ? (accounts.find((a) => name(a).startsWith(accountQuery)) ??
      accounts.find((a) => name(a).includes(accountQuery)))
    : accounts[0]
  if (!account) return null
  return { kind: match[1] === '+' ? 'income' : 'expense', amountMinor, payee, account }
}
