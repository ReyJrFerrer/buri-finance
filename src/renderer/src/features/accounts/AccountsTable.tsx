import { Table, type TableColumn } from '@astryxdesign/core/Table'
import type { Account } from '../../../../shared/ipc'
import { Amount } from '../../components/Amount'

const columns: TableColumn<Account>[] = [
  { key: 'name', header: 'Account' },
  { key: 'institution', header: 'Institution', renderCell: (a) => a.institution ?? '' },
  { key: 'type', header: 'Type', renderCell: (a) => (a.type === 'asset' ? 'Asset' : 'Liability') },
  {
    key: 'balanceMinor',
    header: 'Balance',
    align: 'end',
    renderCell: (a) => <Amount minor={a.balanceMinor} currency={a.currency} />
  }
]

export function AccountsTable({ accounts }: { accounts: Account[] }): React.JSX.Element {
  return <Table data={accounts} columns={columns} idKey="id" hasHover />
}
