import { currencySymbol, formatMoney } from '../../../shared/money'
import { useChartHover } from '../lib/useChartHover'
import { ChartTooltip } from './ChartTooltip'

interface Props {
  days: number // days in the month
  spent: number[] // cumulative spending at the end of day 1, 2, … through today
  budgetMinor: number // the month's budget; 0 draws no pace line
  today?: number // the day of the month to mark, when the month is the current one
  currency: string
  dayLabel: (day: number) => string // as in "Nov 1"
  note?: { day: number; text: string } // names the spending on one day, shown when hovered
}

const width = 600
const height = 220
const left = 44
const right = 16
const top = 12
const bottom = 28
const plotWidth = width - left - right
const plotHeight = height - top - bottom
const text = { fontSize: 11, fill: 'var(--color-text-secondary)' }

// Whole units for chart labels: "₱15,000", or "₱60k" when compact.
const whole = (minor: number, currency: string): string =>
  formatMoney(minor - (minor % 100), currency).replace(/\.00$/, '')
const compact = (minor: number, currency: string): string =>
  minor >= 100_000 ? `${currencySymbol(currency)}${minor / 100_000}k` : whole(minor, currency)

// A round step so three gridlines reach past `max`.
function niceStep(max: number): number {
  const raw = Math.max(max, 300) / 3
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10
  return step * power
}

// Spending so far this month against a straight line from nothing to the whole budget.
// Hovering a day shows what was spent by then against the pace.
export function PaceChart(props: Props): React.JSX.Element {
  const { days, spent, budgetMinor, today, currency, dayLabel, note } = props
  const [hoveredIndex, handlers] = useChartHover(
    days,
    (share) => Math.max(1, Math.round(((share * width - left) / plotWidth) * days)) - 1,
    (today ?? Math.max(spent.length, 1)) - 1
  )
  const hovered = hoveredIndex === undefined ? undefined : hoveredIndex + 1
  const step = niceStep(Math.max(budgetMinor, ...spent))
  const yMax = step * 3
  const x = (day: number): number => left + (day / days) * plotWidth
  const y = (minor: number): number => top + plotHeight - (minor / yMax) * plotHeight
  const pace = (day: number): number => Math.round((budgetMinor * day) / days)
  const line = [0, ...spent].map((minor, day) => `${x(day)},${y(minor)}`).join(' ')
  const spentToday = today ? spent[today - 1] : undefined
  const paceToday = today ? pace(today) : undefined
  const hasMarker = today !== undefined && spentToday !== undefined && budgetMinor > 0
  const markerX = today ? x(today) : 0
  const hoveredSpent = hovered && hovered <= spent.length ? spent[hovered - 1] : undefined
  const hoveredLines = (day: number): string[] => {
    const gap = pace(day) - (hoveredSpent ?? 0)
    return [
      `${dayLabel(day)}${day === today ? ' · Today' : ''}`,
      ...(note?.day === day ? [note.text] : []),
      ...(hoveredSpent !== undefined ? [`${whole(hoveredSpent, currency)} spent`] : []),
      ...(budgetMinor > 0 ? [`${whole(pace(day), currency)} even pace`] : []),
      ...(hoveredSpent !== undefined && budgetMinor > 0
        ? [`${whole(Math.abs(gap), currency)} ${gap >= 0 ? 'under' : 'over'} pace`]
        : [])
    ]
  }
  const ticks = [0, 10, 20].filter((day) => !today || Math.abs(day - today) > 3)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      {...handlers}
      role="img"
      aria-label={
        hasMarker
          ? `${whole(spentToday ?? 0, currency)} spent by day ${today} against an even pace of ${whole(paceToday ?? 0, currency)}`
          : `${whole(spent[spent.length - 1] ?? 0, currency)} spent this month`
      }
    >
      {today !== undefined && (
        <rect
          x={x(today)}
          y={top}
          width={x(days) - x(today)}
          height={plotHeight}
          fill="var(--color-chart-future)"
        />
      )}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <line
            x1={left}
            x2={x(days)}
            y1={y(step * i)}
            y2={y(step * i)}
            stroke="var(--color-chart-track)"
          />
          <text x={left - 8} y={y(step * i) + 4} textAnchor="end" {...text}>
            {compact(step * i, currency)}
          </text>
        </g>
      ))}
      {budgetMinor > 0 && (
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(days)}
          y2={y(budgetMinor)}
          stroke="var(--color-chart-pace)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      )}
      {spent.length > 0 && (
        <polyline
          points={line}
          fill="none"
          stroke="var(--color-chart-blue)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}
      {today !== undefined && (
        <line
          x1={markerX}
          x2={markerX}
          y1={top}
          y2={top + plotHeight}
          stroke="var(--color-chart-pace)"
          strokeDasharray="2 3"
        />
      )}
      {hasMarker && (
        <g>
          <line
            x1={markerX + 10}
            x2={markerX + 10}
            y1={y(spentToday ?? 0)}
            y2={y(paceToday ?? 0)}
            stroke="var(--color-chart-marker)"
            strokeWidth={2}
          />
          <circle
            cx={markerX}
            cy={y(paceToday ?? 0)}
            r={4}
            fill="var(--color-background-card)"
            stroke="var(--color-chart-pace)"
            strokeWidth={1.5}
          />
          <circle cx={markerX} cy={y(spentToday ?? 0)} r={4} fill="var(--color-chart-blue)" />
        </g>
      )}
      {ticks.map((day) => (
        <text key={day} x={x(day)} y={height - 8} textAnchor="start" {...text}>
          {day === 0 ? dayLabel(1) : day}
        </text>
      ))}
      {today !== undefined && (
        <text
          x={markerX}
          y={height - 8}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="var(--color-text-primary)"
        >
          Today
        </text>
      )}
      {(!today || days - today > 3) && (
        <text x={x(days)} y={height - 8} textAnchor="end" {...text}>
          {days}
        </text>
      )}
      {hovered !== undefined && (
        <g>
          <line
            x1={x(hovered)}
            x2={x(hovered)}
            y1={top}
            y2={top + plotHeight}
            stroke="var(--color-chart-tick)"
            strokeOpacity={0.5}
          />
          {budgetMinor > 0 && (
            <circle
              cx={x(hovered)}
              cy={y(pace(hovered))}
              r={3.5}
              fill="var(--color-background-card)"
              stroke="var(--color-chart-pace)"
              strokeWidth={1.5}
            />
          )}
          {hoveredSpent !== undefined && (
            <circle cx={x(hovered)} cy={y(hoveredSpent)} r={4} fill="var(--color-chart-blue)" />
          )}
          <ChartTooltip
            x={x(hovered)}
            y={y(hoveredSpent ?? pace(hovered))}
            width={width}
            height={height}
            lines={hoveredLines(hovered)}
          />
        </g>
      )}
    </svg>
  )
}
