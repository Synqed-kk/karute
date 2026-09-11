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
    expect(result).toMatchObject({ businessId: 'biz-1', candidates: 1, written: 1, skipped: 0, truncated: false })
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
        requestId: 'audit-watch:recording.karute_missing:sess-old:2026-09-11',
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

  it('mode "dry": finds the same candidate but calls audit() zero times', async () => {
    const result = await watchOneBusiness('biz-1', NOW, 'dry', FAR_DEADLINE)
    expect(result).toMatchObject({ candidates: 1, written: 1, skipped: 0 })
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('a prior row for the same target+action is skipped, never written, one dedupe read only (CP2)', async () => {
    ;(newSynqedClient as jest.Mock).mockReturnValue(
      makeClient({ existingRows: [{ id: 'e1', action: 'recording.karute_missing', detail: {} }] }),
    )
    const result = await watchOneBusiness('biz-1', NOW, 'write', FAR_DEADLINE)
    expect(result).toMatchObject({ candidates: 1, written: 0, skipped: 1 })
    expect(auditMock).not.toHaveBeenCalled()
    const client = (newSynqedClient as jest.Mock).mock.results[0].value
    // One target-scoped dedupe read for THIS candidate, never retried — the
    // other call on this mock is step (b)'s category-wide storm page walk.
    const targetScoped = (client.audit.list as jest.Mock).mock.calls.filter(([a]) => 'target_id' in a)
    expect(targetScoped).toHaveLength(1)
  })

  it('a budget already past its deadline returns immediately, truncated, nothing processed', async () => {
    const result = await watchOneBusiness('biz-1', NOW, 'write', Date.now() - 1)
    expect(result).toEqual({ businessId: 'biz-1', candidates: 0, written: 0, skipped: 0, truncated: true })
    expect(auditMock).not.toHaveBeenCalled()
    expect(newSynqedClient).not.toHaveBeenCalled()
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
