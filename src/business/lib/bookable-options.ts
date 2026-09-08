import type { SellResourceLane, SellStaffLane } from './canon-logic/availability'
import { trackFree } from './canon-logic/availability'

export interface OptionResource extends SellResourceLane {
  stores?: string[] | null
  roomClass?: 'standard' | 'private' | null
  cleanupMinutes?: number
}

export interface BookableOption {
  laneKey: string
  start: number
  end: number
  /** Eligibility witnesses, not reservations. Revalidate when booking. */
  resourceKeys: string[]
}

/** Each option is independently bookable against committed occupancy. Options
 * never consume one another's beds. Fixed grid starts do not re-phase when
 * adjacent free pockets merge after a cancellation. */
export function bookableOptions(input: {
  staffLanes: readonly SellStaffLane[]
  resourceLanes: readonly OptionResource[]
  open: number
  close: number
  now: number | null
  gridMin: number
  durationMin: number
  requiresPrivateRoom?: boolean
  privateIsLastResort?: boolean
}): BookableOption[] {
  if (![input.open, input.close, input.now ?? input.open].every(Number.isFinite) || !Number.isFinite(input.gridMin) || input.gridMin <= 0 || !Number.isFinite(input.durationMin) || input.durationMin <= 0) return []
  const first = Math.ceil(Math.max(input.open, input.now ?? input.open) / input.gridMin) * input.gridMin
  const out: BookableOption[] = []
  for (let start = first; start + input.durationMin <= input.close; start += input.gridMin) {
    const end = start + input.durationMin
    for (const staff of input.staffLanes) {
      if (staff.locked || start < staff.from || end > staff.until || !trackFree(staff.occupied, start, end)) continue
      const resourceKeys = input.resourceLanes
        .filter(room => Number.isFinite(room.cleanupMinutes ?? 0) && (room.cleanupMinutes ?? 0) >= 0 && (staff.stores === null || room.stores === null || staff.stores.some(id => (room.stores ?? [room.storeId]).includes(id))) && (!input.requiresPrivateRoom || room.roomClass === 'private') &&
          trackFree(room.occupied, start, end + (room.cleanupMinutes ?? 0)))
        .sort((a, b) => (input.privateIsLastResort === false ? 0 : Number(a.roomClass === 'private') - Number(b.roomClass === 'private')) || a.key.localeCompare(b.key))
        .map(room => room.key)
      if ((input.resourceLanes.length > 0 || input.requiresPrivateRoom) && resourceKeys.length === 0) continue
      out.push({ laneKey: staff.key, start, end, resourceKeys })
    }
  }
  return out
}
