/**
 * 監査ログ round 2, PR C — subject 4: watchOneBusiness (packet subject 8's
 * "the route" bullets that belong at the per-business logic level, not the
 * thin route.ts auth/dispatch layer — see audit-watch-route-auth.test.ts for
 * the 401/allowlist/mode-resolution half).
 */
jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerListFor: async () => [] }))

const auditMock = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditMock(e) }))

import { watchOneBusiness } from '@/lib/audit-watch/run'
import { newSynqedClient } from '@/lib/synqed/client'

jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: jest.fn() }))

const NOW = new Date('2026-09-11T05:00:00.000Z') // 14:00 JST — after today's assembler floor
// 3 days ago: its session (300s duration) ends well over ASSEMBLE_AFTER_MS
// (48h default) before the assembler floor (yesterday 18:07 UTC) — the
// assembler has genuinely had its rescue shot — while still inside the
// inbox's own 7-day window (INBOX_WINDOW_MS): a session older than that
// window never produces a row at all (deriveInboxRows' own floor), so a
// "missing forever" session past 7 days is outside what this cron can see,
// same horizon the 録音履歴 screen itself has.
const OLD = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()

type AuditListArgs = { target_id?: string; page?: number }

/** One record-less, discard-less, job-less, take-less, take-less recording
 *  session old enough to be a 失敗 row past the assembler floor — the exact
 *  shape findKaruteMissing picks up. */
function makeClient(opts: { existingRows?: unknown[]; stormEvents?: unknown[] } = {}) {
  const existingRows = opts.existingRows ?? []
  const stormEvents = opts.stormEvents ?? []
  const auditList = jest.fn(async (args: AuditListArgs) => {
    if ('target_id' in args) {
      return { events: existingRows, total: existingRows.length, page: 1, page_size: 50 }
    }
    // The category:'recording' page walk (step b).
    return { events: stormEvents, total: stormEvents.length, page: 1, page_size: 200 }
  })
  return {
    recordings: {
      list: jest.fn(async () => ({
        recordings: [
          {
            id: 'sess-old',
            business_id: 'biz-1',
            customer_id: 'cust-1',
            store_id: 'store-1',
            staff_id: 'staff-1',
            appointment_id: null,
            audio_storage_path: null,
            duration_seconds: 300,
            status: 'RECORDED',
            created_at: OLD,
            updated_at: OLD,
          },
        ],
        total: 1,
      })),
      get: jest.fn(async (id: string) => ({
        id,
        business_id: 'biz-1',
        customer_id: 'cust-1',
        store_id: 'store-1',
        staff_id: 'staff-1',
        appointment_id: null,
        audio_storage_path: null,
        duration_seconds: 300,
        status: 'RECORDED',
        created_at: OLD,
        updated_at: OLD,
      })),
    },
    karuteRecords: { list: jest.fn(async () => ({ karute_records: [], total: 0 })) },
    recordingJobs: {
      getByRecordingSession: jest.fn(async () => {
        throw { status: 404 }
      }),
    },
    recordingDiscards: {
      list: jest.fn(async () => ({ events: [], total: 0, page: 1, page_size: 200 })),
    },
    audit: { list: auditList },
    packs: { listRecentRedemptions: jest.fn(async () => []) },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(newSynqedClient as jest.Mock).mockReturnValue(makeClient())
})

const FAR_DEADLINE = Date.now() + 60_000

describe('watchOneBusiness — recording.karute_missing', () => {
  it('mode "write": writes one row with the deterministic request_id and honest detail', async () => {
    const result = await watchOneBusiness('biz-1', NOW, 'write', FAR_DEADLINE)
    expect(result).toMatchObject({
      businessId: 'biz-1',
      candidates: 1,
      written: 1,
      skipped: 0,
      truncated: false,
      list: [{ action: 'recording.karute_missing', targetId: 'sess-old', reason: 'genericFailure' }],
    })
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'recording',
        action: 'recording.karute_missing',
        actorId: null,
        actorType: 'system',
        businessId: 'biz-1',
        targetType: 'recording',
        targetId: 'sess-old',
        severity: 'notice',
        source: 'system',
        // P2-2: no day suffix — one fact per target, ever (the run's day is
        // not the session's day, so a day suffix here was never stable).
        requestId: 'audit-watch:recording.karute_missing:sess-old',
        detail: expect.objectContaining({
          recording_session_id: 'sess-old',
          customer_id: 'cust-1',
          staff_id: 'staff-1',
          store_id: 'store-1',
          duration_seconds: 300,
          reason: 'genericFailure',
          ticket_burned: null, // no appointment on this session
        }),
      }),
    )
  })

  it('F-c: mode "dry" finds the same candidate, lists it, but writes NOTHING and calls audit() zero times', async () => {
    const result = await watchOneBusiness('biz-1', NOW, 'dry', FAR_DEADLINE)
    // written stays 0 in dry mode — candidates is the count, list the content.
    expect(result).toMatchObject({
      candidates: 1,
      written: 0,
      skipped: 0,
      list: [{ action: 'recording.karute_missing', targetId: 'sess-old', reason: 'genericFailure' }],
    })
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('a prior row for the same target+action is skipped, never written, one dedupe read only (CP2)', async () => {
    ;(newSynqedClient as jest.Mock).mockReturnValue(
      makeClient({ existingRows: [{ id: 'e1', action: 'recording.karute_missing', detail: {} }] }),
    )
    const result = await watchOneBusiness('biz-1', NOW, 'write', FAR_DEADLINE)
    expect(result).toMatchObject({ candidates: 1, written: 0, skipped: 1 })
    // F-a: a skipped candidate is not new information — absent from the list.
    expect(result.list).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
    const client = (newSynqedClient as jest.Mock).mock.results[0].value
    // One target-scoped dedupe read for THIS candidate, never retried — the
    // other call on this mock is step (b)'s category-wide storm page walk.
    const targetScoped = (client.audit.list as jest.Mock).mock.calls.filter(([a]) => 'target_id' in a)
    expect(targetScoped).toHaveLength(1)
  })

  it('a budget already past its deadline returns immediately, truncated, nothing processed', async () => {
    const result = await watchOneBusiness('biz-1', NOW, 'write', Date.now() - 1)
    expect(result).toEqual({
      businessId: 'biz-1',
      candidates: 0,
      written: 0,
      skipped: 0,
      truncated: true,
      error: false,
      unchecked: 0,
      list: [],
    })
    expect(auditMock).not.toHaveBeenCalled()
    expect(newSynqedClient).not.toHaveBeenCalled()
  })

  it('F-a: dry run with two NEW candidates lists both; a third with a prior row is skipped and absent from the list', async () => {
    const SECOND: typeof OLD = OLD // same age, distinct session
    const client = makeClient()
    // Per-target dedupe: only 'sess-skip' already has a row.
    client.audit.list = jest.fn(async (args: AuditListArgs) => {
      if ('target_id' in args) {
        const hasPriorRow = args.target_id === 'sess-skip'
        const events = hasPriorRow ? [{ id: 'e1', action: 'recording.karute_missing', detail: {} }] : []
        return { events, total: events.length, page: 1, page_size: 50 }
      }
      return { events: [], total: 0, page: 1, page_size: 200 }
    })
    client.recordings.list = jest.fn(async () => ({
      recordings: [
        { id: 'sess-old', business_id: 'biz-1', customer_id: 'cust-1', store_id: 'store-1', staff_id: 'staff-1', appointment_id: null, audio_storage_path: null, duration_seconds: 300, status: 'RECORDED', created_at: OLD, updated_at: OLD },
        { id: 'sess-old-2', business_id: 'biz-1', customer_id: 'cust-2', store_id: 'store-1', staff_id: 'staff-1', appointment_id: null, audio_storage_path: null, duration_seconds: 300, status: 'RECORDED', created_at: SECOND, updated_at: SECOND },
        { id: 'sess-skip', business_id: 'biz-1', customer_id: 'cust-3', store_id: 'store-1', staff_id: 'staff-1', appointment_id: null, audio_storage_path: null, duration_seconds: 300, status: 'RECORDED', created_at: OLD, updated_at: OLD },
      ],
      total: 3,
    }))
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)

    const result = await watchOneBusiness('biz-1', NOW, 'dry', FAR_DEADLINE)
    expect(result.candidates).toBe(3)
    expect(result.skipped).toBe(1)
    expect(auditMock).not.toHaveBeenCalled()
    expect(result.list).toEqual(
      expect.arrayContaining([
        { action: 'recording.karute_missing', targetId: 'sess-old', reason: 'genericFailure' },
        { action: 'recording.karute_missing', targetId: 'sess-old-2', reason: 'genericFailure' },
      ]),
    )
    expect(result.list).toHaveLength(2)
    expect(result.list.some((c) => c.targetId === 'sess-skip')).toBe(false)
  })

  it('F-b: a read failure sets result.error = true — decoupled from truncated', async () => {
    const client = makeClient()
    client.recordings.list = jest.fn(async () => {
      throw new Error('core down')
    })
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)
    const result = await watchOneBusiness('biz-1', NOW, 'write', FAR_DEADLINE)
    expect(result.error).toBe(true)
    expect(result.truncated).toBe(false)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('P2-5: a deadline inside the per-business reserve is not admitted — no read, truncated', async () => {
    const result = await watchOneBusiness('biz-1', NOW, 'write', Date.now() + 20_000)
    expect(result).toEqual({
      businessId: 'biz-1',
      candidates: 0,
      written: 0,
      skipped: 0,
      truncated: true,
      error: false,
      unchecked: 0,
      list: [],
    })
    expect(auditMock).not.toHaveBeenCalled()
    expect(newSynqedClient).not.toHaveBeenCalled()
  })

  it('P2-4: a throwing client constructor sets error: true instead of an uncaught throw', async () => {
    ;(newSynqedClient as jest.Mock).mockImplementation(() => {
      throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
    })
    const result = await watchOneBusiness('biz-1', NOW, 'write', FAR_DEADLINE)
    expect(result.error).toBe(true)
    expect(result.truncated).toBe(false)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('F-e: a session past the job-probe cap (probeIncomplete) never reaches the candidate list, though its shape reads failed', async () => {
    // No audio_storage_path anywhere here — this exercises the JOB-probe cap
    // (inbox-read.ts's MAX_JOB_PROBES residue) exclusively, never storage.
    const client = makeClient()
    const baseMs = new Date(OLD).getTime()
    client.recordings.list = jest.fn(async () => ({
      recordings: Array.from({ length: 101 }, (_, i) => {
        const created = new Date(baseMs - i * 60_000).toISOString()
        return {
          id: `sess-${i}`,
          business_id: 'biz-1',
          customer_id: 'cust-1',
          store_id: 'store-1',
          staff_id: 'staff-1',
          appointment_id: null,
          audio_storage_path: null,
          duration_seconds: 300,
          status: 'RECORDED',
          created_at: created,
          updated_at: created,
        }
      }),
      total: 101,
    }))
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)

    const result = await watchOneBusiness('biz-1', NOW, 'dry', FAR_DEADLINE)
    // The 100 newest get job-probed (404 → a genuine `failed` candidate each);
    // the 101st (oldest, sess-100) is past MAX_JOB_PROBES and marked
    // probeIncomplete — without the F-e filter it reads the exact same shape
    // (jobStatus null, jobProbeFailed false) and would be a 101st candidate.
    expect(result.unchecked).toBe(1)
    expect(result.candidates).toBe(100)
    expect(result.list).toHaveLength(100)
    expect(result.list.some((c) => c.targetId === 'sess-100')).toBe(false)
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe('watchOneBusiness — recording.transcribe_storm', () => {
  const stormEvents = [1, 2, 3, 4].map((n) => ({
    id: `e${n}`,
    at: `2026-09-10T0${n}:00:00.000Z`,
    action: 'recording.transcribe',
    target_id: 'sess-storm',
    detail: { cost_cents: 10, cents_reserved: 12, customer_id: 'cust-2', staff_id: 'staff-2' },
  }))

  it('writes a storm row whose request_id carries the STORM day, not today', async () => {
    // Isolate the storm path: an empty inbox (no recording.karute_missing candidate).
    const client = { ...makeClient({ stormEvents }), recordings: { list: jest.fn(async () => ({ recordings: [], total: 0 })), get: jest.fn() } }
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)

    const result = await watchOneBusiness('biz-1', NOW, 'write', FAR_DEADLINE)
    expect(result).toMatchObject({ candidates: 1, written: 1, skipped: 0 })
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recording.transcribe_storm',
        targetId: 'sess-storm',
        requestId: 'audit-watch:recording.transcribe_storm:sess-storm:2026-09-10',
        detail: expect.objectContaining({ count: 4, day: '2026-09-10' }),
      }),
    )
  })
})
