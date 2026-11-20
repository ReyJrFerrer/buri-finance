import { useState } from 'react'

type SvgHandlers = Pick<
  React.SVGProps<SVGSVGElement>,
  'tabIndex' | 'onPointerMove' | 'onPointerLeave' | 'onFocus' | 'onBlur' | 'onKeyDown'
>

// The point of a chart under the pointer, or picked with the arrow keys once the chart has focus.
// `toIndex` maps a position across the chart (0 to 1) to a point; `initial` is where keys start.
export function useChartHover(
  count: number,
  toIndex: (share: number) => number,
  initial: number
): [number | undefined, SvgHandlers] {
  const [index, setIndex] = useState<number>()
  const clamp = (i: number): number => Math.max(0, Math.min(count - 1, i))
  return [
    index,
    {
      tabIndex: 0,
      onPointerMove: (e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        setIndex(clamp(toIndex((e.clientX - rect.left) / rect.width)))
      },
      onPointerLeave: () => setIndex(undefined),
      onFocus: () => setIndex(clamp(initial)),
      onBlur: () => setIndex(undefined),
      onKeyDown: (e) => {
        const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        if (step) {
          e.preventDefault()
          setIndex((i) => clamp((i ?? initial) + step))
        } else if (e.key === 'Escape') setIndex(undefined)
      }
    }
  ]
}
