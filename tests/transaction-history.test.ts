import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it } from 'vitest'
import { createAccount } from '../src/main/db/accounts'
import { openDatabase } from '../src/main/db/connection'
import { migrate, migrations } from '../src/main/db/migrate'
import { createTransaction, deleteTransaction, listTransactions } from '../src/main/db/transactions'

it('keeps older history available for pagination and calendar markers beyond 500 entries', () => {
  const db = openDatabase(
    join(mkdtempSync(join(tmpdir(), 'buri-history-')), 'l.db'),
    'a'.repeat(64)
  )
  try {
    migrate(db, migrations)
    const account = createAccount(db, {
      name: 'Wallet',
      type: 'asset',
      institution: null,
      currency: 'PHP',
      parentId: null,
      openingBalanceMinor: 0,
      openingDate: '2024-02-29'
    })
    const ids = db.transaction(() =>
      Array.from({ length: 501 }, (_, i) =>
        createTransaction(db, {
          kind: 'expense',
          accountId: account.id,
          amountMinor: 100,
          categoryId: null,
          date: i === 0 ? '2024-02-29' : '2026-01-01',
          payee: `Entry ${i}`,
          memo: ''
        })
      )
    )()
    const rows = listTransactions(db)
    expect(rows).toHaveLength(501)
    expect(rows.at(-1)).toMatchObject({ id: ids[0], date: '2024-02-29' })
    expect(rows.slice(0, 500).map((row) => row.id)).toEqual(ids.slice(1).reverse())
    deleteTransaction(db, ids[0])
    expect(listTransactions(db)).toHaveLength(500)
    expect(listTransactions(db).some((row) => row.date === '2024-02-29')).toBe(false)
  } finally {
    db.close()
  }
})
