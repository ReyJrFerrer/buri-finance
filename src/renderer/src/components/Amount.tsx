import { Text } from '@astryxdesign/core/Text'
import { formatMinor } from '../../../shared/money'

export function Amount({
  minor,
  currency
}: {
  minor: number
  currency: string
}): React.JSX.Element {
  return (
    <Text hasTabularNumbers textWrap="nowrap">
      {formatMinor(minor, currency)}
    </Text>
  )
}
