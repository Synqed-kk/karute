import { bookableOptions } from '@/business/lib/bookable-options'
import type { BoardLane, Hours } from '@/business/lib/today-board'
import { laneSpans, sellStaffLanes, type RoomPolicy } from './today-interactions'
import type { ReservedLaneMask } from './reserved-mask'

/** Customer-facing choices are independent of the board's packing suggestions.
 * Held windows stay visible with an explicit new-client audience restriction. */
export function bookingOptionsFor(input: {
  lanes: BoardLane[]
  storeId?: string | null
  storeIds: string[]
  hours: Hours
  locked: string[]
  now: number | null
  gridMin: number
  durationMin: number
  minSellableMin: number
  cleanupMinutesByBed: Record<string, number>
  rooms: RoomPolicy
  held?: readonly ReservedLaneMask[]
  requiresPrivateRoom?: boolean
}) {
  if (input.durationMin < input.minSellableMin) return []
  const held = new Map(input.held?.map(l => [l.laneKey, l.spans]))
  const rooms = input.lanes.filter(l => l.group === 'beds').map(room => {
    const cleanupMinutes = input.cleanupMinutesByBed[room.key] ?? 0
    return {
      key: room.key, name: room.label, storeId: room.stores?.[0] ?? '', stores: room.stores,
      roomClass: room.roomClass, cleanupMinutes,
      // Drawn cleanup can be absent or clipped after a local add/retarget.
      // Existing cleanup spans are retained too, so a longer occupied snapshot
      // is never shortened by today's policy.
      occupied: [
        ...laneSpans(room),
        ...room.items.filter(item => item.kind === 'booking').map(item => ({
          start: item.startMin, end: item.endMin + cleanupMinutes,
        })),
      ],
    }
  })
  return sellStaffLanes(input.lanes, input.locked).flatMap(staff => {
    if (staff.stores?.length === 0) return []
    const stores = input.storeId != null ? input.storeIds.filter(id => id === input.storeId) : input.storeIds
    const options = new Map<string, { laneKey: string; start: number; end: number; resourceKeys: string[]; storeIds: string[]; audience: 'new_client' | 'any' }>()
    // Each store decides whether rooms are required. Union the choices after
    // that decision; a staffed bedless store remains usable when another store
    // is full, including for staff who work at both.
    for (const storeId of stores) {
      if (storeId !== null && staff.stores !== null && !staff.stores.includes(storeId)) continue
      const localRooms = rooms.filter(room => storeId === null || room.stores === null || room.stores.includes(storeId))
      for (const option of bookableOptions({
        staffLanes: [{ ...staff, stores: storeId === null ? null : [storeId] }], resourceLanes: localRooms,
        open: input.hours.open, close: input.hours.close, now: input.now,
        gridMin: input.gridMin, durationMin: input.durationMin,
        requiresPrivateRoom: input.requiresPrivateRoom, privateIsLastResort: input.rooms.privateIsLastResort,
      })) {
        const key = `${option.start}/${option.end}`
        const previous = options.get(key)
        if (previous) {
          previous.resourceKeys = [...new Set([...previous.resourceKeys, ...option.resourceKeys])]
          if (storeId !== null) previous.storeIds.push(storeId)
        } else {
          options.set(key, {
            ...option, storeIds: storeId === null ? [] : [storeId],
            audience: (held.get(option.laneKey) ?? []).some(span => option.start < span.end && span.start < option.end) ? 'new_client' : 'any',
          })
        }
      }
    }
    return [...options.values()]
  }).sort((a, b) => a.start - b.start || a.laneKey.localeCompare(b.laneKey))
}
