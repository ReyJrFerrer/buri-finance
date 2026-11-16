import { useState } from 'react'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Selector } from '@astryxdesign/core/Selector'
import { DateInput } from '@astryxdesign/core/DateInput'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import type { Account } from '../../../../shared/ipc'
import { parseAmountToMinor } from '../../../../shared/money'
import { FormDialog } from '../../components/FormDialog'
import { errorMessage, today } from '../../lib/useQuery'

interface Props {
  accounts: Account[]
  onClose: () => void
  onSaved: () => void
}

const amountError = { type: 'error', message: 'Enter an amount like 1,234.50' } as const
const accountError = { type: 'error', message: 'Choose an account' } as const

export function AddTransactionDialog({ accounts, onClose, onSaved }: Props): React.JSX.Element {
  const [kind, setKind] = useState('expense')
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : '')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [received, setReceived] = useState('')
  const [payee, setPayee] = useState('')
  const [memo, setMemo] = useState('')
  const [date, setDate] = useState(today())
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)

  const options = accounts.map((a) => ({ value: a.id, label: a.name, description: a.currency }))
  const account = accounts.find((a) => a.id === accountId)
  const toAccount = accounts.find((a) => a.id === toAccountId)
  const isTransfer = kind === 'transfer'
  const isCrossCurrency =
    isTransfer && !!account && !!toAccount && account.currency !== toAccount.currency
  const amountMinor = parseAmountToMinor(amount) || null
  const receivedMinor = parseAmountToMinor(received) || null
  const suffix = (a?: Account): string => (a ? ` (${a.currency})` : '')

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!account || !amountMinor) return
    if (isTransfer && (!toAccount || (isCrossCurrency && !receivedMinor))) return
    try {
      await window.api.transactions.create(
        isTransfer
          ? {
              kind: 'transfer',
              fromAccountId: accountId,
              toAccountId,
              amountMinor,
              receivedMinor: isCrossCurrency ? (receivedMinor ?? undefined) : undefined,
              date,
              memo
            }
          : {
              kind: kind === 'income' ? 'income' : 'expense',
              accountId,
              amountMinor,
              date,
              payee,
              memo
            }
      )
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title="Add transaction"
      submitLabel="Save transaction"
      error={error}
      onSubmit={submit}
      onClose={onClose}
    >
      <SegmentedControl label="Transaction type" value={kind} onChange={setKind} layout="fill">
        <SegmentedControlItem value="expense" label="Expense" />
        <SegmentedControlItem value="income" label="Income" />
        <SegmentedControlItem value="transfer" label="Transfer" />
      </SegmentedControl>
      <Selector
        label={isTransfer ? 'From account' : 'Account'}
        options={options}
        value={accountId}
        onChange={setAccountId}
        status={hasSubmitted && !account ? accountError : undefined}
      />
      {isTransfer && (
        <Selector
          label="To account"
          options={options.filter((o) => o.value !== accountId)}
          value={toAccountId}
          onChange={setToAccountId}
          status={hasSubmitted && !toAccount ? accountError : undefined}
        />
      )}
      <TextInput
        label={`${isCrossCurrency ? 'Amount sent' : 'Amount'}${suffix(account)}`}
        value={amount}
        onChange={setAmount}
        inputMode="decimal"
        placeholder="0.00"
        status={hasSubmitted && !amountMinor ? amountError : undefined}
      />
      {isCrossCurrency && (
        <TextInput
          label={`Amount received${suffix(toAccount)}`}
          description="Enter what actually arrived. No exchange rate is assumed."
          value={received}
          onChange={setReceived}
          inputMode="decimal"
          placeholder="0.00"
          status={hasSubmitted && !receivedMinor ? amountError : undefined}
        />
      )}
      {!isTransfer && (
        <TextInput
          label={kind === 'income' ? 'Received from' : 'Paid to'}
          value={payee}
          onChange={setPayee}
          isOptional
        />
      )}
      <TextInput label="Note" value={memo} onChange={setMemo} isOptional />
      <DateInput label="Date" value={date} onChange={(value) => value && setDate(value)} />
    </FormDialog>
  )
}
