import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { useCalendarDays, useCalendarNavigation, type DayOfWeek } from '@astryxdesign/core/Calendar'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Section } from './Section'
import type { TransactionRow } from '../../../shared/ipc'
import { formatMinor } from '../../../shared/money'
import { today } from '../lib/useQuery'

const kindLabels = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  opening: 'Opening balance',
  other: 'Other'
}

export function TransactionCalendar(props: {
  transactions: TransactionRow[]
  weekStart: number
}): React.JSX.Element {
  const [selectedDate, setSelectedDate] = useState<string>()
  const { monthYearLabel, visibleCalendarMonths, navigateMonth } = useCalendarNavigation({})
  const { days, dayNames } = useCalendarDays({
    ...visibleCalendarMonths[0],
    weekStartsOn: props.weekStart as DayOfWeek,
    hasVariableRowCount: true
  })
  const byDate = new Map<string, TransactionRow[]>()
  for (const transaction of props.transactions) {
    const entries = byDate.get(transaction.date) ?? []
    entries.push(transaction)
    byDate.set(transaction.date, entries)
  }

  return (
    <Section
      title="Transaction calendar"
      description="Income, expenses and transfers by date. Open a logged day to see full details."
    >
      <HStack gap={2} hAlign="between" vAlign="center">
        <Button label="Previous month" onClick={() => navigateMonth(-1)} />
        <Text weight="medium" aria-live="polite">
          {monthYearLabel}
        </Text>
        <Button label="Next month" onClick={() => navigateMonth(1)} />
      </HStack>
      <Grid columns={7} gap={1} aria-label={`Transactions in ${monthYearLabel}`}>
        {dayNames.map((name) => (
          <Text key={name} type="supporting">
            {name}
          </Text>
        ))}
        {days.map((day) => {
          const entries = byDate.get(day.iso) ?? []
          const count = entries.length
          return (
            <Card
              key={day.iso}
              padding={1.5}
              variant={count ? 'blue' : day.isOutside ? 'transparent' : 'default'}
              role="group"
              aria-label={`${day.iso}: ${count} ${count === 1 ? 'transaction' : 'transactions'}`}
            >
              <VStack gap={0.5}>
                <Text
                  type="supporting"
                  weight={day.iso === today() ? 'bold' : undefined}
                  color={day.isOutside ? 'disabled' : undefined}
                >
                  {day.dayNumber}
                </Text>
                {entries.slice(0, 3).map((t) => (
                  <VStack key={t.id} gap={0.5}>
                    <Button
                      size="sm"
                      variant="ghost"
                      width="100%"
                      label={`View ${t.payee || t.memo || kindLabels[t.kind]} on ${t.date}`}
                      aria-haspopup="dialog"
                      onClick={() => setSelectedDate(day.iso)}
                    >
                      <Text
                        type="supporting"
                        maxLines={1}
                        hasTruncateTooltip={false}
                        color={
                          t.kind === 'expense'
                            ? 'negative'
                            : t.kind === 'income'
                              ? 'positive'
                              : 'accent'
                        }
                      >
                        {kindLabels[t.kind]} · {t.payee || t.memo || t.accountLabel}
                      </Text>
                    </Button>
                    <Text type="supporting" hasTabularNumbers justify="end" maxLines={1}>
                      {formatMinor(t.amountMinor, t.currency)}
                    </Text>
                  </VStack>
                ))}
                {count ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    width="100%"
                    aria-haspopup="dialog"
                    label={`View ${count} ${count === 1 ? 'transaction' : 'transactions'} on ${day.iso}`}
                    onClick={() => setSelectedDate(day.iso)}
                  >
                    {count > 3
                      ? `+${count - 3} more · View all ${count}`
                      : `${count} logged · View details`}
                  </Button>
                ) : (
                  <Text type="supporting">—</Text>
                )}
              </VStack>
            </Card>
          )
        })}
      </Grid>
      {selectedDate && (
        <Dialog isOpen onOpenChange={(open) => !open && setSelectedDate(undefined)}>
          <Layout
            header={
              <DialogHeader
                title={`Transactions on ${selectedDate}`}
                onOpenChange={() => setSelectedDate(undefined)}
              />
            }
            content={
              <LayoutContent>
                <VStack gap={5}>
                  {(byDate.get(selectedDate) ?? []).map((t) => (
                    <VStack key={t.id} gap={2}>
                      <Text weight="semibold">{t.payee || t.memo || kindLabels[t.kind]}</Text>
                      <Text>
                        {kindLabels[t.kind]} · {t.date}
                      </Text>
                      <Text>Account: {t.accountLabel}</Text>
                      <Text>Category: {t.category || 'Uncategorized'}</Text>
                      <Text>Memo: {t.memo || 'No memo'}</Text>
                      <Text
                        hasTabularNumbers
                        justify="end"
                        color={
                          t.kind === 'expense'
                            ? 'negative'
                            : t.kind === 'income'
                              ? 'positive'
                              : 'accent'
                        }
                      >
                        {formatMinor(t.amountMinor, t.currency)}
                      </Text>
                    </VStack>
                  ))}
                </VStack>
              </LayoutContent>
            }
          />
        </Dialog>
      )}
    </Section>
  )
}
