interface Props {
  x: number // the point the tooltip describes, in the chart's own units
  y: number
  width: number // the chart's size, to keep the tooltip inside it
  height: number
  lines: string[] // the first is the heading
}

const lineHeight = 16
const charWidth = 6.4 // roughly, at the 11-unit font size

// A small box of text beside a point, inside an SVG chart; it flips left near the right edge.
export function ChartTooltip({ x, y, width, height, lines }: Props): React.JSX.Element {
  const boxWidth = Math.max(...lines.map((line) => line.length)) * charWidth + 20
  const boxHeight = lines.length * lineHeight + 12
  const left = x + 12 + boxWidth > width ? x - 12 - boxWidth : x + 12
  const top = Math.max(0, Math.min(height - boxHeight, y - boxHeight / 2))
  return (
    <g pointerEvents="none" aria-hidden>
      <rect
        x={left}
        y={top}
        width={boxWidth}
        height={boxHeight}
        rx={6}
        fill="var(--color-background-popover)"
        stroke="var(--color-border)"
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={left + 10}
          y={top + 20 + i * lineHeight}
          fontSize={11}
          fontWeight={i === 0 ? 600 : 400}
          fill={i === 0 ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}
        >
          {line}
        </text>
      ))}
    </g>
  )
}
