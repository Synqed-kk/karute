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
import { rotateBusinessIds } from '@/lib/audit-watch/rotate-business-ids'
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
        // P2-3: the row-level store (never just inside detail) — so a
        // branch-scoped 監査ログ can see it under the STORE ISOLATION LAW.
        storeId: 'store-1',
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

  it('P2-7: a storm dated TODAY is absent from the list and writes nothing — it waits for tomorrow', async () => {
    // Same shape as `stormEvents`, but every receipt lands today (JST) —
    // 2026-09-11T0n:00 UTC is 2026-09-11 (today), inside the read window
    // (from = yesterday start JST, to = NOW = 2026-09-11T05:00 UTC).
    const todayStormEvents = [1, 2, 3, 4].map((n) => ({
      id: `t${n}`,
      at: `2026-09-11T0${n}:00:00.000Z`,
      action: 'recording.transcribe',
      target_id: 'sess-storm-today',
      detail: { cost_cents: 10, cents_reserved: 12, customer_id: 'cust-2', staff_id: 'staff-2' },
    }))
    const client = {
      ...makeClient({ stormEvents: todayStormEvents }),
      recordings: { list: jest.fn(async () => ({ recordings: [], total: 0 })), get: jest.fn() },
    }
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)

    const result = await watchOneBusiness('biz-1', NOW, 'write', FAR_DEADLINE)
    expect(result).toMatchObject({ candidates: 0, written: 0, skipped: 0, list: [] })
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('writes a storm row whose request_id carries the STORM day, not today', async () => {
    // Isolate the storm path: an empty inbox (no recording.karute_missing candidate).
    const client = {
      ...makeClient({ stormEvents }),
      recordings: {
        list: jest.fn(async () => ({ recordings: [], total: 0 })),
        get: jest.fn(async () => ({ id: 'sess-storm', store_id: 'store-9' })),
      },
    }
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)

    const result = await watchOneBusiness('biz-1', NOW, 'write', FAR_DEADLINE)
    expect(result).toMatchObject({ candidates: 1, written: 1, skipped: 0 })
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recording.transcribe_storm',
        targetId: 'sess-storm',
        requestId: 'audit-watch:recording.transcribe_storm:sess-storm:2026-09-10',
        // P2-3: one extra per-candidate recording read fills the row-level store.
        storeId: 'store-9',
        // P3-14/m5b: the storm emit's own shape — untested before this pin,
        // unlike the karute_missing emit's (already pinned above).
        severity: 'notice',
        actorType: 'system',
        source: 'system',
        // second-order delta-verify finding: karute_missing's detail always
        // carries store_id (even null on a failed get) — the storm emit's
        // detail did not carry the field at all. Consistent shape now.
        detail: expect.objectContaining({ count: 4, day: '2026-09-10', store_id: 'store-9' }),
      }),
    )
  })

  it('P2-3: a failed recording lookup leaves storeId undefined but still writes the row', async () => {
    const client = {
      ...makeClient({ stormEvents }),
      recordings: {
        list: jest.fn(async () => ({ recordings: [], total: 0 })),
        get: jest.fn(async () => {
          throw new Error('core down')
        }),
      },
    }
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)

    const result = await watchOneBusiness('biz-1', NOW, 'write', FAR_DEADLINE)
    expect(result).toMatchObject({ candidates: 1, written: 1, skipped: 0 })
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recording.transcribe_storm',
        storeId: undefined,
        // same shape as karuteMissingDetail: a failed get still writes the
        // row, with detail.store_id explicitly null, not merely absent.
        detail: expect.objectContaining({ store_id: null }),
      }),
    )
  })

  it('P3-9/m10a: the storm window\'s `from` derives from the injected now, not the wall clock', async () => {
    const auditListCalls: AuditListArgs[] = []
    const client = {
      ...makeClient(),
      recordings: { list: jest.fn(async () => ({ recordings: [], total: 0 })), get: jest.fn() },
      audit: {
        list: jest.fn(async (args: AuditListArgs) => {
          auditListCalls.push(args)
          return { events: [], total: 0, page: 1, page_size: 200 }
        }),
      },
    }
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)

    // 2026-01-05T03:00 UTC = 2026-01-05 12:00 JST — an arbitrary date far
    // from the real wall clock, to prove the window follows THIS value.
    const injectedNow = new Date('2026-01-05T03:00:00.000Z')
    await watchOneBusiness('biz-1', injectedNow, 'dry', Date.now() + 60_000)

    const pageCall = auditListCalls.find((a) => !('target_id' in a)) as { from: string; to: string }
    expect(pageCall.from).toBe('2026-01-03T15:00:00.000Z') // JST start of 2026-01-04
    expect(pageCall.to).toBe(injectedNow.toISOString())
  })

  it('Greptile round 3 finding 1: a truncated event walk never writes or lists a storm', async () => {
    // Never signals "done" (total stays far ahead of any page returned), so
    // pageRecordingEvents keeps paging — forced to truncate by the deadline
    // check, not by exhausting MAX_AUDIT_PAGES, but the real storm events are
    // genuinely read into `events` on page 1 before that happens.
    const client = {
      ...makeClient(),
      recordings: { list: jest.fn(async () => ({ recordings: [], total: 0 })), get: jest.fn() },
      audit: {
        list: jest.fn(async (args: AuditListArgs & { page?: number; page_size?: number }) => {
          if ('target_id' in args) return { events: [], total: 0, page: 1, page_size: 50 }
          return { events: stormEvents, total: 1000, page: args.page, page_size: 200 }
        }),
      },
    }
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)

    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(1_000) // admission
    nowSpy.mockReturnValueOnce(2_000) // pageRecordingEvents' page-1 check
    nowSpy.mockReturnValue(999_999_999) // page-2 check: deadline hit → truncated

    const result = await watchOneBusiness('biz-1', NOW, 'write', 100_000)
    expect(result.truncated).toBe(true)
    expect(result.candidates).toBe(0)
    expect(result.written).toBe(0)
    expect(result.list).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()

    nowSpy.mockRestore()
  })
})

// P3-14/m7: both in-loop deadline checks (missing candidates, storm
// candidates) stop their own loop honestly — truncated: true, nothing
// written past the point the budget ran out. Date.now is mocked directly
// (rather than real elapsed time) since audit() itself is mocked and every
// other call in these paths is a resolved-microtask mock, so the only real
// Date.now() call sites left are run.ts's own three checks (admission, the
// page walk, the write loop reached).
describe('watchOneBusiness — in-loop deadline checks (P3-14/m7)', () => {
  afterEach(() => {
    jest.spyOn(Date, 'now').mockRestore()
  })

  it('the karute_missing write loop stops honestly once the deadline passes mid-loop', async () => {
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(1_000) // admission: 1000 + 30_000 <= 100_000
    nowSpy.mockReturnValueOnce(2_000) // pageRecordingEvents' own page-1 check
    nowSpy.mockReturnValue(999_999_999) // the missing loop's first check

    const result = await watchOneBusiness('biz-1', NOW, 'write', 100_000)
    expect(result.truncated).toBe(true)
    expect(result.candidates).toBe(1) // computed before the loop runs
    expect(result.written).toBe(0)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('the storm write loop stops honestly once the deadline passes mid-loop', async () => {
    const client = {
      ...makeClient({ stormEvents: [1, 2, 3, 4].map((n) => ({
        id: `s${n}`,
        at: `2026-09-10T0${n}:00:00.000Z`,
        action: 'recording.transcribe',
        target_id: 'sess-storm-loop',
        detail: { cost_cents: 10, cents_reserved: 12, customer_id: 'cust-9', staff_id: 'staff-9' },
      })) }),
      recordings: { list: jest.fn(async () => ({ recordings: [], total: 0 })), get: jest.fn() },
    }
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)

    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(1_000) // admission
    nowSpy.mockReturnValueOnce(2_000) // pageRecordingEvents' own page-1 check
    nowSpy.mockReturnValue(999_999_999) // the storms loop's first check

    const result = await watchOneBusiness('biz-1', NOW, 'write', 100_000)
    expect(result.truncated).toBe(true)
    expect(result.candidates).toBe(1) // one storm, computed before the loop runs
    expect(result.written).toBe(0)
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe('rotateBusinessIds (Greptile round 3 finding 2)', () => {
  const ids = ['biz-a', 'biz-b', 'biz-c']

  it('at 00:xx UTC the walk starts at the first business (no rotation)', () => {
    expect(rotateBusinessIds(ids, new Date('2026-09-11T00:45:00.000Z'))).toEqual([
      'biz-a',
      'biz-b',
      'biz-c',
    ])
  })

  it('at 01:xx UTC the walk starts at the second business', () => {
    expect(rotateBusinessIds(ids, new Date('2026-09-11T01:15:00.000Z'))).toEqual([
      'biz-b',
      'biz-c',
      'biz-a',
    ])
  })

  it('an empty list rotates to itself, never throws', () => {
    expect(rotateBusinessIds([], new Date('2026-09-11T01:15:00.000Z'))).toEqual([])
  })
})

// ⚖ UPDATE 25 GROUP B, d5 — recording.no_sessions_today. The 9/9 shape: a
// staffer with a kept appointment today, a session in the previous 7 days,
// and zero sessions today. Evaluated only ≥21:00 JST.
describe('watchOneBusiness — recording.no_sessions_today (d5)', () => {
  const AT_21 = new Date('2026-09-11T12:00:00.000Z') // 21:00 JST
  const AT_2059 = new Date('2026-09-11T11:59:00.000Z') // 20:59 JST
  const AT_2101 = new Date('2026-09-11T12:01:00.000Z') // 21:01 JST
  const threeDaysBefore = (d: Date) => new Date(d.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()

  function clientForD5(opts: {
    sessionsCreatedAt: string
    appointmentsToday: { staff_id: string; status: string }[]
    staff: { id: string; user_id: string | null }[]
    existingEvents?: { id: string; action: string; detail: unknown; at: string }[]
  }) {
    const auditList = jest.fn(async (args: AuditListArgs) => {
      if ('target_id' in args) return { events: [], total: 0, page: 1, page_size: 50 }
      const events = opts.existingEvents ?? []
      return { events, total: events.length, page: 1, page_size: 200 }
    })
    return {
      recordings: {
        list: jest.fn(async () => ({
          recordings: [
            {
              id: 'sess-d5',
              business_id: 'biz-1',
              customer_id: 'cust-1',
              store_id: 'store-1',
              staff_id: 'staff-a',
              appointment_id: null,
              audio_storage_path: null,
              duration_seconds: 300,
              status: 'RECORDED',
              created_at: opts.sessionsCreatedAt,
              updated_at: opts.sessionsCreatedAt,
            },
          ],
          total: 1,
        })),
        get: jest.fn(async (id: string) => ({
          id,
          business_id: 'biz-1',
          customer_id: 'cust-1',
          store_id: 'store-1',
          staff_id: 'staff-a',
          appointment_id: null,
          audio_storage_path: null,
          duration_seconds: 300,
          status: 'RECORDED',
          created_at: opts.sessionsCreatedAt,
          updated_at: opts.sessionsCreatedAt,
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
      appointments: {
        list: jest.fn(async () => ({
          appointments: opts.appointmentsToday,
          total: opts.appointmentsToday.length,
        })),
      },
      staff: {
        list: jest.fn(async () => ({ staff: opts.staff, total: opts.staff.length })),
      },
    }
  }

  const baseOpts = () => ({
    sessionsCreatedAt: threeDaysBefore(AT_21),
    appointmentsToday: [{ staff_id: 'staff-a', status: 'SCHEDULED' }],
    staff: [{ id: 'staff-a', user_id: null }],
  })

  it('20:59 JST is silent — the hour gate has not opened yet, and neither new read runs', async () => {
    const client = clientForD5(baseOpts())
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)
    const result = await watchOneBusiness('biz-1', AT_2059, 'write', FAR_DEADLINE)
    expect(result.list.some((c) => c.action === 'recording.no_sessions_today')).toBe(false)
    expect(client.appointments.list).not.toHaveBeenCalled()
    expect(client.staff.list).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recording.no_sessions_today' }),
    )
  })

  it('21:00 JST fires ONE row, target-less, with the exact detail keys + deterministic request_id', async () => {
    const client = clientForD5(baseOpts())
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)
    const result = await watchOneBusiness('biz-1', AT_21, 'write', FAR_DEADLINE)
    const call = auditMock.mock.calls
      .map(([e]) => e as Record<string, unknown>)
      .find((e) => e.action === 'recording.no_sessions_today')
    expect(call).toBeDefined()
    expect(call).toMatchObject({
      category: 'recording',
      action: 'recording.no_sessions_today',
      actorId: null,
      actorType: 'system',
      businessId: 'biz-1',
      targetType: 'business',
      severity: 'warning',
      source: 'system',
      requestId: 'audit-watch:recording.no_sessions_today:biz-1:2026-09-11',
    })
    expect(call!.targetId).toBeUndefined()
    expect(call!.detail).toEqual({
      day: '2026-09-11',
      staff_ids: ['staff-a'],
      kept_appointments: 1,
      sessions_today: 0,
      sessions_prev_7d: 1,
    })
    expect(result.list).toContainEqual({
      action: 'recording.no_sessions_today',
      targetId: 'biz-1',
      day: '2026-09-11',
      count: 1,
    })
  })

  it('21:01 dedupes off the already-paged recording-category events — no second row, no extra read', async () => {
    const client = clientForD5({
      ...baseOpts(),
      existingEvents: [
        { id: 'e1', action: 'recording.no_sessions_today', detail: { day: '2026-09-11' }, at: AT_21.toISOString() },
      ],
    })
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)
    const result = await watchOneBusiness('biz-1', AT_2101, 'write', FAR_DEADLINE)
    expect(result.list.some((c) => c.action === 'recording.no_sessions_today')).toBe(false)
    expect(auditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recording.no_sessions_today' }),
    )
    // The dedupe cost NOTHING extra: isNewCandidate is unchanged, and this
    // scan never reaches the appointments/staff reads at all.
    expect(client.appointments.list).not.toHaveBeenCalled()
    expect(client.staff.list).not.toHaveBeenCalled()
  })

  it('a truncated recording-events walk → silent this run, never a false zero', async () => {
    const client = clientForD5(baseOpts())
    client.audit.list = jest.fn(async (args: AuditListArgs & { page?: number }) => {
      if ('target_id' in args) return { events: [], total: 0, page: 1, page_size: 50 }
      // A non-empty page that never satisfies `page * page_size >= total` —
      // forces the walk to exhaust MAX_AUDIT_PAGES and return truncated: true
      // (an EMPTY page would instead read as "done" and exit early).
      return {
        events: [{ id: `e-${args.page}`, action: 'recording.transcribe', at: AT_21.toISOString(), detail: {} }],
        total: 999_999,
        page: args.page ?? 1,
        page_size: 200,
      }
    })
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)
    const result = await watchOneBusiness('biz-1', AT_21, 'write', FAR_DEADLINE)
    expect(result.truncated).toBe(true)
    expect(result.list.some((c) => c.action === 'recording.no_sessions_today')).toBe(false)
    expect(client.appointments.list).not.toHaveBeenCalled()
    expect(client.staff.list).not.toHaveBeenCalled()
  })

  it('dry mode lists the day + staff count, writes nothing', async () => {
    const client = clientForD5(baseOpts())
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)
    const result = await watchOneBusiness('biz-1', AT_21, 'dry', FAR_DEADLINE)
    expect(result.list).toContainEqual({
      action: 'recording.no_sessions_today',
      targetId: 'biz-1',
      day: '2026-09-11',
      count: 1,
    })
    expect(auditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recording.no_sessions_today' }),
    )
  })

  it('the appointments read throwing → the business’s own catch (error: true), never a false zero', async () => {
    const client = clientForD5(baseOpts())
    client.appointments.list = jest.fn(async () => {
      throw new Error('core down')
    })
    ;(newSynqedClient as jest.Mock).mockReturnValue(client)
    const result = await watchOneBusiness('biz-1', AT_21, 'write', FAR_DEADLINE)
    expect(result.error).toBe(true)
    expect(auditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recording.no_sessions_today' }),
    )
  })
})
