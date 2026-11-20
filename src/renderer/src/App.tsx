import { useEffect, useMemo, useState } from 'react'
import { Theme } from '@astryxdesign/core/theme'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Icon } from '@astryxdesign/core/Icon'
import { NavIcon } from '@astryxdesign/core/NavIcon'
import { CommandPalette } from '@astryxdesign/core/CommandPalette'
import { createStaticSource } from '@astryxdesign/core/Typeahead'
import { useHotkeys } from '@astryxdesign/core/hooks'
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import {
  ArrowsRightLeftIcon,
  BanknotesIcon,
  ChartPieIcon,
  Cog6ToothIcon,
  FlagIcon,
  HomeIcon,
  PresentationChartLineIcon,
  WalletIcon
} from '@heroicons/react/24/outline'
import { themes, defaultThemeSlug } from '../../astryx-themes'
import type { Settings, TransactionRow } from '../../shared/ipc'
import { formatMoney } from '../../shared/money'
import { AccountsPage } from './features/accounts/AccountsPage'
import { BudgetsPage } from './features/budgets/BudgetsPage'
import { GoalsPage } from './features/goals/GoalsPage'
import { InvestmentsPage } from './features/investments/InvestmentsPage'
import { OverviewPage } from './features/overview/OverviewPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TransactionsPage } from './features/transactions/TransactionsPage'

const pages = {
  overview: { label: 'Overview', icon: HomeIcon },
  accounts: { label: 'Accounts', icon: WalletIcon },
  transactions: { label: 'Transactions', icon: ArrowsRightLeftIcon },
  budgets: { label: 'Budgets', icon: ChartPieIcon },
  goals: { label: 'Goals', icon: FlagIcon },
  investments: { label: 'Investments', icon: PresentationChartLineIcon },
  settings: { label: 'Settings', icon: Cog6ToothIcon }
} as const
type PageKey = keyof typeof pages
const pageKeys = Object.keys(pages) as PageKey[]

function App(): React.JSX.Element {
  const [page, setPage] = useState<PageKey>('overview')
  const [settings, setSettings] = useState<Settings>()
  const [isPaletteOpen, setPaletteOpen] = useState(false)
  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  // Pages first, then transactions; picking a transaction opens the Transactions page.
  const paletteSource = useMemo(
    () =>
      createStaticSource([
        ...pageKeys.map((key) => ({ id: key, label: pages[key].label })),
        ...transactions.map((t) => ({
          id: `transactions:${t.id}`,
          label: `${t.payee || t.memo || 'Transaction'} · ${t.date} · ${formatMoney(t.amountMinor, t.currency)}`
        }))
      ]),
    [transactions]
  )

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])
  useEffect(() => {
    if (isPaletteOpen) window.api.transactions.list().then(setTransactions)
  }, [isPaletteOpen])
  useHotkeys([{ keys: 'mod+k', onPress: () => setPaletteOpen(true), allowInInputs: true }])

  const updateSettings = (patch: Partial<Settings>): void => {
    window.api.settings.update(patch).then(setSettings)
  }

  const navItem = (key: PageKey): React.JSX.Element => (
    <SideNavItem
      key={key}
      label={pages[key].label}
      icon={pages[key].icon}
      isSelected={page === key}
      onClick={() => setPage(key)}
    />
  )

  const content = (): React.ReactNode => {
    const goToAccounts = (): void => setPage('accounts')
    switch (page) {
      case 'overview':
        return (
          <OverviewPage
            onAddAccount={goToAccounts}
            onNavigate={setPage}
            onSearch={() => setPaletteOpen(true)}
          />
        )
      case 'accounts':
        return <AccountsPage />
      case 'transactions':
        return <TransactionsPage onAddAccount={goToAccounts} />
      case 'budgets':
        return <BudgetsPage />
      case 'goals':
        return <GoalsPage />
      case 'investments':
        return <InvestmentsPage onAddAccount={goToAccounts} />
      case 'settings':
        return settings && <SettingsPage settings={settings} onChange={updateSettings} />
    }
  }

  return (
    <Theme theme={themes[defaultThemeSlug]} mode={settings?.themeMode ?? 'system'}>
      <AppShell
        contentPadding={6}
        sideNav={
          <SideNav
            header={
              <SideNavHeading
                icon={<NavIcon icon={<Icon icon={BanknotesIcon} size="sm" />} />}
                heading="Buri Finance"
              />
            }
          >
            <SideNavSection title="Main" isHeaderHidden>
              {pageKeys.filter((key) => key !== 'settings').map(navItem)}
            </SideNavSection>
            <SideNavSection title="App">{navItem('settings')}</SideNavSection>
          </SideNav>
        }
      >
        {content()}
      </AppShell>
      <CommandPalette
        label="Go to page"
        isOpen={isPaletteOpen}
        onOpenChange={setPaletteOpen}
        searchSource={paletteSource}
        onValueChange={(id) => {
          setPage(id.startsWith('transactions:') ? 'transactions' : (id as PageKey))
          setPaletteOpen(false)
        }}
      />
    </Theme>
  )
}

export default App
