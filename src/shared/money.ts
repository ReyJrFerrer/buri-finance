// shortcut: assumes 2-decimal currencies (PHP, USD); add a per-currency exponent table before supporting others like JPY.

// Parses "1,234.5" into minor units without floating point. Returns null if not a valid amount.
export function parseAmountToMinor(text: string): number | null {
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!match) return null
  const minor = Number(match[1].replace(/,/g, '')) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}

export function formatAmount(minor: number): string {
  const abs = Math.abs(minor)
  const cents = abs % 100
  const whole = ((abs - cents) / 100).toLocaleString('en-US')
  return `${whole}.${String(cents).padStart(2, '0')}`
}

export const formatMinor = (minor: number, currency: string): string =>
  `${minor < 0 ? '-' : ''}${currency} ${formatAmount(minor)}`

// Share quantities are integers scaled by 1e8, so fractional shares stay exact.
export function parseQuantityE8(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(text.trim())
  if (!match) return null
  const e8 = Number(match[1]) * 1e8 + Number((match[2] ?? '').padEnd(8, '0'))
  return Number.isSafeInteger(e8) ? e8 : null
}

export function formatQuantity(quantityE8: number): string {
  const fraction = quantityE8 % 1e8
  const whole = ((quantityE8 - fraction) / 1e8).toLocaleString('en-US')
  const decimals = String(fraction).padStart(8, '0').replace(/0+$/, '')
  return decimals ? `${whole}.${decimals}` : whole
}

// A positive decimal such as a price or FX rate, kept as a string so it is never a float.
export const isDecimalString = (text: string): boolean =>
  /^\d{1,12}(\.\d{1,8})?$/.test(text) && /[1-9]/.test(text)
