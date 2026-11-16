import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { formatMinor } from '../../../shared/money'
import { Amount } from './Amount'

export interface PieSlice {
  label: string
  minor: number
  isNeutral?: boolean // drawn in the neutral data colour, for "unallocated" and similar
}

interface Props {
  title: string
  slices: PieSlice[]
  currency: string
  emptyText: string
}

const palette = [
  'blue',
  'orange',
  'purple',
  'green',
  'pink',
  'cyan',
  'red',
  'teal',
  'brown',
  'indigo'
].map((name) => `var(--color-data-categorical-${name})`)
const radius = 100 / (2 * Math.PI) // circumference of 100 viewBox units

// A donut chart with a legend. Colours follow each slice's position in `slices`, so charts fed
// the same list in the same order colour a category alike. Only positive amounts are drawn.
export function PieChart({ title, slices, currency, emptyText }: Props): React.JSX.Element {
  const shown = slices
    .map((slice, index) => ({
      ...slice,
      color: slice.isNeutral ? 'var(--color-data-neutral)' : palette[index % palette.length]
    }))
    .filter((slice) => slice.minor > 0)
  const total = shown.reduce((sum, s) => sum + s.minor, 0)
  const starts = shown.map((_, i) => shown.slice(0, i).reduce((sum, s) => sum + s.minor, 0))
  const summary = shown.map((s) => `${s.label} ${formatMinor(s.minor, currency)}`).join(', ')

  return (
    <VStack gap={3}>
      <Text weight="medium">{title}</Text>
      {total === 0 ? (
        <Text type="supporting">{emptyText}</Text>
      ) : (
        <HStack gap={4} vAlign="center">
          <svg
            viewBox="0 0 40 40"
            width={128}
            height={128}
            role="img"
            aria-label={`${title}: ${summary}`}
          >
            {shown.map((s, i) => (
              <circle
                key={s.label}
                cx={20}
                cy={20}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={7}
                pathLength={total}
                strokeDasharray={`${s.minor} ${total - s.minor}`}
                strokeDashoffset={-starts[i]}
                transform="rotate(-90 20 20)"
              />
            ))}
          </svg>
          <StackItem size="fill">
            <VStack gap={1}>
              {shown.map((s) => (
                <HStack key={s.label} gap={2} vAlign="center" hAlign="between">
                  <HStack gap={2} vAlign="center">
                    <svg viewBox="0 0 10 10" width={10} height={10} aria-hidden>
                      <rect width={10} height={10} rx={2} fill={s.color} />
                    </svg>
                    <Text>{s.label}</Text>
                  </HStack>
                  <HStack gap={2} vAlign="center">
                    <Text type="supporting" hasTabularNumbers>
                      {Math.round((s.minor * 100) / total)}%
                    </Text>
                    <Amount minor={s.minor} currency={currency} />
                  </HStack>
                </HStack>
              ))}
            </VStack>
          </StackItem>
        </HStack>
      )}
    </VStack>
  )
}
