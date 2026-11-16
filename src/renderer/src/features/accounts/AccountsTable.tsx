import { Table, type TableColumn } from '@astryxdesign/core/Table'
import type { Account } from '../../../../shared/ipc'
import { Amount } from '../../components/Amount'
import { moneyWidth, nameWidth } from '../../lib/table'

const columns: TableColumn<Account>[] = [
  { key: 'name', header: 'Account', width: nameWidth },
  { key: 'institution', header: 'Institution', renderCell: (a) => a.institution ?? '' },
  { key: 'type', header: 'Type', renderCell: (a) => (a.type === 'asset' ? 'Asset' : 'Liability') },
  {
    key: 'holdingsMinor',
    header: 'Holdings',
    align: 'end',
    width: moneyWidth,
    renderCell: (a) =>
      a.holdingsMinor ? <Amount minor={a.holdingsMinor} currency={a.currency} /> : ''
  },
  {
    key: 'balanceMinor',
    header: 'Cash balance',
    align: 'end',
    width: moneyWidth,
    renderCell: (a) => <Amount minor={a.balanceMinor} currency={a.currency} />
  }
]

export function AccountsTable({ accounts }: { accounts: Account[] }): React.JSX.Element {
  return <Table data={accounts} columns={columns} idKey="id" hasHover />
}
