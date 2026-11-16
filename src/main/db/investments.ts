import type { Buy, Investments, Sell } from '../../shared/ipc'
import { baseCurrency } from '../../shared/presets'
import { mulDiv, valueMinor } from '../ledger/decimal'
import { systemAccounts, type FxRate } from '../ledger/posting'
import { getLedgerAccount } from './accounts'
import type { Db } from './connection'
import { uuidv7 } from './id'
import { deleteTransaction, insertTransaction } from './transactions'

interface LotRow {
  lotId: string
  accountId: string
  accountName: string
  symbol: string
  currency: string
  quantityE8: number
  acquiredDate: string
  costMinor: number
  price: string
  priceDate: string
}

const latestPrice = (column: 'price' | 'date'): string =>
  `(SELECT ${column} FROM prices WHERE security_id = s.id AND deleted_at IS NULL
    ORDER BY date DESC LIMIT 1)`

// Open lots valued at each security's latest price. Buying always records a price, so one exists.
function listHoldings(db: Db): Investments['holdings'] {
  const lots = db
    .prepare(
      `SELECT l.id AS lotId, l.account_id AS accountId, a.name AS accountName, s.symbol, s.currency,
              l.quantity_e8 AS quantityE8, l.acquired_date AS acquiredDate, l.cost_minor AS costMinor,
              ${latestPrice('price')} AS price, ${latestPrice('date')} AS priceDate
       FROM holdings_lots l
       JOIN securities s ON s.id = l.security_id
       JOIN accounts a ON a.id = l.account_id
       WHERE l.deleted_at IS NULL ORDER BY s.symbol, l.acquired_date, l.id`
    )
    .all() as LotRow[]
  return lots.map((lot) => {
    const value = valueMinor(lot.quantityE8, lot.price)
    return { ...lot, valueMinor: value, gainMinor: value - lot.costMinor }
  })
}

export function holdingsByAccount(db: Db): Map<string, number> {
  const totals = new Map<string, number>()
  for (const h of listHoldings(db) as (Investments['holdings'][number] & { accountId: string })[]) {
    totals.set(h.accountId, (totals.get(h.accountId) ?? 0) + h.valueMinor)
  }
  return totals
}

// The most recent stored rate into the base currency, per currency.
export function latestRates(db: Db): FxRate[] {
  return db
    .prepare(
      `SELECT base AS currency, rate, date FROM fx_rates f
       WHERE quote = ? AND deleted_at IS NULL
         AND date = (SELECT MAX(date) FROM fx_rates
                     WHERE base = f.base AND quote = f.quote AND deleted_at IS NULL)
       ORDER BY base`
    )
    .all(baseCurrency) as FxRate[]
}

// Currencies of the user's accounts that need a rate into the base currency.
export function foreignCurrencies(db: Db): string[] {
  return db
    .prepare(
      'SELECT DISTINCT currency FROM accounts WHERE currency != ? AND deleted_at IS NULL ORDER BY currency'
    )
    .pluck()
    .all(baseCurrency) as string[]
}

export function getInvestments(db: Db): Investments {
  const securities = db
    .prepare(
      `SELECT s.id, s.symbol, s.name, s.currency,
              ${latestPrice('price')} AS price, ${latestPrice('date')} AS priceDate
       FROM securities s WHERE s.deleted_at IS NULL ORDER BY s.symbol`
    )
    .all() as Investments['securities']
  return { holdings: listHoldings(db), securities, fxRates: latestRates(db) }
}

export function setPrice(db: Db, securityId: string, price: string, date: string): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO prices (id, security_id, date, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (security_id, date) DO UPDATE SET
       price = excluded.price, updated_at = excluded.updated_at, deleted_at = NULL`
  ).run(uuidv7(), securityId, date, price, now, now)
}

export function setFxRate(db: Db, currency: string, rate: string, date: string): void {
  if (currency === baseCurrency) throw new Error(`${baseCurrency} is the base currency`)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO fx_rates (id, base, quote, date, rate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (base, quote, date) DO UPDATE SET
       rate = excluded.rate, updated_at = excluded.updated_at, deleted_at = NULL`
  ).run(uuidv7(), currency, baseCurrency, date, rate, now, now)
}

function securityId(db: Db, symbol: string, name: string, currency: string): string {
  const existing = db
    .prepare('SELECT id FROM securities WHERE symbol = ? AND currency = ?')
    .get(symbol, currency) as { id: string } | undefined
  if (existing) return existing.id
  const id = uuidv7()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO securities (id, symbol, name, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, symbol, name, currency, now, now)
  return id
}

// Cash moves between the account and the Investments equity account at cost or proceeds; the
// holding itself is never a ledger balance, it is valued from quantity x price.
function cashSplits(
  accountId: string,
  currency: string,
  amountMinor: number
): Parameters<typeof insertTransaction>[2] {
  return [
    { accountId, amountMinor, currency },
    { accountId: systemAccounts.investments, amountMinor: -amountMinor, currency }
  ]
}

export function buy(db: Db, input: Buy): void {
  db.transaction(() => {
    const account = getLedgerAccount(db, input.accountId)
    if (account.type !== 'asset') throw new Error('Holdings belong in an asset account')
    const costMinor = valueMinor(input.quantityE8, input.price)
    if (costMinor <= 0) throw new Error('The cost rounds to zero')
    const security = securityId(db, input.symbol, input.name, account.currency)
    const transactionId = input.payFromCash
      ? insertTransaction(
          db,
          { date: input.date, payee: `Buy ${input.symbol}`, memo: '' },
          cashSplits(account.id, account.currency, -costMinor)
        )
      : null
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO holdings_lots (id, account_id, security_id, quantity_e8, cost_minor, acquired_date, transaction_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv7(),
      account.id,
      security,
      input.quantityE8,
      costMinor,
      input.date,
      transactionId,
      now,
      now
    )
    setPrice(db, security, input.price, input.date)
  })()
}

interface Lot {
  accountId: string
  securityId: string
  symbol: string
  currency: string
  quantityE8: number
  costMinor: number
  transactionId: string | null
}

function getLot(db: Db, id: string): Lot {
  const lot = db
    .prepare(
      `SELECT l.account_id AS accountId, l.security_id AS securityId, s.symbol, s.currency,
              l.quantity_e8 AS quantityE8, l.cost_minor AS costMinor, l.transaction_id AS transactionId
       FROM holdings_lots l JOIN securities s ON s.id = l.security_id
       WHERE l.id = ? AND l.deleted_at IS NULL`
    )
    .get(id) as Lot | undefined
  if (!lot) throw new Error('Holding not found')
  return lot
}

// Sells part or all of a lot: proceeds go to the account's cash and the lot shrinks, giving up
// the matching share of its cost (rounded half-even).
export function sell(db: Db, input: Sell): void {
  db.transaction(() => {
    const lot = getLot(db, input.lotId)
    if (input.quantityE8 > lot.quantityE8)
      throw new Error('You cannot sell more than the lot holds')
    const proceedsMinor = valueMinor(input.quantityE8, input.price)
    if (proceedsMinor <= 0) throw new Error('The proceeds round to zero')
    insertTransaction(
      db,
      { date: input.date, payee: `Sell ${lot.symbol}`, memo: '' },
      cashSplits(lot.accountId, lot.currency, proceedsMinor)
    )
    const quantityLeft = lot.quantityE8 - input.quantityE8
    const costLeft = lot.costMinor - mulDiv(lot.costMinor, input.quantityE8, lot.quantityE8)
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE holdings_lots SET quantity_e8 = ?, cost_minor = ?, updated_at = ?,
              deleted_at = CASE WHEN ? = 0 THEN ? ELSE NULL END
       WHERE id = ?`
    ).run(quantityLeft, costLeft, now, quantityLeft, now, input.lotId)
    setPrice(db, lot.securityId, input.price, input.date)
  })()
}

// Removes a lot entered by mistake, and gives back the cash its purchase took.
export function deleteLot(db: Db, id: string): void {
  db.transaction(() => {
    const lot = getLot(db, id)
    const now = new Date().toISOString()
    db.prepare('UPDATE holdings_lots SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
      now,
      now,
      id
    )
    if (lot.transactionId) deleteTransaction(db, lot.transactionId)
  })()
}
