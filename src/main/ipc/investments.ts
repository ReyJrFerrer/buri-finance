import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { Db, secretFile } from '../db/connection'
import { buy, deleteLot, getInvestments, sell, setFxRate, setPrice } from '../db/investments'
import { downloadUsSymbols, refreshPrices, searchUsSymbols, type UsSymbol } from '../prices/finnhub'
import { refreshFxRates } from '../prices/fx'
import { handle } from './handle'

// The US symbol list is public market data, so it is cached as plain JSON beside the database.
interface SymbolList {
  updated: string
  symbols: UsSymbol[]
}
const listMaxAgeDays = 7

export function registerInvestmentIpc(
  db: Db,
  finnhubKey: ReturnType<typeof secretFile>,
  symbolFile: string
): void {
  let list: SymbolList | null = null
  try {
    if (existsSync(symbolFile)) list = JSON.parse(readFileSync(symbolFile, 'utf8')) as SymbolList
  } catch {
    // A damaged cache is downloaded again on the next search.
  }
  const download = async (apiKey: string): Promise<SymbolList> => {
    list = {
      updated: new Date().toISOString().slice(0, 10),
      symbols: await downloadUsSymbols(apiKey)
    }
    writeFileSync(symbolFile, JSON.stringify(list))
    return list
  }
  // A stale list is refreshed; when that fails the old list is still searched.
  const currentList = async (): Promise<SymbolList> => {
    const age = list ? (Date.now() - Date.parse(list.updated)) / 86_400_000 : Infinity
    if (list && age < listMaxAgeDays) return list
    return download(key()).catch((e: unknown) => {
      if (list) return list
      throw e
    })
  }
  const key = (): string => {
    const value = finnhubKey.get()
    if (!value) throw new Error('Add a Finnhub API key to look up prices.')
    return value
  }
  handle('investments:get', () => getInvestments(db))
  handle('investments:buy', (input) => (buy(db, input), null))
  handle('investments:sell', (input) => (sell(db, input), null))
  handle('investments:deleteLot', ({ id }) => (deleteLot(db, id), null))
  handle(
    'prices:set',
    ({ securityId, price, date }) => (setPrice(db, securityId, price, date), null)
  )
  handle('fx:set', ({ currency, rate, date }) => (setFxRate(db, currency, rate, date), null))
  handle('fx:refresh', () => refreshFxRates(db).then(() => null))
  // The key is write-only from the renderer: it can be saved or removed, never read back.
  handle('prices:status', () => ({
    hasKey: finnhubKey.get() !== null,
    symbolCount: list?.symbols.length ?? 0,
    listUpdated: list?.updated ?? null
  }))
  // A new key is tried by downloading the symbol list before it is saved, so a wrong key is
  // reported and never stored.
  handle('prices:setKey', async ({ key }) => {
    if (key === null) return (finnhubKey.set(null), 0)
    const { symbols } = await download(key)
    finnhubKey.set(key)
    return symbols.length
  })
  handle('prices:search', async ({ query }) =>
    searchUsSymbols((await currentList()).symbols, query)
  )
  handle('prices:refresh', () => refreshPrices(db, key()))
}
