import {
  DEFAULT_CONTACT_THRESHOLD_DAYS,
  daysSince,
  resolvePackAlert,
} from '@/lib/packs/resolve'

// The 離客/upsell alert rules from the 2026-06-09 Kitano meeting — single
// source for every surface (list, dashboard, profile, alert page).

const base = {
  remainingTotal: 8,
  hasActivePack: true,
  daysSinceLastVisit: 78,
  hasNextBooking: false,
} as const

describe('resolvePackAlert (single source for 要連絡/残り1回)', () => {
  it("the meeting's example: 8 sessions left, 78 days unseen, no booking → contact", () => {
    expect(resolvePackAlert({ ...base })).toBe('contact')
  })

  it('a next booking suppresses the contact alert', () => {
    expect(resolvePackAlert({ ...base, hasNextBooking: true })).toBe(null)
  })

  it('under the threshold → no contact alert (19 days, default 20)', () => {
    expect(DEFAULT_CONTACT_THRESHOLD_DAYS).toBe(20)
    expect(resolvePackAlert({ ...base, daysSinceLastVisit: 19 })).toBe(null)
    expect(resolvePackAlert({ ...base, daysSinceLastVisit: 20 })).toBe('contact')
  })

  it('threshold is configurable (30日 setting)', () => {
    expect(
      resolvePackAlert({ ...base, daysSinceLastVisit: 25, thresholdDays: 30 }),
    ).toBe(null)
    expect(
      resolvePackAlert({ ...base, daysSinceLastVisit: 31, thresholdDays: 30 }),
    ).toBe('contact')
  })

  it('残り1回 → low (the next-pack conversation)', () => {
    expect(
      resolvePackAlert({
        ...base,
        remainingTotal: 1,
        daysSinceLastVisit: 3,
        hasNextBooking: true,
      }),
    ).toBe('low')
  })

  it('contact takes precedence over low when both apply', () => {
    expect(resolvePackAlert({ ...base, remainingTotal: 1 })).toBe('contact')
  })

  it('卒業/離客 customers are never alerted', () => {
    expect(resolvePackAlert({ ...base, lifecycleStatus: 'graduated' })).toBe(null)
    expect(resolvePackAlert({ ...base, lifecycleStatus: 'lost' })).toBe(null)
  })

  it('no active pack → never alerts', () => {
    expect(
      resolvePackAlert({ ...base, hasActivePack: false, remainingTotal: 0 }),
    ).toBe(null)
  })

  it('no visit history → no contact alert (nothing to measure from)', () => {
    expect(resolvePackAlert({ ...base, daysSinceLastVisit: null })).toBe(null)
  })
})

describe('daysSince', () => {
  it('null/invalid → null', () => {
    expect(daysSince(null)).toBe(null)
    expect(daysSince('not-a-date')).toBe(null)
  })

  it('counts whole days', () => {
    const now = new Date('2026-06-10T12:00:00Z')
    expect(daysSince('2026-06-10T09:00:00Z', now)).toBe(0)
    expect(daysSince('2026-06-09T12:00:00Z', now)).toBe(1)
    expect(daysSince('2026-03-24T12:00:00Z', now)).toBe(78)
  })

  it('future timestamps floor at 0 (clock skew safety)', () => {
    const now = new Date('2026-06-10T12:00:00Z')
    expect(daysSince('2026-06-11T12:00:00Z', now)).toBe(0)
  })
})
