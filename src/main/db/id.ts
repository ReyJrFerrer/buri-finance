import { randomBytes } from 'crypto'

let lastTimestamp = 0

// UUIDv7: 48-bit millisecond timestamp, then random bits, so ids sort by creation time.
// Ids made in the same millisecond take the next one, so order within this device is strict.
export function uuidv7(): string {
  const b = randomBytes(16)
  lastTimestamp = Math.max(Date.now(), lastTimestamp + 1)
  b.writeUIntBE(lastTimestamp, 0, 6)
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
