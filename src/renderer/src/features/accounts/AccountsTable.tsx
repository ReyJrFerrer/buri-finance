import { Card } from '@astryxdesign/core/Card'
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Table, pixel, type TableColumn } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { FlagIcon, PencilIcon } from '@heroicons/react/24/outline'
import type { Account, Goal } from '../../../../shared/ipc'
import { formatMoney } from '../../../../shared/money'
import { Amount } from '../../components/Amount'
import { DeleteButton } from '../../components/DeleteButton'
import { moneyWidth, nameWidth } from '../../lib/table'

interface Actions {
  goals: Goal[] // to warn that goals linked to an account are deleted with it
  onEdit: (account: Account) => void
  onDeleted: () => void
  onDeleteError: (account: Account, message: string) => void
}

const removed = 'The account and its income, expense and opening-balance transactions are removed.'

// Each goal deleted along with an account, highlighted so it is not missed.
const goalCards = (linked: Goal[]): React.JSX.Element => (
  <VStack gap={2}>
    {linked.map((g) => (
      <Card key={g.id} variant="warm" padding={3}>
        <HStack gap={3} vAlign="center">
          <Icon icon={FlagIcon} color="orange" size="sm" />
          <StackItem size="fill">
            <VStack gap={0.5}>
              <Text weight="semibold" color="warm">
                {g.name}
              </Text>
              <Text type="supporting" hasTabularNumbers>
                Goal · {formatMoney(g.savedMinor, g.currency)} of{' '}
                {formatMoney(g.targetMinor, g.currency)}
              </Text>
            </VStack>
          </StackItem>
        </HStack>
      </Card>
    ))}
  </VStack>
)

const columns = ({ goals, onEdit, onDeleted, onDeleteError }: Actions): TableColumn<Account>[] => [
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
    renderCell: (a) => {
      const linked = goals.filter((g) => g.accountId === a.id)
      return (
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
            description={
              linked.length
                ? `${removed} ${linked.length === 1 ? 'This goal is linked to it and is' : 'These goals are linked to it and are'} deleted too:`
                : removed
            }
            details={linked.length ? goalCards(linked) : undefined}
            onDelete={() => window.api.accounts.remove(a.id, linked.length > 0).then(onDeleted)}
            onError={(message) => onDeleteError(a, message)}
          />
        </HStack>
      )
    }
  }
]

const noop = (): void => {}
const readOnly = columns({
  goals: [],
  onEdit: noop,
  onDeleted: noop,
  onDeleteError: noop
}).slice(0, -1)

// Without actions (the overview) the table is read-only.
export function AccountsTable(
  props: Partial<Actions> & { accounts: Account[] }
): React.JSX.Element {
  return (
    <Table
      data={props.accounts}
      columns={
        props.goals && props.onEdit && props.onDeleted && props.onDeleteError
          ? columns(props as Actions)
          : readOnly
      }
      idKey="id"
      hasHover
    />
  )
}
