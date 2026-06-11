/**
 * Speaker-id aligner (src/lib/speaker-id/align.ts) — the overlap-vote rules
 * locked. Pure function, no mocks.
 */
import { mapStaffSpeaker } from '@/lib/speaker-id/align'

const w = (speaker: number, start: number, end: number) => ({
  word: 'x', start, end, confidence: 0.9, speaker,
})

describe('mapStaffSpeaker — overlap vote', () => {
  it('picks the Deepgram speaker whose speech falls inside staff segments', () => {
    const words = [
      w(0, 0, 2), w(0, 4, 6), w(0, 10, 12), // speaker 0 = matches staff segs
      w(1, 2, 4), w(1, 6, 10),              // speaker 1 = customer
    ]
    const m = mapStaffSpeaker(words, [{ start: 0, end: 2 }, { start: 4, end: 6 }, { start: 10, end: 12 }])!
    expect(m.staffSpeakerIndex).toBe(0)
    expect(m.confidence).toBeGreaterThanOrEqual(0.99)
    expect(m.ambiguous).toBe(false)
  })
  it('null when the winner covers <60% of their own speech', () => {
    const words = [w(0, 0, 2), w(0, 2, 4), w(0, 4, 6), w(1, 6, 8)]
    expect(mapStaffSpeaker(words, [{ start: 0, end: 2 }])).toBeNull()
  })
  it('null when the winner does not beat the runner-up 2×', () => {
    // both speakers ~70% inside staff segments → no clear winner
    const words = [w(0, 0, 10), w(1, 10, 20)]
    expect(mapStaffSpeaker(words, [{ start: 0, end: 8 }, { start: 10, end: 17 }])).toBeNull()
  })
  it('Deepgram-merge smell: staff blanket over >80% of ALL speech → demoted + flagged', () => {
    const words = [w(0, 0, 9), w(1, 9, 10)]
    const m = mapStaffSpeaker(words, [{ start: 0, end: 9.2 }])!
    expect(m.staffSpeakerIndex).toBe(0)
    expect(m.ambiguous).toBe(true)
    expect(m.confidence).toBeLessThanOrEqual(0.5)
  })
  it('empty inputs / no speaker data → null', () => {
    expect(mapStaffSpeaker([], [{ start: 0, end: 1 }])).toBeNull()
    expect(mapStaffSpeaker([w(0, 0, 1)], [])).toBeNull()
    expect(mapStaffSpeaker([{ word: 'x', start: 0, end: 1, confidence: 0.9 }], [{ start: 0, end: 1 }])).toBeNull()
  })
})
