import { useState } from 'react'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Pagination } from '@astryxdesign/core/Pagination'
import { Table, pixel, type TableColumn } from '@astryxdesign/core/Table'
import { TrashIcon } from '@heroicons/react/24/outline'
import type { TransactionRow } from '../../../../shared/ipc'
import { Amount } from '../../components/Amount'
import { Page } from '../../components/Page'
import { TransactionCalendar } from '../../components/TransactionCalendar'
import { moneyWidth } from '../../lib/table'
import { useQuery } from '../../lib/useQuery'
import { AddTransactionDialog } from './AddTransactionDialog'

const pageSize = 10

export function TransactionsPage(props: { onAddAccount: () => void }): React.JSX.Element {
  const [accounts] = useQuery(window.api.accounts.list)
  const [categories] = useQuery(window.api.categories.list)
  const [transactions, reload] = useQuery(window.api.transactions.list)
  const [settings] = useQuery(window.api.settings.get)
  const [requestedPage, setPage] = useState(1)
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil((transactions?.length ?? 0) / pageSize))
  )
  const [isAdding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string>()
  const addButton = (
    <Button label="Add transaction" variant="primary" onClick={() => setAdding(true)} />
  )

  const columns: TableColumn<TransactionRow>[] = [
    { key: 'date', header: 'Date', width: pixel(120) },
    { key: 'payee', header: 'Description', renderCell: (t) => t.payee || t.memo },
    { key: 'category', header: 'Category' },
    { key: 'accountLabel', header: 'Account' },
    {
      key: 'amountMinor',
      header: 'Amount',
      align: 'end',
      width: moneyWidth,
      renderCell: (t) => <Amount minor={t.amountMinor} currency={t.currency} />
    },
    {
      key: 'id',
      header: '',
      width: pixel(72),
      align: 'end',
      renderCell: (t) => (
        <IconButton
          label={`Delete ${t.payee || 'transaction'} on ${t.date}`}
          icon={<Icon icon={TrashIcon} />}
          variant="ghost"
          size="sm"
          onClick={() => setDeletingId(t.id)}
        />
      )
    }
  ]

  const hasAccounts = !!accounts?.length
  return (
    <Page title="Transactions" action={hasAccounts && transactions?.length ? addButton : undefined}>
      {accounts?.length === 0 && (
        <EmptyState
          title="Add an account first"
          description="Transactions are recorded against an account, so start by adding one."
          headingLevel={2}
          actions={<Button label="Add account" variant="primary" onClick={props.onAddAccount} />}
        />
      )}
      {hasAccounts && transactions?.length === 0 && (
        <EmptyState
          title="No transactions yet"
          description="Record your first expense, income or transfer between accounts."
          headingLevel={2}
          actions={addButton}
        />
      )}
      {hasAccounts && transactions && (
        <TransactionCalendar transactions={transactions} weekStart={settings?.weekStart ?? 1} />
      )}
      {!!transactions?.length && (
        <>
          <Table
            data={transactions.slice((page - 1) * pageSize, page * pageSize)}
            columns={columns}
            idKey="id"
            hasHover
          />
          {transactions.length > pageSize && (
            <Pagination
              label="Transaction pages"
              page={page}
              onChange={setPage}
              totalItems={transactions.length}
              pageSize={pageSize}
            />
          )}
        </>
      )}

      {isAdding && accounts && categories && (
        <AddTransactionDialog
          accounts={accounts}
          categories={categories}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            setPage(1)
            reload()
          }}
        />
      )}
      <AlertDialog
        isOpen={!!deletingId}
        onOpenChange={(isOpen) => !isOpen && setDeletingId(undefined)}
        title="Delete this transaction?"
        description="Account balances will be updated. This cannot be undone here."
        actionLabel="Delete"
        actionVariant="destructive"
        onAction={async () => {
          if (deletingId) await window.api.transactions.remove(deletingId)
          setDeletingId(undefined)
          reload()
        }}
      />
    </Page>
  )
}
