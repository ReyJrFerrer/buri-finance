import { createAccount, deleteAccount, listAccounts, updateAccount } from '../db/accounts'
import type { Db } from '../db/connection'
import { latestRates } from '../db/investments'
import {
  categorizeTransaction,
  createTransaction,
  dailyFlows,
  deleteTransaction,
  firstTransactionDate,
  listTransactions,
  monthActivity
} from '../db/transactions'
import { netWorth, netWorthHistory } from '../ledger/posting'
import { baseCurrency } from '../../shared/presets'
import { handle } from './handle'

export function registerLedgerIpc(db: Db): void {
  handle('accounts:list', () => listAccounts(db))
  handle('accounts:create', (input) => createAccount(db, input))
  handle('accounts:update', (input) => (updateAccount(db, input), null))
  handle('accounts:delete', ({ id }) => (deleteAccount(db, id), null))
  handle('transactions:list', () => listTransactions(db))
  handle('transactions:create', (input) => (createTransaction(db, input), null))
  handle('transactions:month', ({ date }) => monthActivity(db, date))
  handle('transactions:delete', ({ id }) => (deleteTransaction(db, id), null))
  handle(
    'transactions:categorize',
    ({ id, categoryId }) => (categorizeTransaction(db, id, categoryId), null)
  )
  handle('networth:get', () => netWorth(listAccounts(db), latestRates(db)))
  handle('networth:history', () => {
    const start = firstTransactionDate(db)
    const { totals, converted } = netWorth(listAccounts(db), latestRates(db))
    const netMinor =
      converted?.netMinor ?? totals.find((t) => t.currency === baseCurrency)?.netMinor ?? 0
    const today = new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD
    return {
      currency: baseCurrency,
      points: start ? netWorthHistory(netMinor, dailyFlows(db), start, today) : []
    }
  })
}
