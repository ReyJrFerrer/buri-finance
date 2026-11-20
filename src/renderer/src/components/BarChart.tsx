import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { formatMinor } from '../../../shared/money'

interface Props {
  title: string
  bars: { label: string; minor: number }[] // in order; one bar each, zero or less draws nothing
  currency: string
  emptyText: string
}

const height = 40
const step = 10 // viewBox units per bar, of which 7 are the bar

// A bar per entry, scaled to the tallest. The first and last labels mark the ends of the axis.
export function BarChart({ title, bars, currency, emptyText }: Props): React.JSX.Element {
  const max = Math.max(0, ...bars.map((b) => b.minor))
  const peak = bars.find((b) => b.minor === max)

  return (
    <VStack gap={3}>
      <Text weight="medium">{title}</Text>
      {max === 0 || !peak ? (
        <Text type="supporting">{emptyText}</Text>
      ) : (
        <VStack gap={1}>
          <svg
            viewBox={`0 0 ${bars.length * step} ${height}`}
            width="100%"
            height={128}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${title}: highest ${formatMinor(max, currency)} on ${peak.label}`}
          >
            {bars.map((bar, i) => {
              const barHeight = bar.minor > 0 ? Math.max(1, (bar.minor / max) * height) : 0
              return (
                <rect
                  key={bar.label}
                  x={i * step}
                  y={height - barHeight}
                  width={7}
                  height={barHeight}
                  rx={1}
                  fill="var(--color-data-categorical-blue)"
                >
                  <title>{`${bar.label}: ${formatMinor(bar.minor, currency)}`}</title>
                </rect>
              )
            })}
          </svg>
          <HStack hAlign="between">
            <Text type="supporting">{bars[0].label}</Text>
            <Text type="supporting" hasTabularNumbers>
              Highest {formatMinor(max, currency)} on {peak.label}
            </Text>
            <Text type="supporting">{bars[bars.length - 1].label}</Text>
          </HStack>
        </VStack>
      )}
    </VStack>
  )
}
