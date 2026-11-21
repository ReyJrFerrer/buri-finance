import { describe, expect, it } from 'vitest'
import type { Account } from '../src/shared/ipc'
import { parseQuickAdd } from '../src/shared/quickAdd'

const account = (id: string, name: string): Account => ({
  id,
  name,
  type: 'asset',
  institution: null,
  currency: 'PHP',
  parentId: null,
  balanceMinor: 0,
  holdingsMinor: 0,
  baseMinor: 0
})
const accounts = [account('a', 'GCash'), account('b', 'GoTyme Go Save'), account('c', 'MariBank')]

describe('parseQuickAdd', () => {
  it('reads an expense on the first account by default', () => {
    expect(parseQuickAdd('120 coffee', accounts)).toEqual({
      kind: 'expense',
      amountMinor: 12000,
      payee: 'coffee',
      account: accounts[0]
    })
    expect(parseQuickAdd('-1,234.5 rent', accounts)?.amountMinor).toBe(123450)
  })
  it('reads income and picks the account by prefix, then by substring', () => {
    const income = parseQuickAdd('+5,000.25 Salary @gotyme', accounts)
    expect(income).toMatchObject({ kind: 'income', amountMinor: 500025, payee: 'Salary' })
    expect(income?.account.id).toBe('b')
    expect(parseQuickAdd('50 snack @save', accounts)?.account.id).toBe('b')
    expect(parseQuickAdd('50 a@b lunch @mari', accounts)).toMatchObject({
      payee: 'a@b lunch',
      account: { id: 'c' }
    })
  })
  it('returns null for anything that is not a complete entry', () => {
    for (const text of ['', 'coffee', '120', '0 coffee', '1.234 coffee', '12 coffee @bpi']) {
      expect(parseQuickAdd(text, accounts)).toBeNull()
    }
    expect(parseQuickAdd(`1 ${'x'.repeat(201)}`, accounts)).toBeNull()
    expect(parseQuickAdd('120 coffee', [])).toBeNull()
  })
})
