import { useCallback, useEffect, useState } from 'react'
import type { ISODateString } from '@astryxdesign/core/Calendar'

// Loads data through window.api and returns it with a reload function. Pass a stable loader.
export function useQuery<T>(load: () => Promise<T>): [T | undefined, () => void] {
  const [data, setData] = useState<T>()
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let isCurrent = true
    load().then((result) => isCurrent && setData(result))
    return () => {
      isCurrent = false
    }
  }, [load, version])
  return [data, useCallback(() => setVersion((v) => v + 1), [])]
}

// Local calendar date; en-CA formats as YYYY-MM-DD.
export const today = (): ISODateString => new Date().toLocaleDateString('en-CA') as ISODateString

// Electron prefixes handler errors with the channel name; keep only the message.
export const errorMessage = (error: unknown): string =>
  String(error instanceof Error ? error.message : error).replace(/^.*?: Error: /, '')
