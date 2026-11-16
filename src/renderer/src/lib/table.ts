import { proportional } from '@astryxdesign/core/Table'

// Money columns never shrink below a full amount such as "PHP 1,234,567.89"; a table that
// cannot fit scrolls sideways instead of clipping figures.
export const moneyWidth = proportional(1, { minWidth: 130 })
export const nameWidth = proportional(1.5, { minWidth: 120 })
