import {
  assignStaffColors,
  getStaffColorByKey,
  NEUTRAL_STAFF_COLOR,
  STAFF_COLOR_KEYS,
} from '@/lib/staff-colors'

describe('assignStaffColors', () => {
  it('gives every staff a DISTINCT color (no collisions up to palette size)', () => {
    const ids = ['s1', 's2', 's3', 's4', 's5', 's6']
    const map = assignStaffColors(ids)
    const keys = ids.map((id) => map.get(id)!.key)
    expect(new Set(keys).size).toBe(ids.length)
  })

  it('is stable regardless of input order (sorted-index assignment)', () => {
    const a = assignStaffColors(['c', 'a', 'b'])
    const b = assignStaffColors(['b', 'c', 'a'])
    for (const id of ['a', 'b', 'c']) {
      expect(a.get(id)!.key).toBe(b.get(id)!.key)
    }
  })

  it('skips null / undefined ids', () => {
    const map = assignStaffColors(['s1', null, undefined, 's2'])
    expect(map.size).toBe(2)
    expect(map.has('s1')).toBe(true)
    expect(map.has('s2')).toBe(true)
  })

  it('only wraps the palette once the roster outgrows it', () => {
    const n = STAFF_COLOR_KEYS.length
    // n+1 sorted ids → index 0 and index n share a color (n % n === 0).
    const ids = Array.from({ length: n + 1 }, (_, i) =>
      `staff-${String(i).padStart(3, '0')}`,
    )
    const map = assignStaffColors(ids)
    expect(map.get(ids[0])!.key).toBe(map.get(ids[n])!.key)
  })
})

describe('getStaffColorByKey', () => {
  it('resolves a palette key to its class-string tone (bg / text / stripe / ring)', () => {
    const color = getStaffColorByKey('blue')
    expect(color.key).toBe('blue')
    for (const field of ['stripe', 'bg', 'text', 'ring'] as const) {
      expect(typeof color[field]).toBe('string')
      expect(color[field].length).toBeGreaterThan(0)
    }
  })

  it('falls back to the neutral tone for null / neutral keys', () => {
    expect(getStaffColorByKey(null)).toBe(NEUTRAL_STAFF_COLOR)
    expect(getStaffColorByKey(undefined)).toBe(NEUTRAL_STAFF_COLOR)
    expect(getStaffColorByKey('neutral')).toBe(NEUTRAL_STAFF_COLOR)
  })
})
