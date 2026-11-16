// shortcut: assumes 2-decimal currencies (PHP, USD); add a per-currency exponent table before supporting others like JPY.

// Parses "1,234.5" into minor units without floating point. Returns null if not a valid amount.
export function parseAmountToMinor(text: string): number | null {
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!match) return null
  const minor = Number(match[1].replace(/,/g, '')) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}

export function formatMinor(minor: number, currency: string): string {
  const abs = Math.abs(minor)
  const cents = abs % 100
  const whole = ((abs - cents) / 100).toLocaleString('en-US')
  return `${minor < 0 ? '-' : ''}${currency} ${whole}.${String(cents).padStart(2, '0')}`
}
