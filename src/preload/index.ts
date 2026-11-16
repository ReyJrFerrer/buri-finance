import { contextBridge, ipcRenderer } from 'electron'
import type { Channel, IpcInput, IpcOutput } from '../shared/ipc'

const invoke = <C extends Channel>(channel: C, input?: IpcInput<C>): Promise<IpcOutput<C>> =>
  ipcRenderer.invoke(channel, input)

// One named method per channel; never a generic invoke.
const api = {
  settings: {
    get: () => invoke('settings:get'),
    update: (patch: IpcInput<'settings:update'>) => invoke('settings:update', patch)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
