/** @jest-environment node */
// model: claude-opus-5-5 · S87 F2(a) (R-S87-7): the staged door's second key per
// take. Absent `stagedPart` = today's key, byte for byte; the tail key is read
// back by every parser path that can see it, and its mark never throws.
import {
  composeMarkKey,
  composeStagedKey,
  isStagedKeyFor,
  looksLikeRecordingKey,
  parseRecordingKey,
} from '@/lib/recording/key-grammar'

const BIZ = 'biz-1'
const SESSION = '99999999-2222-4333-8444-555555555555'
const TAKE = '11111111-2222-4333-8444-555555555555'

describe('S87 F2(a) — the staged tail key', () => {
  it('absent stagedPart → the plain key, byte-identical to the shape before this round', () => {
    expect(composeStagedKey(BIZ, SESSION, 'audio/webm', TAKE)?.key).toBe(`stg/${BIZ}_${SESSION}_${TAKE}.webm`)
    expect(parseRecordingKey(`stg/${BIZ}_${SESSION}_${TAKE}.webm`, BIZ)).toEqual({ kind: 'staged', recordingSessionId: SESSION, ext: 'webm' })
  })
  it("'tail' → its own key, read back as the session's staged tail part", () => {
    const key = composeStagedKey(BIZ, SESSION, 'audio/webm', TAKE, 'tail')?.key
    expect(key).toBe(`stg/${BIZ}_${SESSION}_${TAKE}_tail.webm`)
    expect(parseRecordingKey(key, BIZ)).toEqual({ kind: 'staged', recordingSessionId: SESSION, ext: 'webm', part: 'tail' })
    expect(looksLikeRecordingKey(key)).toBe(true)
    expect(looksLikeRecordingKey(`stg/${BIZ}_${SESSION}_${TAKE}.webm`)).toBe(true)
  })
  it('a tail mark composes without throwing and parses back to its uuid and part', () => {
    const tail = `stg/${BIZ}_${SESSION}_${TAKE}_tail.webm`
    const mark = composeMarkKey(BIZ, tail, 'partial')
    expect(mark?.key).toBe(`mrk/${tail}.partial.json`)
    expect(parseRecordingKey(mark?.key, BIZ)).toEqual({
      kind: 'mark',
      target: { kind: 'staged', sessionId: SESSION, uuid: TAKE, ext: 'webm', part: 'tail' },
      mark: 'partial',
    })
  })
  it("a tail part is never the session's staged copy for its words (no transcription this round)", () => {
    expect(isStagedKeyFor(`stg/${BIZ}_${SESSION}_${TAKE}_tail.webm`, BIZ, SESSION)).toBe(false)
    expect(isStagedKeyFor(`stg/${BIZ}_${SESSION}_${TAKE}.webm`, BIZ, SESSION)).toBe(true)
  })
})
