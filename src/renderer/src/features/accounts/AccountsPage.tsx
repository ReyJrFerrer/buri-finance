import { useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Page } from '../../components/Page'
import { useQuery } from '../../lib/useQuery'
import { AccountsTable } from './AccountsTable'
import { AddAccountDialog } from './AddAccountDialog'
import { EditAccountDialog } from './EditAccountDialog'
import type { Account } from '../../../../shared/ipc'

export function AccountsPage(): React.JSX.Element {
  const [accounts, reloadAccounts] = useQuery(window.api.accounts.list)
  const [goals, reloadGoals] = useQuery(window.api.goals.list)
  const [deleteError, setDeleteError] = useState<{ name: string; message: string }>()
  const [isAdding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Account>()
  const addButton = <Button label="Add account" variant="primary" onClick={() => setAdding(true)} />
  const reload = (): void => {
    setDeleteError(undefined)
    reloadAccounts()
    reloadGoals()
  }

  return (
    <Page title="Accounts" action={accounts?.length ? addButton : undefined}>
      {accounts?.length === 0 && (
        <EmptyState
          title="No accounts yet"
          description="Add the bank, wallet or broker you use most. GoTyme, MariBank, GCash, DragonFi and GoTrade are ready as presets."
          headingLevel={2}
          actions={addButton}
        />
      )}
      {deleteError && (
        <Banner
          status="error"
          title={`${deleteError.name} could not be deleted`}
          description={deleteError.message}
          isDismissable
          onDismiss={() => setDeleteError(undefined)}
        />
      )}
      {!!accounts?.length && goals && (
        <AccountsTable
          accounts={accounts}
          goals={goals}
          onEdit={setEditing}
          onDeleted={reload}
          onDeleteError={(a, message) => setDeleteError({ name: a.name, message })}
        />
      )}
      {isAdding && (
        <AddAccountDialog
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            reload()
          }}
        />
      )}
      {editing && (
        <EditAccountDialog
          account={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            reload()
          }}
        />
      )}
    </Page>
  )
}
