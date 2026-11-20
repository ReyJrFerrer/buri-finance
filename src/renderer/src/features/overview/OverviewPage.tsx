import { useCallback, useState } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Divider } from '@astryxdesign/core/Divider'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid, GridSpan } from '@astryxdesign/core/Grid'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Kbd } from '@astryxdesign/core/Kbd'
import { Link } from '@astryxdesign/core/Link'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack'
import { Table, pixel, type TableColumn } from '@astryxdesign/core/Table'
import { Heading, Text } from '@astryxdesign/core/Text'
import { Avatar } from '@astryxdesign/core/Avatar'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TagIcon
} from '@heroicons/react/24/outline'
import type { Budget, TransactionRow } from '../../../../shared/ipc'
import { currencySymbol, formatMoney } from '../../../../shared/money'
import { baseCurrency } from '../../../../shared/presets'
import { AreaChart } from '../../components/AreaChart'
import { Meter } from '../../components/Meter'
import { PaceChart } from '../../components/PaceChart'
import { moneyWidth } from '../../lib/table'
import { longDate, monthLabel, shortDate, today, useFxRefresh, useQuery } from '../../lib/useQuery'
import { AddTransactionDialog } from '../transactions/AddTransactionDialog'
import { CategorizeDialog } from './CategorizeDialog'

type Destination = 'accounts' | 'transactions' | 'budgets' | 'goals'

interface Props {
  onAddAccount: () => void
  onNavigate: (page: Destination) => void
  onSearch: () => void
}

const partColors = ['var(--color-chart-blue)', 'var(--color-chart-purple)']
const partColor = (i: number): string => partColors[i] ?? 'var(--color-chart-gray)'

// Whole units, as in "₱5,454", for rounded figures.
const whole = (minor: number, currency: string): string =>
  formatMoney(minor - (minor % 100), currency).replace(/\.00$/, '')
const percent = (part: number, total: number): number =>
  total > 0 ? Math.round((part * 100) / total) : 0
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const isSavings = (name: string): boolean => /saving/i.test(name)

// A large amount with its cents dimmed, as in ₱117,939.85.
function BigMoney(props: {
  minor: number
  currency: string
  type: 'display-2' | 'display-3'
}): React.JSX.Element {
  const text = formatMoney(props.minor, props.currency)
  const dot = text.lastIndexOf('.')
  return (
    <Text type={props.type} weight="bold" hasTabularNumbers>
      {text.slice(0, dot)}
      <Text type="inherit" color="disabled">
        {text.slice(dot)}
      </Text>
    </Text>
  )
}

// A dot in a chart colour, for legends.
const Swatch = ({ color }: { color: string }): React.JSX.Element => (
  <svg width={8} height={8} aria-hidden>
    <rect width={8} height={8} rx={2} fill={color} />
  </svg>
)

// One row of the needs-attention list.
function Alert(props: {
  tone: 'orange' | 'blue'
  title: string
  description: string
  action: React.ReactNode
}): React.JSX.Element {
  return (
    <HStack gap={3} vAlign="center">
      <Card variant={props.tone} padding={1.5}>
        <Icon
          icon={props.tone === 'orange' ? TagIcon : InformationCircleIcon}
          color={props.tone}
          size="sm"
        />
      </Card>
      <StackItem size="fill">
        <VStack gap={0.5}>
          <Text weight="semibold">{props.title}</Text>
          <Text type="supporting">{props.description}</Text>
        </VStack>
      </StackItem>
      {props.action}
    </HStack>
  )
}

type BudgetRow = Budget['rows'][number]

// Where a budget stands against an even pace through the month (paceShare 0 to 1).
function budgetStatus(
  row: BudgetRow,
  paceShare: number,
  currency: string
): { badge: React.ReactNode; detail: string; color: string } {
  const total = row.budgetedMinor + row.carriedMinor
  const left = total - row.spentMinor
  // shortcut: a savings budget is recognised by its name; add a category flag if names vary.
  if (isSavings(row.name)) {
    return {
      badge:
        row.spentMinor === 0 ? (
          <Badge variant="neutral" label="Not started" />
        ) : (
          <Badge variant={left <= 0 ? 'green' : 'blue'} label={left <= 0 ? 'Done' : 'Started'} />
        ),
      detail: left > 0 ? `${formatMoney(left, currency)} to set aside` : 'All set aside',
      color: 'var(--color-chart-blue)'
    }
  }
  if (left < 0) {
    return {
      badge: <Badge variant="red" label="Over budget" />,
      detail: `${formatMoney(-left, currency)} over`,
      color: 'var(--color-error)'
    }
  }
  const isAhead = row.spentMinor > total * paceShare
  return {
    badge: (
      <Badge
        variant={isAhead ? 'orange' : 'green'}
        label={isAhead ? 'Ahead of pace' : 'On track'}
      />
    ),
    detail: `${formatMoney(left, currency)} left`,
    color: isAhead ? 'var(--color-chart-marker)' : 'var(--color-chart-blue)'
  }
}

export function OverviewPage(props: Props): React.JSX.Element {
  const { onNavigate } = props
  const [date, setDate] = useState<string>(today())
  const [accounts, reloadAccounts] = useQuery(window.api.accounts.list)
  const [netWorth, reloadNetWorth] = useQuery(window.api.netWorth.get)
  const [history, reloadHistory] = useQuery(window.api.netWorth.history)
  const [transactions, reloadTransactions] = useQuery(window.api.transactions.list)
  const [categories] = useQuery(window.api.categories.list)
  const [goals] = useQuery(window.api.goals.list)
  const [activity, reloadActivity] = useQuery(
    useCallback(() => window.api.transactions.month(date), [date])
  )
  const [budget, reloadBudget] = useQuery(
    useCallback(() => window.api.budgets.get({ period: 'monthly', date }), [date])
  )
  const reloadValues = useCallback(() => {
    reloadNetWorth()
    reloadHistory()
    reloadAccounts()
  }, [reloadNetWorth, reloadHistory, reloadAccounts])
  const fxError = useFxRefresh(reloadValues)
  const [isAdding, setAdding] = useState(false)
  const [categorizing, setCategorizing] = useState<TransactionRow>()
  const [isShowingOpening, setShowingOpening] = useState(false)

  const reloadAll = (): void => {
    reloadValues()
    reloadTransactions()
    reloadActivity()
    reloadBudget()
  }

  if (accounts?.length === 0) {
    return (
      <VStack gap={6}>
        <Heading level={1}>Overview</Heading>
        <EmptyState
          title="Your net worth starts here"
          description="Add an account with its current balance to see what you have and what you owe."
          headingLevel={2}
          actions={<Button label="Add account" variant="primary" onClick={props.onAddAccount} />}
        />
      </VStack>
    )
  }

  const now = today()
  const currency = activity?.currency ?? baseCurrency
  const month = activity ? monthLabel(activity.start) : ''
  const monthName = month.split(' ')[0]
  const daysInMonth = activity ? Number(activity.end.slice(8)) : 30
  const isThisMonth = !!activity && activity.start <= now && now <= activity.end
  const isPast = !!activity && activity.end < now
  const dayOfMonth = isThisMonth ? Number(now.slice(8)) : isPast ? daysInMonth : 0
  const paceShare = dayOfMonth / daysInMonth

  const inMonth = (t: TransactionRow): boolean =>
    !!activity && activity.start <= t.date && t.date <= activity.end
  const monthExpenses = transactions?.filter((t) => t.kind === 'expense' && inMonth(t)) ?? []
  const uncategorized = monthExpenses.filter((t) => !t.category)
  const firstUncategorized = uncategorized[0] as TransactionRow | undefined
  const biggest = monthExpenses.reduce<TransactionRow | undefined>(
    (max, t) => (!max || t.amountMinor < max.amountMinor ? t : max),
    undefined
  )
  const categorize = (t: TransactionRow | undefined): void => t && setCategorizing(t)

  const budgetRows = budget?.rows.filter((r) => r.budgetedMinor + r.carriedMinor > 0) ?? []
  const budgetTotal = budgetRows.reduce((sum, r) => sum + r.budgetedMinor + r.carriedMinor, 0)
  const budgetLeft = budgetRows.reduce((sum, r) => sum + r.availableMinor, 0)
  const daysLeft = isThisMonth ? daysInMonth - dayOfMonth + 1 : isPast ? 0 : daysInMonth
  const isNothingSpentInBudgets = budgetRows.every((r) => r.spentMinor === 0)
  const savings = budgetRows.find((r) => isSavings(r.name))

  const openingIncome = activity?.days.find(
    (d) => d.incomeMinor > 0 && activity.openingDates.includes(d.date)
  )
  const uncategorizedMinor = activity?.uncategorizedMinor ?? 0
  const uncategorizedCount = activity?.uncategorizedCount ?? 0

  const points = history?.points ?? []
  const first = points[0]
  const last = points[points.length - 1]
  const change = first && last ? last.netMinor - first.netMinor : 0
  const middle = points[Math.floor((points.length - 1) / 2)]

  const converted = netWorth?.converted
  const baseTotal = netWorth?.totals.find((t) => t.currency === baseCurrency)
  const netMinor = converted?.netMinor ?? baseTotal?.netMinor ?? 0
  const parts = converted?.parts ?? (baseTotal ? [baseTotal] : [])
  const partsTotal = parts.reduce((sum, p) => sum + Math.max(0, p.netMinor), 0)
  const debts = netWorth?.totals.filter((t) => t.liabilitiesMinor > 0) ?? []

  const byDay = new Map(activity?.days.map((d) => [Number(d.date.slice(8)), d.expenseMinor]))
  const spentByDay: number[] = []
  for (let day = 1; day <= dayOfMonth; day++) {
    spentByDay.push((spentByDay[day - 2] ?? 0) + (byDay.get(day) ?? 0))
  }
  const paceGap =
    Math.round((budgetTotal * dayOfMonth) / daysInMonth) - (spentByDay[dayOfMonth - 1] ?? 0)

  const categoryRows = [
    ...(budget?.rows ?? [])
      .filter((r) => r.spentMinor > 0)
      .sort((a, b) => b.spentMinor - a.spentMinor)
      .map((r) => ({ name: r.name, minor: r.spentMinor, color: 'var(--color-chart-blue)' })),
    ...(uncategorizedMinor > 0
      ? [{ name: 'Uncategorized', minor: uncategorizedMinor, color: 'var(--color-chart-gray)' }]
      : [])
  ]
  const spentTotal = activity?.expenseMinor ?? 0
  const budgetNames = budgetRows.map((r) => r.name)
  const namesList =
    budgetNames.length > 1
      ? `${budgetNames.slice(0, -1).join(', ')} and ${budgetNames[budgetNames.length - 1]}`
      : budgetNames[0]

  const openings = transactions?.filter((t) => t.kind === 'opening') ?? []
  const recent = (transactions ?? [])
    .filter((t) => isShowingOpening || t.kind !== 'opening')
    .slice(0, 5)
  const sortedAccounts = [...(accounts ?? [])].sort(
    (a, b) => (b.baseMinor ?? Number.MIN_SAFE_INTEGER) - (a.baseMinor ?? Number.MIN_SAFE_INTEGER)
  )

  const recentColumns: TableColumn<TransactionRow>[] = [
    { key: 'date', header: 'Date', width: pixel(96), renderCell: (t) => shortDate(t.date) },
    {
      key: 'payee',
      header: 'Description',
      renderCell: (t) => (
        <HStack gap={2} vAlign="center">
          <Avatar name={t.payee || t.memo || '?'} size="sm" shape="rounded" tooltip={false} />
          <Text weight="semibold" maxLines={1}>
            {t.payee || t.memo}
          </Text>
        </HStack>
      )
    },
    {
      key: 'category',
      header: 'Category',
      renderCell: (t) =>
        t.kind === 'expense' && !t.category ? (
          <Button
            label="Add category"
            variant="chip"
            size="sm"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => categorize(t)}
          />
        ) : (
          <Text type="supporting">
            {t.category ||
              {
                expense: '',
                income: 'Income',
                transfer: 'Transfer',
                opening: 'Opening balance',
                other: ''
              }[t.kind]}
          </Text>
        )
    },
    {
      key: 'amountMinor',
      header: 'Amount',
      align: 'end',
      width: moneyWidth,
      renderCell: (t) => (
        <Text
          weight="semibold"
          hasTabularNumbers
          textWrap="nowrap"
          color={t.kind === 'expense' ? 'negative' : t.kind === 'income' ? 'positive' : undefined}
        >
          {t.kind === 'income' ? '+' : ''}
          {formatMoney(t.amountMinor, t.currency)}
        </Text>
      )
    }
  ]

  return (
    <VStack gap={6}>
      <HStack gap={4} hAlign="between" vAlign="end">
        <VStack gap={1}>
          <Text type="supporting">{longDate(now)}</Text>
          <Heading level={1}>Overview</Heading>
        </VStack>
        <HStack gap={3} vAlign="center">
          <Button
            label="Search transactions"
            icon={<Icon icon={MagnifyingGlassIcon} />}
            onClick={props.onSearch}
          >
            <HStack gap={6} vAlign="center">
              <Text color="secondary">Search transactions</Text>
              <Kbd keys="mod+k" />
            </HStack>
          </Button>
          {activity && (
            <Card padding={0.5}>
              <HStack gap={1} vAlign="center">
                <IconButton
                  label="Previous month"
                  icon={<Icon icon="chevronLeft" />}
                  variant="ghost"
                  size="sm"
                  onClick={() => setDate(activity.previous)}
                />
                <Button
                  label={month}
                  variant="ghost"
                  size="sm"
                  tooltip={isThisMonth ? undefined : 'Back to this month'}
                  onClick={() => setDate(now)}
                />
                <IconButton
                  label="Next month"
                  icon={<Icon icon="chevronRight" />}
                  variant="ghost"
                  size="sm"
                  onClick={() => setDate(activity.next)}
                />
              </HStack>
            </Card>
          )}
          <Button
            label="Add transaction"
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            isDisabled={!accounts?.length}
            onClick={() => setAdding(true)}
          />
        </HStack>
      </HStack>

      {fxError && (
        <Banner
          status="error"
          title="Exchange rates could not be updated"
          description={`${fxError} Converted totals use the last saved rates.`}
        />
      )}

      {(uncategorizedCount > 0 || openingIncome) && (
        <Card>
          <VStack gap={3}>
            {uncategorizedCount > 0 && (
              <Alert
                tone="orange"
                title={`Categorize ${plural(uncategorizedCount, 'transaction')}`}
                description={
                  uncategorizedCount === 1 && firstUncategorized
                    ? `${formatMoney(uncategorizedMinor, currency)} to ${firstUncategorized.payee || 'a payee'} on ${shortDate(firstUncategorized.date)} isn't in a budget yet, so ${isNothingSpentInBudgets ? `every budget still shows ${whole(0, currency)} spent` : "your budgets don't count it"}.`
                    : `${formatMoney(uncategorizedMinor, currency)} across ${plural(uncategorizedCount, 'transaction')} isn't in a budget yet, so your budgets don't count it.`
                }
                action={
                  <Button
                    label="Categorize"
                    variant="warm"
                    isDisabled={!firstUncategorized}
                    onClick={() => categorize(firstUncategorized)}
                  />
                }
              />
            )}
            {uncategorizedCount > 0 && openingIncome && <Divider />}
            {openingIncome && (
              <Alert
                tone="blue"
                title={`Check income on ${shortDate(openingIncome.date)}`}
                description={`${formatMoney(openingIncome.incomeMinor, currency)} was recorded the same day as your opening balances. Starting balances shouldn't count as income.`}
                action={
                  <Button
                    label="Review"
                    variant="info"
                    onClick={() => onNavigate('transactions')}
                  />
                }
              />
            )}
          </VStack>
        </Card>
      )}

      <Grid columns={3} gap={5}>
        <GridSpan columns={2}>
          <Card height="100%">
            <VStack gap={4}>
              <HStack gap={2} hAlign="between" vAlign="center">
                <Text color="secondary">Net worth</Text>
                <HStack gap={1}>
                  {converted?.rates.map((r) => (
                    <Badge
                      key={r.currency}
                      variant="neutral"
                      label={`${currencySymbol(r.currency)}1 = ${currencySymbol(baseCurrency)}${r.rate} · rate of ${shortDate(r.date)}`}
                    />
                  ))}
                </HStack>
              </HStack>
              <VStack gap={2}>
                <BigMoney minor={netMinor} currency={baseCurrency} type="display-2" />
                {first && (
                  <HStack gap={2} vAlign="center">
                    {change !== 0 && (
                      <Badge
                        variant={change < 0 ? 'orange' : 'green'}
                        icon={<Icon icon={change < 0 ? ArrowDownIcon : ArrowUpIcon} />}
                        label={`${formatMoney(Math.abs(change), baseCurrency)}${first.netMinor > 0 ? ` · ${(Math.round((Math.abs(change) * 1000) / first.netMinor) / 10).toFixed(1)}%` : ''}`}
                      />
                    )}
                    <Text type="supporting">
                      {change === 0 ? 'No change' : ''} since you started tracking on{' '}
                      {shortDate(first.date)}
                    </Text>
                  </HStack>
                )}
              </VStack>
              {first && last && middle && (
                <AreaChart
                  label={`Net worth from ${formatMoney(first.netMinor, baseCurrency)} on ${shortDate(first.date)} to ${formatMoney(last.netMinor, baseCurrency)} today`}
                  values={points.map((p) => p.netMinor)}
                  axis={[shortDate(first.date), shortDate(middle.date), 'Today']}
                  tooltip={(i) => [
                    i === points.length - 1 ? 'Today' : shortDate(points[i].date),
                    formatMoney(points[i].netMinor, baseCurrency)
                  ]}
                />
              )}
              {parts.length > 0 && (
                <VStack gap={3}>
                  <Meter
                    label="Net worth by currency"
                    max={partsTotal}
                    segments={parts.map((p, i) => ({
                      value: Math.max(0, p.netMinor),
                      color: partColor(i)
                    }))}
                  />
                  <Grid columns={2} gap={3}>
                    {parts.map((p, i) => {
                      const original = netWorth?.totals.find((t) => t.currency === p.currency)
                      const share = `${percent(Math.max(0, p.netMinor), partsTotal)}%`
                      return (
                        <HStack key={p.currency} gap={2} vAlign="center">
                          <Swatch color={partColor(i)} />
                          <StackItem size="fill">
                            <Text type="supporting">{p.currency} accounts</Text>
                          </StackItem>
                          <Text weight="semibold" hasTabularNumbers textWrap="nowrap">
                            {formatMoney(original?.netMinor ?? p.netMinor, p.currency)}
                          </Text>
                          <Text type="supporting" hasTabularNumbers>
                            {p.currency === baseCurrency
                              ? share
                              : `≈ ${formatMoney(p.netMinor, baseCurrency)} · ${share}`}
                          </Text>
                        </HStack>
                      )
                    })}
                  </Grid>
                </VStack>
              )}
              {(netWorth?.totals.length ?? 0) > 1 && !converted ? (
                <Text type="supporting">
                  Each currency is totalled separately. To see one total, set an exchange rate under
                  Investments.
                </Text>
              ) : (
                <Text type="supporting" hasTabularNumbers>
                  {debts.length
                    ? `Debts ${debts.map((d) => formatMoney(d.liabilitiesMinor, d.currency)).join(' · ')}`
                    : 'No debts tracked'}
                </Text>
              )}
            </VStack>
          </Card>
        </GridSpan>

        <Card height="100%">
          {budgetTotal === 0 ? (
            <VStack gap={3}>
              <Text color="secondary">Budget remaining</Text>
              <Text type="supporting">No budget is set for {month}.</Text>
              <Button label="Set budgets" onClick={() => onNavigate('budgets')} />
            </VStack>
          ) : (
            <VStack gap={4}>
              <VStack gap={2}>
                <Text color="secondary">Budget remaining</Text>
                <BigMoney minor={budgetLeft} currency={currency} type="display-3" />
                <Text type="supporting" hasTabularNumbers>
                  of {formatMoney(budgetTotal, currency)} budgeted for {monthName}
                </Text>
              </VStack>
              <Divider />
              {daysLeft > 0 && budgetLeft > 0 ? (
                <VStack gap={1}>
                  <Text type="supporting">You can spend about</Text>
                  <HStack gap={1} vAlign="end">
                    <Text type="large" weight="bold" hasTabularNumbers>
                      {whole(Math.floor(budgetLeft / daysLeft), currency)}
                    </Text>
                    <Text type="supporting">/ day</Text>
                  </HStack>
                  <Text type="supporting">
                    for the {plural(daysLeft, 'day')}{' '}
                    {isThisMonth ? 'left this month' : `of ${monthName}`}
                  </Text>
                </VStack>
              ) : (
                <Text type="supporting">
                  {budgetLeft > 0 ? `${monthName} is over.` : 'Nothing left to spend this month.'}
                </Text>
              )}
              {uncategorizedMinor > 0 && (
                <Card variant="warm" padding={3}>
                  <VStack gap={0.5}>
                    <Text color="warm" type="supporting">
                      {formatMoney(uncategorizedMinor, currency)} uncategorized isn&apos;t counted
                      yet.
                    </Text>
                    {firstUncategorized && (
                      <Link
                        color="inherit"
                        weight="semibold"
                        type="supporting"
                        onClick={() => categorize(firstUncategorized)}
                      >
                        <Text color="warm" type="inherit">
                          Categorize →
                        </Text>
                      </Link>
                    )}
                  </VStack>
                </Card>
              )}
            </VStack>
          )}
        </Card>
      </Grid>

      {activity && (
        <Grid columns={3} gap={5}>
          <Card>
            <VStack gap={2}>
              <Text color="secondary">Income</Text>
              <Text size="2xl" weight="bold" color="positive" hasTabularNumbers>
                +{formatMoney(activity.incomeMinor, currency)}
              </Text>
              <Text type="supporting">
                {activity.incomeCount === 0
                  ? 'No income yet'
                  : `${plural(activity.incomeCount, 'deposit')}${activity.incomeCount === 1 ? ` · ${shortDate(activity.days.find((d) => d.incomeMinor > 0)?.date ?? activity.start)}` : ''}`}
              </Text>
            </VStack>
          </Card>
          <Card>
            <VStack gap={2}>
              <Text color="secondary">Spent</Text>
              <Text size="2xl" weight="bold" color="negative" hasTabularNumbers>
                {formatMoney(-activity.expenseMinor, currency)}
              </Text>
              <Text type="supporting">
                {activity.incomeMinor > 0
                  ? `${percent(activity.expenseMinor, activity.incomeMinor)}% of income · `
                  : ''}
                {plural(activity.expenseCount, 'payment')}
              </Text>
            </VStack>
          </Card>
          <Card>
            <VStack gap={2}>
              <Text color="secondary">Left over</Text>
              <Text size="2xl" weight="bold" hasTabularNumbers>
                {formatMoney(activity.incomeMinor - activity.expenseMinor, currency)}
              </Text>
              <Text type="supporting">
                {activity.incomeMinor > activity.expenseMinor
                  ? `${percent(activity.incomeMinor - activity.expenseMinor, activity.incomeMinor)}% of income kept`
                  : activity.incomeMinor === activity.expenseMinor
                    ? 'Nothing left over'
                    : 'Spent more than came in'}
              </Text>
            </VStack>
          </Card>
        </Grid>
      )}

      {activity && (
        <Grid columns={3} gap={5}>
          <GridSpan columns={2}>
            <Card height="100%">
              <VStack gap={3}>
                <HStack gap={2} hAlign="between" vAlign="start">
                  <VStack gap={1}>
                    <Heading level={4}>Spending pace</Heading>
                    <Text type="supporting">
                      {budgetTotal === 0
                        ? 'Set budgets to compare your spending with an even pace.'
                        : isThisMonth
                          ? `${whole(Math.abs(paceGap), currency)} ${paceGap >= 0 ? 'under' : 'over'} an even pace for your budgets`
                          : `${formatMoney(activity.expenseMinor, currency)} spent of ${formatMoney(budgetTotal, currency)} budgeted`}
                    </Text>
                  </VStack>
                  <HStack gap={3} vAlign="center">
                    <HStack gap={1} vAlign="center">
                      <svg width={16} height={2} aria-hidden>
                        <line x2={16} stroke="var(--color-chart-blue)" strokeWidth={4} />
                      </svg>
                      <Text type="supporting" size="xsm">
                        Spent so far
                      </Text>
                    </HStack>
                    {budgetTotal > 0 && (
                      <HStack gap={1} vAlign="center">
                        <svg width={16} height={2} aria-hidden>
                          <line
                            x2={16}
                            stroke="var(--color-chart-pace)"
                            strokeWidth={4}
                            strokeDasharray="4 3"
                          />
                        </svg>
                        <Text type="supporting" size="xsm">
                          Even pace to {whole(budgetTotal, currency)}
                        </Text>
                      </HStack>
                    )}
                  </HStack>
                </HStack>
                <PaceChart
                  days={daysInMonth}
                  spent={spentByDay}
                  budgetMinor={budgetTotal}
                  today={isThisMonth ? dayOfMonth : undefined}
                  currency={currency}
                  dayLabel={(day) =>
                    shortDate(`${activity.start.slice(0, 8)}${String(day).padStart(2, '0')}`)
                  }
                  note={
                    biggest
                      ? {
                          day: Number(biggest.date.slice(8)),
                          text: biggest.payee || biggest.memo
                        }
                      : undefined
                  }
                />
              </VStack>
            </Card>
          </GridSpan>
          <Card height="100%">
            <VStack gap={4}>
              <VStack gap={1}>
                <Heading level={4}>Spending by category</Heading>
                <Text type="supporting" hasTabularNumbers>
                  {monthName} · {formatMoney(spentTotal, currency)} total
                </Text>
              </VStack>
              {categoryRows.length === 0 ? (
                <Text type="supporting">No spending recorded in {monthName}.</Text>
              ) : (
                categoryRows.map((row) => (
                  <VStack key={row.name} gap={1.5}>
                    <HStack gap={2} hAlign="between">
                      <Text weight="semibold">{row.name}</Text>
                      <Text weight="semibold" hasTabularNumbers>
                        {formatMoney(row.minor, currency)}
                      </Text>
                    </HStack>
                    <Meter
                      label={`${row.name}: ${percent(row.minor, spentTotal)}% of spending`}
                      max={spentTotal}
                      segments={[{ value: row.minor, color: row.color }]}
                    />
                    <Text type="supporting" size="xsm">
                      {percent(row.minor, spentTotal)}% of spending
                      {row.name === 'Uncategorized'
                        ? ` · ${plural(uncategorizedCount, 'transaction')}`
                        : ''}
                    </Text>
                  </VStack>
                ))
              )}
              {firstUncategorized && (
                <VStack gap={3}>
                  <Text type="supporting">
                    {uncategorizedCount === 1 ? 'Give it a category' : 'Give them categories'} and
                    this breaks down by {namesList ?? 'your budgets'}.
                  </Text>
                  <Button
                    label={`Categorize ${firstUncategorized.payee || 'transaction'}`}
                    width="100%"
                    onClick={() => categorize(firstUncategorized)}
                  />
                </VStack>
              )}
            </VStack>
          </Card>
        </Grid>
      )}

      {budget && budgetRows.length > 0 && (
        <Card>
          <VStack gap={5}>
            <HStack gap={2} hAlign="between" vAlign="start">
              <VStack gap={1}>
                <Heading level={4}>Budgets</Heading>
                <Text type="supporting">
                  {isThisMonth
                    ? `Day ${dayOfMonth} of ${daysInMonth} · the white tick shows where an even pace would be today`
                    : `${month} · ${isPast ? 'the month is over' : 'the month has not started'}`}
                </Text>
              </VStack>
              <Link weight="semibold" onClick={() => onNavigate('budgets')}>
                Manage budgets →
              </Link>
            </HStack>
            <Grid columns={2} columnGap={10} rowGap={5}>
              {budgetRows.map((row) => {
                const status = budgetStatus(row, paceShare, budget.currency)
                const total = row.budgetedMinor + row.carriedMinor
                return (
                  <VStack key={row.categoryId} gap={2}>
                    <HStack gap={2} hAlign="between" vAlign="center">
                      <Text weight="semibold">{row.name}</Text>
                      {status.badge}
                    </HStack>
                    <Meter
                      label={`${row.name}: ${formatMoney(row.spentMinor, budget.currency)} of ${formatMoney(total, budget.currency)}`}
                      max={total}
                      segments={[{ value: row.spentMinor, color: status.color }]}
                      tick={isThisMonth ? paceShare : undefined}
                    />
                    <HStack gap={2} hAlign="between">
                      <Text type="supporting" hasTabularNumbers>
                        {formatMoney(row.spentMinor, budget.currency)} of{' '}
                        {formatMoney(total, budget.currency)}
                      </Text>
                      <Text type="supporting" weight="semibold" color="primary" hasTabularNumbers>
                        {status.detail}
                      </Text>
                    </HStack>
                  </VStack>
                )
              })}
            </Grid>
          </VStack>
        </Card>
      )}

      <Grid columns={3} gap={5} align="start">
        <GridSpan columns={2}>
          <Card height="fit-content">
            <VStack gap={3}>
              <HStack gap={2} hAlign="between" vAlign="center">
                <Heading level={4}>Recent transactions</Heading>
                <Link weight="semibold" onClick={() => onNavigate('transactions')}>
                  View all →
                </Link>
              </HStack>
              {recent.length === 0 ? (
                <EmptyState
                  title="No transactions yet"
                  description="Record your first income or expense to see it here."
                  headingLevel={5}
                  actions={
                    <Button
                      label="Add transaction"
                      variant="primary"
                      onClick={() => setAdding(true)}
                    />
                  }
                />
              ) : (
                <Table data={recent} columns={recentColumns} idKey="id" />
              )}
              {openings.length > 0 && (
                <HStack gap={2} hAlign="between" vAlign="center">
                  <Text type="supporting">
                    {isShowingOpening
                      ? 'Opening balances are shown. They aren’t income or spending.'
                      : `Opening balances from ${shortDate(openings[openings.length - 1].date)} are hidden — they aren't income or spending.`}
                  </Text>
                  <Button
                    label={isShowingOpening ? 'Hide' : 'Show'}
                    size="sm"
                    onClick={() => setShowingOpening(!isShowingOpening)}
                  />
                </HStack>
              )}
            </VStack>
          </Card>
        </GridSpan>

        <VStack gap={5}>
          {accounts && (
            <Card>
              <VStack gap={3}>
                <HStack gap={2} hAlign="between" vAlign="center">
                  <Heading level={4}>Accounts</Heading>
                  <Text type="supporting">{plural(accounts.length, 'account')}</Text>
                </HStack>
                {sortedAccounts.slice(0, 5).map((a, i) => (
                  <VStack key={a.id} gap={3}>
                    {i > 0 && <Divider />}
                    <HStack gap={2} hAlign="between" vAlign="start">
                      <VStack gap={0.5}>
                        <Text weight="semibold">{a.name}</Text>
                        <Text type="supporting" size="xsm">
                          {[a.institution, a.currency !== baseCurrency && a.currency]
                            .filter(Boolean)
                            .join(' · ') || (a.type === 'liability' ? 'Debt' : 'Account')}
                        </Text>
                      </VStack>
                      <VStack gap={0.5}>
                        <Text weight="semibold" hasTabularNumbers justify="end" textWrap="nowrap">
                          {formatMoney(a.balanceMinor + a.holdingsMinor, a.currency)}
                        </Text>
                        {a.currency !== baseCurrency && a.baseMinor !== null && (
                          <Text type="supporting" size="xsm" hasTabularNumbers justify="end">
                            ≈ {formatMoney(a.baseMinor, baseCurrency)}
                          </Text>
                        )}
                      </VStack>
                    </HStack>
                  </VStack>
                ))}
                <Link weight="semibold" onClick={() => onNavigate('accounts')}>
                  View all {plural(accounts.length, 'account')} →
                </Link>
              </VStack>
            </Card>
          )}

          {goals && (
            <Card>
              <VStack gap={3}>
                <Heading level={4}>Goals</Heading>
                {goals.length === 0 ? (
                  <Text type="supporting">
                    No goals yet.{' '}
                    {savings
                      ? `Your ${formatMoney(savings.budgetedMinor + savings.carriedMinor - savings.spentMinor, currency)} ${savings.name} budget would be easier to watch grow as a goal.`
                      : 'Set a target and a date to see how much to put aside each period.'}
                  </Text>
                ) : (
                  goals
                    .slice(0, 3)
                    .map((g) => (
                      <ProgressBar
                        key={g.id}
                        label={`${g.name} · ${formatMoney(g.savedMinor, g.currency)} of ${formatMoney(g.targetMinor, g.currency)}`}
                        value={Math.min(g.savedMinor, g.targetMinor)}
                        max={g.targetMinor}
                        variant="accent"
                      />
                    ))
                )}
                <Button
                  label={goals.length === 0 ? 'Create a goal' : 'View all goals'}
                  width="100%"
                  onClick={() => onNavigate('goals')}
                />
              </VStack>
            </Card>
          )}
        </VStack>
      </Grid>

      {isAdding && accounts && categories && (
        <AddTransactionDialog
          accounts={accounts}
          categories={categories}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            reloadAll()
          }}
        />
      )}
      {categorizing && categories && (
        <CategorizeDialog
          transaction={categorizing}
          categories={categories}
          onClose={() => setCategorizing(undefined)}
          onSaved={() => {
            setCategorizing(undefined)
            reloadAll()
          }}
        />
      )}
    </VStack>
  )
}
