import { z } from 'zod'
import { isDecimalString } from '../../shared/money'
import { baseCurrency } from '../../shared/presets'
import type { Db } from '../db/connection'
import { foreignCurrencies, setFxRate } from '../db/investments'
import type { FxRate } from '../ledger/posting'

// Frankfurter: free central-bank reference rates, no API key. One rate per working day.
const endpoint = 'https://api.frankfurter.dev/v1/latest'

const responseSchema = z.object({ date: z.iso.date(), rates: z.record(z.string(), z.number()) })

// The latest rate of one unit of `currency` in the base currency.
export async function fetchFxRate(
  currency: string,
  fetcher: typeof fetch = fetch
): Promise<FxRate> {
  const response = await fetcher(`${endpoint}?base=${currency}&symbols=${baseCurrency}`, {
    signal: AbortSignal.timeout(10_000)
  }).catch(() => undefined)
  if (response?.status === 404) throw new Error(`No exchange rate is available for ${currency}.`)
  if (!response?.ok) throw new Error('Could not reach the exchange rate service.')
  const body = responseSchema.safeParse(await response.json().catch(() => undefined))
  // The shortest text of the JSON number is the decimal the service sent, so no float maths happens.
  const rate = String(body.data?.rates[baseCurrency])
  if (!body.success || !isDecimalString(rate))
    throw new Error(`No exchange rate is available for ${currency}.`)
  return { currency, rate, date: body.data.date }
}

// Stores the latest rate for each foreign currency the user holds. Rates that arrive are kept
// even when another currency fails; the first failure is then thrown.
export async function refreshFxRates(db: Db, fetcher: typeof fetch = fetch): Promise<void> {
  const results = await Promise.allSettled(
    foreignCurrencies(db).map((currency) => fetchFxRate(currency, fetcher))
  )
  for (const result of results) {
    if (result.status === 'fulfilled')
      setFxRate(db, result.value.currency, result.value.rate, result.value.date)
  }
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
}
