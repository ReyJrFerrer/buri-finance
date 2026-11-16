import { describe, expect, it } from 'vitest'
import { ipcContract } from '../src/shared/ipc'

describe('ipc contract', () => {
  it('rejects unknown settings and bad values', () => {
    const input = ipcContract['settings:update'].input
    expect(input.safeParse({ themeMode: 'dark' }).success).toBe(true)
    expect(input.safeParse({ themeMode: 'neon' }).success).toBe(false)
    expect(input.safeParse({ other: 1 }).success).toBe(false)
  })
})
