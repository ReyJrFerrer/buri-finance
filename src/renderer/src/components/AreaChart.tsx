import { useEffect, useRef, useState } from 'react'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { useChartHover } from '../lib/useChartHover'
import { ChartTooltip } from './ChartTooltip'

interface Props {
  label: string // a summary for screen readers
  values: number[] // evenly spaced, oldest first
  axis: [string, string, string] // labels for the start, middle and end
  tooltip: (index: number) => string[] // what to show for a hovered point; the first line leads
}

const height = 64

// A filled line over time, scaled between the lowest and highest value. Hovering shows a point.
export function AreaChart({ label, values, axis, tooltip }: Props): React.JSX.Element {
  const ref = useRef<SVGSVGElement>(null)
  // Drawn in real pixels so the tooltip text is not stretched with the chart.
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const svg = ref.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || 600))
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])
  const last = values.length - 1
  const [hovered, handlers] = useChartHover(
    values.length,
    (share) => Math.round(share * last),
    last
  )

  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min
  // The lowest point sits a little above the bottom so a fall still shows as filled area.
  const y = (v: number): number =>
    range === 0 ? height / 2 : height - ((v - min + range / 4) / (range * 1.25)) * height
  const x = (i: number): number => (last > 0 ? (i / last) * width : 0)
  const line = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')

  return (
    <VStack gap={1}>
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        overflow="visible"
        role="img"
        aria-label={label}
        {...handlers}
      >
        <polygon
          points={`0,${height} ${line} ${x(last)},${height}`}
          fill="var(--color-chart-blue-fill)"
        />
        <polyline points={line} fill="none" stroke="var(--color-chart-blue)" strokeWidth={1.5} />
        {hovered !== undefined && (
          <g>
            <line
              x1={x(hovered)}
              x2={x(hovered)}
              y1={0}
              y2={height}
              stroke="var(--color-chart-pace)"
              strokeDasharray="2 3"
            />
            <circle cx={x(hovered)} cy={y(values[hovered])} r={4} fill="var(--color-chart-blue)" />
            <ChartTooltip
              x={x(hovered)}
              y={y(values[hovered])}
              width={width}
              height={height}
              lines={tooltip(hovered)}
            />
          </g>
        )}
      </svg>
      <HStack hAlign="between">
        {axis.map((text) => (
          <Text key={text} type="supporting" size="xsm">
            {text}
          </Text>
        ))}
      </HStack>
    </VStack>
  )
}
