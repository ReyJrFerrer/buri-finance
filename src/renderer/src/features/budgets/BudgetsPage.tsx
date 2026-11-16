import { useCallback, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { HStack } from '@astryxdesign/core/Stack'
import { Table, pixel, type TableColumn } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { budgetPeriodSchema, type Budget, type Rule } from '../../../../shared/ipc'
import { formatAmount, formatMinor } from '../../../../shared/money'
import { Amount } from '../../components/Amount'
import { DeleteButton } from '../../components/DeleteButton'
import { Page } from '../../components/Page'
import { Section } from '../../components/Section'
import { moneyWidth, nameWidth } from '../../lib/table'
import { today, useQuery } from '../../lib/useQuery'
import { AddCategoryDialog, AddRuleDialog, SetBudgetDialog } from './BudgetDialogs'

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
  const [dialog, setDialog] = useState<'category' | 'rule' | Row>()

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
  const amount = (pick: (row: Row) => number, header: string): TableColumn<Row> => ({
    key: header,
    header,
    align: 'end',
    width: moneyWidth,
    renderCell: (row) => <Amount minor={pick(row)} currency={budget?.currency ?? ''} />
  })

  const columns: TableColumn<Row>[] = [
    { key: 'name', header: 'Category', width: nameWidth },
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
          {isMonthly && (
            <Button label={`Set budget for ${row.name}`} size="sm" onClick={() => setDialog(row)}>
              Set budget
            </Button>
          )}
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
    <Page title="Budgets" action={categories?.length ? addCategory : undefined}>
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
          <Table data={budget.rows} columns={columns} idKey="categoryId" hasHover />
          {!isMonthly && (
            <Text type="supporting">
              A week shows its share of each month&apos;s budget, split by days. Set budgets in the
              monthly view.
            </Text>
          )}
          <Section
            title="Income rules"
            description="When you record income, these rules propose how to divide it across your budgets, in this order. You confirm or edit the split before it is saved."
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
      {typeof dialog === 'object' && budget && (
        <SetBudgetDialog
          row={dialog}
          month={budget.start}
          currency={budget.currency}
          onClose={() => setDialog(undefined)}
          onSaved={reload}
        />
      )}
    </Page>
  )
}
