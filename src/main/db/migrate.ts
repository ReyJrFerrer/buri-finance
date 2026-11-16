import type { Db } from './connection'

export interface Migration {
  version: number
  sql: string
}

// Files are named NNNN_description.sql; the number is the schema version.
export function parseMigrations(files: Record<string, string>): Migration[] {
  const migrations = Object.entries(files)
    .map(([path, sql]) => {
      const match = /(\d+)_[^/]+\.sql$/.exec(path)
      if (!match) throw new Error(`Bad migration file name: ${path}`)
      return { version: Number(match[1]), sql }
    })
    .sort((a, b) => a.version - b.version)
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migrations must be numbered 1..n, found ${m.version}`)
  })
  return migrations
}

export function migrate(db: Db, migrations: Migration[]): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > migrations.length) throw new Error('Database is newer than this app version')
  for (const m of migrations.slice(current)) {
    db.transaction(() => {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`) // integer from parseMigrations, not user input
    })()
  }
}

export const migrations = parseMigrations(
  import.meta.glob<string>('./migrations/*.sql', { query: '?raw', import: 'default', eager: true })
)
