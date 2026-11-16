import { contextBridge, ipcRenderer } from 'electron'
import type { Channel, IpcInput, IpcOutput } from '../shared/ipc'

const invoke = <C extends Channel>(channel: C, input?: IpcInput<C>): Promise<IpcOutput<C>> =>
  ipcRenderer.invoke(channel, input)

// One named method per channel; never a generic invoke.
const api = {
  settings: {
    get: () => invoke('settings:get'),
    update: (patch: IpcInput<'settings:update'>) => invoke('settings:update', patch)
  },
  accounts: {
    list: () => invoke('accounts:list'),
    create: (input: IpcInput<'accounts:create'>) => invoke('accounts:create', input)
  },
  transactions: {
    list: () => invoke('transactions:list'),
    create: (input: IpcInput<'transactions:create'>) => invoke('transactions:create', input),
    remove: (id: string) => invoke('transactions:delete', { id })
  },
  netWorth: { get: () => invoke('networth:get') },
  categories: {
    list: () => invoke('categories:list'),
    create: (name: string) => invoke('categories:create', { name }),
    remove: (id: string) => invoke('categories:delete', { id })
  },
  budgets: {
    get: (input: IpcInput<'budgets:get'>) => invoke('budgets:get', input),
    set: (input: IpcInput<'budgets:set'>) => invoke('budgets:set', input),
    propose: (amountMinor: number) => invoke('budgets:propose', { amountMinor }),
    plan: (input: IpcInput<'budgets:plan'>) => invoke('budgets:plan', input)
  },
  bills: {
    list: (date: string) => invoke('bills:list', { date }),
    create: (input: IpcInput<'bills:create'>) => invoke('bills:create', input),
    remove: (id: string) => invoke('bills:delete', { id }),
    pay: (input: IpcInput<'bills:pay'>) => invoke('bills:pay', input)
  },
  rules: {
    list: () => invoke('rules:list'),
    create: (input: IpcInput<'rules:create'>) => invoke('rules:create', input),
    remove: (id: string) => invoke('rules:delete', { id })
  },
  goals: {
    list: () => invoke('goals:list'),
    create: (input: IpcInput<'goals:create'>) => invoke('goals:create', input),
    remove: (id: string) => invoke('goals:delete', { id })
  },
  investments: {
    get: () => invoke('investments:get'),
    buy: (input: IpcInput<'investments:buy'>) => invoke('investments:buy', input),
    sell: (input: IpcInput<'investments:sell'>) => invoke('investments:sell', input),
    removeLot: (id: string) => invoke('investments:deleteLot', { id }),
    setPrice: (input: IpcInput<'prices:set'>) => invoke('prices:set', input),
    setFxRate: (input: IpcInput<'fx:set'>) => invoke('fx:set', input)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
