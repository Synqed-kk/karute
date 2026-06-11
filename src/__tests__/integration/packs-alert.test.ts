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

describe('resolveOutcomeMode (what the stop flow shows)', () => {
  const { resolveOutcomeMode } = jest.requireActual('@/lib/packs/resolve')
  it('no pack → conversion question (the trial/first-visit sale)', () => {
    expect(resolveOutcomeMode(null)).toBe('conversion')
    expect(resolveOutcomeMode(undefined)).toBe('conversion')
    expect(resolveOutcomeMode({ remaining: 0 })).toBe('conversion')
  })
  it('mid-pack (残3+) → auto: NO dialog, consume + autosave', () => {
    expect(resolveOutcomeMode({ remaining: 3 })).toBe('auto')
    expect(resolveOutcomeMode({ remaining: 10 })).toBe('auto')
  })
  it('decision point (残2/残1) → repurchase question', () => {
    expect(resolveOutcomeMode({ remaining: 2 })).toBe('repurchase')
    expect(resolveOutcomeMode({ remaining: 1 })).toBe('repurchase')
  })
})

describe('exhausted-unrenewed joins 要連絡 (Liam: the highest-value churn moment)', () => {
  const { resolvePackAlert } = jest.requireActual('@/lib/packs/resolve')
  it('残0・未更新・予約なし・20日 → contact', () => {
    expect(resolvePackAlert({ hasActivePack: true, remainingTotal: 0, hasNextBooking: false, daysSinceLastVisit: 20 })).toBe('contact')
  })
  it('残0 but BOOKED → no alert (they are coming back)', () => {
    expect(resolvePackAlert({ hasActivePack: true, remainingTotal: 0, hasNextBooking: true, daysSinceLastVisit: 30 })).toBe(null)
  })
  it('残0 at 19 days → not yet (threshold honored)', () => {
    expect(resolvePackAlert({ hasActivePack: true, remainingTotal: 0, hasNextBooking: false, daysSinceLastVisit: 19 })).toBe(null)
  })
  it('lifecycle 卒業 still suppresses even at 残0', () => {
    expect(resolvePackAlert({ hasActivePack: true, remainingTotal: 0, hasNextBooking: false, daysSinceLastVisit: 40, lifecycleStatus: 'graduated' })).toBe(null)
  })
})
