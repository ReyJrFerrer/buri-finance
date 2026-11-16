import { useState } from 'react'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Selector } from '@astryxdesign/core/Selector'
import { Switch } from '@astryxdesign/core/Switch'
import { TextInput } from '@astryxdesign/core/TextInput'
import type { Account, Holding, Security } from '../../../../shared/ipc'
import { formatQuantity, isDecimalString, parseQuantityE8 } from '../../../../shared/money'
import { baseCurrency } from '../../../../shared/presets'
import { FormDialog } from '../../components/FormDialog'
import { errorMessage, today } from '../../lib/useQuery'

interface DialogProps {
  onClose: () => void
  onSaved: () => void
}

const quantityError = { type: 'error', message: 'Enter a quantity like 10 or 0.25' } as const
const priceError = { type: 'error', message: 'Enter a price like 128.50' } as const

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
