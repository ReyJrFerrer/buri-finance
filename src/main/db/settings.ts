import { settingsSchema, type Settings } from '../../shared/ipc'
import type { Db } from './connection'

const defaults: Settings = {
  themeMode: 'system',
  budgetPeriod: 'monthly',
  weekStart: 1,
  logReminder: true
}

export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
  return settingsSchema.parse({ ...defaults, ...stored })
}

export function updateSettings(db: Db, patch: Partial<Settings>): Settings {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
  const now = new Date().toISOString()
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) upsert.run(key, JSON.stringify(value), now)
    }
  })()
  return getSettings(db)
}
