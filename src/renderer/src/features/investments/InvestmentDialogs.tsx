import { useMemo, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Selector } from '@astryxdesign/core/Selector'
import { Switch } from '@astryxdesign/core/Switch'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Typeahead, type SearchableItem } from '@astryxdesign/core/Typeahead'
import type { Account, Holding, IpcOutput, Security } from '../../../../shared/ipc'
import { formatQuantity, isDecimalString, parseQuantityE8 } from '../../../../shared/money'
import { baseCurrency, phSecurityPresets } from '../../../../shared/presets'
import { FormDialog } from '../../components/FormDialog'
import { errorMessage, today, useQuery } from '../../lib/useQuery'

interface DialogProps {
  onClose: () => void
  onSaved: () => void
}

const quantityError = { type: 'error', message: 'Enter a quantity like 10 or 0.25' } as const
const priceError = { type: 'error', message: 'Enter a price like 128.50' } as const

type PriceStatus = IpcOutput<'prices:status'>
type Pick = SearchableItem<{ symbol: string; name: string }>
const pick = (market: string, symbol: string, name: string): Pick => ({
  id: `${market}:${symbol}`,
  label: `${symbol} · ${name} · ${market}`,
  auxiliaryData: { symbol, name }
})

// Philippine names match from the built-in list; US names come from the downloaded Finnhub list
// when a key is saved. A failed US lookup is reported and the Philippine matches stay.
function investmentSource(
  hasKey: boolean,
  onError: (message: string | undefined) => void
): {
  bootstrap: () => Pick[]
  search: (query: string, context?: { update(items: Pick[]): void }) => Promise<Pick[]>
} {
  return {
    bootstrap: () => [],
    search: async (query, context) => {
      const q = query.trim().toLowerCase()
      const local = phSecurityPresets
        .filter((p) => p.symbol.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
        .map((p) => pick('PH', p.symbol, p.name))
      if (!hasKey) return local
      context?.update(local)
      try {
        const remote = await window.api.prices.search(query)
        onError(undefined)
        return [...local, ...remote.map((r) => pick(`US ${r.kind}`, r.symbol, r.name))]
      } catch (e) {
        onError(errorMessage(e))
        return local
      }
    }
  }
}

// Shared form state: a decimal-string price, a date, and saving with error handling.
function usePriceForm(onSaved: () => void): {
  price: string
  setPrice: (value: string) => void
  isPriceValid: boolean
  date: ReturnType<typeof today>
  dateInput: React.JSX.Element
  error: string | undefined
  hasSubmitted: boolean
  save: (isValid: boolean, send: () => Promise<unknown>) => Promise<void>
} {
  const [price, setPrice] = useState('')
  const [date, setDate] = useState(today())
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)
  const save = async (isValid: boolean, send: () => Promise<unknown>): Promise<void> => {
    setSubmitted(true)
    if (!isValid) return
    try {
      await send()
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return {
    price: price.trim().replace(/,/g, ''),
    setPrice,
    isPriceValid: isDecimalString(price.trim().replace(/,/g, '')),
    date,
    dateInput: (
      <DateInput label="Date" value={date} onChange={(value) => value && setDate(value)} />
    ),
    error,
    hasSubmitted,
    save
  }
}

export function BuyDialog(props: DialogProps & { accounts: Account[] }): React.JSX.Element {
  const accounts = props.accounts.filter((a) => a.type === 'asset')
  const form = usePriceForm(props.onSaved)
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : '')
  const [symbol, setSymbol] = useState('')
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [payFromCash, setPayFromCash] = useState(true)
  const [picked, setPicked] = useState<Pick | null>(null)
  const [priceStatus] = useQuery(window.api.prices.status)
  const hasKey = !!priceStatus?.hasKey
  const [searchError, setSearchError] = useState<string>()
  const source = useMemo(() => investmentSource(hasKey, setSearchError), [hasKey])
  const account = accounts.find((a) => a.id === accountId)
  const quantityE8 = parseQuantityE8(quantity.replace(/,/g, '')) || null
  const isSymbolValid = /^[A-Za-z0-9.]{1,12}$/.test(symbol.trim())

  const submit = (): Promise<void> =>
    form.save(!!account && isSymbolValid && !!quantityE8 && form.isPriceValid, () =>
      window.api.investments.buy({
        accountId,
        symbol: symbol.trim(),
        name,
        quantityE8: quantityE8 ?? 0,
        price: form.price,
        date: form.date,
        payFromCash
      })
    )

  return (
    <FormDialog
      title="Add holding"
      submitLabel="Save holding"
      error={form.error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      <Selector
        label="Account"
        options={accounts.map((a) => ({ value: a.id, label: a.name, description: a.currency }))}
        value={accountId}
        onChange={setAccountId}
        status={
          form.hasSubmitted && !account
            ? { type: 'error', message: 'Choose an account' }
            : undefined
        }
      />
      <Typeahead
        label="Find investment"
        description={
          hasKey
            ? 'Philippine stocks and funds, or US stocks and ETFs. Fills in the symbol and name.'
            : 'Philippine stocks and funds. Add a Finnhub key under Prices to also search US stocks and ETFs.'
        }
        placeholder="VOO, Jollibee, equity fund…"
        searchSource={source}
        value={picked}
        debounceMs={200}
        status={
          searchError
            ? { type: 'warning', message: `US search is unavailable: ${searchError}` }
            : undefined
        }
        onChange={(item) => {
          setPicked(item)
          if (item?.auxiliaryData) {
            setSymbol(item.auxiliaryData.symbol)
            setName(item.auxiliaryData.name)
          }
        }}
        isOptional
      />
      <TextInput
        label="Symbol"
        placeholder="BDO"
        value={symbol}
        onChange={setSymbol}
        autoCapitalize="characters"
        status={
          form.hasSubmitted && !isSymbolValid
            ? { type: 'error', message: 'Enter a ticker symbol like BDO or AAPL' }
            : undefined
        }
      />
      <TextInput label="Company or fund name" value={name} onChange={setName} isOptional />
      <TextInput
        label="Quantity"
        description="Fractional shares are fine, up to 8 decimal places."
        value={quantity}
        onChange={setQuantity}
        inputMode="decimal"
        status={form.hasSubmitted && !quantityE8 ? quantityError : undefined}
      />
      <TextInput
        label={`Price per share${account ? ` (${account.currency})` : ''}`}
        value={form.price}
        onChange={form.setPrice}
        inputMode="decimal"
        status={form.hasSubmitted && !form.isPriceValid ? priceError : undefined}
      />
      {form.dateInput}
      <Switch
        label="Paid from this account's cash"
        description="Turn off for shares you already owned before tracking them here."
        value={payFromCash}
        onChange={setPayFromCash}
      />
    </FormDialog>
  )
}

export function SellDialog(props: DialogProps & { holding: Holding }): React.JSX.Element {
  const { holding } = props
  const form = usePriceForm(props.onSaved)
  const [quantity, setQuantity] = useState(formatQuantity(holding.quantityE8).replace(/,/g, ''))
  const quantityE8 = parseQuantityE8(quantity.replace(/,/g, '')) || null

  const submit = (): Promise<void> =>
    form.save(!!quantityE8 && form.isPriceValid, () =>
      window.api.investments.sell({
        lotId: holding.lotId,
        quantityE8: quantityE8 ?? 0,
        price: form.price,
        date: form.date
      })
    )

  return (
    <FormDialog
      title={`Sell ${holding.symbol}`}
      submitLabel="Record sale"
      error={form.error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      <TextInput
        label="Quantity to sell"
        description={`This lot holds ${formatQuantity(holding.quantityE8)}. The proceeds are added to ${holding.accountName}.`}
        value={quantity}
        onChange={setQuantity}
        inputMode="decimal"
        status={form.hasSubmitted && !quantityE8 ? quantityError : undefined}
      />
      <TextInput
        label={`Sale price per share (${holding.currency})`}
        value={form.price}
        onChange={form.setPrice}
        inputMode="decimal"
        hasAutoFocus
        status={form.hasSubmitted && !form.isPriceValid ? priceError : undefined}
      />
      {form.dateInput}
    </FormDialog>
  )
}

export function PriceDialog(props: DialogProps & { security: Security }): React.JSX.Element {
  const { security } = props
  const form = usePriceForm(props.onSaved)
  const submit = (): Promise<void> =>
    form.save(form.isPriceValid, () =>
      window.api.investments.setPrice({
        securityId: security.id,
        price: form.price,
        date: form.date
      })
    )

  return (
    <FormDialog
      title={`Update ${security.symbol} price`}
      submitLabel="Save price"
      error={form.error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      <TextInput
        label={`Price per share (${security.currency})`}
        value={form.price}
        onChange={form.setPrice}
        inputMode="decimal"
        hasAutoFocus
        status={form.hasSubmitted && !form.isPriceValid ? priceError : undefined}
      />
      {form.dateInput}
    </FormDialog>
  )
}

export function FxDialog(props: DialogProps & { currencies: string[] }): React.JSX.Element {
  const form = usePriceForm(props.onSaved)
  const [currency, setCurrency] = useState(props.currencies[0])
  const submit = (): Promise<void> =>
    form.save(form.isPriceValid, () =>
      window.api.investments.setFxRate({ currency, rate: form.price, date: form.date })
    )

  return (
    <FormDialog
      title="Set exchange rate"
      submitLabel="Save rate"
      error={form.error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      <Selector
        label="Currency"
        options={props.currencies}
        value={currency}
        onChange={setCurrency}
      />
      <TextInput
        label={`${baseCurrency} for 1 ${currency}`}
        placeholder="58.25"
        value={form.price}
        onChange={form.setPrice}
        inputMode="decimal"
        status={
          form.hasSubmitted && !form.isPriceValid
            ? { type: 'error', message: 'Enter a rate like 58.25' }
            : undefined
        }
      />
      {form.dateInput}
    </FormDialog>
  )
}

export function PriceKeyDialog(props: DialogProps & { status: PriceStatus }): React.JSX.Element {
  const { hasKey, symbolCount, listUpdated } = props.status
  const [key, setKey] = useState('')
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)
  // Set once a new key has been checked and saved, to show the confirmation.
  const [savedCount, setSavedCount] = useState<number>()
  const trimmed = key.trim()
  const isValid = trimmed === '' ? hasKey : /^[A-Za-z0-9]{8,64}$/.test(trimmed)

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    setError(undefined)
    if (!isValid) return
    try {
      const count = await window.api.prices.setKey(trimmed || null)
      if (trimmed) setSavedCount(count)
      else props.onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (savedCount !== undefined)
    return (
      <FormDialog
        title="Automatic prices are on"
        submitLabel="Done"
        onSubmit={async () => props.onSaved()}
        onClose={props.onSaved}
      >
        <Banner
          status="success"
          title="Your Finnhub key works"
          description={`${savedCount.toLocaleString('en-US')} US stocks and ETFs are ready to search when you add a holding. Prices for your US (USD) holdings now update each time you open Investments.`}
        />
      </FormDialog>
    )

  return (
    <FormDialog
      title="Automatic prices"
      submitLabel={trimmed || !hasKey ? 'Save key' : 'Remove key'}
      error={error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      {hasKey && (
        <Banner
          status="info"
          title="A Finnhub key is already saved"
          description={`${symbolCount.toLocaleString('en-US')} US stocks and ETFs are available to search${listUpdated ? ` (list from ${listUpdated}, refreshed weekly)` : ''}. Enter a new key to replace it, or leave the field empty and remove it.`}
        />
      )}
      <TextInput
        label={hasKey ? 'New Finnhub API key' : 'Finnhub API key'}
        type="password"
        description="Get a free key at finnhub.io. It is stored encrypted on this device and only used for US stock and ETF names and prices. Saving checks the key and downloads the US list, which can take a few seconds."
        value={key}
        onChange={setKey}
        status={
          hasSubmitted && !isValid
            ? {
                type: 'error',
                message: trimmed ? 'Paste the key exactly as Finnhub shows it' : 'Paste your key'
              }
            : undefined
        }
      />
    </FormDialog>
  )
}
