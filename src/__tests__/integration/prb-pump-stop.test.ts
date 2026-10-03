/**
 * PR-B commit 5b (R-S74-10 b, c). The uploader records WHY it stopped: each
 * exit of pumpOnce names one code from take-diag.ts PUMP_STOP_CODES, through
 * commit 5's one writer, and an unchanged code writes nothing. The killer of
 * M-B15 「the pump stops without a code」. Plus session_null_count's one home:
 * draft.ts currentUserId counts every null answer.
 */
import { pumpSegments, __resetSegmentPumpState } from '@/lib/recording/segment-uploader'
import { noteTakeDiagEvent } from '@/lib/karute/take-store'
import { currentUserId, sessionNullReadCount } from '@/lib/karute/draft'
import { PUMP_STOP_CODES, buildTakeDiag } from '@/lib/recording/take-diag'

jest.mock('@/lib/karute/take-store', () => ({
  ...jest.requireActual('@/lib/karute/take-store'),
  noteTakeDiagEvent: jest.fn(async () => undefined),
}))
let session: unknown = null
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}))

const note = noteTakeDiagEvent as jest.Mock
const port = {} as Parameters<typeof pumpSegments>[0]
const source = (meta: unknown) => ({ readUploadMeta: async () => meta }) as never

describe('pump_stop_code — the uploader names its exit (M-B15)', () => {
  beforeEach(() => {
    __resetSegmentPumpState()
    note.mockClear()
  })
  it('an exit records its code; the same code again writes nothing; a new code writes once', async () => {
    await pumpSegments(port, 't1', { source: source(null) })
    expect(note).toHaveBeenCalledWith('t1', { code: 'pump_stop', stop: 'no_meta' })
    await pumpSegments(port, 't1', { source: source(null) })
    expect(note).toHaveBeenCalledTimes(1)
    await pumpSegments(port, 't1', { source: source({ recordingSessionId: null }) })
    expect(note).toHaveBeenLastCalledWith('t1', { code: 'pump_stop', stop: 'no_session' })
    expect(note).toHaveBeenCalledTimes(2)
  })
  it('every code fits the server bound', () => {
    for (const c of PUMP_STOP_CODES) expect(c).toMatch(/^[a-z0-9_]{1,16}$/)
  })
})

describe('session_null_count — ONE count in currentUserId', () => {
  it('two null answers during a take → a difference of 2 → session_null_count 2', async () => {
    const start = sessionNullReadCount()
    session = null
    await currentUserId()
    await currentUserId()
    session = { user: { id: 'staff-A' } }
    await currentUserId()
    const n = sessionNullReadCount() - start
    expect(n).toBe(2)
    expect(buildTakeDiag({ arm: 'stored', blobBytes: 1, sessionNullCount: n })?.session_null_count).toBe(2)
    expect(buildTakeDiag({ arm: 'stored', blobBytes: 1 })).not.toHaveProperty('session_null_count')
  })
})
