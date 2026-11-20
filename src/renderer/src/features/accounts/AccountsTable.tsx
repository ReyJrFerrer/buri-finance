import { HStack } from '@astryxdesign/core/Stack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Table, pixel, type TableColumn } from '@astryxdesign/core/Table'
import { PencilIcon } from '@heroicons/react/24/outline'
import type { Account } from '../../../../shared/ipc'
import { Amount } from '../../components/Amount'
import { DeleteButton } from '../../components/DeleteButton'
import { moneyWidth, nameWidth } from '../../lib/table'

interface Actions {
  onEdit: (account: Account) => void
  onDeleted: () => void
}

const columns = ({ onEdit, onDeleted }: Actions): TableColumn<Account>[] => [
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
  },
  {
    key: 'id',
    header: '',
    align: 'end',
    width: pixel(96),
    renderCell: (a) => (
      <HStack gap={1} hAlign="end">
        <IconButton
          label={`Edit account ${a.name}`}
          icon={<Icon icon={PencilIcon} />}
          variant="ghost"
          size="sm"
          onClick={() => onEdit(a)}
        />
        <DeleteButton
          label={`Delete account ${a.name}`}
          title={`Delete ${a.name}?`}
          description="The account and its income, expense and opening-balance transactions are removed."
          onDelete={() => window.api.accounts.remove(a.id).then(onDeleted)}
        />
      </HStack>
    )
  }
]

const readOnly = columns({ onEdit: () => {}, onDeleted: () => {} }).slice(0, -1)

// Without actions (the overview) the table is read-only.
export function AccountsTable(
  props: Partial<Actions> & { accounts: Account[] }
): React.JSX.Element {
  return (
    <Table
      data={props.accounts}
      columns={props.onEdit && props.onDeleted ? columns(props as Actions) : readOnly}
      idKey="id"
      hasHover
    />
  )
}
