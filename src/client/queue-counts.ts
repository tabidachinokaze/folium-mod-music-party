import type { RoomQueueEntry } from '@party/shared/types'

// src/client/queue-counts.ts
type CountedEntry = RoomQueueEntry & { upCountKnown?: boolean }

/** The shared parser defaults omitted upCnt to zero; keep absence distinct at the boundary. */
export function withPromotionCount(entry: RoomQueueEntry, value: unknown): CountedEntry {
  const number =
    typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))
      ? Number(value)
      : NaN
  const known = Number.isSafeInteger(number) && number >= 0
  return { ...entry, upCount: known ? number : 0, upCountKnown: known }
}

export function promotionCount(entry: RoomQueueEntry): number | undefined {
  if ((entry as CountedEntry).upCountKnown === false) return undefined
  return Number.isSafeInteger(entry.upCount) && entry.upCount >= 0 ? entry.upCount : undefined
}
