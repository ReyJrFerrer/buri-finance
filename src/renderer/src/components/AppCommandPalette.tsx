import { useEffect, useMemo, useRef, useState } from 'react'
import { CommandPalette } from '@astryxdesign/core/CommandPalette'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { useHotkeys } from '@astryxdesign/core/hooks'
import { Kbd } from '@astryxdesign/core/Kbd'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { useToast } from '@astryxdesign/core/Toast'
import { createStaticSource, type SearchableItem } from '@astryxdesign/core/Typeahead'
import type { Account, Category, Settings, TransactionRow } from '../../../shared/ipc'
import { formatMinor, formatMoney } from '../../../shared/money'
import { parseQuickAdd } from '../../../shared/quickAdd'
import { AddTransactionDialog } from '../features/transactions/AddTransactionDialog'
import { errorMessage, today } from '../lib/useQuery'

type Item = SearchableItem<{ group: string; shortcut?: string; run: () => void }>

interface Props {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  // In sidebar order; mod+1 to mod+9 jump to them. Picking a transaction opens 'transactions'.
  pages: { key: string; label: string }[]
  onNavigate: (key: string) => void
  onThemeChange: (mode: Settings['themeMode']) => void
  // Called after the palette writes data, so the visible page can reload.
  onDataChanged: () => void
}

const shortcuts = [
  { keys: 'mod+k', label: 'Open the command palette' },
  { keys: 'mod+n', label: 'Add a transaction' },
  { keys: 'mod+1', label: 'Go to a page (1 to 7, in sidebar order)' },
  { keys: 'mod+/', label: 'Show this help' },
  { keys: 'escape', label: 'Close a dialog or the palette' }
]

export function AppCommandPalette(props: Props): React.JSX.Element {
  const { isOpen, onOpenChange, pages, onNavigate, onThemeChange, onDataChanged } = props
  const showToast = useToast()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [isAdding, setAdding] = useState(false)
  const [isHelpOpen, setHelpOpen] = useState(false)
  // Items currently listed, so a selected id can be run; quick add items exist only per query.
  const shown = useRef(new Map<string, Item>())

  useEffect(() => {
    if (!isOpen && !isAdding) return
    window.api.accounts.list().then(setAccounts)
    window.api.categories.list().then(setCategories)
    if (isOpen) window.api.transactions.list().then(setTransactions)
  }, [isOpen, isAdding])

  const goTo = (key: string): void => {
    onNavigate(key)
    onOpenChange(false)
  }
  const openAdd = (): void => {
    onOpenChange(false)
    setAdding(true)
  }
  const openHelp = (): void => {
    onOpenChange(false)
    setHelpOpen(true)
  }
  useHotkeys([
    { keys: 'mod+k', onPress: () => onOpenChange(true), allowInInputs: true },
    { keys: 'mod+n', onPress: openAdd, allowInInputs: true },
    { keys: 'mod+/', onPress: openHelp, allowInInputs: true },
    ...pages.map((p, i) => ({ keys: `mod+${i + 1}`, onPress: () => goTo(p.key) }))
  ])

  const source = useMemo(() => {
    const item = (
      group: string,
      id: string,
      label: string,
      run: () => void,
      shortcut?: string
    ): Item => ({
      id,
      label,
      auxiliaryData: { group, shortcut, run }
    })
    const theme = (mode: Settings['themeMode'], label: string): Item =>
      item('Appearance', `theme:${mode}`, label, () => {
        onThemeChange(mode)
        onOpenChange(false)
      })
    const items = [
      item('Actions', 'add-transaction', 'Add transaction…', openAdd, 'mod+n'),
      ...pages.map((p, i) =>
        item('Go to', `page:${p.key}`, p.label, () => goTo(p.key), `mod+${i + 1}`)
      ),
      theme('light', 'Use light theme'),
      theme('dark', 'Use dark theme'),
      theme('system', 'Match system theme'),
      item('Help', 'help', 'Keyboard shortcuts and quick add help', openHelp, 'mod+/'),
      ...transactions.map((t) =>
        item(
          'Transactions',
          `transaction:${t.id}`,
          `${t.payee || t.memo || 'Transaction'} · ${t.date} · ${formatMoney(t.amountMinor, t.currency)}`,
          () => goTo('transactions')
        )
      )
    ]
    const staticSource = createStaticSource(items, {
      keywords: (i) => (i.id === 'help' ? ['?', 'help', 'shortcuts', 'how'] : [])
    })
    const remember = (list: Item[]): Item[] => {
      shown.current = new Map(list.map((i) => [i.id, i]))
      return list
    }

    const quickAdd = async (query: string): Promise<Item[]> => {
      const entry = parseQuickAdd(query, accounts)
      if (!entry) return []
      const { kind, amountMinor, payee, account } = entry
      const amount = formatMinor(amountMinor, account.currency)
      const label = `Add ${kind} of ${amount} · ${payee} · ${account.name} · today`
      return [
        item('Quick add', 'quick-add', label, async () => {
          onOpenChange(false)
          try {
            await window.api.transactions.create(
              kind === 'income'
                ? {
                    kind,
                    accountId: account.id,
                    amountMinor,
                    date: today(),
                    payee,
                    memo: '',
                    allocations: []
                  }
                : {
                    kind,
                    accountId: account.id,
                    amountMinor,
                    date: today(),
                    payee,
                    memo: '',
                    categoryId: null
                  }
            )
            showToast({ body: `Added ${kind} of ${amount} to ${account.name}` })
            onDataChanged()
          } catch (e) {
            showToast({ body: errorMessage(e), type: 'error' })
          }
        })
      ]
    }

    return {
      bootstrap: async () => remember(await staticSource.bootstrap()),
      search: async (query: string) =>
        remember([...(await quickAdd(query)), ...(await staticSource.search(query))])
    }
    // The handlers only close over props and setters, so the source rebuilds on data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, transactions, pages])

  return (
    <>
      <CommandPalette<Item>
        label="Command palette"
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        searchSource={source}
        emptySearchText="No matches. To add a transaction, type an amount and a description, like 120 coffee."
        renderItem={(i) => (
          <HStack justify="between" gap={3}>
            <Text>{i.label}</Text>
            {i.auxiliaryData?.shortcut && <Kbd keys={i.auxiliaryData.shortcut} />}
          </HStack>
        )}
        onValueChange={(id) => shown.current.get(id)?.auxiliaryData?.run()}
      />
      {isAdding && (
        <AddTransactionDialog
          accounts={accounts}
          categories={categories}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            showToast({ body: 'Transaction saved' })
            onDataChanged()
          }}
        />
      )}
      <Dialog isOpen={isHelpOpen} onOpenChange={setHelpOpen}>
        <Layout
          header={<DialogHeader title="Help" onOpenChange={setHelpOpen} />}
          content={
            <LayoutContent>
              <VStack gap={5}>
                <MetadataList title="Keyboard shortcuts">
                  {shortcuts.map((s) => (
                    <MetadataListItem key={s.keys} label={s.label}>
                      <Kbd keys={s.keys} />
                    </MetadataListItem>
                  ))}
                </MetadataList>
                <VStack gap={2}>
                  <Text weight="semibold">Quick add</Text>
                  <Text>
                    Open the palette and type an amount followed by a description to record an
                    expense dated today, for example “120 coffee”. Start with + to record income
                    (“+25,000 salary”). End with @ and part of an account name to choose the account
                    (“120 coffee @gcash”); otherwise the first account is used. Quick add leaves
                    expenses uncategorized and skips the income allocation step; use Add transaction
                    for those.
                  </Text>
                </VStack>
              </VStack>
            </LayoutContent>
          }
        />
      </Dialog>
    </>
  )
}
