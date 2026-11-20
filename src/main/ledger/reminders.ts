// The local hour from which a day with nothing recorded gets a reminder.
export const reminderHour = 20

interface ReminderState {
  isEnabled: boolean
  hasAccounts: boolean // nothing to log against before the first account exists
  hasLoggedToday: boolean
  hour: number // local hour, 0 to 23
  today: string // local YYYY-MM-DD
  lastReminded: string | undefined // the day the last reminder was shown
}

// One reminder a day, in the evening, and only when today has no transaction.
export function shouldRemind(state: ReminderState): boolean {
  return (
    state.isEnabled &&
    state.hasAccounts &&
    !state.hasLoggedToday &&
    state.hour >= reminderHour &&
    state.lastReminded !== state.today
  )
}
