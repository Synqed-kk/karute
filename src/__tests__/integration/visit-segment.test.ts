/**
 * Pure-logic coverage for the visit-frequency SEGMENT + TACTIC helper
 * (src/lib/visits/segment.ts). Drives a fixed `now` so the JST day math is
 * deterministic. Proves: the segment thresholds, that a drifting regular beats
 * the raw count (離脱気味, not 常連), that avgIntervalDays is null-gated (never
 * fabricated), and that terminal lifecycle states (卒業/離客) suppress the
 * frequency segment so they keep their own status chip.
 */
// segment.ts reuses customerVisitCount/isReturningCustomer from list-enrich (so
// the visit count can't disagree across surfaces), which imports the ESM-only
// @synqed-kk/client at module scope. Those pure fns never touch the SDK, so an
// empty stub lets jest load the module graph. (Same pattern as the save-flow tests.)
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {},
}))

import {
  computeVisitSignals,
  classifyVisitSegment,
  computeVisitRhythm,
  visitTacticKey,
  SEGMENT_TONE,
  OVERDUE_FACTOR,
  JOUREN_MIN_VISITS,
  type VisitSignalsInput,
} from '@/lib/visits/segment'

// Fixed reference "today" (JST) for all day-difference math.
const NOW = new Date('2026-06-16T03:00:00.000Z')

/** ISO string for `d` JST-days before NOW. */
function daysAgo(d: number): string {
  return new Date(NOW.getTime() - d * 86_400_000).toISOString()
}

function input(overrides: Partial<VisitSignalsInput>): VisitSignalsInput {
  return { joinDateIso: null, lastVisitIso: null, ...overrides }
}

describe('computeVisitSignals', () => {
  it('counts visits via the shared MAX rule and days since last visit', () => {
    const sig = computeVisitSignals(
      input({ visitCount: 12, lastVisitIso: daysAgo(20), firstVisitIso: daysAgo(240) }),
      NOW,
    )
    expect(sig.totalVisits).toBe(12)
    expect(sig.lastVisitAgoDays).toBe(20)
    // span 240 / 12 visits = 20-day 目安
    expect(sig.avgIntervalDays).toBe(20)
    expect(sig.isFirstVisit).toBe(false)
  })

  it('null-gates avgIntervalDays with <2 visits or no first-visit date', () => {
    expect(
      computeVisitSignals(input({ visitCount: 1, lastVisitIso: daysAgo(5), firstVisitIso: daysAgo(5) }), NOW)
        .avgIntervalDays,
    ).toBeNull()
    expect(
      computeVisitSignals(input({ visitCount: 8, lastVisitIso: daysAgo(5), firstVisitIso: null }), NOW)
        .avgIntervalDays,
    ).toBeNull()
  })

  it('reports a true first-timer', () => {
    const sig = computeVisitSignals(input({}), NOW)
    expect(sig.isFirstVisit).toBe(true)
    expect(sig.lastVisitAgoDays).toBeNull()
  })
})

describe('classifyVisitSegment', () => {
  it('新規 — no prior history of any kind', () => {
    expect(classifyVisitSegment(input({}), NOW)).toBe('shinki')
  })

  it('常連 — many visits, on rhythm', () => {
    expect(
      classifyVisitSegment(
        input({ visitCount: 14, lastVisitIso: daysAgo(18), firstVisitIso: daysAgo(280) }),
        NOW,
      ),
    ).toBe('jouren')
  })

  it('安定 — mid visit count, on rhythm', () => {
    expect(
      classifyVisitSegment(
        input({ visitCount: 5, lastVisitIso: daysAgo(22), firstVisitIso: daysAgo(120) }),
        NOW,
      ),
    ).toBe('antei')
  })

  it('離脱気味 — a 12-visit regular drifted past 1.5× their usual interval beats 常連', () => {
    // 240/12 = 20-day 目安; 48 days out > 20 × 1.5 = 30 → drifting.
    expect(
      classifyVisitSegment(
        input({ visitCount: 12, lastVisitIso: daysAgo(48), firstVisitIso: daysAgo(240) }),
        NOW,
      ),
    ).toBe('ridatsugimi')
  })

  it('within 1.5× the interval is NOT yet 離脱気味', () => {
    // 20-day 目安, 28 days out < 30 threshold.
    expect(
      classifyVisitSegment(
        input({ visitCount: 12, lastVisitIso: daysAgo(28), firstVisitIso: daysAgo(240) }),
        NOW,
      ),
    ).toBe('jouren')
  })

  it('a returning customer with no computable rhythm cannot be 離脱気味', () => {
    // visitCount 1 (returning via ticket pack) but no avg interval → antei, not drift.
    expect(
      classifyVisitSegment(
        input({ hasTicketPack: true, visitCount: 1, lastVisitIso: daysAgo(400), firstVisitIso: daysAgo(400) }),
        NOW,
      ),
    ).toBe('antei')
  })

  it('terminal lifecycle (卒業/離客) suppresses the frequency segment', () => {
    const base = input({ visitCount: 20, lastVisitIso: daysAgo(15), firstVisitIso: daysAgo(300) })
    expect(classifyVisitSegment({ ...base, lifecycleStatus: 'graduated' }, NOW)).toBeNull()
    expect(classifyVisitSegment({ ...base, lifecycleStatus: 'lost' }, NOW)).toBeNull()
    // ...but an active customer with the same numbers is 常連.
    expect(classifyVisitSegment({ ...base, lifecycleStatus: 'active' }, NOW)).toBe('jouren')
  })
})

describe('computeVisitRhythm', () => {
  it('flags an on-rhythm visit', () => {
    const r = computeVisitRhythm(
      input({ visitCount: 10, lastVisitIso: daysAgo(18), firstVisitIso: daysAgo(200) }),
      NOW,
    )
    expect(r?.state).toBe('on-rhythm')
  })

  it('flags an overdue visit and clamps the ratio', () => {
    const r = computeVisitRhythm(
      input({ visitCount: 10, lastVisitIso: daysAgo(400), firstVisitIso: daysAgo(200) }),
      NOW,
    )
    expect(r?.state).toBe('over')
    expect(r?.ratio).toBeLessThanOrEqual(2.5)
  })

  it('returns null when there is no honest rhythm to plot', () => {
    expect(
      computeVisitRhythm(input({ visitCount: 1, lastVisitIso: daysAgo(5), firstVisitIso: daysAgo(5) }), NOW),
    ).toBeNull()
  })
})

describe('visitTacticKey', () => {
  it('maps segment × ticket to a stable key; 新規 ignores ticket', () => {
    expect(visitTacticKey('jouren', true)).toBe('jouren_pack')
    expect(visitTacticKey('ridatsugimi', false)).toBe('ridatsugimi_nopack')
    expect(visitTacticKey('shinki', true)).toBe('shinki')
    expect(visitTacticKey('shinki', false)).toBe('shinki')
  })
})

describe('exported constants', () => {
  it('tones cover every segment and thresholds are sane', () => {
    expect(Object.keys(SEGMENT_TONE).sort()).toEqual(['antei', 'jouren', 'ridatsugimi', 'shinki'])
    expect(SEGMENT_TONE.ridatsugimi).toBe('warning')
    expect(OVERDUE_FACTOR).toBeGreaterThan(1)
    expect(JOUREN_MIN_VISITS).toBeGreaterThanOrEqual(5)
  })
})
