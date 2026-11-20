interface Props {
  label: string // what the bar shows, for screen readers
  segments: { value: number; color: string }[] // drawn left to right; color is a CSS colour token
  max: number
  tick?: number // a marker at this share of the bar, 0 to 1
}

// A horizontal bar of one or more coloured segments on a track, with an optional tick.
export function Meter({ label, segments, max, tick }: Props): React.JSX.Element {
  const share = (value: number): number => (max > 0 ? Math.max(0, Math.min(1, value / max)) : 0)
  const hasTick = tick !== undefined
  const top = hasTick ? 5 : 0
  const starts = segments.map((_, i) =>
    segments.slice(0, i).reduce((sum, s) => sum + share(s.value), 0)
  )
  return (
    <svg width="100%" height={hasTick ? 16 : 8} role="img" aria-label={label}>
      <rect y={top} width="100%" height={6} rx={3} fill="var(--color-chart-track)" />
      {segments.map((segment, i) => (
        <rect
          key={i}
          x={`${starts[i] * 100}%`}
          y={top}
          width={`${share(segment.value) * 100}%`}
          height={6}
          rx={3}
          fill={segment.color}
        />
      ))}
      {hasTick && (
        <rect
          x={`${share(tick * max) * 100}%`}
          width={2}
          height={16}
          rx={1}
          transform="translate(-1 0)"
          fill="var(--color-chart-tick)"
        />
      )}
    </svg>
  )
}
