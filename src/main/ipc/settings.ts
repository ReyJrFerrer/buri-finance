import type { Db } from '../db/connection'
import { getSettings, updateSettings } from '../db/settings'
import { handle } from './handle'

export function registerSettingsIpc(db: Db): void {
  handle('settings:get', () => getSettings(db))
  handle('settings:update', (patch) => updateSettings(db, patch))
}
