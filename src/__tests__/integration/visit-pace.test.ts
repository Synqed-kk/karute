/**
 * Pure-logic coverage for computeVisitPace (src/lib/visits/pace.ts) — the
 * single source for the 来店ペース card. Proves the council's contract: advice
 * and evidence rise/fall together (hasDates gates segment + verdict), recency
 * survives a missing interval, the 矢崎 count-only case degrades to `pending`
 * with NO segment, and the dated-count denominator (not lifetime count) drives
 * the interval.
 */
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {},
}))

import { computeVisitPace, type VisitPaceInput } from '@/lib/visits/pace'

const NOW = new Date('2026-06-17T03:00:00.000Z')
function daysAgo(d: number): string {
  return new Date(NOW.getTime() - d * 86_400_000).toISOString()
}
function input(o: Partial<VisitPaceInput>): VisitPaceInput {
  return {
    firstVisitIso: null,
    lastVisitIso: null,
    datedVisitCount: 0,
    totalVisits: 0,
    isReturning: false,
    isTerminal: false,
    ...o,
  }
}

describe('computeVisitPace — full dated history', () => {
  it('常連 on rhythm: interval from the dated-count denominator, segment jouren', () => {
    // 14 dated visits over 600→18 days (582-day span) → ÷13 ≈ 45-day 目安; last 18d out → on-rhythm.
    const p = computeVisitPace(
      input({
        firstVisitIso: daysAgo(600),
        lastVisitIso: daysAgo(18),
        datedVisitCount: 14,
        totalVisits: 14,
        isReturning: true,
      }),
      NOW,
    )
    expect(p.hasDates).toBe(true)
    expect(p.avgIntervalDays).toBe(45)
    expect(p.lastVisitAgoDays).toBe(18)
    expect(p.state).toBe('on-rhythm')
    expect(p.segment).toBe('jouren')
    expect(p.pending).toBe(false)
    expect(p.spanMonths).toBe(20)
  })

  it('離脱気味: last visit well past the interval → over → ridatsugimi', () => {
    // 10 dated visits over 300→10 (290 span) ÷9 ≈ 32d; last 90d out > 32×1.5 → over.
    const p = computeVisitPace(
      input({
        firstVisitIso: daysAgo(300),
        lastVisitIso: daysAgo(90),
        datedVisitCount: 10,
        totalVisits: 10,
        isReturning: true,
      }),
      NOW,
    )
    expect(p.state).toBe('over')
    expect(p.segment).toBe('ridatsugimi')
    expect(p.ratio).toBeLessThanOrEqual(2.5)
  })

  it('安定: mid count, on rhythm', () => {
    const p = computeVisitPace(
      input({
        firstVisitIso: daysAgo(120),
        lastVisitIso: daysAgo(20),
        datedVisitCount: 5,
        totalVisits: 5,
        isReturning: true,
      }),
      NOW,
    )
    expect(p.segment).toBe('antei')
  })
})

describe('computeVisitPace — honest degradation', () => {
  it('矢崎: returning, count only, no dates → pending, NO segment, no interval', () => {
    const p = computeVisitPace(
      input({ totalVisits: 9, isReturning: true }), // no dates at all
      NOW,
    )
    expect(p.hasDates).toBe(false)
    expect(p.avgIntervalDays).toBeNull()
    expect(p.state).toBeNull()
    expect(p.segment).toBeNull()
    expect(p.pending).toBe(true)
    expect(p.lastVisitAgoDays).toBeNull()
  })

  it('recency survives a missing interval (single dated visit, 420 days out)', () => {
    const p = computeVisitPace(
      input({ lastVisitIso: daysAgo(420), datedVisitCount: 1, totalVisits: 6, isReturning: true }),
      NOW,
    )
    expect(p.lastVisitAgoDays).toBe(420) // recency still screams
    expect(p.hasDates).toBe(false) // but no interval asserted
    expect(p.segment).toBeNull()
    expect(p.pending).toBe(true)
  })

  it('新規: not returning → shinki, never pending', () => {
    const p = computeVisitPace(input({ isReturning: false }), NOW)
    expect(p.segment).toBe('shinki')
    expect(p.pending).toBe(false)
  })

  it('terminal (卒業/離客): segment suppressed, not pending', () => {
    const p = computeVisitPace(
      input({
        firstVisitIso: daysAgo(300),
        lastVisitIso: daysAgo(15),
        datedVisitCount: 12,
        totalVisits: 12,
        isReturning: true,
        isTerminal: true,
      }),
      NOW,
    )
    expect(p.segment).toBeNull()
    expect(p.pending).toBe(false)
    expect(p.hasDates).toBe(true) // the numbers still compute; only the segment defers
  })
})
