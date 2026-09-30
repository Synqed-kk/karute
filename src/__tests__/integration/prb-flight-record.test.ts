/**
 * PR-B commit 5 (build 32) — the take keeps its own flight record (B5,
 * B-S66-1, K-2, A13). The phone's mirrored 12-key constant and its bounds
 * equal the server's schema; the local ring is bounded in entries and bytes;
 * the phone's own check omits an invalid diag; OFF writes no ring.
 */
import {
  DIAG_CODE_MAX_CHARS,
  DIAG_CODE_PATTERN,
  DIAG_MAX_BLOB_BYTES,
  DIAG_MAX_BYTE_VALUE,
  DIAG_MAX_EVENT_COUNT,
  DIAG_MAX_SEQ,
  DIAG_MAX_SEQ_COUNT,
  TakeDiagSchema,
  type TakeDiag,
} from '@/lib/app-api/record-schemas'
import {
  DIAG_ENTRY_MAX_BYTES,
  DIAG_RING_MAX_ENTRIES,
  PHONE_DIAG_CODE_MAX_CHARS,
  PHONE_DIAG_CODE_PATTERN,
  PHONE_DIAG_MAX_BLOB_BYTES,
  PHONE_DIAG_MAX_BYTE_VALUE,
  PHONE_DIAG_MAX_EVENT_COUNT,
  PHONE_DIAG_MAX_SEQ,
  PHONE_DIAG_MAX_SEQ_COUNT,
  TAKE_DIAG_KEYS,
  buildTakeDiag,
  pushDiagEntry,
  validTakeDiag,
  type DiagRingEntry,
  type PhoneTakeDiag,
} from '@/lib/recording/take-diag'

describe('the mirrored constant equals the server schema (K-2)', () => {
  it('TAKE_DIAG_KEYS == Object.keys(TakeDiagSchema.shape), in order', () => {
    expect([...TAKE_DIAG_KEYS]).toEqual(Object.keys(TakeDiagSchema.shape))
  })
  it('every mirrored bound equals the server bound', () => {
    expect(PHONE_DIAG_MAX_SEQ).toBe(DIAG_MAX_SEQ)
    expect(PHONE_DIAG_MAX_SEQ_COUNT).toBe(DIAG_MAX_SEQ_COUNT)
    expect(PHONE_DIAG_MAX_BLOB_BYTES).toBe(DIAG_MAX_BLOB_BYTES)
    expect(PHONE_DIAG_MAX_BYTE_VALUE).toBe(DIAG_MAX_BYTE_VALUE)
    expect(PHONE_DIAG_MAX_EVENT_COUNT).toBe(DIAG_MAX_EVENT_COUNT)
    expect(PHONE_DIAG_CODE_MAX_CHARS).toBe(DIAG_CODE_MAX_CHARS)
    expect(PHONE_DIAG_CODE_PATTERN.source).toBe(DIAG_CODE_PATTERN.source)
  })
  it('the phone type is the server type (compile-time)', () => {
    const d: PhoneTakeDiag = { arm: 'memory', seq_max: 3 }
    const asServer: TakeDiag = d
    expect(TakeDiagSchema.safeParse(asServer).success).toBe(true)
  })
})

describe('send a valid diag or none (A13)', () => {
  const full = {
    arm: 'stored', seq_min: 0, seq_max: 9, seq_count: 10, seq0_present: true, blob_bytes: 4096,
    first_byte: 26, store_error_count: 1, pump_stop_code: 'ok_1', hidden_count: 2, freeze_count: 0,
    session_null_count: 0,
  }
  it('a full phone diag passes the phone check AND the server schema', () => {
    const d = validTakeDiag(full)
    expect(d).toEqual(full)
    expect(TakeDiagSchema.safeParse(d).success).toBe(true)
  })
  it.each([
    ['first_byte', 256], ['seq_max', -1], ['arm', 'disk'], ['pump_stop_code', 'Bad-Code'],
    ['pump_stop_code', 'x'.repeat(17)], ['hidden_count', 1.5], ['seq0_present', 1],
  ])('%s = %p → the phone omits the whole diag, and the server would refuse it', (k, v) => {
    expect(validTakeDiag({ ...full, [k]: v })).toBeUndefined()
    expect(TakeDiagSchema.safeParse({ ...full, [k]: v }).success).toBe(false)
  })
  it('only the 12 keys leave: local fields are never copied', () => {
    expect(validTakeDiag({ arm: 'memory', bytesEmitted: 5, endedBySystem: { at: 1 }, diagRing: [] })).toEqual({
      arm: 'memory',
    })
  })
  it('buildTakeDiag counts the ring and leaves unknowns out', () => {
    const ring: DiagRingEntry[] = [{ at: 1, code: 'hidden' }, { at: 2, code: 'store_error' }]
    expect(buildTakeDiag({ arm: 'memory', blobBytes: 10, lastSeq: 4, ring })).toEqual({
      arm: 'memory', blob_bytes: 10, hidden_count: 1, freeze_count: 0, store_error_count: 1,
    })
    expect(buildTakeDiag({ arm: 'stored', blobBytes: 10, lastSeq: -1 })).toEqual({ arm: 'stored', blob_bytes: 10 })
  })
})

describe('the local ring is bounded (P:80)', () => {
  it(`keeps at most DIAG_RING_MAX_ENTRIES (${DIAG_RING_MAX_ENTRIES}), newest last`, () => {
    let ring: DiagRingEntry[] | undefined
    for (let i = 0; i < DIAG_RING_MAX_ENTRIES + 5; i++) ring = pushDiagEntry(ring, { at: i, code: 'hidden' })
    expect(ring).toHaveLength(DIAG_RING_MAX_ENTRIES)
    expect(ring![0].at).toBe(5)
    expect(ring!.at(-1)!.at).toBe(DIAG_RING_MAX_ENTRIES + 4)
  })
  it(`an entry over DIAG_ENTRY_MAX_BYTES (${DIAG_ENTRY_MAX_BYTES}) is not kept`, () => {
    const big = { at: 1, code: 'hidden', pad: 'x'.repeat(DIAG_ENTRY_MAX_BYTES) } as unknown as DiagRingEntry
    expect(pushDiagEntry([], big)).toEqual([])
  })
})

describe('takeDiag OFF writes no ring', () => {
  it('noteTakeDiagEvent returns before touching the store', async () => {
    const { RECORDING_SWITCHES } = await import('@/lib/recording/recording-switches')
    const store = await import('@/lib/karute/take-store')
    const restore = RECORDING_SWITCHES.takeDiag
    ;(RECORDING_SWITCHES as { takeDiag: boolean }).takeDiag = false
    const open = jest.fn()
    const saved = (globalThis as { indexedDB?: unknown }).indexedDB
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open }
    try {
      await expect(store.noteTakeDiagEvent('t1', { code: 'hidden' })).resolves.toBeUndefined()
      expect(open).not.toHaveBeenCalled()
    } finally {
      ;(RECORDING_SWITCHES as { takeDiag: boolean }).takeDiag = restore
      ;(globalThis as { indexedDB?: unknown }).indexedDB = saved
    }
  })
})
