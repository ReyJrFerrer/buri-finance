import { VStack } from '@astryxdesign/core/Stack'
import { Heading, Text } from '@astryxdesign/core/Text'
import { Selector } from '@astryxdesign/core/Selector'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { themeModeSchema, type Settings } from '../../../../shared/ipc'

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
}

export function SettingsPage({ settings, onChange }: Props): React.JSX.Element {
  return (
    <VStack gap={6}>
      <Heading level={3}>Settings</Heading>
      <VStack gap={2}>
        <Text type="body">Appearance</Text>
        <SegmentedControl
          label="Appearance"
          value={settings.themeMode}
          onChange={(value) => onChange({ themeMode: themeModeSchema.parse(value) })}
        >
          <SegmentedControlItem value="system" label="System" />
          <SegmentedControlItem value="light" label="Light" />
          <SegmentedControlItem value="dark" label="Dark" />
        </SegmentedControl>
      </VStack>
      <Selector
        label="Week starts on"
        description="Used for weekly budgets."
        options={weekdays.map((label, day) => ({ value: String(day), label }))}
        value={String(settings.weekStart)}
        onChange={(value) => onChange({ weekStart: Number(value) })}
        width={240}
      />
    </VStack>
  )
}
