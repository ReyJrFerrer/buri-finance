import { useState } from 'react'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Selector } from '@astryxdesign/core/Selector'
import { DateInput } from '@astryxdesign/core/DateInput'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Text } from '@astryxdesign/core/Text'
import type { Account, Category } from '../../../../shared/ipc'
import { formatAmount, formatMinor, parseAmountToMinor } from '../../../../shared/money'
import { baseCurrency } from '../../../../shared/presets'
import { FormDialog } from '../../components/FormDialog'
import { errorMessage, today } from '../../lib/useQuery'

interface Props {
  accounts: Account[]
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}

const amountError = { type: 'error', message: 'Enter an amount like 1,234.50' } as const
const accountError = { type: 'error', message: 'Choose an account' } as const

export function AddTransactionDialog(props: Props): React.JSX.Element {
  const { accounts, categories, onClose, onSaved } = props
  const [kind, setKind] = useState('expense')
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : '')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [received, setReceived] = useState('')
  const [payee, setPayee] = useState('')
  const [memo, setMemo] = useState('')
  const [categoryId, setCategoryId] = useState('')
  // Set once the income rules have proposed a split; the user edits it, then confirms.
  const [proposal, setProposal] = useState<{ categoryId: string; name: string; text: string }[]>()
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

  const allocations = proposal?.map((p) => ({
    categoryId: p.categoryId,
    amountMinor: p.text.trim() === '' ? 0 : parseAmountToMinor(p.text)
  }))

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!account || !amountMinor) return
    if (isTransfer && (!toAccount || (isCrossCurrency && !receivedMinor))) return
    if (allocations?.some((a) => a.amountMinor === null)) return
    try {
      if (kind === 'income' && !proposal && account.currency === baseCurrency) {
        const proposed = await window.api.budgets.propose(amountMinor)
        if (proposed.length > 0) {
          setProposal(proposed.map((p) => ({ ...p, text: formatAmount(p.amountMinor) })))
          return
        }
      }
      const common = { accountId, amountMinor, date, payee, memo }
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
          : kind === 'income'
            ? {
                ...common,
                kind: 'income',
                allocations: (allocations ?? []).flatMap((a) =>
                  a.amountMinor ? [{ categoryId: a.categoryId, amountMinor: a.amountMinor }] : []
                )
              }
            : { ...common, kind: 'expense', categoryId: categoryId || null }
      )
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (proposal && account && amountMinor) {
    return (
      <FormDialog
        title="Allocate this income"
        submitLabel="Confirm and save"
        error={error}
        onSubmit={submit}
        onClose={onClose}
      >
        <Text>
          Your income rules suggest dividing {formatMinor(amountMinor, account.currency)} like this.
          Change any amount, or clear it to skip that category. The amounts are added to this
          month&apos;s budgets.
        </Text>
        {proposal.map((p, index) => (
          <TextInput
            key={p.categoryId}
            label={`${p.name} (${account.currency})`}
            value={p.text}
            onChange={(text) =>
              setProposal(proposal.map((q, i) => (i === index ? { ...q, text } : q)))
            }
            inputMode="decimal"
            placeholder="0.00"
            status={allocations?.[index].amountMinor === null ? amountError : undefined}
          />
        ))}
      </FormDialog>
    )
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
      {kind === 'expense' && categories.length > 0 && (
        <Selector
          label="Category"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId}
          onChange={(value) => setCategoryId(value ?? '')}
          hasClear
          isOptional
        />
      )}
      <TextInput label="Note" value={memo} onChange={setMemo} isOptional />
      <DateInput label="Date" value={date} onChange={(value) => value && setDate(value)} />
    </FormDialog>
  )
}
