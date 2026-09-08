import { bookableOptions, type OptionResource } from '@/business/lib/bookable-options'
import type { SellStaffLane } from '@/business/lib/canon-logic/availability'

const staff = (key: string): SellStaffLane => ({ key, name: key, from: 600, until: 780, locked: false, occupied: [], listPrice: 6000, stores: ['a'] })
const bed = (key: string): OptionResource => ({ key, name: key, storeId: 'a', occupied: [], roomClass: 'standard' })
const query = { staffLanes: [staff('alice'), staff('bob')], resourceLanes: [bed('bed')], open: 600, close: 780, now: null, gridMin: 30, durationMin: 60 }
const identity = (o: { laneKey: string; start: number; end: number }) => `${o.laneKey}/${o.start}/${o.end}`

describe('CORE-9 independently bookable therapist options', () => {
  it('offers both therapists on one bed without claiming it for either', () => {
    const input = structuredClone(query)
    expect(bookableOptions(input).filter(o => o.start === 600).map(o => o.laneKey)).toEqual(['alice', 'bob'])
    expect(input).toEqual(query)
    const occupied = { ...input, resourceLanes: [{ ...bed('bed'), occupied: [{ start: 600, end: 660 }] }] }
    expect(bookableOptions(occupied).some(o => o.start < 660)).toBe(false)
  })
  it('requires one compatible room for the entire treatment and its cleanup', () => {
    const rooms = [{ ...bed('early'), occupied: [{ start: 630, end: 780 }] }, { ...bed('late'), occupied: [{ start: 600, end: 630 }] }]
    expect(bookableOptions({ ...query, resourceLanes: rooms }).some(o => o.start === 600)).toBe(false)
    expect(bookableOptions({ ...query, resourceLanes: [{ ...bed('bed'), cleanupMinutes: 15, occupied: [{ start: 660, end: 700 }] }] }).some(o => o.start === 600)).toBe(false)
  })
  it('keeps private rooms last and rejects standard or foreign rooms for private treatments', () => {
    const rooms = [{ ...bed('private'), roomClass: 'private' as const }, bed('standard'), { ...bed('foreign'), storeId: 'b', roomClass: 'private' as const }]
    expect(bookableOptions({ ...query, resourceLanes: rooms })[0].resourceKeys).toEqual(['standard', 'private'])
    expect(bookableOptions({ ...query, resourceLanes: rooms, requiresPrivateRoom: true })[0].resourceKeys).toEqual(['private'])
    expect(bookableOptions({ ...query, resourceLanes: [bed('standard')], requiresPrivateRoom: true })).toEqual([])
    expect(bookableOptions({ ...query, resourceLanes: [], requiresPrivateRoom: true })).toEqual([])
  })
  it('respects staff shifts, locks, the clock, and beds outside the staff store', () => {
    expect(bookableOptions({ ...query, staffLanes: [{ ...staff('alice'), locked: true }] })).toEqual([])
    expect(bookableOptions({ ...query, resourceLanes: [{ ...bed('other'), storeId: 'b' }] })).toEqual([])
    expect(bookableOptions({ ...query, now: 614 })[0].start).toBe(630)
    expect(bookableOptions({ ...query, staffLanes: [{ ...staff('alice'), from: 615, until: 690 }] }).map(o => o.start)).toEqual([630])
  })
  it('never loses a therapist/start/duration option when a booking, block, or break is removed', () => {
    for (const durationMin of [20, 30, 45, 60, 90]) for (const gridMin of [15, 30, 60]) {
      for (let start = 600; start < 750; start += 15) {
        const occupied = [{ start, end: start + 30 }]
        const withBlock = { ...query, durationMin, gridMin, staffLanes: [{ ...staff('alice'), occupied }, staff('bob')], resourceLanes: [{ ...bed('bed'), occupied }] }
        const before = bookableOptions(withBlock)
        const after = new Set(bookableOptions({ ...query, durationMin, gridMin }).map(identity))
        expect(before.every(o => after.has(identity(o)))).toBe(true)
      }
    }
  })
})
