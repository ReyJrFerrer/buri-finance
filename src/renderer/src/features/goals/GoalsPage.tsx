import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { DateInput } from '@astryxdesign/core/DateInput'
import type { ISODateString } from '@astryxdesign/core/Calendar'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { VStack } from '@astryxdesign/core/Stack'
import { Table, pixel, proportional, type TableColumn } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import type { Goal } from '../../../../shared/ipc'
import { formatMinor, parseAmountToMinor } from '../../../../shared/money'
import { Amount } from '../../components/Amount'
import { DeleteButton } from '../../components/DeleteButton'
import { FormDialog } from '../../components/FormDialog'
import { Page } from '../../components/Page'
import { moneyWidth, nameWidth } from '../../lib/table'
import { errorMessage, useQuery } from '../../lib/useQuery'

function AddGoalDialog(props: { onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const [accounts] = useQuery(window.api.accounts.list)
  const [categories] = useQuery(window.api.categories.list)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [link, setLink] = useState('account')
  const [linkId, setLinkId] = useState('')
  const [targetDate, setTargetDate] = useState<ISODateString>()
  const [error, setError] = useState<string>()
  const [hasSubmitted, setSubmitted] = useState(false)

  const isAccount = link === 'account'
  const options = isAccount
    ? (accounts ?? []).map((a) => ({ value: a.id, label: a.name, description: a.currency }))
    : (categories ?? []).map((c) => ({ value: c.id, label: c.name }))
  const targetMinor = parseAmountToMinor(target) || null
  const isNameMissing = name.trim() === ''

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (isNameMissing || !targetMinor || !linkId) return
    try {
      await window.api.goals.create({
        name,
        targetMinor,
        targetDate: targetDate ?? null,
        accountId: isAccount ? linkId : null,
        categoryId: isAccount ? null : linkId
      })
      props.onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title="Add goal"
      submitLabel="Save goal"
      error={error}
      onSubmit={submit}
      onClose={props.onClose}
    >
      <TextInput
        label="Goal name"
        placeholder="Emergency fund"
        value={name}
        onChange={setName}
        status={
          hasSubmitted && isNameMissing ? { type: 'error', message: 'Enter a name' } : undefined
        }
      />
      <TextInput
        label="Target amount"
        value={target}
        onChange={setTarget}
        inputMode="decimal"
        placeholder="0.00"
        status={
          hasSubmitted && !targetMinor
            ? { type: 'error', message: 'Enter an amount like 1,234.50' }
            : undefined
        }
      />
      <SegmentedControl
        label="Measure progress by"
        value={link}
        onChange={(value) => {
          setLink(value)
          setLinkId('')
        }}
        layout="fill"
      >
        <SegmentedControlItem value="account" label="Account balance" />
        <SegmentedControlItem value="category" label="Budget category" />
      </SegmentedControl>
      <Selector
        label={isAccount ? 'Account' : 'Category'}
        description={
          isAccount
            ? 'Progress is the value of this account.'
            : 'Progress is what this category has available this month, in PHP.'
        }
        options={options}
        value={linkId}
        onChange={setLinkId}
        emptyText={isAccount ? 'Add an account first' : 'Add a budget category first'}
        status={hasSubmitted && !linkId ? { type: 'error', message: 'Choose one' } : undefined}
      />
      <DateInput
        label="Target date"
        value={targetDate}
        onChange={setTargetDate}
        isOptional
        hasClear
      />
    </FormDialog>
  )
}

export function GoalsPage(): React.JSX.Element {
  const [goals, reload] = useQuery(window.api.goals.list)
  const [isAdding, setAdding] = useState(false)
  const addButton = <Button label="Add goal" variant="primary" onClick={() => setAdding(true)} />

  const columns: TableColumn<Goal>[] = [
    {
      key: 'name',
      header: 'Goal',
      width: nameWidth,
      renderCell: (g) => (
        <VStack gap={1}>
          <Text weight="medium">{g.name}</Text>
          <Text type="supporting">{g.linkLabel}</Text>
        </VStack>
      )
    },
    {
      key: 'percent',
      header: 'Progress',
      width: proportional(1.5, { minWidth: 200 }),
      renderCell: (g) => (
        <VStack gap={1}>
          <ProgressBar
            label={`${g.name} progress`}
            isLabelHidden
            value={g.percent}
            variant={g.percent >= 100 ? 'success' : 'accent'}
          />
          <Text type="supporting" hasTabularNumbers>
            {g.percent}% · {formatMinor(g.savedMinor, g.currency)} saved
          </Text>
        </VStack>
      )
    },
    {
      key: 'targetMinor',
      header: 'Target',
      align: 'end',
      width: moneyWidth,
      renderCell: (g) => (
        <VStack gap={1} hAlign="end">
          <Amount minor={g.targetMinor} currency={g.currency} />
          <Text type="supporting" hasTabularNumbers>
            {g.targetDate ? `by ${g.targetDate}` : 'No date'}
          </Text>
        </VStack>
      )
    },
    {
      key: 'perPeriodMinor',
      header: 'To stay on track',
      align: 'end',
      width: proportional(1.5, { minWidth: 230 }),
      renderCell: (g) => (
        <Text hasTabularNumbers textWrap="nowrap">
          {g.remainingMinor === 0
            ? 'Reached'
            : g.perPeriodMinor === null
              ? `${formatMinor(g.remainingMinor, g.currency)} to go`
              : `${formatMinor(g.perPeriodMinor, g.currency)} per ${g.period === 'weekly' ? 'week' : 'month'}`}
        </Text>
      )
    },
    {
      key: 'id',
      header: '',
      align: 'end',
      width: pixel(72),
      renderCell: (g) => (
        <DeleteButton
          label={`Delete goal ${g.name}`}
          title={`Delete ${g.name}?`}
          description="Only the goal is removed. Your accounts and budgets are not changed."
          onDelete={() => window.api.goals.remove(g.id).then(reload)}
        />
      )
    }
  ]

  return (
    <Page title="Goals" action={goals?.length ? addButton : undefined}>
      {goals?.length === 0 && (
        <EmptyState
          title="No goals yet"
          description="Add a savings goal and link it to an account or a budget category to track your progress."
          headingLevel={2}
          actions={addButton}
        />
      )}
      {!!goals?.length && <Table data={goals} columns={columns} idKey="id" hasHover />}
      {isAdding && (
        <AddGoalDialog
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            reload()
          }}
        />
      )}
    </Page>
  )
}
