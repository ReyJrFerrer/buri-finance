import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Page } from '../../components/Page'
import { useQuery } from '../../lib/useQuery'
import { AccountsTable } from './AccountsTable'
import { AddAccountDialog } from './AddAccountDialog'
import { EditAccountDialog } from './EditAccountDialog'
import type { Account } from '../../../../shared/ipc'

export function AccountsPage(): React.JSX.Element {
  const [accounts, reload] = useQuery(window.api.accounts.list)
  const [isAdding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Account>()
  const addButton = <Button label="Add account" variant="primary" onClick={() => setAdding(true)} />

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
      {!!accounts?.length && (
        <AccountsTable accounts={accounts} onEdit={setEditing} onDeleted={reload} />
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
