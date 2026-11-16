import DecimalJs from 'decimal.js'

const Decimal = DecimalJs.clone({ precision: 60, rounding: DecimalJs.ROUND_HALF_EVEN })

function toSafeInteger(value: DecimalJs): number {
  const n = value.toDecimalPlaces(0).toNumber()
  if (!Number.isSafeInteger(n)) throw new Error('Amount is too large')
  return n
}

// a * b / c, rounded once, half-even.
export function mulDiv(a: number, b: number, c: number): number {
  return toSafeInteger(new Decimal(a).mul(b).div(c))
}

// Minor units of `quantityE8` shares at a decimal-string price.
export function valueMinor(quantityE8: number, price: string): number {
  return toSafeInteger(new Decimal(quantityE8).div(1e8).mul(price).mul(100))
}

// Converts minor units with a stored decimal-string rate. Display value only.
export function convertMinor(amountMinor: number, rate: string): number {
  return toSafeInteger(new Decimal(amountMinor).mul(rate))
}
