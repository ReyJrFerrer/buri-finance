import { Fragment, useEffect, useState } from 'react'
import { Theme } from '@astryxdesign/core/theme'
import { AppShell } from '@astryxdesign/core/AppShell'
import { ToastViewport } from '@astryxdesign/core/Toast'
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import {
  ArrowsRightLeftIcon,
  ChartPieIcon,
  Cog6ToothIcon,
  FlagIcon,
  HomeIcon,
  PresentationChartLineIcon,
  WalletIcon
} from '@heroicons/react/24/outline'
import { themes, defaultThemeSlug } from '../../astryx-themes'
import type { Settings } from '../../shared/ipc'
import { AppCommandPalette } from './components/AppCommandPalette'
import { AppLogo } from './components/AppLogo'
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
  // Bumped when the palette adds data, remounting the page so it reloads.
  const [dataVersion, setDataVersion] = useState(0)

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])

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
          <SideNav header={<SideNavHeading icon={<AppLogo />} heading="Buri Finance" />}>
            <SideNavSection title="Main" isHeaderHidden>
              {pageKeys.filter((key) => key !== 'settings').map(navItem)}
            </SideNavSection>
            <SideNavSection title="App">{navItem('settings')}</SideNavSection>
          </SideNav>
        }
      >
        <Fragment key={dataVersion}>{content()}</Fragment>
      </AppShell>
      <ToastViewport>
        <AppCommandPalette
          isOpen={isPaletteOpen}
          onOpenChange={setPaletteOpen}
          pages={pageKeys.map((key) => ({ key, label: pages[key].label }))}
          onNavigate={(key) => setPage(key as PageKey)}
          onThemeChange={(themeMode) => updateSettings({ themeMode })}
          onDataChanged={() => setDataVersion((v) => v + 1)}
        />
      </ToastViewport>
    </Theme>
  )
}

export default App
