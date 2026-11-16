import Database from 'better-sqlite3-multiple-ciphers'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'

export type Db = Database.Database

export function openDatabase(file: string, keyHex: string): Db {
  // PRAGMA key cannot take bound parameters, so only a validated hex key is interpolated.
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('Invalid database key')
  const db = new Database(file)
  db.pragma("cipher = 'sqlcipher'")
  db.pragma(`key = "x'${keyHex}'"`)
  db.prepare('SELECT count(*) FROM sqlite_master').get() // throws if the key is wrong
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

interface KeyWrapper {
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

// Generates the key once and stores it wrapped by the OS keychain (Electron safeStorage).
export function loadOrCreateKey(keyFile: string, dbFile: string, wrapper: KeyWrapper): string {
  if (existsSync(keyFile)) return wrapper.decryptString(readFileSync(keyFile))
  // A new key cannot open an existing database; refuse instead of orphaning the data.
  if (existsSync(dbFile)) throw new Error('Database exists but its key file is missing')
  const key = randomBytes(32).toString('hex')
  writeFileSync(keyFile, wrapper.encryptString(key), { mode: 0o600 })
  return key
}
