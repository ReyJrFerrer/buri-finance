import type { Account, NewAccount } from '../../shared/ipc'
import { openingSplits, type LedgerAccount } from '../ledger/posting'
import type { Db } from './connection'
import { uuidv7 } from './id'
import { insertTransaction } from './transactions'

const selectUserAccounts = `
  SELECT a.id, a.name, a.type, a.institution, a.currency, a.parent_id AS parentId,
    COALESCE((SELECT SUM(s.amount_minor) FROM splits s
              WHERE s.account_id = a.id AND s.deleted_at IS NULL), 0) AS balanceMinor
  FROM accounts a
  WHERE a.type IN ('asset', 'liability') AND a.archived = 0 AND a.deleted_at IS NULL`

export function listAccounts(db: Db): Account[] {
  return db.prepare(`${selectUserAccounts} ORDER BY a.name COLLATE NOCASE`).all() as Account[]
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
  return db.prepare(`${selectUserAccounts} AND a.id = ?`).get(id) as Account
}
