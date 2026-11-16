import { useCallback, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { useCalendarDays, type DayOfWeek } from '@astryxdesign/core/Calendar'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Table, pixel, type TableColumn } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import type { Account, Bills, Category } from '../../../../shared/ipc'
import { Amount } from '../../components/Amount'
import { DeleteButton } from '../../components/DeleteButton'
import { Section } from '../../components/Section'
import { moneyWidth, nameWidth } from '../../lib/table'
import { today, useQuery } from '../../lib/useQuery'
import { AddBillDialog, PayBillDialog } from './BudgetDialogs'

type Due = Bills['dues'][number] & { id: string }

interface Props {
  date: string // any day in the month to show
  weekStart: number
  categories: Category[]
  accounts: Account[] // accounts bills can be paid from
  onPaid: () => void
}

const repeatLabel = { none: 'Once', weekly: 'Every week', monthly: 'Every month' }

// A month calendar of bill due dates, with a list below for paying and deleting them.
export function DueDates(props: Props): React.JSX.Element {
  const { date, weekStart, categories, accounts, onPaid } = props
  const [bills, reload] = useQuery(useCallback(() => window.api.bills.list(date), [date]))
  const [dialog, setDialog] = useState<'add' | Due>()
  const { days, dayNames } = useCalendarDays({
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    weekStartsOn: weekStart as DayOfWeek,
    hasVariableRowCount: true
  })
  const dues: Due[] = (bills?.dues ?? []).map((d) => ({ ...d, id: `${d.billId}:${d.dueDate}` }))
  const currency = bills?.currency ?? ''
  const monthName = new Date(`${date.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-US', {
    month: 'long'
  })
  const saved = (): void => {
    setDialog(undefined)
    reload()
    onPaid()
  }

  const columns: TableColumn<Due>[] = [
    { key: 'dueDate', header: 'Due', width: pixel(120) },
    { key: 'name', header: 'Bill', width: nameWidth },
    { key: 'categoryName', header: 'Category' },
    { key: 'repeat', header: 'Repeats', renderCell: (d) => repeatLabel[d.repeat] },
    {
      key: 'amountMinor',
      header: 'Amount',
      align: 'end',
      width: moneyWidth,
      renderCell: (d) => <Amount minor={d.amountMinor} currency={currency} />
    },
    {
      key: 'id',
      header: '',
      align: 'end',
      width: pixel(190),
      renderCell: (d) => (
        <HStack gap={1} hAlign="end" vAlign="center">
          {d.paidTransactionId ? (
            <Text type="supporting">Paid</Text>
          ) : (
            <Button
              label={`Mark ${d.name} due ${d.dueDate} paid`}
              size="sm"
              isDisabled={accounts.length === 0}
              onClick={() => setDialog(d)}
            >
              Mark paid
            </Button>
          )}
          <DeleteButton
            label={`Delete bill ${d.name}`}
            title={`Delete ${d.name}?`}
            description="All its due dates are removed. Payments already recorded stay in your transactions."
            onDelete={() => window.api.bills.remove(d.billId).then(saved)}
          />
        </HStack>
      )
    }
  ]

  return (
    <Section
      title="Due dates"
      description="Bills paid from your budgets. Marking one paid records the expense in its category."
      action={categories.length > 0 && <Button label="Add bill" onClick={() => setDialog('add')} />}
    >
      <Grid columns={7} gap={1}>
        {dayNames.map((name) => (
          <Text key={name} type="supporting" weight="medium">
            {name}
          </Text>
        ))}
        {days.map((day) => {
          const onDay = dues.filter((d) => d.dueDate === day.iso)
          return (
            <Card
              key={day.iso}
              padding={1.5}
              minHeight={84}
              variant={day.isOutside ? 'transparent' : 'default'}
            >
              <VStack gap={0.5}>
                <Text
                  type="supporting"
                  weight={day.iso === today() ? 'bold' : undefined}
                  color={day.isOutside ? 'disabled' : undefined}
                >
                  {day.dayNumber}
                </Text>
                {onDay.map((d) => (
                  <Text key={d.id} maxLines={1}>
                    {d.paidTransactionId ? `✓ ${d.name}` : d.name}
                  </Text>
                ))}
              </VStack>
            </Card>
          )
        })}
      </Grid>
      {dues.length > 0 ? (
        <Table data={dues} columns={columns} idKey="id" hasHover />
      ) : (
        <Text type="supporting">
          No payments due in {monthName}. Add a bill such as Rent or Electricity with its due date.
        </Text>
      )}
      {dialog === 'add' && (
        <AddBillDialog
          categories={categories}
          onClose={() => setDialog(undefined)}
          onSaved={saved}
        />
      )}
      {typeof dialog === 'object' && (
        <PayBillDialog
          due={dialog}
          accounts={accounts}
          currency={currency}
          onClose={() => setDialog(undefined)}
          onSaved={saved}
        />
      )}
    </Section>
  )
}
