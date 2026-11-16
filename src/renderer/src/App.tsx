import { useEffect, useMemo, useState } from 'react'
import { Theme } from '@astryxdesign/core/theme'
import { AppShell } from '@astryxdesign/core/AppShell'
import { EmptyState } from '@astryxdesign/core/EmptyState'
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
import type { Settings } from '../../shared/ipc'
import { SettingsPage } from './features/settings/SettingsPage'

const pages = {
  overview: { label: 'Overview', icon: HomeIcon, empty: 'Add an account to see your net worth.' },
  accounts: { label: 'Accounts', icon: WalletIcon, empty: 'Add your first account to start.' },
  transactions: {
    label: 'Transactions',
    icon: ArrowsRightLeftIcon,
    empty: 'Add an account, then record your first transaction.'
  },
  budgets: { label: 'Budgets', icon: ChartPieIcon, empty: 'Create a category to start budgeting.' },
  goals: { label: 'Goals', icon: FlagIcon, empty: 'Add a savings goal to track progress.' },
  investments: {
    label: 'Investments',
    icon: PresentationChartLineIcon,
    empty: 'Add a broker account to track holdings.'
  },
  settings: { label: 'Settings', icon: Cog6ToothIcon, empty: '' }
} as const
type PageKey = keyof typeof pages
const pageKeys = Object.keys(pages) as PageKey[]

function App(): React.JSX.Element {
  const [page, setPage] = useState<PageKey>('overview')
  const [settings, setSettings] = useState<Settings>()
  const [isPaletteOpen, setPaletteOpen] = useState(false)
  const paletteSource = useMemo(
    () => createStaticSource(pageKeys.map((key) => ({ id: key, label: pages[key].label }))),
    []
  )

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])
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
        {page === 'settings' ? (
          settings && <SettingsPage settings={settings} onChange={updateSettings} />
        ) : (
          <EmptyState title={pages[page].label} description={pages[page].empty} headingLevel={1} />
        )}
      </AppShell>
      <CommandPalette
        label="Go to page"
        isOpen={isPaletteOpen}
        onOpenChange={setPaletteOpen}
        searchSource={paletteSource}
        onValueChange={(id) => {
          setPage(id as PageKey)
          setPaletteOpen(false)
        }}
      />
    </Theme>
  )
}

export default App
