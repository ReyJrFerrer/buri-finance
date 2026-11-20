import type { Account, AccountUpdate, NewAccount } from '../../shared/ipc'
import { convertMinor } from '../ledger/decimal'
import { openingSplits, type LedgerAccount } from '../ledger/posting'
import { baseCurrency } from '../../shared/presets'
import type { Db } from './connection'
import { uuidv7 } from './id'
import { holdingsByAccount, latestRates } from './investments'
import { insertTransaction } from './transactions'

const selectUserAccounts = `
  SELECT a.id, a.name, a.type, a.institution, a.currency, a.parent_id AS parentId,
    COALESCE((SELECT SUM(s.amount_minor) FROM splits s
              WHERE s.account_id = a.id AND s.deleted_at IS NULL), 0) AS balanceMinor
  FROM accounts a
  WHERE a.type IN ('asset', 'liability') AND a.archived = 0 AND a.deleted_at IS NULL`

type CashAccount = Omit<Account, 'holdingsMinor' | 'baseMinor'>

function withHoldings(db: Db, accounts: CashAccount[]): Account[] {
  const holdings = holdingsByAccount(db)
  const rates = latestRates(db)
  return accounts.map((a) => {
    const holdingsMinor = holdings.get(a.id) ?? 0
    const valueMinor = a.balanceMinor + holdingsMinor
    const rate = rates.find((r) => r.currency === a.currency)
    const baseMinor =
      a.currency === baseCurrency ? valueMinor : rate ? convertMinor(valueMinor, rate.rate) : null
    return { ...a, holdingsMinor, baseMinor }
  })
}

export function listAccounts(db: Db): Account[] {
  const rows = db.prepare(`${selectUserAccounts} ORDER BY a.name COLLATE NOCASE`).all()
  return withHoldings(db, rows as CashAccount[])
}

export function getLedgerAccount(db: Db, id: string): LedgerAccount {
  const account = db
    .prepare('SELECT id, type, currency FROM accounts WHERE id = ? AND deleted_at IS NULL')
    .get(id) as LedgerAccount | undefined
  if (!account) throw new Error('Account not found')
  return account
}

export function createAccount(db: Db, input: NewAccount): Account {
  const id = uuidv7()
  const now = new Date().toISOString()
  db.transaction(() => {
    if (input.parentId) getLedgerAccount(db, input.parentId)
    db.prepare(
      `INSERT INTO accounts (id, name, type, institution, currency, parent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.name, input.type, input.institution, input.currency, input.parentId, now, now)
    if (input.openingBalanceMinor > 0) {
      insertTransaction(
        db,
        { date: input.openingDate, payee: 'Opening balance', memo: '' },
        openingSplits({ id, type: input.type, currency: input.currency }, input.openingBalanceMinor)
      )
    }
  })()
  return withHoldings(db, [
    db.prepare(`${selectUserAccounts} AND a.id = ?`).get(id) as CashAccount
  ])[0]
}

export function updateAccount(db: Db, input: AccountUpdate): void {
  const { changes } = db
    .prepare(
      `UPDATE accounts SET name = ?, institution = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL AND type IN ('asset', 'liability')`
    )
    .run(input.name, input.institution, new Date().toISOString(), input.id)
  if (changes === 0) throw new Error('Account not found')
}

// Soft-deletes the account and its own transactions (opening balance, income, expenses).
// Refuses when other records depend on it, so no transfer or holding is left dangling. Goals
// linked to the account go with it only when `deleteGoals` says the user agreed to that.
export function deleteAccount(db: Db, id: string, deleteGoals = false): void {
  const now = new Date().toISOString()
  db.transaction(() => {
    getLedgerAccount(db, id)
    const count = (sql: string): number =>
      (db.prepare(sql).get(id) as { n: number }).n > 0 ? 1 : 0
    if (
      count(
        `SELECT COUNT(*) AS n FROM splits s
         JOIN splits o ON o.transaction_id = s.transaction_id AND o.account_id <> s.account_id
         JOIN accounts oa ON oa.id = o.account_id
         WHERE s.account_id = ? AND s.deleted_at IS NULL AND o.deleted_at IS NULL
           AND oa.type IN ('asset', 'liability')`
      )
    )
      throw new Error('This account has transfers. Delete them on the Transactions page first.')
    if (
      count('SELECT COUNT(*) AS n FROM holdings_lots WHERE account_id = ? AND deleted_at IS NULL')
    )
      throw new Error(
        'This account has holdings. Sell or remove them on the Investments page first.'
      )
    if (
      !deleteGoals &&
      count('SELECT COUNT(*) AS n FROM goals WHERE account_id = ? AND deleted_at IS NULL')
    )
      throw new Error('A goal is linked to this account. Delete the goal first.')
    db.prepare(
      'UPDATE goals SET deleted_at = ?, updated_at = ? WHERE account_id = ? AND deleted_at IS NULL'
    ).run(now, now, id)
    const where = `transaction_id IN (SELECT transaction_id FROM splits WHERE account_id = ?)`
    db.prepare(
      `UPDATE splits SET deleted_at = ?, updated_at = ? WHERE ${where} AND deleted_at IS NULL`
    ).run(now, now, id)
    db.prepare(
      `UPDATE transactions SET deleted_at = ?, updated_at = ?
       WHERE id IN (SELECT transaction_id FROM splits WHERE account_id = ?) AND deleted_at IS NULL`
    ).run(now, now, id)
    db.prepare('UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
  })()
}
