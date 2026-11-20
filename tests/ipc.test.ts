import { describe, expect, it } from 'vitest'
import { ipcContract, transactionTextSchema } from '../src/shared/ipc'

describe('ipc contract', () => {
  it('shares the transaction text limit and trimming rules with the form', () => {
    for (const text of ['', 'x'.repeat(200), ` ${'x'.repeat(200)} `, '😀'.repeat(200)]) {
      expect(transactionTextSchema.safeParse(text).success).toBe(true)
    }
    for (const text of ['x'.repeat(201), '😀'.repeat(201)]) {
      expect(transactionTextSchema.safeParse(text).success).toBe(false)
    }
  })
  it('rejects unknown settings and bad values', () => {
    const input = ipcContract['settings:update'].input
    expect(input.safeParse({ themeMode: 'dark' }).success).toBe(true)
    expect(input.safeParse({ themeMode: 'neon' }).success).toBe(false)
    expect(input.safeParse({ other: 1 }).success).toBe(false)
  })
})
