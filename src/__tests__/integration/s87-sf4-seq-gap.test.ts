/** @jest-environment node */
// model: claude-opus-5-5 · S87 F4 (SF-4, R-S87-3b): a hole in the stored
// segment sequence is 'partial' — never a whole take under the take key.
import { decideBlobFate, heldCopyWins } from '@/lib/recording/blob-fate'
import { PROBE_MIN_HEAD_BYTES } from '@/lib/recording/container-sniff'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'

const sw = RECORDING_SWITCHES as unknown as { stagedPartialDoor: boolean }
let saved: boolean
beforeEach(() => {
  saved = sw.stagedPartialDoor
  sw.stagedPartialDoor = true
})
afterEach(() => {
  sw.stagedPartialDoor = saved
})

// A webm (EBML) head: readable, so only the seq facts can decide.
const head = new Uint8Array(PROBE_MIN_HEAD_BYTES)
head.set([0x1a, 0x45, 0xdf, 0xa3])

describe('S87 F4 — the verdict reads the seq facts', () => {
  it('seqs 0,1,3 (count 3, max 3) → partial', () => {
    expect(decideBlobFate({ head, size: 300, lastSeq: 3, seq: { segmentCount: 3, seqMin: 0, seqMax: 3 } })).toBe('partial')
  })
  it('seqs 0,1,2 with lastSeq 2 → ok', () => {
    expect(decideBlobFate({ head, size: 300, lastSeq: 2, seq: { segmentCount: 3, seqMin: 0, seqMax: 2 } })).toBe('ok')
  })
  it('the store says lastSeq 5 but the rows end at 2 → partial', () => {
    expect(decideBlobFate({ head, size: 300, lastSeq: 5, seq: { segmentCount: 3, seqMin: 0, seqMax: 2 } })).toBe('partial')
  })
  it('seqs 1,2,3 (contiguous, but the recorder starts at 0) → partial', () => {
    expect(decideBlobFate({ head, size: 300, lastSeq: 3, seq: { segmentCount: 3, seqMin: 1, seqMax: 3 } })).toBe('partial')
  })
  it('no seq facts (the memory arm) → today’s answer', () => {
    expect(decideBlobFate({ head, size: 300 })).toBe('ok')
    expect(decideBlobFate({ head, size: 300, lastSeq: 9 })).toBe('ok')
  })
  it('heldCopyWins: a stored copy with a hole loses to a larger held blob; a whole one does not', () => {
    const hole = { size: 300, lastSeq: 3, seq: { segmentCount: 3, seqMin: 0, seqMax: 3 } }
    expect(heldCopyWins(400, hole)).toBe(true)
    expect(heldCopyWins(400, { ...hole, seq: { segmentCount: 4, seqMin: 0, seqMax: 3 } })).toBe(false)
  })
})
