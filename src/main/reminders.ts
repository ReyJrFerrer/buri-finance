import { BrowserWindow, Notification } from 'electron'
import { listAccounts } from './db/accounts'
import type { Db } from './db/connection'
import { getSettings } from './db/settings'
import { hasTransactionOn } from './db/transactions'
import { shouldRemind } from './ledger/reminders'

// Shows a system notification in the evening when nothing was recorded today. The text never
// includes amounts, payees or account names.
// shortcut: only fires while the app is running; register a login item or OS scheduler to
// remind when it is closed.
export function startReminders(db: Db): void {
  let lastReminded: string | undefined
  const check = (): void => {
    const now = new Date()
    const today = now.toLocaleDateString('en-CA') // local YYYY-MM-DD
    const isDue = shouldRemind({
      isEnabled: Notification.isSupported() && getSettings(db).logReminder,
      hasAccounts: listAccounts(db).length > 0,
      hasLoggedToday: hasTransactionOn(db, today),
      hour: now.getHours(),
      today,
      lastReminded
    })
    if (!isDue) return
    lastReminded = today
    const notification = new Notification({
      title: "Log today's transactions",
      body: 'Nothing is recorded for today yet. If you spent or received money, add it now.'
    })
    notification.on('click', () => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.show()
      window?.focus()
    })
    notification.show()
  }
  check()
  setInterval(check, 15 * 60 * 1000)
}
