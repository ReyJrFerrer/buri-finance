import { useState } from 'react'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import type { Category, TransactionRow } from '../../../../shared/ipc'
import { formatMoney } from '../../../../shared/money'
import { FormDialog } from '../../components/FormDialog'
import { errorMessage, shortDate } from '../../lib/useQuery'

interface Props {
  transaction: TransactionRow
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}

// Puts one expense in a budget category.
export function CategorizeDialog(props: Props): React.JSX.Element {
  const { transaction, categories, onClose, onSaved } = props
  const [categoryId, setCategoryId] = useState('')
  const [error, setError] = useState<string>()

  const submit = async (): Promise<void> => {
    if (!categoryId) return setError('Choose a category')
    try {
      await window.api.transactions.categorize({ id: transaction.id, categoryId })
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <FormDialog
      title={`Categorize ${transaction.payee || 'transaction'}`}
      submitLabel="Categorize"
      error={error}
      onSubmit={submit}
      onClose={onClose}
    >
      <Text type="supporting" hasTabularNumbers>
        {formatMoney(Math.abs(transaction.amountMinor), transaction.currency)} on{' '}
        {shortDate(transaction.date)} from {transaction.accountLabel}
      </Text>
      {categories.length === 0 ? (
        <Text>Add a category under Budgets first.</Text>
      ) : (
        <Selector
          label="Category"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId}
          onChange={(value) => setCategoryId(value ?? '')}
        />
      )}
    </FormDialog>
  )
}
