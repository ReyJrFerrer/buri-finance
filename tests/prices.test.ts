import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createAccount } from '../src/main/db/accounts'
import { openDatabase, secretFile, type Db } from '../src/main/db/connection'
import { buy, getInvestments } from '../src/main/db/investments'
import { migrate, migrations } from '../src/main/db/migrate'
import {
  downloadUsSymbols,
  fetchQuote,
  refreshPrices,
  searchUsSymbols,
  type UsSymbol
} from '../src/main/prices/finnhub'
import { ipcContract } from '../src/shared/ipc'

const open = (): Db => {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'buri-')), 'p.db'), 'a'.repeat(64))
  migrate(db, migrations)
  return db
}
const hold = (db: Db, symbol: string, currency: string): void => {
  const account = createAccount(db, {
    name: `${symbol} broker`,
    type: 'asset',
    institution: null,
    currency,
    parentId: null,
    openingBalanceMinor: 0,
    openingDate: '2026-01-01'
  })
  buy(db, {
    accountId: account.id,
    symbol,
    name: '',
    quantityE8: 1e8,
    price: '1',
    date: '2026-01-02',
    payFromCash: false
  })
}
const prices = (db: Db): Record<string, string | null> =>
  Object.fromEntries(getInvestments(db).securities.map((s) => [s.symbol, s.price]))

// 2026-11-20 21:00 UTC, after the US close.
const t = Date.UTC(2026, 10, 20, 21) / 1000
const service =
  (quotes: Record<string, number>, seen: Request[] = []): typeof fetch =>
  async (url, init) => {
    seen.push(new Request(url, init))
    const { pathname, searchParams } = new URL(String(url))
    if (pathname.endsWith('/stock/symbol'))
      return Response.json([
        { symbol: 'VOO', description: 'VANGUARD S&P 500 ETF', type: 'ETP', mic: 'ARCX' },
        { symbol: 'TSM', description: 'TAIWAN SEMICONDUCTOR-SP ADR', type: 'ADR' },
        { symbol: 'AAPL', description: 'APPLE INC', type: 'Common Stock' },
        { symbol: 'XYZW', description: 'SOME WARRANT', type: 'Warrant' },
        { symbol: 'BRK-B', description: 'Not a plain ticker', type: 'Common Stock' }
      ])
    const symbol = searchParams.get('symbol')!
    return Response.json({ c: quotes[symbol] ?? 0, t: symbol in quotes ? t : 0 })
  }

describe('Finnhub prices', () => {
  it('downloads US stocks, ADRs and ETFs with the key in a header, not the URL', async () => {
    const seen: Request[] = []
    expect(await downloadUsSymbols('k3y', service({}, seen))).toEqual([
      { symbol: 'VOO', name: 'VANGUARD S&P 500 ETF', kind: 'ETF' },
      { symbol: 'TSM', name: 'TAIWAN SEMICONDUCTOR-SP ADR', kind: 'Stock' },
      { symbol: 'AAPL', name: 'APPLE INC', kind: 'Stock' }
    ])
    expect(seen[0].url).toBe('https://finnhub.io/api/v1/stock/symbol?exchange=US')
    expect(seen[0].headers.get('X-Finnhub-Token')).toBe('k3y')
    await expect(
      downloadUsSymbols('k', async () => Response.json({ error: 'nope' }))
    ).rejects.toThrow('unexpected reply')
  })

  it('ranks an exact ticker, then ticker prefixes, then names', () => {
    const list: UsSymbol[] = [
      { symbol: 'VTV', name: 'VANGUARD VALUE ETF', kind: 'ETF' },
      { symbol: 'VOOG', name: 'VANGUARD S&P 500 GROWTH ETF', kind: 'ETF' },
      { symbol: 'VOO', name: 'VANGUARD S&P 500 ETF', kind: 'ETF' },
      { symbol: 'VXUS', name: 'VANGUARD TOTAL INTL STOCK', kind: 'ETF' },
      { symbol: 'TSM', name: 'TAIWAN SEMICONDUCTOR-SP ADR', kind: 'Stock' }
    ]
    expect(searchUsSymbols(list, 'voo').map((s) => s.symbol)).toEqual(['VOO', 'VOOG'])
    expect(searchUsSymbols(list, ' vanguard ').map((s) => s.symbol)).toEqual([
      'VOO',
      'VTV',
      'VOOG',
      'VXUS'
    ])
    expect(searchUsSymbols(list, 'taiwan')[0].symbol).toBe('TSM')
    expect(searchUsSymbols(list, 'vanguard', 2)).toHaveLength(2)
    expect(searchUsSymbols(list, '  ')).toEqual([])
  })

  it('keeps the decimal Finnhub sent and dates it by the trade day', async () => {
    expect(await fetchQuote('VOO', 'k', service({ VOO: 612.07 }))).toEqual({
      price: '612.07',
      date: '2026-11-20'
    })
    await expect(fetchQuote('NOPE', 'k', service({}))).rejects.toThrow(
      'No price is available for NOPE.'
    )
  })

  it('updates USD securities only and reports symbols without a price', async () => {
    const db = open()
    hold(db, 'VOO', 'USD')
    hold(db, 'TSMA', 'USD')
    hold(db, 'BDO', 'PHP')
    const seen: Request[] = []
    expect(await refreshPrices(db, 'k', service({ VOO: 612.07 }, seen))).toEqual({
      updated: 1,
      failed: ['TSMA']
    })
    expect(prices(db)).toEqual({ BDO: '1', TSMA: '1', VOO: '612.07' })
    expect(seen.map((r) => new URL(r.url).searchParams.get('symbol')).sort()).toEqual([
      'TSMA',
      'VOO'
    ])
  })

  it('keeps prices that arrived when the key is rejected or the network fails', async () => {
    const db = open()
    hold(db, 'VOO', 'USD')
    const rejected: typeof fetch = async () => new Response('', { status: 401 })
    await expect(refreshPrices(db, 'bad', rejected)).rejects.toThrow('rejected the API key')
    await expect(
      refreshPrices(db, 'k', () => Promise.reject(new TypeError('offline')))
    ).rejects.toThrow('Could not reach Finnhub.')
    expect(prices(db)).toEqual({ VOO: '1' })
  })
})

describe('API key file', () => {
  const wrapper = {
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
    decryptString: (data: Buffer) => data.toString().replace(/^enc:/, '')
  }

  it('stores the key wrapped, reads it back and removes it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'buri-')), 'finnhub.key')
    const secret = secretFile(file, wrapper)
    expect(secret.get()).toBeNull()
    secret.set('abc12345')
    expect(readFileSync(file, 'utf8')).toBe('enc:abc12345')
    expect(secret.get()).toBe('abc12345')
    secret.set(null)
    expect(secret.get()).toBeNull()
    secret.set(null) // removing twice is harmless
  })

  it('accepts only plausible keys or null at the IPC boundary', () => {
    const input = ipcContract['prices:setKey'].input
    expect(input.parse({ key: ' abcd1234 ' }).key).toBe('abcd1234')
    expect(input.safeParse({ key: null }).success).toBe(true)
    for (const key of ['', 'short', 'has space 123', 'x'.repeat(65)])
      expect(input.safeParse({ key }).success).toBe(false)
  })
})
