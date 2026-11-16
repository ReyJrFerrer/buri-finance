import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { DateInput } from '@astryxdesign/core/DateInput'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import {
  budgetPeriodSchema,
  type Account,
  type Bills,
  type Budget,
  type Category
} from '../../../../shared/ipc'
import { formatAmount, formatMinor, parseAmountToMinor } from '../../../../shared/money'
import { baseCurrency } from '../../../../shared/presets'
import { FormDialog } from '../../components/FormDialog'
import { PieChart } from '../../components/PieChart'
import { errorMessage, today } from '../../lib/useQuery'

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
  date: string
  currency: string
}

export function SetBudgetDialog(props: SetBudgetProps): React.JSX.Element {
  const { row, date, currency, onClose, onSaved } = props
  const [cadence, setCadence] = useState<string>(row.cadence)
  const [kind, setKind] = useState(row.percentBp ? 'percent' : 'amount')
  const [amount, setAmount] = useState(
    row.setMinor && !row.percentBp ? formatAmount(row.setMinor) : ''
  )
  const [percent, setPercent] = useState(row.percentBp ? formatAmount(row.percentBp) : '')
  const [rollover, setRollover] = useState(row.rollover)
  const [error, setError] = useState<string>()
  const amountMinor = amount.trim() === '' ? 0 : parseAmountToMinor(amount)
  // Two decimals, so this is basis points: 12.5 -> 1250.
  const percentBp = parseAmountToMinor(percent)
  const isPercent = kind === 'percent'
  const isPercentValid = !!percentBp && percentBp <= 10_000
  const isWeekly = cadence === 'weekly'

  const submit = async (): Promise<void> => {
    if (isPercent ? !isPercentValid : amountMinor === null) return
    try {
      await window.api.budgets.set({
        categoryId: row.categoryId,
        date,
        amountMinor: isPercent ? 0 : (amountMinor ?? 0),
        percentBp: isPercent ? percentBp : null,
        rollover,
        cadence: budgetPeriodSchema.parse(cadence)
      })
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
      <SegmentedControl
        label="Budget this category"
        value={cadence}
        onChange={setCadence}
        layout="fill"
      >
        <SegmentedControlItem value="monthly" label="Every month" />
        <SegmentedControlItem value="weekly" label="Every week" />
      </SegmentedControl>
      <SegmentedControl label="Budget as" value={kind} onChange={setKind} layout="fill">
        <SegmentedControlItem value="amount" label="Fixed amount" />
        <SegmentedControlItem value="percent" label="Percent of income" />
      </SegmentedControl>
      {isPercent ? (
        <TextInput
          label="Percent of income"
          description={`The budget is this share of each ${isWeekly ? 'week' : 'month'}'s planned income, from now until you change it.`}
          value={percent}
          onChange={setPercent}
          inputMode="decimal"
          placeholder="20"
          hasAutoFocus
          status={
            percent.trim() !== '' && !isPercentValid
              ? { type: 'error', message: 'Enter a percentage from 0.01 to 100' }
              : undefined
          }
        />
      ) : (
        <TextInput
          label={`${isWeekly ? 'Weekly' : 'Monthly'} budget (${currency})`}
          description={
            isWeekly
              ? 'Applies to this week and every week after it until you change it.'
              : 'Applies to this month.'
          }
          value={amount}
          onChange={setAmount}
          inputMode="decimal"
          placeholder="0.00"
          hasAutoFocus
          status={amountMinor === null ? amountError : undefined}
        />
      )}
      <Switch
        label="Roll over unspent money"
        description={`What is left at the end of the ${isWeekly ? 'week' : 'month'} is added to the next.`}
        value={rollover}
        onChange={setRollover}
      />
    </FormDialog>
  )
}

interface PlanIncomeProps extends DialogProps {
  budget: Budget
  hasRules: boolean
}

// The income the user expects per month or week (the view's period), divided across the fixed
// budgets of that cadence. Saving plans the income from this period on and sets those budgets;
// no account or transaction is touched. Percentage budgets follow the income by themselves.
export function PlanIncomeDialog(props: PlanIncomeProps): React.JSX.Element {
  const { budget, hasRules, onClose, onSaved } = props
  const { period, currency } = budget
  const unit = period === 'weekly' ? 'week' : 'month'
  const mine = budget.rows.filter((r) => r.cadence === period && !r.percentBp)
  const plannedOther = budget.income && budget.income.cadence !== period ? budget.income : null
  const [income, setIncome] = useState(
    budget.income && !plannedOther ? formatAmount(budget.income.amountMinor) : ''
  )
  const [texts, setTexts] = useState(mine.map((r) => (r.setMinor ? formatAmount(r.setMinor) : '')))
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)
  const incomeMinor = income.trim() === '' ? null : parseAmountToMinor(income)
  const amounts = texts.map((t) => (t.trim() === '' ? 0 : parseAmountToMinor(t)))
  const amountOf = (categoryId: string): number =>
    amounts[mine.findIndex((r) => r.categoryId === categoryId)] ?? 0
  // Percentage budgets take their share of the income entered; categories budgeted in the other
  // cadence already take their share of this period.
  // shortcut: rounds half-up for this preview; the saved budget is rounded half-even in main.
  const slices = budget.rows.map((r) =>
    r.percentBp
      ? {
          label: `${r.name} (${formatAmount(r.percentBp)}%)`,
          minor: Math.round(((incomeMinor ?? 0) * r.percentBp) / 10_000)
        }
      : {
          label: r.cadence === period ? r.name : `${r.name} (${r.cadence})`,
          minor: r.cadence === period ? amountOf(r.categoryId) : r.budgetedMinor
        }
  )
  const leftMinor = (incomeMinor ?? 0) - slices.reduce((sum, s) => sum + s.minor, 0)

  const fillFromRules = async (): Promise<void> => {
    setSubmitted(true)
    if (!incomeMinor) return
    try {
      const proposed = await window.api.budgets.propose(incomeMinor)
      setTexts(
        mine.map((r, i) => {
          const minor = proposed.find((p) => p.categoryId === r.categoryId)?.amountMinor
          return minor ? formatAmount(minor) : texts[i]
        })
      )
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (incomeMinor === null || amounts.some((a) => a === null)) return
    try {
      await window.api.budgets.plan({
        period,
        date: budget.start,
        incomeMinor,
        allocations: mine.map((r, i) => ({
          categoryId: r.categoryId,
          amountMinor: amounts[i] ?? 0
        }))
      })
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title={`Plan this ${unit}'s income`}
      submitLabel="Save plan"
      error={error}
      onSubmit={submit}
      onClose={onClose}
    >
      <Text>
        Enter the income you expect each {unit}, then divide it across your {period} budgets. The
        income applies from this {unit} until you change it, and the{' '}
        {period === 'monthly' ? 'weekly' : 'monthly'} view shows its share. Percentage budgets
        follow it. No account balance changes.
      </Text>
      {plannedOther && (
        <Text type="supporting">
          Your income is planned at {formatMinor(plannedOther.amountMinor, currency)} a{' '}
          {plannedOther.cadence === 'monthly' ? 'month' : 'week'}. Saving here plans it per {unit}{' '}
          instead.
        </Text>
      )}
      <TextInput
        label={`Expected income per ${unit} (${currency})`}
        value={income}
        onChange={setIncome}
        inputMode="decimal"
        placeholder="0.00"
        hasAutoFocus
        status={hasSubmitted && incomeMinor === null ? amountError : undefined}
      />
      {hasRules && mine.length > 0 && (
        <Button label="Fill from income rules" variant="secondary" clickAction={fillFromRules} />
      )}
      <PieChart
        title="Plan"
        currency={currency}
        emptyText="Enter an amount to see the split."
        slices={[...slices, { label: 'Not budgeted', minor: leftMinor, isNeutral: true }]}
      />
      {leftMinor < 0 && (
        <Text type="supporting">
          The budgets are {formatMinor(-leftMinor, currency)} more than the expected income.
        </Text>
      )}
      {mine.length === 0 && (
        <Text type="supporting">
          No category has a fixed {period} budget. Change a category&apos;s budget to plan it here.
        </Text>
      )}
      {mine.map((r, index) => (
        <TextInput
          key={r.categoryId}
          label={`${r.name} (${currency})`}
          value={texts[index]}
          onChange={(text) => setTexts(texts.map((t, i) => (i === index ? text : t)))}
          inputMode="decimal"
          placeholder="0.00"
          status={amounts[index] === null ? amountError : undefined}
        />
      ))}
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

export function AddBillDialog(props: DialogProps & { categories: Category[] }): React.JSX.Element {
  const { categories, onClose, onSaved } = props
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [dueDate, setDueDate] = useState(today())
  const [repeat, setRepeat] = useState('monthly')
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)
  const amountMinor = parseAmountToMinor(amount) || null

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!name.trim() || !amountMinor || !categoryId) return
    try {
      await window.api.bills.create({
        name,
        amountMinor,
        categoryId,
        dueDate,
        repeat: repeat === 'none' || repeat === 'weekly' ? repeat : 'monthly'
      })
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title="Add bill"
      submitLabel="Save bill"
      error={error}
      onSubmit={submit}
      onClose={onClose}
    >
      <TextInput
        label="Bill name"
        placeholder="Rent"
        value={name}
        onChange={setName}
        hasAutoFocus
        status={
          hasSubmitted && !name.trim() ? { type: 'error', message: 'Enter a name' } : undefined
        }
      />
      <TextInput
        label={`Amount (${baseCurrency})`}
        value={amount}
        onChange={setAmount}
        inputMode="decimal"
        placeholder="0.00"
        status={hasSubmitted && !amountMinor ? amountError : undefined}
      />
      <Selector
        label="Category"
        description="The budget this bill is paid from."
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
        value={categoryId}
        onChange={setCategoryId}
        status={
          hasSubmitted && !categoryId ? { type: 'error', message: 'Choose a category' } : undefined
        }
      />
      <DateInput label="Due date" value={dueDate} onChange={(v) => v && setDueDate(v)} />
      <SegmentedControl label="Repeats" value={repeat} onChange={setRepeat} layout="fill">
        <SegmentedControlItem value="none" label="Once" />
        <SegmentedControlItem value="weekly" label="Every week" />
        <SegmentedControlItem value="monthly" label="Every month" />
      </SegmentedControl>
    </FormDialog>
  )
}

interface PayBillProps extends DialogProps {
  due: Bills['dues'][number]
  accounts: Account[]
  currency: string
}

export function PayBillDialog(props: PayBillProps): React.JSX.Element {
  const { due, accounts, currency, onClose, onSaved } = props
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : '')
  const [date, setDate] = useState(today())
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!accountId) return
    try {
      await window.api.bills.pay({ billId: due.billId, dueDate: due.dueDate, accountId, date })
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title={`Pay ${due.name}`}
      submitLabel="Record payment"
      error={error}
      onSubmit={submit}
      onClose={onClose}
    >
      <Text>
        Records an expense of {formatMinor(due.amountMinor, currency)} in {due.categoryName}, due{' '}
        {due.dueDate}.
      </Text>
      <Selector
        label="Paid from"
        options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        value={accountId}
        onChange={setAccountId}
        status={
          hasSubmitted && !accountId ? { type: 'error', message: 'Choose an account' } : undefined
        }
      />
      <DateInput label="Date paid" value={date} onChange={(v) => v && setDate(v)} />
    </FormDialog>
  )
}
