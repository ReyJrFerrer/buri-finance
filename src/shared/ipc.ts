import { z } from 'zod'

export const themeModeSchema = z.enum(['system', 'light', 'dark'])
export const settingsSchema = z.object({ themeMode: themeModeSchema })
export type Settings = z.infer<typeof settingsSchema>

// Every IPC channel with the schemas for its input and output. Main parses both.
export const ipcContract = {
  'settings:get': { input: z.undefined(), output: settingsSchema },
  'settings:update': { input: settingsSchema.partial().strict(), output: settingsSchema }
} as const

export type Channel = keyof typeof ipcContract
export type IpcInput<C extends Channel> = z.input<(typeof ipcContract)[C]['input']>
export type IpcOutput<C extends Channel> = z.output<(typeof ipcContract)[C]['output']>
