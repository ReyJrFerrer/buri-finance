import { useState } from 'react'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { Switch } from '@astryxdesign/core/Switch'
import { TextInput } from '@astryxdesign/core/TextInput'
import type { Budget, Category } from '../../../../shared/ipc'
import { formatAmount, parseAmountToMinor } from '../../../../shared/money'
import { FormDialog } from '../../components/FormDialog'
import { errorMessage } from '../../lib/useQuery'

interface DialogProps {
  onClose: () => void
  onSaved: () => void
}

const amountError = { type: 'error', message: 'Enter an amount like 1,234.50' } as const

export function AddCategoryDialog({ onClose, onSaved }: DialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)
  const isMissing = name.trim() === ''

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (isMissing) return
    try {
      await window.api.categories.create(name)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title="Add category"
      submitLabel="Save category"
      error={error}
      onSubmit={submit}
      onClose={onClose}
    >
      <TextInput
        label="Category name"
        placeholder="Groceries"
        value={name}
        onChange={setName}
        onEnter={submit}
        hasAutoFocus
        status={hasSubmitted && isMissing ? { type: 'error', message: 'Enter a name' } : undefined}
      />
    </FormDialog>
  )
}

interface SetBudgetProps extends DialogProps {
  row: Budget['rows'][number]
  month: string
  currency: string
}

export function SetBudgetDialog(props: SetBudgetProps): React.JSX.Element {
  const { row, month, currency, onClose, onSaved } = props
  const [amount, setAmount] = useState(row.budgetedMinor ? formatAmount(row.budgetedMinor) : '')
  const [rollover, setRollover] = useState(row.rollover)
  const [error, setError] = useState<string>()
  const amountMinor = amount.trim() === '' ? 0 : parseAmountToMinor(amount)

  const submit = async (): Promise<void> => {
    if (amountMinor === null) return
    try {
      await window.api.budgets.set({ categoryId: row.categoryId, month, amountMinor, rollover })
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title={`Budget for ${row.name}`}
      submitLabel="Save budget"
      error={error}
      onSubmit={submit}
      onClose={onClose}
    >
      <TextInput
        label={`Monthly budget (${currency})`}
        value={amount}
        onChange={setAmount}
        inputMode="decimal"
        placeholder="0.00"
        hasAutoFocus
        status={amountMinor === null ? amountError : undefined}
      />
      <Switch
        label="Roll over unspent money"
        description="What is left at the end of the month is added to next month."
        value={rollover}
        onChange={setRollover}
      />
    </FormDialog>
  )
}

export function AddRuleDialog(props: DialogProps & { categories: Category[] }): React.JSX.Element {
  const { categories, onClose, onSaved } = props
  const [categoryId, setCategoryId] = useState('')
  const [kind, setKind] = useState('percent')
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)
  // Two decimals either way: centavos for a fixed amount, basis points for a percentage.
  const value = parseAmountToMinor(text) || null

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!categoryId || !value) return
    try {
      await window.api.rules.create({
        categoryId,
        kind: kind === 'fixed' ? 'fixed' : 'percent',
        value
      })
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title="Add income rule"
      submitLabel="Save rule"
      error={error}
      onSubmit={submit}
      onClose={onClose}
    >
      <Selector
        label="Category"
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
        value={categoryId}
        onChange={setCategoryId}
        status={
          hasSubmitted && !categoryId ? { type: 'error', message: 'Choose a category' } : undefined
        }
      />
      <SegmentedControl label="Rule type" value={kind} onChange={setKind} layout="fill">
        <SegmentedControlItem value="percent" label="Percent of income" />
        <SegmentedControlItem value="fixed" label="Fixed amount" />
      </SegmentedControl>
      <TextInput
        label={kind === 'fixed' ? 'Amount (PHP)' : 'Percent'}
        value={text}
        onChange={setText}
        inputMode="decimal"
        placeholder={kind === 'fixed' ? '0.00' : '20'}
        status={
          hasSubmitted && !value
            ? kind === 'fixed'
              ? amountError
              : { type: 'error', message: 'Enter a percentage like 20 or 12.5' }
            : undefined
        }
      />
    </FormDialog>
  )
}
