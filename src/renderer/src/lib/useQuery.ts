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

// Fetches the latest exchange rates when the page opens, then calls `onDone` (pass a stable
// reload) so the page shows them. Returns the error message when the rates could not be fetched.
export function useFxRefresh(onDone: () => void): string | undefined {
  const [error, setError] = useState<string>()
  useEffect(() => {
    window.api.investments
      .refreshFx()
      .catch((e: unknown) => setError(errorMessage(e)))
      .then(onDone)
  }, [onDone])
  return error
}

// "November 2026" for any ISO date in that month.
export const monthLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

// "Nov 18" and "Friday, 20 November 2026" for an ISO date.
export const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

// Local calendar date; en-CA formats as YYYY-MM-DD.
export const today = (): ISODateString => new Date().toLocaleDateString('en-CA') as ISODateString

// Electron prefixes handler errors with the channel name; keep only the message.
export const errorMessage = (error: unknown): string =>
  String(error instanceof Error ? error.message : error).replace(/^.*?: Error: /, '')
