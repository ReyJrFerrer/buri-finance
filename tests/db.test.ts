import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { loadOrCreateKey, openDatabase } from '../src/main/db/connection'
import { migrate, migrations, parseMigrations } from '../src/main/db/migrate'
import { getSettings, updateSettings } from '../src/main/db/settings'

const key = 'a'.repeat(64)
const tempFile = (name: string): string => join(mkdtempSync(join(tmpdir(), 'buri-')), name)
const fakeWrapper = {
  encryptString: (s: string) => Buffer.from(`wrapped:${s}`),
  decryptString: (b: Buffer) => b.toString().replace('wrapped:', '')
}

describe('openDatabase', () => {
  it('encrypts the file and rejects the wrong key', () => {
    const file = tempFile('test.db')
    const db = openDatabase(file, key)
    db.exec('CREATE TABLE t (x TEXT)')
    db.close()
    expect(readFileSync(file).subarray(0, 15).toString()).not.toBe('SQLite format 3')
    expect(() => openDatabase(file, 'b'.repeat(64))).toThrow()
    expect(openDatabase(file, key).prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 })
  })

  it('rejects a malformed key', () => {
    expect(() => openDatabase(tempFile('x.db'), "'; DROP")).toThrow('Invalid database key')
  })
})

describe('loadOrCreateKey', () => {
  it('creates a key once and returns the same key after', () => {
    const keyFile = tempFile('k')
    const first = loadOrCreateKey(keyFile, tempFile('none.db'), fakeWrapper)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(loadOrCreateKey(keyFile, 'unused', fakeWrapper)).toBe(first)
  })

  it('refuses to make a new key for an existing database', () => {
    const dbFile = tempFile('db')
    writeFileSync(dbFile, '')
    const keyFile = tempFile('k')
    expect(() => loadOrCreateKey(keyFile, dbFile, fakeWrapper)).toThrow()
    expect(existsSync(keyFile)).toBe(false)
  })
})

describe('migrations', () => {
  it('applies pending migrations once', () => {
    const db = openDatabase(tempFile('m.db'), key)
    migrate(db, migrations)
    migrate(db, migrations)
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)
  })

  it('rolls back a failing migration', () => {
    const db = openDatabase(tempFile('m.db'), key)
    expect(() =>
      migrate(db, [{ version: 1, sql: 'CREATE TABLE a (x); SELECT * FROM missing;' }])
    ).toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(0)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").get()).toBeUndefined()
  })

  it('rejects gaps and bad names', () => {
    expect(() => parseMigrations({ '0001_a.sql': '', '0003_b.sql': '' })).toThrow()
    expect(() => parseMigrations({ 'init.sql': '' })).toThrow()
  })

  it('refuses a database newer than the app', () => {
    const db = openDatabase(tempFile('m.db'), key)
    db.pragma('user_version = 99')
    expect(() => migrate(db, migrations)).toThrow('newer')
  })
})

describe('settings', () => {
  it('returns defaults and persists updates', () => {
    const db = openDatabase(tempFile('m.db'), key)
    migrate(db, migrations)
    expect(getSettings(db)).toEqual({ themeMode: 'system' })
    expect(updateSettings(db, { themeMode: 'dark' })).toEqual({ themeMode: 'dark' })
    expect(getSettings(db).themeMode).toBe('dark')
  })
})
