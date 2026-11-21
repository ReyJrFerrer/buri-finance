import { z } from 'zod'
import { isDecimalString } from '../../shared/money'
import type { Db } from '../db/connection'
import { getInvestments, setPrice } from '../db/investments'

// Finnhub: US stocks and ETFs, free API key. PSE stocks and PH funds are not covered, so only
// USD securities are looked up; the rest keep manual prices.
const endpoint = 'https://finnhub.io/api/v1'

const listSchema = z.array(
  z.object({ symbol: z.string(), description: z.string(), type: z.string() })
)
const quoteSchema = z.object({ c: z.number(), t: z.number() })

class NoPriceError extends Error {}

async function get(
  path: string,
  apiKey: string,
  fetcher: typeof fetch,
  timeoutMs = 10_000
): Promise<unknown> {
  // The key goes in a header so it never appears in a URL.
  const response = await fetcher(`${endpoint}${path}`, {
    headers: { 'X-Finnhub-Token': apiKey },
    signal: AbortSignal.timeout(timeoutMs)
  }).catch(() => undefined)
  if (response?.status === 401 || response?.status === 403)
    throw new Error('Finnhub rejected the API key. Check it in price lookup settings.')
  if (response?.status === 429)
    throw new Error('Finnhub rate limit reached. Try again in a minute.')
  if (!response?.ok) throw new Error('Could not reach Finnhub.')
  return response.json().catch(() => undefined)
}

export interface UsSymbol {
  symbol: string
  name: string
  kind: 'Stock' | 'ETF'
}

// Finnhub types kept from the US list; TSM, for one, trades in the US as an ADR.
const kinds: Record<string, UsSymbol['kind']> = {
  'Common Stock': 'Stock',
  ADR: 'Stock',
  REIT: 'Stock',
  ETP: 'ETF'
}

// Every US-listed stock and ETF Finnhub covers, about 30,000 rows, fetched once and searched on
// the device so typing never waits on the network.
export async function downloadUsSymbols(
  apiKey: string,
  fetcher: typeof fetch = fetch
): Promise<UsSymbol[]> {
  const body = listSchema.safeParse(await get('/stock/symbol?exchange=US', apiKey, fetcher, 60_000))
  if (!body.success) throw new Error('Finnhub sent an unexpected reply.')
  return body.data.flatMap(({ symbol, description, type }) =>
    kinds[type] && /^[A-Z0-9.]{1,12}$/.test(symbol)
      ? [{ symbol, name: description, kind: kinds[type] }]
      : []
  )
}

// Exact ticker first, then tickers starting with the query, then names containing it.
export function searchUsSymbols(symbols: UsSymbol[], query: string, limit = 10): UsSymbol[] {
  const q = query.trim().toUpperCase()
  if (!q) return []
  const rank = (s: UsSymbol): number =>
    s.symbol === q ? 0 : s.symbol.startsWith(q) ? 1 : s.name.toUpperCase().includes(q) ? 2 : 3
  return symbols
    .filter((s) => rank(s) < 3)
    .sort(
      (a, b) =>
        rank(a) - rank(b) || a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol)
    )
    .slice(0, limit)
}

// The latest trade price as the decimal Finnhub sent, dated by the trade's UTC day.
export async function fetchQuote(
  symbol: string,
  apiKey: string,
  fetcher: typeof fetch = fetch
): Promise<{ price: string; date: string }> {
  const body = quoteSchema.safeParse(
    await get(`/quote?symbol=${encodeURIComponent(symbol)}`, apiKey, fetcher)
  )
  // Finnhub answers an unknown symbol with zeros rather than an error.
  const price = String(body.data?.c)
  if (!body.success || body.data.c <= 0 || !isDecimalString(price))
    throw new NoPriceError(`No price is available for ${symbol}.`)
  return { price, date: new Date(body.data.t * 1000).toISOString().slice(0, 10) }
}

// Stores the latest price of every USD security. Prices that arrive are kept when others fail;
// the symbols that failed are returned, and a key or network problem is thrown.
export async function refreshPrices(
  db: Db,
  apiKey: string,
  fetcher: typeof fetch = fetch
): Promise<{ updated: number; failed: string[] }> {
  const symbols = getInvestments(db).securities.filter((s) => s.currency === 'USD')
  const results = await Promise.allSettled(
    symbols.map((s) => fetchQuote(s.symbol, apiKey, fetcher))
  )
  const failed: string[] = []
  let error: unknown
  results.forEach((result, i) => {
    if (result.status === 'fulfilled')
      setPrice(db, symbols[i].id, result.value.price, result.value.date)
    else if (result.reason instanceof NoPriceError) failed.push(symbols[i].symbol)
    else error ??= result.reason
  })
  if (error) throw error
  return { updated: symbols.length - failed.length, failed }
}
