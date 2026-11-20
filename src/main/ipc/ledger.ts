import { createAccount, listAccounts } from '../db/accounts'
import type { Db } from '../db/connection'
import { latestRates } from '../db/investments'
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  monthActivity
} from '../db/transactions'
import { netWorth } from '../ledger/posting'
import { handle } from './handle'

export function registerLedgerIpc(db: Db): void {
  handle('accounts:list', () => listAccounts(db))
  handle('accounts:create', (input) => createAccount(db, input))
  handle('transactions:list', () => listTransactions(db))
  handle('transactions:create', (input) => (createTransaction(db, input), null))
  handle('transactions:month', ({ date }) => monthActivity(db, date))
  handle('transactions:delete', ({ id }) => (deleteTransaction(db, id), null))
  handle('networth:get', () => netWorth(listAccounts(db), latestRates(db)))
}
