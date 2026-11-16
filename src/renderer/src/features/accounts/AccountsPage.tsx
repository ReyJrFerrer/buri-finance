import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Page } from '../../components/Page'
import { useQuery } from '../../lib/useQuery'
import { AccountsTable } from './AccountsTable'
import { AddAccountDialog } from './AddAccountDialog'

export function AccountsPage(): React.JSX.Element {
  const [accounts, reload] = useQuery(window.api.accounts.list)
  const [isAdding, setAdding] = useState(false)
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
      {!!accounts?.length && <AccountsTable accounts={accounts} />}
      {isAdding && (
        <AddAccountDialog
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            reload()
          }}
        />
      )}
    </Page>
  )
}
