import { getStaffColor, STAFF_COLOR_KEYS } from '@/lib/staff-colors'

describe('getStaffColor', () => {
  it('returns one of the 6 palette buckets', () => {
    const result = getStaffColor('any-id')
    expect(STAFF_COLOR_KEYS).toContain(result.key)
  })

  it('is deterministic for the same id', () => {
    expect(getStaffColor('staff-abc').key).toBe(getStaffColor('staff-abc').key)
  })

  it('distributes across multiple buckets for varying ids', () => {
    const keys = new Set<string>()
    const samples = [
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
    ]
    for (const id of samples) keys.add(getStaffColor(id).key)
    // With 13 samples across 6 buckets we expect coverage of at least 4 buckets.
    expect(keys.size).toBeGreaterThanOrEqual(4)
  })

  it('returns each tone with bg / border / accent / text strings', () => {
    const color = getStaffColor('seed-1')
    expect(typeof color.bg).toBe('string')
    expect(typeof color.border).toBe('string')
    expect(typeof color.accent).toBe('string')
    expect(typeof color.text).toBe('string')
  })
})
