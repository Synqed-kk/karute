/**
 * deriveStatus (src/lib/customers/list-enrich.ts) — drives the "新規" /
 * "needs-followup" / "dormant" / "on-track" badge on the customers list.
 *
 * This was confirmed-functional in the senior audit (#63/#64) but never
 * had test coverage. Lock the behavior so a refactor of the day-based
 * thresholds is intentional, not accidental.
 */

// list-enrich.ts transitively imports @synqed-kk/client (ESM) at module
// load. Jest's node transform can't parse that, so stub it before the
// import. deriveStatus itself doesn't call the client — pure date math.
jest.mock('@synqed-kk/client', () => ({
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  },
}))

import { deriveStatus } from '@/lib/customers/list-enrich'

function daysAgoIso(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

describe('deriveStatus — customer status from join + last visit', () => {
  it("returns 'new' when joinDate is within 30 days", () => {
    expect(deriveStatus(daysAgoIso(5), daysAgoIso(2))).toBe('new')
    expect(deriveStatus(daysAgoIso(29), daysAgoIso(5))).toBe('new')
  })

  it("returns 'new' when there is no last-visit record (any join age)", () => {
    expect(deriveStatus(daysAgoIso(45), null)).toBe('new')
    expect(deriveStatus(daysAgoIso(120), null)).toBe('new')
  })

  it("returns 'dormant' when last visit > 90 days ago", () => {
    expect(deriveStatus(daysAgoIso(180), daysAgoIso(95))).toBe('dormant')
    expect(deriveStatus(daysAgoIso(365), daysAgoIso(365))).toBe('dormant')
  })

  it("returns 'needs-followup' when last visit is 61-90 days ago", () => {
    expect(deriveStatus(daysAgoIso(120), daysAgoIso(65))).toBe('needs-followup')
    expect(deriveStatus(daysAgoIso(120), daysAgoIso(89))).toBe('needs-followup')
  })

  it("returns 'on-track' when last visit is within 60 days", () => {
    expect(deriveStatus(daysAgoIso(120), daysAgoIso(10))).toBe('on-track')
    expect(deriveStatus(daysAgoIso(120), daysAgoIso(59))).toBe('on-track')
  })

  it("handles null joinDate gracefully (still derives from last visit)", () => {
    expect(deriveStatus(null, null)).toBe('new')
    expect(deriveStatus(null, daysAgoIso(100))).toBe('dormant')
  })
})
