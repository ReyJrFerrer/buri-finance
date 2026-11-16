import type { Db } from '../db/connection'
import { buy, deleteLot, getInvestments, sell, setFxRate, setPrice } from '../db/investments'
import { handle } from './handle'

export function registerInvestmentIpc(db: Db): void {
  handle('investments:get', () => getInvestments(db))
  handle('investments:buy', (input) => (buy(db, input), null))
  handle('investments:sell', (input) => (sell(db, input), null))
  handle('investments:deleteLot', ({ id }) => (deleteLot(db, id), null))
  handle(
    'prices:set',
    ({ securityId, price, date }) => (setPrice(db, securityId, price, date), null)
  )
  handle('fx:set', ({ currency, rate, date }) => (setFxRate(db, currency, rate, date), null))
}
