import { ipcMain } from 'electron'
import { z } from 'zod'
import { ipcContract, type Channel, type IpcOutput } from '../../shared/ipc'

type ParsedInput<C extends Channel> = z.output<(typeof ipcContract)[C]['input']>

// Registers a handler whose input and output are validated against the shared contract.
export function handle<C extends Channel>(
  channel: C,
  fn: (input: ParsedInput<C>) => IpcOutput<C>
): void {
  const { input, output } = ipcContract[channel]
  ipcMain.handle(channel, (_event, raw: unknown) =>
    output.parse(fn(input.parse(raw) as ParsedInput<C>))
  )
}
