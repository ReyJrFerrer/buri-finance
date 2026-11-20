import { useCallback, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { useCalendarDays, type DayOfWeek } from '@astryxdesign/core/Calendar'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Table, pixel, type TableColumn } from '@astryxdesign/core/Table'
import { Heading, Text } from '@astryxdesign/core/Text'
import type { TransactionRow } from '../../../../shared/ipc'
import { formatMinor } from '../../../../shared/money'
import { Amount } from '../../components/Amount'
import { BarChart } from '../../components/BarChart'
import { Page } from '../../components/Page'
import { PieChart } from '../../components/PieChart'
import { Section } from '../../components/Section'
import { moneyWidth } from '../../lib/table'
import { monthLabel, today, useFxRefresh, useQuery } from '../../lib/useQuery'
import { AccountsTable } from '../accounts/AccountsTable'

const recentColumns = [
  { key: 'date', header: 'Date', width: pixel(120) },
  { key: 'payee', header: 'Description', renderCell: (t) => t.payee || t.memo },
  { key: 'category', header: 'Category' },
  {
    key: 'amountMinor',
    header: 'Amount',
    align: 'end',
    width: moneyWidth,
    renderCell: (t) => <Amount minor={t.amountMinor} currency={t.currency} />
  }
] satisfies TableColumn<TransactionRow>[]

export function OverviewPage(props: { onAddAccount: () => void }): React.JSX.Element {
  const [accounts] = useQuery(window.api.accounts.list)
  const [netWorth, reloadNetWorth] = useQuery(window.api.netWorth.get)
  const fxError = useFxRefresh(reloadNetWorth)
  const [settings] = useQuery(window.api.settings.get)
  const [transactions] = useQuery(window.api.transactions.list)
  const [date, setDate] = useState<string>(today())
  const [activity] = useQuery(useCallback(() => window.api.transactions.month(date), [date]))
  const [budget] = useQuery(
    useCallback(() => window.api.budgets.get({ period: 'monthly', date }), [date])
  )
  const [bills] = useQuery(useCallback(() => window.api.bills.list(date), [date]))
  const { days, dayNames } = useCalendarDays({
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    weekStartsOn: (settings?.weekStart ?? 1) as DayOfWeek,
    hasVariableRowCount: true
  })

  if (accounts?.length === 0) {
    return (
      <Page title="Overview">
        <EmptyState
          title="Your net worth starts here"
          description="Add an account with its current balance to see what you have and what you owe."
          headingLevel={2}
          actions={<Button label="Add account" variant="primary" onClick={props.onAddAccount} />}
        />
      </Page>
    )
  }

  const stat = (label: string, minor: number, currency: string): React.JSX.Element => (
    <Card>
      <VStack gap={2}>
        <Text type="supporting">{label}</Text>
        <Text type="large" weight="bold" hasTabularNumbers>
          {formatMinor(minor, currency)}
        </Text>
      </VStack>
    </Card>
  )
  const budgeted = budget?.rows.filter((r) => r.budgetedMinor > 0) ?? []
  const byDay = new Map(activity?.days.map((d) => [d.date, d]))

  return (
    <Page title="Overview">
      {fxError && (
        <Banner
          status="error"
          title="Exchange rates could not be updated"
          description={`${fxError} Converted totals use the last saved rates.`}
        />
      )}
      <Grid columns={{ minWidth: 280, repeat: 'fit' }} gap={4}>
        {netWorth?.converted && (
          <Card>
            <VStack gap={2}>
              <Text type="supporting">Total net worth · {netWorth.converted.currency}</Text>
              <Text type="display-3" weight="bold" hasTabularNumbers>
                {formatMinor(netWorth.converted.netMinor, netWorth.converted.currency)}
              </Text>
              <Text type="supporting" hasTabularNumbers>
                {netWorth.converted.rates
                  .map((r) => `${r.currency} converted at ${r.rate}, the rate of ${r.date}`)
                  .join(' · ')}
              </Text>
            </VStack>
          </Card>
        )}
        {netWorth?.totals.map((total) => (
          <Card key={total.currency}>
            <VStack gap={2}>
              <Text type="supporting">Net worth · {total.currency}</Text>
              <Text type="display-3" weight="bold" hasTabularNumbers>
                {formatMinor(total.netMinor, total.currency)}
              </Text>
              <Text type="supporting" hasTabularNumbers>
                Assets {formatMinor(total.assetsMinor, total.currency)} · Liabilities{' '}
                {formatMinor(total.liabilitiesMinor, total.currency)}
              </Text>
            </VStack>
          </Card>
        ))}
      </Grid>
      {(netWorth?.totals.length ?? 0) > 1 && !netWorth?.converted && (
        <Text type="supporting">
          Each currency is totalled separately. To see one total, set an exchange rate under
          Investments.
        </Text>
      )}
      {activity && (
        <Section
          title={monthLabel(activity.start)}
          description={`Income and spending recorded in ${activity.currency}. Transfers between your accounts are not counted.`}
          action={
            <HStack gap={1} vAlign="center">
              <IconButton
                label="Previous month"
                icon={<Icon icon="chevronLeft" />}
                variant="ghost"
                onClick={() => setDate(activity.previous)}
              />
              <Button label="This month" size="sm" onClick={() => setDate(today())} />
              <IconButton
                label="Next month"
                icon={<Icon icon="chevronRight" />}
                variant="ghost"
                onClick={() => setDate(activity.next)}
              />
            </HStack>
          }
        >
          <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={4}>
            {stat('Income', activity.incomeMinor, activity.currency)}
            {stat('Spent', activity.expenseMinor, activity.currency)}
            {stat('Left over', activity.incomeMinor - activity.expenseMinor, activity.currency)}
            {budget &&
              stat(
                'Available in budgets',
                budget.rows.reduce((sum, r) => sum + r.availableMinor, 0),
                budget.currency
              )}
          </Grid>
          <Grid columns={{ minWidth: 320, max: 2 }} gap={4}>
            <Card>
              <BarChart
                title="Spending by day"
                currency={activity.currency}
                emptyText="No spending recorded this month."
                bars={days
                  .filter((day) => !day.isOutside)
                  .map((day) => ({
                    label: String(day.dayNumber),
                    minor: byDay.get(day.iso)?.expenseMinor ?? 0
                  }))}
              />
            </Card>
            <Card>
              <PieChart
                title="Spending by category"
                currency={budget?.currency ?? activity.currency}
                emptyText="No spending in a budget category this month."
                slices={(budget?.rows ?? []).map((r) => ({ label: r.name, minor: r.spentMinor }))}
              />
            </Card>
          </Grid>
          {budget && budgeted.length > 0 && (
            <Card>
              <VStack gap={3}>
                <Text weight="medium">Budgets</Text>
                {budgeted.map((r) => (
                  <ProgressBar
                    key={r.categoryId}
                    label={`${r.name} · ${formatMinor(r.spentMinor, budget.currency)} of ${formatMinor(r.budgetedMinor, budget.currency)}${r.spentMinor > r.budgetedMinor ? ' · over budget' : ''}`}
                    value={Math.min(r.spentMinor, r.budgetedMinor)}
                    max={r.budgetedMinor}
                    variant={r.spentMinor > r.budgetedMinor ? 'error' : 'accent'}
                  />
                ))}
              </VStack>
            </Card>
          )}
          <Grid columns={7} gap={1}>
            {dayNames.map((name) => (
              <Text key={name} type="supporting" weight="medium">
                {name}
              </Text>
            ))}
            {days.map((day) => {
              const on = day.isOutside ? undefined : byDay.get(day.iso)
              const dues = bills?.dues.filter((d) => d.dueDate === day.iso) ?? []
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
                      color={
                        day.isOutside ? 'disabled' : day.iso === today() ? 'accent' : undefined
                      }
                    >
                      {day.dayNumber}
                    </Text>
                    {!!on?.incomeMinor && (
                      <Text type="supporting" color="primary" maxLines={1} hasTabularNumbers>
                        +{formatMinor(on.incomeMinor, activity.currency)}
                      </Text>
                    )}
                    {!!on?.expenseMinor && (
                      <Text type="supporting" color="primary" maxLines={1} hasTabularNumbers>
                        {formatMinor(-on.expenseMinor, activity.currency)}
                      </Text>
                    )}
                    {!day.isOutside &&
                      dues.map((d) => (
                        <Text key={d.billId} type="supporting" maxLines={1}>
                          {d.paidTransactionId ? `✓ ${d.name}` : `Due: ${d.name}`}
                        </Text>
                      ))}
                  </VStack>
                </Card>
              )
            })}
          </Grid>
        </Section>
      )}
      {!!transactions?.length && (
        <Section title="Recent transactions">
          <Table data={transactions.slice(0, 5)} columns={recentColumns} idKey="id" />
        </Section>
      )}
      {accounts && (
        <VStack gap={3}>
          <Heading level={2}>Accounts</Heading>
          <AccountsTable accounts={accounts} />
        </VStack>
      )}
    </Page>
  )
}
