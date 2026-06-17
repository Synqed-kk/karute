/**
 * Guards that every visit-frequency message key the shared components reference
 * exists in BOTH locales. next-intl v4 throws on a missing key at render time;
 * because PR2's components aren't wired to a page yet, only this test would catch
 * a gap before PR3 lights them up. Also pins the compliance-locked tactic set to
 * exactly the 7 keys the helper can emit — no missing, no orphans.
 */
// visitTacticKey pulls in the helper graph, which imports the ESM-only
// @synqed-kk/client at module scope (via list-enrich). Stub it — the key logic
// never touches the SDK. Same pattern as visit-segment.test.ts.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {},
}))

import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'
import { visitTacticKey, type VisitSegment, type TacticKey } from '@/lib/visits/segment'

const SEGMENTS: VisitSegment[] = ['jouren', 'antei', 'ridatsugimi', 'shinki']
const TICKET = [true, false]
const RHYTHM_KEYS = ['title', 'sinceLabel', 'daysUnit', 'usual', 'estimate', 'longerBy', 'onRhythm']
const PACE_KEYS = [
  'title',
  'avgInterval',
  'lastVisit',
  'total',
  'daysAgoValue',
  'aboutWeeks',
  'aboutDays',
  'inputs',
  'existingCustomer',
  'noVisitDate',
  'syncing',
  'pending',
  'verdictMada',
  'verdictSoro',
  'verdictOver',
  'coversWeeks',
  'coversMonths',
  'atThisPace',
]

const EXPECTED_TACTIC_KEYS: TacticKey[] = [
  'jouren_pack',
  'jouren_nopack',
  'antei_pack',
  'antei_nopack',
  'ridatsugimi_pack',
  'ridatsugimi_nopack',
  'shinki',
]

type Messages = {
  visits: {
    segment: Record<string, string>
    tactic: Record<string, string>
    rhythm: Record<string, string>
    pace: Record<string, string>
  }
}

describe.each([
  ['ja', ja as unknown as Messages],
  ['en', en as unknown as Messages],
])('visits messages — %s', (_locale, m) => {
  it('has a label for every segment', () => {
    for (const seg of SEGMENTS) {
      expect(typeof m.visits.segment[seg]).toBe('string')
      expect(m.visits.segment[seg].length).toBeGreaterThan(0)
    }
  })

  it('has a tactic string for every segment × ticket combination the helper emits', () => {
    for (const seg of SEGMENTS) {
      for (const hasPack of TICKET) {
        const key = visitTacticKey(seg, hasPack)
        expect(typeof m.visits.tactic[key]).toBe('string')
        expect(m.visits.tactic[key].length).toBeGreaterThan(0)
      }
    }
  })

  it('has every rhythm-panel string', () => {
    for (const k of RHYTHM_KEYS) {
      expect(typeof m.visits.rhythm[k]).toBe('string')
    }
  })

  it('has every 来店ペース card string', () => {
    for (const k of PACE_KEYS) {
      expect(typeof m.visits.pace[k]).toBe('string')
      expect(m.visits.pace[k].length).toBeGreaterThan(0)
    }
  })

  it('carries no orphan tactic keys beyond the locked 7', () => {
    expect(Object.keys(m.visits.tactic).sort()).toEqual([...EXPECTED_TACTIC_KEYS].sort())
  })
})

describe('the {n}-interpolated strings keep their placeholder in both locales', () => {
  it('usual + longerBy reference {n}', () => {
    for (const m of [ja, en] as unknown as Messages[]) {
      expect(m.visits.rhythm.usual).toContain('{n}')
      expect(m.visits.rhythm.longerBy).toContain('{n}')
    }
  })
})
