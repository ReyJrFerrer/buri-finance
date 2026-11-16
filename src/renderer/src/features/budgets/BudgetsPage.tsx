import { useCallback, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Table, pixel, type TableColumn } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { budgetPeriodSchema, type Budget, type Rule } from '../../../../shared/ipc'
import { formatAmount, formatMinor } from '../../../../shared/money'
import { baseCurrency } from '../../../../shared/presets'
import { Amount } from '../../components/Amount'
import { DeleteButton } from '../../components/DeleteButton'
import { Page } from '../../components/Page'
import { PieChart } from '../../components/PieChart'
import { Section } from '../../components/Section'
import { moneyWidth, nameWidth } from '../../lib/table'
import { today, useQuery } from '../../lib/useQuery'
import {
  AddCategoryDialog,
  AddRuleDialog,
  PlanIncomeDialog,
  SetBudgetDialog
} from './BudgetDialogs'
import { DueDates } from './DueDates'

type Row = Budget['rows'][number]

const monthLabel = (start: string): string =>
  new Date(`${start}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

export function BudgetsPage(): React.JSX.Element {
  const [settings, reloadSettings] = useQuery(window.api.settings.get)
  const [date, setDate] = useState<string>(today())
  const period = settings?.budgetPeriod ?? 'monthly'
  const [budget, reloadBudget] = useQuery(
    useCallback(() => window.api.budgets.get({ period, date }), [period, date])
  )
  const [categories, reloadCategories] = useQuery(window.api.categories.list)
  const [rules, reloadRules] = useQuery(window.api.rules.list)
  const [accounts] = useQuery(window.api.accounts.list)
  const [dialog, setDialog] = useState<'category' | 'rule' | 'plan' | Row>()
  // Bills are in the base currency, so they are paid from base-currency asset accounts.
  const payAccounts = accounts?.filter((a) => a.type === 'asset' && a.currency === baseCurrency)

  const reload = (): void => {
    setDialog(undefined)
    reloadBudget()
    reloadCategories()
    reloadRules()
  }
  const addCategory = (
    <Button label="Add category" variant="primary" onClick={() => setDialog('category')} />
  )
  const isMonthly = period === 'monthly'
  const budgetedMinor = budget?.rows.reduce((sum, r) => sum + r.budgetedMinor, 0) ?? 0
  const amount = (pick: (row: Row) => number, header: string): TableColumn<Row> => ({
    key: header,
    header,
    align: 'end',
    width: moneyWidth,
    renderCell: (row) => <Amount minor={pick(row)} currency={budget?.currency ?? ''} />
  })

  const columns: TableColumn<Row>[] = [
    {
      key: 'name',
      header: 'Category',
      width: nameWidth,
      renderCell: (row) => (
        <VStack gap={0.5}>
          <Text>{row.name}</Text>
          <Text type="supporting">
            {row.cadence === 'weekly' ? 'Weekly' : 'Monthly'}
            {row.percentBp ? ` · ${formatAmount(row.percentBp)}% of income` : ''}
          </Text>
        </VStack>
      )
    },
    amount((r) => r.budgetedMinor, 'Budgeted'),
    ...(isMonthly ? [amount((r) => r.carriedMinor, 'Rolled over')] : []),
    amount((r) => r.spentMinor, 'Spent'),
    amount((r) => r.availableMinor, 'Available'),
    {
      key: 'categoryId',
      header: '',
      align: 'end',
      width: pixel(190),
      renderCell: (row) => (
        <HStack gap={1} hAlign="end" vAlign="center">
          <Button label={`Set budget for ${row.name}`} size="sm" onClick={() => setDialog(row)}>
            Set budget
          </Button>
          <DeleteButton
            label={`Delete category ${row.name}`}
            title={`Delete ${row.name}?`}
            description="The category leaves your budgets. Transactions already recorded keep it."
            onDelete={() => window.api.categories.remove(row.categoryId).then(reload)}
          />
        </HStack>
      )
    }
  ]

  const ruleColumns: TableColumn<Rule>[] = [
    { key: 'categoryName', header: 'Category' },
    {
      key: 'value',
      header: 'Takes',
      align: 'end',
      renderCell: (rule) => (
        <Text hasTabularNumbers>
          {rule.kind === 'fixed'
            ? formatMinor(rule.value, budget?.currency ?? '')
            : `${formatAmount(rule.value)}% of income`}
        </Text>
      )
    },
    {
      key: 'id',
      header: '',
      align: 'end',
      width: pixel(72),
      renderCell: (rule) => (
        <DeleteButton
          label={`Delete rule for ${rule.categoryName}`}
          title="Delete this rule?"
          description="Future income will no longer be proposed for this category."
          onDelete={() => window.api.rules.remove(rule.id).then(reload)}
        />
      )
    }
  ]

  return (
    <Page
      title="Budgets"
      action={
        categories?.length ? (
          <HStack gap={2}>
            <Button label="Plan income" onClick={() => setDialog('plan')} />
            {addCategory}
          </HStack>
        ) : undefined
      }
    >
      {categories?.length === 0 && (
        <EmptyState
          title="No categories yet"
          description="Add a category such as Groceries or Rent, then give it a monthly budget."
          headingLevel={2}
          actions={addCategory}
        />
      )}
      {!!categories?.length && budget && (
        <>
          <HStack gap={4} vAlign="center" hAlign="between">
            <SegmentedControl
              label="Budget period"
              value={period}
              onChange={(value) =>
                window.api.settings
                  .update({ budgetPeriod: budgetPeriodSchema.parse(value) })
                  .then(reloadSettings)
              }
            >
              <SegmentedControlItem value="monthly" label="Monthly" />
              <SegmentedControlItem value="weekly" label="Weekly" />
            </SegmentedControl>
            <HStack gap={2} vAlign="center">
              <IconButton
                label="Previous period"
                icon={<Icon icon="chevronLeft" />}
                variant="ghost"
                onClick={() => setDate(budget.previous)}
              />
              <Text hasTabularNumbers weight="medium">
                {isMonthly ? monthLabel(budget.start) : `${budget.start} to ${budget.end}`}
              </Text>
              <IconButton
                label="Next period"
                icon={<Icon icon="chevronRight" />}
                variant="ghost"
                onClick={() => setDate(budget.next)}
              />
            </HStack>
          </HStack>
          {budget.incomeMinor !== null && (
            <Text hasTabularNumbers>
              Expected income {formatMinor(budget.incomeMinor, budget.currency)}
              {budget.income && budget.income.cadence !== period
                ? ` (from ${formatMinor(budget.income.amountMinor, budget.currency)} a ${budget.income.cadence === 'monthly' ? 'month' : 'week'})`
                : ''}{' '}
              · Budgeted {formatMinor(budgetedMinor, budget.currency)} · Not budgeted{' '}
              {formatMinor(budget.incomeMinor - budgetedMinor, budget.currency)}
            </Text>
          )}
          <Grid columns={{ minWidth: 320, max: 2 }} gap={6}>
            <PieChart
              title="Budgeted"
              currency={budget.currency}
              emptyText="No budgets set for this period yet."
              slices={budget.rows.map((r) => ({ label: r.name, minor: r.budgetedMinor }))}
            />
            <PieChart
              title="Spent"
              currency={budget.currency}
              emptyText="No spending in this period yet."
              slices={budget.rows.map((r) => ({ label: r.name, minor: r.spentMinor }))}
            />
          </Grid>
          <Table data={budget.rows} columns={columns} idKey="categoryId" hasHover />
          <Text type="supporting">
            {isMonthly
              ? 'Weekly categories show their weekly budget for the days of this month.'
              : "Monthly categories show this week's share of the month's budget, split by days."}
          </Text>
          {settings && payAccounts && (
            <DueDates
              date={budget.start}
              weekStart={settings.weekStart}
              categories={categories}
              accounts={payAccounts}
              onPaid={reloadBudget}
            />
          )}
          <Section
            title="Income rules"
            description="When you plan or record income, these rules propose how to divide it across your budgets, in this order. You confirm or edit the split before it is saved."
            action={<Button label="Add rule" onClick={() => setDialog('rule')} />}
          >
            {!!rules?.length && <Table data={rules} columns={ruleColumns} idKey="id" />}
          </Section>
        </>
      )}
      {dialog === 'category' && (
        <AddCategoryDialog onClose={() => setDialog(undefined)} onSaved={reload} />
      )}
      {dialog === 'rule' && categories && (
        <AddRuleDialog
          categories={categories}
          onClose={() => setDialog(undefined)}
          onSaved={reload}
        />
      )}
      {dialog === 'plan' && budget && (
        <PlanIncomeDialog
          budget={budget}
          hasRules={!!rules?.length}
          onClose={() => setDialog(undefined)}
          onSaved={reload}
        />
      )}
      {typeof dialog === 'object' && budget && (
        <SetBudgetDialog
          row={dialog}
          date={budget.start}
          currency={budget.currency}
          onClose={() => setDialog(undefined)}
          onSaved={reload}
        />
      )}
    </Page>
  )
}
