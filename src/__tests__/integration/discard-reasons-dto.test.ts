/**
 * 破棄の記録 — the WIRE SHAPE both facade routes parse before answering.
 *
 * Why a schema is worth a suite of its own: the routes serve a shared twin's
 * return value straight out, so a field RENAMED inside that twin passes tsc,
 * passes both read suites, and reaches a baked phone as a missing name or an
 * Invalid Date row. The parse at the door is the only thing standing there, and
 * these tests are what keep it standing — including the part that is easy to
 * soften by accident.
 *
 * THE SOFTENING TO GUARD: every new field is `.nullable()`, NOT `.optional()`.
 * The server always emits the key, so an ABSENT one means a rename — exactly
 * the drift being caught. A schema loosened to tolerate absence would still
 * accept every honest payload here and quietly stop catching the one thing it
 * exists for. Old-wire tolerance is a different boundary and lives at the thin
 * port (thin-discard-reasons-port.test.ts), where a NEW phone meets an OLD
 * server.
 */
import { DiscardReasonsListDTO, DiscardTranscriptDTO } from '@/lib/app-api/discard-reasons-dto'

const ROW = {
  id: 'd1',
  recordingSessionId: 'rs-1',
  createdAt: '2026-08-31T05:33:00.000Z',
  staffId: 'card-A',
  staffName: '原 奏恵',
  reason: 'お客様を間違えて録音を開始してしまいました',
  customerId: 'cus-1',
  customerName: '田中 恵子',
  recordingCreatedAt: '2026-08-31T05:28:00.000Z',
  durationSeconds: 252,
  storeName: '代官山店',
}

const LIST = {
  rows: [ROW],
  counts: { thisMonth: 1, total: 1, byStaff: [{ staffId: 'card-A', staffName: '原 奏恵', thisMonth: 1 }] },
  truncated: false,
}

describe('DiscardReasonsListDTO — the row the phone is promised', () => {
  it('a fully joined row parses', () => {
    expect(DiscardReasonsListDTO.parse(LIST)).toMatchObject({ rows: [ROW] })
  })

  it.each([
    'customerId',
    'customerName',
    'recordingCreatedAt',
    'durationSeconds',
    'storeName',
  ])('%s may be null — every join behind it is best-effort', (field) => {
    const row = { ...ROW, [field]: null }

    expect(DiscardReasonsListDTO.parse({ ...LIST, rows: [row] }).rows[0]).toMatchObject({
      [field]: null,
    })
  })

  it.each([
    'customerId',
    'customerName',
    'recordingCreatedAt',
    'durationSeconds',
    'storeName',
  ])('%s may NOT be absent — an absent key is a rename, not an absence', (field) => {
    const row: Record<string, unknown> = { ...ROW }
    delete row[field]

    expect(() => DiscardReasonsListDTO.parse({ ...LIST, rows: [row] })).toThrow()
  })

  it('a wrongly TYPED join value is refused rather than shipped', () => {
    // The section formats `durationSeconds` into 「録音 4分12秒」 — a string
    // here would render NaN分NaN秒 on a manager's screen.
    expect(() =>
      DiscardReasonsListDTO.parse({ ...LIST, rows: [{ ...ROW, durationSeconds: '252' }] }),
    ).toThrow()
  })
})

describe('DiscardTranscriptDTO — the words and their clock', () => {
  it('segments carry startTime', () => {
    const parsed = DiscardTranscriptDTO.parse({
      segments: [{ text: 'ひとつめ', startTime: 4 }],
      durationSeconds: 42,
    })

    expect(parsed.segments).toEqual([{ text: 'ひとつめ', startTime: 4 }])
  })

  it('startTime may be null — a segment whose clock is unknown still has WORDS', () => {
    expect(
      DiscardTranscriptDTO.parse({
        segments: [{ text: 'ひとつめ', startTime: null }],
        durationSeconds: null,
      }).segments[0].startTime,
    ).toBeNull()
  })

  it('startTime may NOT be absent — the server always emits it, so a missing key is drift', () => {
    expect(() =>
      DiscardTranscriptDTO.parse({ segments: [{ text: 'ひとつめ' }], durationSeconds: 42 }),
    ).toThrow()
  })

  it('an empty transcript still parses — the swept-session answer', () => {
    expect(DiscardTranscriptDTO.parse({ segments: [], durationSeconds: null })).toEqual({
      segments: [],
      durationSeconds: null,
    })
  })
})
