/**
 * ⚖ THE TRANSCRIPTION SPEND WALL (2026-09-08) — every door, one meter.
 *
 * The claims, and they are all about MONEY:
 *
 *   1. THE CEILING IS ASKED BEFORE THE PROVIDER. A refused consume never
 *      reaches Deepgram and never debits — the assertions count the PROVIDER
 *      mock (`@/lib/deepgram`), not the wrapper, so a wall that asks after
 *      spending cannot pass.
 *   2. THE DEBIT RIDES THE PROVIDER'S ANSWER, not the job's success. The
 *      EMPTY_TRANSCRIPT throw is the case that proves it: deterministic for the
 *      same audio, re-run on every requeue, and billed by Deepgram every time.
 *   3. AN UNREADABLE LEDGER REFUSES. No `.catch` on the consume — the worker's
 *      own law for the reads beside it ("could not check" is never "under the
 *      ceiling"), so a core blip fails the job instead of spending.
 *   4. ONE CONSUME PER REQUEST on the two interactive routes: the meter
 *      consumes now, so the routes' own consume was REMOVED — two would count
 *      the hourly cap twice.
 *   5. ONE RECEIPT PER CALL. The worker/discard doors get theirs from the
 *      wrapper; the two routes carry the same two numbers on the row they
 *      already emit.
 *
 *   6. THE LEDGER IS WRITTEN BEFORE THE MONEY MOVES (fix round 4). The wall
 *      RESERVES an estimate — the audio's own byte count at the recorder's
 *      bitrate, read from the buffer or from the storage server's
 *      content-length — and REFUSES when the ledger will not take it. A debit
 *      that used to be lost after three attempts left the money spent and
 *      absent from the cap forever; now nothing is spent unless a ledger row
 *      landed first, and only the smaller TRUE-UP can still go missing.
 *
 * The cents are pinned in both directions: the pure estimator, and the ONE
 * fallback a real spend can arrive with — the named floor, never a caller's
 * own number (fix round 2, Greptile P1: a client-supplied duration hint used
 * to win over it, so a phone could name 60 s for a 90-minute session and be
 * billed a cent) and never zero.
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
process.env.SPEAKER_ID_MODE = 'off'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-local.supabase.co'
// Only the three fix-round-6 cases below let the REAL provider wrapper run; it
// refuses to start without a key.
process.env.DEEPGRAM_API_KEY ??= 'test-deepgram-key'

import { createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string) => k,
  getLocale: async () => 'ja',
}))

/** Call order across the mocks — the ONLY way to prove the debit happened
 *  BEFORE the EMPTY_TRANSCRIPT throw rather than merely happening. */
const order: string[] = []

// ── THE PROVIDER (the thing that costs money) ───────────────────────────────
// Typed as the provider's own result: the fix-round-6 cases hand the REAL
// wrapper's return value back through this same mock, and an inferred
// `words: never[]` would refuse it.
const deepgramResult: DeepgramTranscribeResult = {
  transcript: 'こんにちは',
  durationSec: 5400,
  requestId: 'dg-1',
  confidence: 0.9,
  words: [],
  paragraphs: [],
}
const transcribeUrlWithDeepgram = jest.fn(async () => {
  order.push('deepgram')
  return deepgramResult
})
const transcribeWithDeepgram = jest.fn(async () => {
  order.push('deepgram')
  return deepgramResult
})
// Spread the REAL module: the wall's release now turns on `err instanceof
// DeepgramHttpError`, and that class must be the SAME object on both sides of
// the mock or the check silently answers false for every error (fix round 6).
jest.mock('@/lib/deepgram', () => ({
  ...jest.requireActual('@/lib/deepgram'),
  transcribeUrlWithDeepgram: (...a: unknown[]) => transcribeUrlWithDeepgram(...(a as [])),
  transcribeWithDeepgram: (...a: unknown[]) => transcribeWithDeepgram(...(a as [])),
}))

// ── THE LEDGER (core's own, ridden rather than replaced) ────────────────────
type ConsumeResult = {
  allowed: boolean
  reason: 'ok' | 'hourly_count' | 'daily_cost'
  cap: number
  used: number
  remaining: number
  costCap: number
  costUsed: number
  resetAt: string
}
const ALLOWED: ConsumeResult = {
  allowed: true,
  reason: 'ok',
  cap: 100,
  used: 1,
  remaining: 99,
  costCap: 3000,
  costUsed: 10,
  resetAt: '2026-09-09T00:00:00.000Z',
}
const REFUSED: ConsumeResult = {
  allowed: false,
  reason: 'daily_cost',
  cap: 100,
  used: 12,
  remaining: 88,
  costCap: 3000,
  costUsed: 3000,
  resetAt: '2026-09-09T00:00:00.000Z',
}
const consume = jest.fn(async (route: string): Promise<ConsumeResult> => {
  void route
  return ALLOWED
})
const recordUsage = jest.fn(async () => {})
/** The ledger as the code sees it — the order push is OUTSIDE the jest.fn so a
 *  per-test mockResolvedValue can never silently drop it. */
const aiRateLimit = {
  consume: (route: string) => {
    order.push('consume')
    return consume(route)
  },
  recordUsage: (...a: unknown[]) => {
    // reserve or true-up, decided by WHERE the call sits relative to the
    // provider rather than by anything the wrapper says about itself — so a
    // wall that reserved AFTER spending shows up in the pin as a delta in the
    // wrong slot, which is exactly what m16 does.
    //
    // A NEGATIVE row is named for what it is (fix round 5): the RELEASE. The
    // sign is the ledger's own, not the wrapper's word for itself, so a
    // release that fired on a successful call (m20) or fired twice (m23)
    // lands in the order pin as an extra slot nobody asked for.
    const cents = a[3]
    order.push(
      typeof cents === 'number' && cents < 0
        ? 'recordUsage(release)'
        : order.includes('deepgram')
          ? 'recordUsage(delta)'
          : 'recordUsage(reserve)',
    )
    return (recordUsage as (...x: unknown[]) => Promise<void>)(...a)
  },
}

// ── THE STORAGE SERVER'S ANSWER ABOUT OUR OBJECT (fix round 4) ──────────────
// The reserve HEADs the signed URL and reads content-length. This is the ONLY
// size the wall may believe for a URL audio: it is the storage server's own
// statement about the object WE minted a url for, never a number a caller sent.
// `null` = the HEAD fails (an outage, a missing header), which must reserve the
// floor rather than hand out a free transcription.
// 32,400,000 B ÷ 6,000 B/s = 5,400 s — the 90-minute session the whole suite
// bills at 45 ¢, so the default keeps every existing cent pin exact.
const headBytes: { current: number | null } = { current: 32_400_000 }
// ── DEEPGRAM'S OWN HTTP ANSWER (fix round 6) ────────────────────────────────
// Null by default, and then a non-HEAD fetch is the error it has always been.
// The three tests that need the REAL provider wrapper — the ones whose whole
// claim is WHICH error it throws — queue one answer here instead of mocking
// the wrapper away.
const deepgramHttp: { next: (() => Response) | null } = { next: null }
const originalFetch = global.fetch
const fetchMock = jest.fn(async (url: unknown, init?: { method?: string }) => {
  if (init?.method === 'HEAD') {
    if (headBytes.current == null) throw new Error('storage unreachable')
    return { headers: new Headers({ 'content-length': String(headBytes.current) }) }
  }
  const queued = deepgramHttp.next
  if (!queued) throw new Error(`unexpected non-HEAD fetch: ${String(url)}`)
  deepgramHttp.next = null
  return queued()
})

const audit = jest.fn()
// Spread the REAL module: the facade's own audit hook reads FACADE_AUDIT_MAP
// out of it, and a bare { audit } mock makes that read throw inside the hook —
// a 500 that looks like a route bug and is really a missing export.
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => audit(...(a as [])),
}))

jest.mock('@/lib/ai/karute-extract', () => ({
  runKaruteExtraction: jest.fn(async () => ({ result: { entries: [] }, usage: null })),
}))
jest.mock('@/lib/ai/karute-summarize', () => ({
  runKaruteSummary: jest.fn(async () => ({ result: { summary: 'S' }, usage: null })),
}))
jest.mock('@/lib/diarized', () => ({
  buildDiarizedTranscript: jest.fn(() => null),
  toSpeakerText: jest.fn(() => ''),
}))

const createSignedUrl = jest.fn(async () => ({
  data: { signedUrl: 'https://x/audio' },
  error: null,
}))
// ── THE TRANSCRIPT MEMO'S STORAGE (PR-5, charge once) ───────────────────────
// The bucket as the memo sees it: one map, cleared before every test. A `trc/`
// key that is not in it answers storage's real NoSuchKey shape (HTTP 400, body
// statusCode '404', 'Object not found' — take-binding.ts#isStorageNotFound); a
// second upload of the same key answers the duplicate refusal unless it asks
// to upsert (the memo's corrupt-object repair). Every other key keeps the
// answer this suite always gave, so no pre-PR-5 test sees a different bucket.
const memoStore = new Map<string, string>()
const storageDownload = jest.fn(async (key: string) => {
  if (!key.startsWith('trc/')) return { data: null, error: { message: 'none' } }
  const body = memoStore.get(key)
  return body === undefined
    ? { data: null, error: { status: 400, statusCode: '404', message: 'Object not found' } }
    : { data: new Blob([body]), error: null }
})
const storageUpload = jest.fn(
  async (key: string, body: string, opts?: { upsert?: boolean; contentType?: string }) => {
    if (memoStore.has(key) && !opts?.upsert) {
      return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
    }
    memoStore.set(key, body)
    return { data: { path: key }, error: null }
  },
)
// ⚖ S53 A5 — the "transcribing now" lease lives beside the memo
// (`trc/<audio>.<locale>.lease.json`). Its I/O goes to its OWN map and mocks,
// so every PR-5 pin above keeps counting memo reads and writes only.
const leaseStore = new Map<string, string>()
const isLease = (key: unknown) => typeof key === 'string' && key.endsWith('.lease.json')
const leaseDownload = jest.fn(async (key: string) => {
  const body = leaseStore.get(key)
  return body === undefined
    ? { data: null, error: { status: 400, statusCode: '404', message: 'Object not found' } }
    : { data: new Blob([body]), error: null }
})
const leaseUpload = jest.fn(async (key: string, body: string, opts?: { upsert?: boolean }) => {
  if (leaseStore.has(key) && !opts?.upsert) {
    return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
  }
  leaseStore.set(key, body)
  return { data: { path: key }, error: null }
})
// ⚖ S57 — the true-up's recorded fact lives beside the memo too
// (`trc/<audio>.<locale>.trueup.json`, create-only). Its own map and mocks, so
// the memo pins above still count memo reads and writes only.
const trueUpStore = new Map<string, string>()
const isTrueUp = (key: unknown) => typeof key === 'string' && key.endsWith('.trueup.json')
const trueUpDownload = jest.fn(async (key: string) => {
  const body = trueUpStore.get(key)
  return body === undefined
    ? { data: null, error: { status: 400, statusCode: '404', message: 'Object not found' } }
    : { data: new Blob([body]), error: null }
})
const trueUpUpload = jest.fn(async (key: string, body: string, opts?: { upsert?: boolean }) => {
  if (trueUpStore.has(key) && !opts?.upsert) {
    return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
  }
  trueUpStore.set(key, body)
  return { data: { path: key }, error: null }
})
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl,
        download: (...a: unknown[]) =>
          isLease(a[0])
            ? leaseDownload(...(a as [string]))
            : isTrueUp(a[0])
              ? trueUpDownload(...(a as [string]))
              : storageDownload(...(a as [string])),
        upload: (...a: unknown[]) =>
          isLease(a[0])
            ? leaseUpload(...(a as [string, string]))
            : isTrueUp(a[0])
              ? trueUpUpload(...(a as [string, string]))
              : storageUpload(...(a as [string, string])),
        info: jest.fn(async () => ({ data: { size: 1 }, error: null })),
      }),
    },
  }),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'auth-user-1' } }, error: null })) },
  })),
}))
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))

// ── THE CORE CLIENT (one fake, every door) ──────────────────────────────────
const getConsent = jest.fn(async () => ({
  consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION },
}))
const listDiscards = jest.fn(async () => ({
  events: [] as Array<{
    id: string
    recording_session_id: string
    source: string
    reason?: string
  }>,
}))
const upsertSegments = jest.fn(async () => ({ segments: [] }))
const listSegments = jest.fn(async () => ({ segments: [] as Array<{ text: string }> }))
const recordingsGet = jest.fn(async () => ({
  duration_seconds: 60,
  customer_id: 'cust-1',
  audio_storage_path: null as string | null,
}))
const claim = jest.fn()
const complete = jest.fn(async () => ({}))
const fail = jest.fn(async () => ({}))
const fakeClient = {
  aiRateLimit,
  customers: { getConsent, get: jest.fn(async () => ({ name: 'customer' })) },
  orgSettings: { get: jest.fn(async () => ({ settings: {} })) },
  karuteRecords: {
    getByRecordingSession: jest.fn(async () => {
      throw Object.assign(new Error('nf'), { status: 404 })
    }),
    create: jest.fn(async () => ({ id: 'record-1' })),
    update: jest.fn(async () => ({ id: 'record-1' })),
  },
  recordingJobs: { claim, complete, fail },
  recordingDiscards: { list: listDiscards },
  recordings: { upsertSegments, listSegments, get: recordingsGet },
  staff: { get: jest.fn(async () => ({ id: 'staff-1', user_id: 'auth-user-9' })) },
  appointments: { get: jest.fn(async () => ({ notes: null })) },
}
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(() => fakeClient),
  SynqedError: class extends Error {},
}))
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))

// ── THE TWO INTERACTIVE ROUTES' OWN BOUNDARIES ──────────────────────────────
const planAllowed = { current: true }
jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: jest.fn(async () => planAllowed.current),
  featureAllowedForBusiness: jest.fn(async () => planAllowed.current),
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ speaker_diarization: true })),
  orgSettingsWithClient: jest.fn(async () => ({ speaker_diarization: true })),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  businessIdForUser: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => null),
  getCurrentAccessToken: jest.fn(async () => 'web-cookie-token'),
  staffListByBusinessOrThrow: jest.fn(async () => [
    { id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' },
  ]),
}))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return {
    ...actual,
    capabilitiesForUser: jest.fn(async () => new Set(['records.write'])),
    getMyCapabilities: jest.fn(async () => new Set(['records.write'])),
    // The web route's cookie-side capability read (PR-5 gates its memo on it).
    // Replaced, not spread: the real `can` closes over the REAL
    // getMyCapabilities, so overriding that export above would not reach it.
    can: jest.fn(async () => true),
  }
})
jest.mock('@/lib/app-api/customer-facade', () => ({
  resolveSelfStaffId: jest.fn(async () => null),
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (id: string) => id),
  resolveSynqedStaffIdForBusiness: jest.fn(async (id: string) => id),
}))
const auditWeb = jest.fn(async () => {})
jest.mock('@/lib/audit-web', () => ({ auditWeb: (...a: unknown[]) => auditWeb(...(a as [])) }))

import { processRecordingJobs } from '@/lib/jobs/process-recording'
import { DeepgramHttpError, type DeepgramTranscribeResult } from '@/lib/deepgram'
import { transcribeAndPersistDiscardWithClient } from '@/lib/recording/discard-transcript.core'
import type { SynqedClient } from '@synqed-kk/client'
import { estimateTranscriptionCostCents } from '@/lib/ai-rate-limit'
import { AI_SPEND_LIMIT } from '@/lib/recording/job-errors'
import { POST as webTranscribePOST } from '@/app/api/ai/transcribe/route'
import { POST as facadeTranscribePOST } from '@/app/api/app/v1/ai/transcribe/route'
import { getCurrentUserStaffId } from '@/lib/staff'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import {
  LEASE_TAKEOVER_RESERVE_MS,
  LEASE_WORKER_FUNCTION_LIMIT_MS,
  LEASE_WORKER_WAIT_MS,
  TRANSCRIPTION_IN_PROGRESS,
  runMeteredTranscription,
} from '@/lib/ai/transcribe'
import { transcriptionReceiptSeverity } from '@/lib/ai/transcription-receipt'
import { maxDuration as JOB_ROUTE_MAX_DURATION_S } from '@/app/api/jobs/process/route'
import { readTranscriptMemo } from '@/lib/recording/transcript-memo'
import { TRANSCRIPT_LEASE_TTL_MS } from '@/lib/recording/transcript-lease-ttl'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { can } from '@/lib/auth/require-permission'
import { conformingKey, rescueKey } from './helpers/recording-key-fixtures'

const OWN_KEY = conformingKey('biz-1')
const baseJob = {
  id: 'job-1',
  business_id: 'biz-1',
  recording_session_id: 'sess-1',
  status: 'RUNNING',
  attempts: 1,
  max_attempts: 3,
  last_error: null,
  karute_record_id: null,
  claimed_at: null,
  created_at: '',
  updated_at: '',
  payload: {
    customer_id: 'cust-1',
    staff_id: 'staff-1',
    audio_path: OWN_KEY,
    duration_seconds: 600,
  } as Record<string, unknown>,
}

/** Every audit() call for one action. */
const rows = (action: string) =>
  audit.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((e) => e.action === action)

afterAll(() => {
  global.fetch = originalFetch
})

beforeEach(() => {
  jest.clearAllMocks()
  order.length = 0
  headBytes.current = 32_400_000
  deepgramHttp.next = null
  global.fetch = fetchMock as unknown as typeof global.fetch
  // reset, not clear: a queued `...Once` that a test never reached would
  // otherwise leak into the next one.
  consume.mockReset()
  consume.mockResolvedValue(ALLOWED)
  recordUsage.mockReset()
  recordUsage.mockResolvedValue(undefined)
  deepgramResult.transcript = 'こんにちは'
  deepgramResult.durationSec = 5400
  planAllowed.current = true
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/audio' }, error: null })
  getConsent.mockResolvedValue({ consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION } })
  listDiscards.mockResolvedValue({ events: [] })
  recordingsGet.mockResolvedValue({
    duration_seconds: 60,
    customer_id: 'cust-1',
    audio_storage_path: null,
  })
  listSegments.mockResolvedValue({ segments: [] })
  memoStore.clear()
  leaseStore.clear()
  trueUpStore.clear()
  // Reset, for the same reason as consume: the t2c rows whose key fails the
  // grammar never reach `can`, and their queued answer must not leak.
  ;(can as jest.Mock).mockReset()
  ;(can as jest.Mock).mockResolvedValue(true)
})

// ── t3 — the cents ──────────────────────────────────────────────────────────
describe('the cents (0.5 ¢/min, rounded up, never below one)', () => {
  // 130 and 3661 are the ROUNDING cases: both land between two cents, so a
  // `floor` here still answers 45 for a 90-minute take and only these two rows
  // go red — the whole reason they are in the table.
  it.each([
    [61, 1],
    [130, 2],
    [5400, 45],
    [3661, 31],
  ])('%i seconds → %i ¢', (seconds, cents) => {
    expect(estimateTranscriptionCostCents(seconds)).toBe(cents)
  })
})

// ── t1 / t2 / t4 / t7 — the worker ──────────────────────────────────────────
describe('the job worker — the phone’s normal save path', () => {
  const runOneJob = async (job: Record<string, unknown> = baseJob) => {
    claim.mockResolvedValueOnce(job).mockResolvedValueOnce(null)
    await processRecordingJobs(10_000)
  }

  it('t1 refused → the provider is never called, the job fails with AI_SPEND_LIMIT, nothing is debited', async () => {
    consume.mockResolvedValueOnce(REFUSED)

    await runOneJob()

    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(transcribeWithDeepgram).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledWith('job-1', AI_SPEND_LIMIT)
    expect(complete).not.toHaveBeenCalled()
  })

  it('t7 refused → ONE recording.transcribe_refused row, severity warning, with the ledger’s own numbers', async () => {
    consume.mockResolvedValueOnce(REFUSED)

    await runOneJob()

    expect(rows('recording.transcribe')).toHaveLength(0)
    const refusals = rows('recording.transcribe_refused')
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      category: 'recording',
      severity: 'warning',
      actorType: 'system',
      actorId: null,
      businessId: 'biz-1',
      targetType: 'recording',
      targetId: 'sess-1',
      source: 'system',
      detail: {
        door: 'job',
        reason: 'daily_cost',
        cost_used_cents: 3000,
        cost_cap_cents: 3000,
        recording_session_id: 'sess-1',
        customer_id: 'cust-1',
        staff_id: 'staff-1',
      },
    })
  })

  it('t2 the debit rides the provider’s answer — an EMPTY_TRANSCRIPT job is still billed, BEFORE it throws', async () => {
    deepgramResult.transcript = '   '
    deepgramResult.durationSec = 5400

    await runOneJob()

    expect(recordUsage).toHaveBeenCalledWith('transcribe', null, null, 45)
    expect(fail).toHaveBeenCalledWith('job-1', 'EMPTY_TRANSCRIPT')
    // The order is the claim: ask → RESERVE → spend, and only then the throw.
    // The provider's answer matches the estimate here (5,400 s both ways), so
    // there is no true-up to make — the ledger already holds the 45 ¢.
    expect(order).toEqual(['consume', 'recordUsage(reserve)', 'deepgram'])
  })

  it('t7 a billed job files ONE recording.transcribe receipt — ids and numbers only', async () => {
    await runOneJob()

    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      category: 'recording',
      actorType: 'system',
      actorId: null,
      businessId: 'biz-1',
      targetType: 'recording',
      targetId: 'sess-1',
      requestId: 'job-1',
      source: 'system',
      detail: {
        door: 'job',
        duration_seconds: 5400,
        cost_cents: 45,
        cents_reserved: 45,
        debit_recorded: true,
        recording_session_id: 'sess-1',
        customer_id: 'cust-1',
        staff_id: 'staff-1',
        attempt: 1,
        rescued: false,
      },
    })
    // A landed debit is an ordinary row — the 'warning' severity below is
    // reserved for the two ways the wall stops holding.
    expect(receipts[0].severity).toBeUndefined()
    expect(rows('recording.transcribe_refused')).toHaveLength(0)
  })

  // ⚖ THE BILLED LENGTH NEVER COMES FROM A CLIENT (fix round 2, Greptile P1).
  // `duration_seconds` on this payload is a number the PHONE wrote, and the
  // wrapper used to prefer it over the floor whenever the provider returned
  // none — so "600" here bought a 90-minute session for 5 ¢. baseJob still
  // carries it, on purpose: the assertion is that it changes nothing.
  it('t3 the provider returned no duration → the FLOOR is billed (3600 s → 30 ¢), even though the job payload says 600', async () => {
    deepgramResult.durationSec = 0

    await runOneJob()

    expect(baseJob.payload.duration_seconds).toBe(600)
    // The receipt bills the floor, exactly as before — the provider gave no
    // length, so a client's 600 is still not allowed to become one.
    expect(rows('recording.transcribe')[0].detail).toMatchObject({ cost_cents: 30 })
    // …and the LEDGER holds the reserve, 45 ¢, because the object's own 32.4 MB
    // says 90 minutes. That is MORE than the floor, so there is no true-up and
    // the over-reservation stands (fix round 4 — it is never refunded).
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledWith('transcribe', null, null, 45)
    // 600 s would have been 5 ¢. The ledger never sees it.
    expect(recordUsage).not.toHaveBeenCalledWith('transcribe', null, null, 5)
  })

  it('t3 no duration anywhere → the named floor is billed (3600 s → 30 ¢), never zero', async () => {
    deepgramResult.durationSec = 0
    // No size either: the HEAD fails, so the RESERVE falls to the same floor.
    headBytes.current = null

    await runOneJob({ ...baseJob, payload: { ...baseJob.payload, duration_seconds: undefined } })

    expect(recordUsage).toHaveBeenCalledWith('transcribe', null, null, 30)
    expect(rows('recording.transcribe')[0].detail).toMatchObject({
      cost_cents: 30,
      cents_reserved: 30,
    })
  })

  it('t4 an UNREADABLE ledger refuses: the job fails with that error, nothing is spent or debited', async () => {
    consume.mockRejectedValueOnce(new Error('core unreachable'))

    await runOneJob()

    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
    // Recording hole PR-1: the worker names the stage in front of the raw line.
    expect(fail).toHaveBeenCalledWith('job-1', 'transcription_failed: core unreachable')
    // Not the spend-limit word: only a classified refusal earns that name.
    expect(fail).not.toHaveBeenCalledWith('job-1', AI_SPEND_LIMIT)
  })

  it('a rescued take is billed too, and its receipt says which door and which take', async () => {
    await runOneJob({
      ...baseJob,
      payload: { ...baseJob.payload, audio_path: rescueKey('biz-1') },
    })

    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(1)
    expect(receipts[0].detail).toMatchObject({
      door: 'from_session',
      rescued: true,
      take_id: '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30',
    })
  })
})

// ── t9 — the provider body is PRIVATE (fix round 2, Greptile P2) ────────────
//
// A wall with a door beside it is a decoration. While `runTranscription` was
// exported, any new caller could import it and reach Deepgram with no ceiling
// asked and no debit filed — and the money would only show up on the invoice.
// Two locks: the module exports it to nobody, and no file under src/ calls it
// (or the provider under it) by name.
describe('the provider body is unreachable from outside the wrapper', () => {
  it('t9 @/lib/ai/transcribe exports no runTranscription', () => {
    const exported = Object.keys(jest.requireActual('@/lib/ai/transcribe'))
    expect(exported).not.toContain('runTranscription')
    // The wrapper IS exported — a test that passed because the module failed to
    // load, or because the name simply moved, would prove nothing.
    expect(exported).toContain('runMeteredTranscription')
  })

  it('t9 no file under src/ calls the provider body, or Deepgram itself, directly', () => {
    // Anchored on THIS file, not the cwd — a run from anywhere walks the same
    // tree. The two homes that are allowed to call: the wrapper's own file (it
    // calls both) and deepgram.ts (it DEFINES both).
    const SRC = path.resolve(__dirname, '..', '..')
    const METER = path.join(SRC, 'lib', 'ai', 'transcribe.ts')
    const DEEPGRAM = path.join(SRC, 'lib', 'deepgram.ts')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name)
        // Tests may name anything — they mock these very modules.
        if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full)
        return /\.tsx?$/.test(e.name) ? [full] : []
      })

    const files = walk(SRC)
    const offenders: string[] = []
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const at = `${path.relative(SRC, file)}:${i + 1}`
          if (file !== METER && /\brunTranscription\s*\(/.test(line)) offenders.push(at)
          if (
            file !== METER &&
            file !== DEEPGRAM &&
            /transcribe(Url)?WithDeepgram\s*\(/.test(line)
          ) {
            offenders.push(at)
          }
        })
    }
    expect(offenders).toEqual([])
    // The walk must actually have walked: an empty (or tiny) file list would
    // pass the assertion above while proving nothing at all.
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain(METER)
  })
})

// ── t8 — the debit itself (fix round 2, Greptile P1) ────────────────────────
//
// A `recordUsage` that failed used to be a shrug in the log: the money was
// spent, the ledger never heard about it, and the rolling 24 h cap under-counted
// by that whole recording — for exactly as long as core was unwell, which is
// precisely when a runaway would be running. Three attempts, and a loss that
// survives all three is COUNTABLE rather than merely mentioned.
describe('the debit — three attempts, and a lost one is written down', () => {
  const runOneJob = async (job: Record<string, unknown> = baseJob) => {
    claim.mockResolvedValueOnce(job).mockResolvedValueOnce(null)
    await processRecordingJobs(10_000)
  }
  let errorLog: jest.SpyInstance

  beforeEach(() => {
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorLog.mockRestore()
  })

  it('t8 core blips twice → the third attempt lands, the debit is recorded, nothing is written down', async () => {
    recordUsage
      .mockRejectedValueOnce(new Error('core 502'))
      .mockRejectedValueOnce(new Error('core 502'))
      .mockResolvedValueOnce(undefined)

    await runOneJob()

    // Three attempts, all of them the RESERVE — and the provider ran only
    // after the third landed. The estimate matched, so no true-up followed.
    expect(recordUsage).toHaveBeenCalledTimes(3)
    expect(recordUsage).toHaveBeenLastCalledWith('transcribe', null, null, 45)
    // All three attempts sit BEFORE the provider: the wall waited for the
    // ledger rather than spending while core was unwell.
    expect(order).toEqual([
      'consume',
      'recordUsage(reserve)',
      'recordUsage(reserve)',
      'recordUsage(reserve)',
      'deepgram',
    ])
    expect(rows('recording.transcribe')[0].detail).toMatchObject({ debit_recorded: true })
    expect(errorLog).not.toHaveBeenCalled()
    // ONE provider call — a retry of the DEBIT must never re-run the spend.
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it('t8 the TRUE-UP is lost → one console.error, a warning receipt saying so, and the karute still saves', async () => {
    // The estimate under-shot (a 3 MB object = 500 s → 5 ¢) and the provider
    // came back with 90 minutes, so a 40 ¢ true-up is owed — and core is down
    // for all three of its attempts. The reserve itself landed first.
    headBytes.current = 3_000_000
    recordUsage.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('core down'))

    await runOneJob()

    expect(recordUsage).toHaveBeenCalledTimes(4) // 1 reserve + 3 true-up attempts
    expect(recordUsage).toHaveBeenNthCalledWith(1, 'transcribe', null, null, 5)
    // The money was spent exactly once; only the report was retried.
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)

    expect(errorLog).toHaveBeenCalledTimes(1)
    expect(errorLog).toHaveBeenCalledWith(
      '[ai-usage] transcription debit LOST after 3 attempts:',
      expect.objectContaining({ costCents: 40 }),
    )

    // COUNTABLE: severity 'warning' is what the refusal row uses, so the one
    // audit.list query that answers "is the wall firing?" now also returns the
    // spends nobody counted. Both mean the wall is not holding.
    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(1)
    expect(receipts[0].severity).toBe('warning')
    expect(receipts[0].detail).toMatchObject({
      door: 'job',
      duration_seconds: 5400,
      cost_cents: 45,
      cents_reserved: 5,
      debit_recorded: false,
    })
    // ⚖ AND THE UNDER-COUNT IS BOUNDED. The ledger is short by the true-up
    // only — 40 ¢ of the 45 — never by the whole recording, which is what a
    // lost debit used to cost before the reserve went first.

    // ⚖ AND IT NEVER THROWS. The money is already spent; failing the caller
    // here would send the whole recording back through Deepgram on the requeue
    // — paying twice to report once. The job finishes.
    expect(complete).toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })
})

// ── t5 — the discard-words door ─────────────────────────────────────────────
describe('the discard-words door', () => {
  const input = {
    recordingSessionId: 'sess-1',
    audioPath: OWN_KEY,
    durationSeconds: 600,
    locale: 'ja',
  }
  const actor = { staffId: 'staff-A', businessId: 'biz-1' }
  /** The door takes the four namespaces it uses; the fake answers all of them
   *  and nothing else, so the cast is the shape of THIS test, not a widening. */
  const discardCore = fakeClient as unknown as Pick<
    SynqedClient,
    'recordings' | 'recordingDiscards' | 'customers' | 'orgSettings' | 'aiRateLimit'
  >

  beforeEach(() => {
    listDiscards.mockResolvedValue({
      events: [
        { id: 'd-1', recording_session_id: 'sess-1', source: 'STAFF', reason: '事故' },
      ],
    })
    recordingsGet.mockResolvedValue({
      duration_seconds: 60,
      customer_id: 'cust-1',
      audio_storage_path: OWN_KEY,
    })
  })

  it('t5 refused → the provider is never called, nothing is debited, and the answer stays retryable', async () => {
    consume.mockResolvedValueOnce(REFUSED)

    const res = await transcribeAndPersistDiscardWithClient(discardCore, actor, input)

    expect(res).toEqual({ error: 'failed' })
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
    expect(upsertSegments).not.toHaveBeenCalled()
    expect(rows('recording.transcribe_refused')).toHaveLength(1)
    expect(rows('recording.transcribe_refused')[0].detail).toMatchObject({
      door: 'discard',
      customer_id: 'cust-1',
      staff_id: 'staff-A',
    })
  })

  // X9 (S56 stress): the discard door rides the worker's wait; a lease that stays live for the
  // whole budget ends in the retryable conflict, which THIS door's own catch must turn into its
  // retryable `failed` — never a throw out of the door, never a payment.
  it('x9 (S57) a lease live for the WHOLE wait → the conflict at the budget is caught by the discard door: { error: failed }, nothing paid, reserved or written', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      leaseStore.set(`trc/${OWN_KEY}.ja.lease.json`, JSON.stringify({ v: 1, expires_at: Date.now() + 330_000 }))
      const out: { done: boolean; value?: unknown; error?: unknown } = { done: false }
      transcribeAndPersistDiscardWithClient(discardCore, actor, input).then(
        (value) => Object.assign(out, { done: true, value }),
        (error: unknown) => Object.assign(out, { done: true, error }),
      )
      for (let i = 0; i < 80 && !out.done; i++) await jest.advanceTimersByTimeAsync(3_000)
      expect(out.done).toBe(true)
      expect(out.error).toBeUndefined()
      expect(out.value).toEqual({ error: 'failed' })
      // The door's own line names the conflict it caught.
      expect(warn.mock.calls.some((c) => String(c[0]).includes('[discard-transcript] transcribe failed') && (c[1] as { code?: string })?.code === 'conflict')).toBe(true)
      expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
      expect(consume).not.toHaveBeenCalled()
      expect(recordUsage).not.toHaveBeenCalled()
      expect(upsertSegments).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      jest.useRealTimers()
    }
  })

  it('allowed → the words land, the minutes are debited once, and ONE receipt says door discard', async () => {
    const res = await transcribeAndPersistDiscardWithClient(discardCore, actor, input)

    expect(res).toEqual({ ok: true })
    expect(consume).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledWith('transcribe', null, null, 45)
    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(1)
    expect(receipts[0].detail).toMatchObject({
      door: 'discard',
      duration_seconds: 5400,
      cost_cents: 45,
      cents_reserved: 45,
      recording_session_id: 'sess-1',
      customer_id: 'cust-1',
      staff_id: 'staff-A',
    })
  })
})

// ── t6 — the two interactive routes ─────────────────────────────────────────
describe('the web route (cookie door)', () => {
  const post = (body: unknown) =>
    new Request('https://s/api/ai/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('t6 exactly ONE consume per request — the route’s own block is gone', async () => {
    const res = await webTranscribePOST(
      post({ audioUrl: 'https://test-local.supabase.co/storage/audio.webm', locale: 'ja' }),
    )

    expect(res.status).toBe(200)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledWith('transcribe')
  })

  it('t6 refused → 429 with the same body keys and Retry-After the removed block sent', async () => {
    consume.mockResolvedValueOnce(REFUSED)

    const res = await webTranscribePOST(post({ audioUrl: 'https://test-local.supabase.co/storage/audio.webm', locale: 'ja' }))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('3600')
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(
      ['cap', 'cost_cap_cents', 'cost_used_cents', 'error', 'reason', 'retry_at'].sort(),
    )
    expect(body.reason).toBe('daily_cost')
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
  })

  // The refusal ROW on this door was never pinned (blind lens on f7ca09484,
  // LOW 2): the wrapper files it for all five doors, but only the worker's and
  // the discard door's were asserted, so 'web' could have gone missing — or
  // arrived under another door's name — and the one severity-filtered "is the
  // wall firing?" query would have been quietly short of this door.
  it('t7 refused → the wrapper files the refusal row for THIS door, named web', async () => {
    consume.mockResolvedValueOnce(REFUSED)

    await webTranscribePOST(
      post({ audioUrl: 'https://test-local.supabase.co/storage/audio.webm', locale: 'ja' }),
    )

    expect(rows('recording.transcribe')).toHaveLength(0)
    const refusals = rows('recording.transcribe_refused')
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      category: 'recording',
      severity: 'warning',
      actorType: 'system',
      actorId: null,
      businessId: 'business-1',
      source: 'system',
      detail: {
        door: 'web',
        reason: 'daily_cost',
        cost_used_cents: 3000,
        cost_cap_cents: 3000,
      },
    })
    // This door carries no recording session, so the row names none rather
    // than inventing one.
    expect(refusals[0].targetId).toBeUndefined()
    // This door has no customer in scope either (a raw upload, no session
    // binding) — the meter was never given one, so the row omits the key
    // rather than writing null.
    expect(refusals[0].detail).not.toHaveProperty('customer_id')
    // §v2 (2026-09-10 widen) — no signed-in staffer on this mock (the default
    // getCurrentUserStaffId() below resolves null) → the key is omitted too.
    expect(refusals[0].detail).not.toHaveProperty('staff_id')
  })

  it('t7 refused, signed in → the wrapper carries staff_id (already resolved for the reference)', async () => {
    ;(getCurrentUserStaffId as jest.Mock).mockResolvedValueOnce('staff-web-1')
    consume.mockResolvedValueOnce(REFUSED)

    await webTranscribePOST(
      post({ audioUrl: 'https://test-local.supabase.co/storage/audio.webm', locale: 'ja' }),
    )

    const refusals = rows('recording.transcribe_refused')
    expect(refusals[0].detail).toMatchObject({ staff_id: 'staff-web-1' })
  })

  it('t7 the route files ONE receipt, carrying the numbers the meter debited AND whether it landed', async () => {
    const res = await webTranscribePOST(post({ audioUrl: 'https://test-local.supabase.co/storage/audio.webm', locale: 'ja' }))

    // The wrapper stays silent for this door — the route's own row is the one.
    expect(rows('recording.transcribe')).toHaveLength(0)
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'recording',
        action: 'recording.transcribe',
        detail: {
          duration_seconds: 5400,
          cost_cents: 45,
          cents_reserved: 45,
          debit_recorded: true,
          replayed: false,
        },
      }),
    )
    // A landed debit is an ordinary row — no severity key at all (fix round 3;
    // matches the wrapper's own emitter's t8 assertion above).
    expect('severity' in ((auditWeb as jest.Mock).mock.calls[0][0] as Record<string, unknown>)).toBe(
      false,
    )
    // …and the receipt is SERVER-SIDE ONLY: the client's body is the provider's,
    // unchanged, with no accounting field bolted onto it.
    expect(Object.keys(await res.json()).sort()).toEqual(['confidence', 'durationSec', 'transcript'])
  })

  // G1 (Greptile 4/5, fix round 2): the wrapper stays silent for this door, so
  // the SUCCESS row above only ever carried the four receipt fields — never
  // staff_id, even though the refusal row (t7 above) already does. The route
  // already holds the id (the same meter.staffId the refusal row reads); this
  // proves the success row carries it too.
  it('g1 signed in → the success row carries staff_id (already resolved for the reference)', async () => {
    ;(getCurrentUserStaffId as jest.Mock).mockResolvedValueOnce('staff-web-1')

    await webTranscribePOST(
      post({ audioUrl: 'https://test-local.supabase.co/storage/audio.webm', locale: 'ja' }),
    )

    const detail = (auditWeb as jest.Mock).mock.calls[0][0].detail as Record<string, unknown>
    expect(detail).toMatchObject({ staff_id: 'staff-web-1' })
    // This door has no customer in scope (a raw upload, no session binding) —
    // never invented, never null.
    expect(detail).not.toHaveProperty('customer_id')
  })

  it('t8 the true-up is lost → the route’s OWN row says so (debit_recorded false), and the caller still gets its words', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    // Reserve lands (5 ¢ from a 3 MB object), the 40 ¢ true-up does not.
    headBytes.current = 3_000_000
    recordUsage.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('core down'))

    const res = await webTranscribePOST(post({ audioUrl: 'https://test-local.supabase.co/storage/audio.webm', locale: 'ja' }))

    expect(res.status).toBe(200)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          duration_seconds: 5400,
          cost_cents: 45,
          cents_reserved: 5,
          debit_recorded: false,
          replayed: false,
        },
      }),
    )
    // ⚖ fix round 3, m13: a lost debit on THIS route's own row is severity
    // 'warning' too — the same one-query answer the wrapper's receipt gives
    // the other three doors.
    expect(auditWeb).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' }))
    errorLog.mockRestore()
  })

  // ── ⚖ THE WEB JSON ARM'S MEMO IS GATED (PR-5, S29 ruling) ────────────────
  // A replay answers without Deepgram fetching the URL, so the token is never
  // checked: the memo is granted only for the caller's own tenant's TAKE and
  // only with records.write — nothing wider than the facade twin grants.
  const OWN_TAKE = conformingKey('business-1')
  /** The web recording port's REAL shape: mintRecordingReadUrl → createSignedUrl
   *  (storage-js 2.99.1: `${url}/storage/v1` + `/object/sign/<bucket>/<key>?token=`). */
  const signedUrl = (key: string, route = 'object/sign/recordings') =>
    `https://test-local.supabase.co/storage/v1/${route}/${key}?token=t0k3n`

  it('t2b records.write + own take: the web door pays, then the job door on the same key pays NOTHING — one charge', async () => {
    const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja' }))
    expect(res.status).toBe(200)
    expect(storageUpload).toHaveBeenCalledWith(`trc/${OWN_TAKE}.ja.json`, expect.any(String), {
      contentType: 'application/json',
      upsert: false,
    })

    claim
      .mockResolvedValueOnce({
        ...baseJob,
        business_id: 'business-1',
        payload: { ...baseJob.payload, audio_path: OWN_TAKE },
      })
      .mockResolvedValueOnce(null)
    await processRecordingJobs(10_000)

    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(rows('recording.transcribe')[0].detail).toMatchObject({
      door: 'job',
      cost_cents: 0,
      replayed: true,
    })
  })

  it.each([
    ['WITHOUT records.write, own take', false, () => OWN_TAKE],
    ['with records.write, another tenant’s take', true, () => conformingKey('biz-2')],
    ['with records.write, own RESCUE (take-only fence)', true, () => rescueKey('business-1')],
  ])('t2c %s → no memo read, no memo write, and it pays', async (_label, holds, key) => {
    ;(can as jest.Mock).mockResolvedValueOnce(holds)
    // A memo already sits at the key this call would compose — a gate that
    // leaked would answer from it instead of paying.
    memoStore.set(
      `trc/${key()}.ja.json`,
      JSON.stringify({ v: 1, result: { transcript: 'leak' }, duration_seconds: 1, written_at: '' }),
    )

    const res = await webTranscribePOST(post({ audioUrl: signedUrl(key()), locale: 'ja' }))

    expect(res.status).toBe(200)
    expect((await res.json()).transcript).toBe('こんにちは')
    expect(storageDownload).not.toHaveBeenCalled()
    expect(storageUpload).not.toHaveBeenCalled()
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledTimes(1)
  })

  it('t2c the capability read FAILS → no memo, and it still pays (no new refusal)', async () => {
    ;(can as jest.Mock).mockRejectedValueOnce(new Error('profile read down'))

    const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja' }))

    expect(res.status).toBe(200)
    expect(storageDownload).not.toHaveBeenCalled()
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the real producer’s shape', signedUrl(OWN_TAKE), `trc/${OWN_TAKE}.ja.json`],
    [
      'a percent-encoded key (decoded before the grammar reads it)',
      signedUrl(OWN_TAKE.replace('.webm', '%2Ewebm')),
      `trc/${OWN_TAKE}.ja.json`,
    ],
    ['a public/ route', signedUrl(OWN_TAKE, 'object/public/recordings'), null],
    ['another bucket', signedUrl(OWN_TAKE, 'object/sign/avatars'), null],
    ['no bucket segment at all', `https://test-local.supabase.co/storage/v1/object/sign/${OWN_TAKE}`, null],
  ])('t10 the URL → key parse: %s', async (_label, audioUrl, memoRead) => {
    // S46: a replay is read only for the caller's OWN take, so the parse is
    // pinned with the row the web port now sends (takeKeyHolder → 'own').
    ownRowHolds(OWN_TAKE)
    try {
      const res = await webTranscribePOST(post({ audioUrl, locale: 'ja', recordingSessionId: S46_ROW }))

      expect(res.status).toBe(200)
      if (memoRead === null) expect(storageDownload).not.toHaveBeenCalled()
      else expect(storageDownload).toHaveBeenCalledWith(memoRead)
    } finally {
      jest.mocked(getCurrentUserStaffId).mockResolvedValue(null)
    }
  })

  // ── S46 closure 2: the replay needs the caller's OWN row ─────────────────
  const S46_ROW = '5a0e0c1d-2b3c-4d5e-8f60-718293a4b5c6'
  /** The web cookie's LOGIN id and a core row that holds `key` for it. */
  const ownRowHolds = (key: string, staffId = 'login-recorder') => {
    jest.mocked(getCurrentUserStaffId).mockResolvedValue('login-recorder')
    recordingsGet.mockResolvedValue({
      id: S46_ROW,
      business_id: 'business-1',
      staff_id: staffId,
      store_id: 'store-a',
      audio_storage_path: key,
      duration_seconds: 60,
      customer_id: 'cust-1',
    } as never)
  }
  const seedMemo = async () => {
    // One paid call with no row: token-proven, so its answer is remembered.
    await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja' }))
    transcribeUrlWithDeepgram.mockClear()
    storageDownload.mockClear()
  }

  it('s46 own row → the replay answers, Deepgram is not asked', async () => {
    await seedMemo()
    ownRowHolds(OWN_TAKE)
    try {
      const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja', recordingSessionId: S46_ROW }))
      expect(res.status).toBe(200)
      expect(storageDownload).toHaveBeenCalledWith(`trc/${OWN_TAKE}.ja.json`)
      expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    } finally {
      jest.mocked(getCurrentUserStaffId).mockResolvedValue(null)
    }
  })

  it("s46 a colleague's row → NO replay: Deepgram fetches the URL, whose token is the proof", async () => {
    await seedMemo()
    ownRowHolds(OWN_TAKE, 'login-colleague')
    try {
      const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja', recordingSessionId: S46_ROW }))
      expect(res.status).toBe(200)
      expect(storageDownload).not.toHaveBeenCalled()
      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    } finally {
      jest.mocked(getCurrentUserStaffId).mockResolvedValue(null)
    }
  })

  // ⚖ S53 A1 — THIS PIN IS FLIPPED ON PURPOSE (it reverses the S46 line in
  // the route; ruling given — Liam, 2026-09-28 19:5x JST:
  // 「I think both. Yes to both.」). S46 read "no row → no replay": the
  // unbound fallback's automatic re-POST of the SAME key after a lost response
  // paid twice on the web door. A1 replays 'no_row' too, and grants nothing
  // new: the phone door already replays 'no_row' (v1 route, :86-101), and the
  // read-URL door already hands any same-tenant records.write holder a signed
  // URL for a 'no_row' key (recording-upload.ts, mintRecordingReadUrl). The
  // fence (own tenant's take key + records.write) and the 'foreign' refusal
  // are unchanged — t2c and the colleague's-row case above still pay.
  it('S53 A1 (was s46) no row (unbound fallback / an older tab) → the memo is READ: the first call pays and is remembered, the same key again REPLAYS', async () => {
    const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja' }))
    expect(res.status).toBe(200)
    expect((await res.json()).transcript).toBe('こんにちは')
    expect(storageDownload).toHaveBeenCalledWith(`trc/${OWN_TAKE}.ja.json`)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(storageUpload).toHaveBeenCalledWith(`trc/${OWN_TAKE}.ja.json`, expect.any(String), expect.anything())

    const again = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja' }))
    expect(again.status).toBe(200)
    expect((await again.json()).transcript).toBe('こんにちは')
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it('S53 A1 switch OFF → the S46 answer exactly: no row → no memo read, it pays, and the answer is still remembered', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', false)
    try {
      const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja' }))
      expect(res.status).toBe(200)
      expect((await res.json()).transcript).toBe('こんにちは')
      expect(storageDownload).not.toHaveBeenCalled()
      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
      expect(storageUpload).toHaveBeenCalledWith(`trc/${OWN_TAKE}.ja.json`, expect.any(String), expect.anything())
    } finally {
      off.restore()
    }
  })

  it("S53 A1 a colleague's row with a remembered answer → still NO replay (the fence A1 leaves standing)", async () => {
    await seedMemo()
    ownRowHolds(OWN_TAKE, 'login-colleague')
    try {
      const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja', recordingSessionId: S46_ROW }))
      expect(res.status).toBe(200)
      expect(storageDownload).not.toHaveBeenCalled()
      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    } finally {
      jest.mocked(getCurrentUserStaffId).mockResolvedValue(null)
    }
  })

  // ── S53 A2: a core read blip never buys the same audio twice ─────────────
  const coreBlips = () =>
    recordingsGet.mockRejectedValueOnce(Object.assign(new Error('core 500'), { status: 500 }))

  it('a2 core blip + a paid answer already remembered → retryable 502, Deepgram NOT asked, nothing reserved', async () => {
    await seedMemo()
    recordUsage.mockClear()
    coreBlips()
    const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja', recordingSessionId: S46_ROW }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('could not read the recording')
    expect(storageDownload).toHaveBeenCalledWith(`trc/${OWN_TAKE}.ja.json`)
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
  })

  it('a2 core blip + nothing remembered → pays exactly as before (no availability lost), and the answer is remembered', async () => {
    coreBlips()
    const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja', recordingSessionId: S46_ROW }))
    expect(res.status).toBe(200)
    expect((await res.json()).transcript).toBe('こんにちは')
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(memoStore.has(`trc/${OWN_TAKE}.ja.json`)).toBe(true)
  })

  it('a2 the blip clears → the retry replays: ONE provider call across paid → 502 → replay (the phone door’s shape)', async () => {
    ownRowHolds(OWN_TAKE)
    try {
      const body = { audioUrl: signedUrl(OWN_TAKE), locale: 'ja', recordingSessionId: S46_ROW }
      expect((await webTranscribePOST(post(body))).status).toBe(200)
      coreBlips()
      expect((await webTranscribePOST(post(body))).status).toBe(502)
      const replay = await webTranscribePOST(post(body))
      expect(replay.status).toBe(200)
      expect((await replay.json()).transcript).toBe('こんにちは')
      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    } finally {
      jest.mocked(getCurrentUserStaffId).mockResolvedValue(null)
    }
  })

  it("a2 a colleague's row still pays (the S46 fence is unchanged — only 'unreadable' reads the memo)", async () => {
    await seedMemo()
    ownRowHolds(OWN_TAKE, 'login-colleague')
    try {
      const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja', recordingSessionId: S46_ROW }))
      expect(res.status).toBe(200)
      expect(storageDownload).not.toHaveBeenCalled()
      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    } finally {
      jest.mocked(getCurrentUserStaffId).mockResolvedValue(null)
    }
  })

  it('a6 switch OFF → the pre-S53 answer: core blip + a remembered answer PAYS again (no memo read)', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', false)
    try {
      await seedMemo()
      coreBlips()
      const res = await webTranscribePOST(post({ audioUrl: signedUrl(OWN_TAKE), locale: 'ja', recordingSessionId: S46_ROW }))
      expect(res.status).toBe(200)
      expect(storageDownload).not.toHaveBeenCalled()
      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    } finally {
      off.restore()
    }
  })

  it('t10 a non-URL never reaches the parse — the SSRF guard answers 400 first, nothing read', async () => {
    const res = await webTranscribePOST(post({ audioUrl: 'not a url', locale: 'ja' }))

    expect(res.status).toBe(400)
    expect(storageDownload).not.toHaveBeenCalled()
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
  })
})

describe('the facade route (Bearer door)', () => {
  const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
  const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const bearer = () => {
    const now = Math.floor(Date.now() / 1000)
    const header = b64({ alg: 'HS256', typ: 'JWT' })
    const payload = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
    const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
    return `${header}.${payload}.${sig}`
  }
  const post = () =>
    new Request('https://s/api/app/v1/ai/transcribe', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ path: conformingKey('business-1'), locale: 'ja' }),
    })
  const noRoute = { params: Promise.resolve({}) }

  it('t6 exactly ONE consume per request — the route’s own line is gone', async () => {
    const res = await facadeTranscribePOST(post(), noRoute)

    expect(res.status).toBe(200)
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('t6 refused → 429 through the handler’s own mapper, with nothing spent', async () => {
    consume.mockResolvedValueOnce(REFUSED)

    const res = await facadeTranscribePOST(post(), noRoute)

    expect(res.status).toBe(429)
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
  })

  // The fifth door's refusal row (blind lens LOW 2) — same claim as the web
  // twin above, and the door word is the half that matters: 'app', not 'web'.
  it('t7 refused → the wrapper files the refusal row for THIS door, named app', async () => {
    consume.mockResolvedValueOnce(REFUSED)

    await facadeTranscribePOST(post(), noRoute)

    expect(rows('recording.transcribe')).toHaveLength(0)
    const refusals = rows('recording.transcribe_refused')
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      category: 'recording',
      severity: 'warning',
      actorType: 'system',
      actorId: null,
      businessId: 'business-1',
      source: 'system',
      detail: {
        door: 'app',
        reason: 'daily_cost',
        cost_used_cents: 3000,
        cost_cap_cents: 3000,
      },
    })
    // The facade route names a storage path, never a customer — the meter
    // was never given one, so the row omits the key rather than null.
    expect(refusals[0].detail).not.toHaveProperty('customer_id')
    // §v2 (2026-09-10 widen) — this mock's resolveSelfStaffId() resolves null
    // by default → the key is omitted too.
    expect(refusals[0].detail).not.toHaveProperty('staff_id')
  })

  it('t7 refused, resolved caller → the wrapper carries staff_id (already resolved for the reference)', async () => {
    ;(resolveSelfStaffId as jest.Mock).mockResolvedValueOnce('staff-app-1')
    consume.mockResolvedValueOnce(REFUSED)

    await facadeTranscribePOST(post(), noRoute)

    const refusals = rows('recording.transcribe_refused')
    expect(refusals[0].detail).toMatchObject({ staff_id: 'staff-app-1' })
  })

  it('the ledger will not take the reserve → 502, and the row says ledger_unavailable', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    recordUsage.mockRejectedValue(new Error('core down'))

    const res = await facadeTranscribePOST(post(), noRoute)

    expect(res.status).toBe(502)
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    const refusals = rows('recording.transcribe_refused')
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      severity: 'warning',
      detail: {
        door: 'app',
        reason: 'ledger_unavailable',
        // The ledger never answered, so it named no numbers.
        cost_used_cents: null,
        cost_cap_cents: null,
      },
    })
    errorLog.mockRestore()
  })

  it('t7 the hook’s row carries the numbers AND the debit outcome, and the wrapper files none of its own', async () => {
    const res = await facadeTranscribePOST(post(), noRoute)

    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(1)
    expect(receipts[0].source).toBe('facade')
    expect(receipts[0].detail).toMatchObject({
      duration_seconds: 5400,
      cost_cents: 45,
      cents_reserved: 45,
      debit_recorded: true,
    })
    // Five keys since PR-5 added `replayed` — still well inside the hook's cap
    // of 8 (handler.ts) — and none of them reaches the client: the body is the
    // provider's own.
    expect(Object.keys(receipts[0].detail as object)).toHaveLength(5)
    expect(Object.keys(await res.json()).sort()).toEqual(['confidence', 'durationSec', 'transcript'])
    // A landed debit is an ordinary row (fix round 3 — same default as every
    // other route the hook serves).
    expect(receipts[0].severity).toBeUndefined()
  })

  // ⚖ CHARGE ONCE ACROSS DOORS (PR-5, T2 on the doors this build wires). The
  // phone's interactive door pays for a take; the worker then reaches the SAME
  // object (same business, same key) and answers from the memo — one provider
  // call and one reserve between them, and the job's own receipt says so.
  it('t2 the app door pays, then the job door on the same audio pays NOTHING — one provider call, one reserve', async () => {
    const res = await facadeTranscribePOST(post(), noRoute)
    expect(res.status).toBe(200)

    claim
      .mockResolvedValueOnce({
        ...baseJob,
        business_id: 'business-1',
        payload: { ...baseJob.payload, audio_path: conformingKey('business-1') },
      })
      .mockResolvedValueOnce(null)
    await processRecordingJobs(10_000)

    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(1)
    // The job's receipt row: the door ran, and paid nothing.
    const jobRows = rows('recording.transcribe').filter(
      (r) => (r.detail as Record<string, unknown>).door === 'job',
    )
    expect(jobRows).toHaveLength(1)
    expect(jobRows[0].detail).toMatchObject({
      duration_seconds: 5400,
      cost_cents: 0,
      cents_reserved: 0,
      debit_recorded: true,
      replayed: true,
    })
  })

  // T11 — the receipt's new key rides the hook's OWN row, inside its cap of 8
  // route keys (handler.ts): five receipt keys + staff_id = six, none evicted.
  it('t11 a replay on this door: the hook row carries replayed:true and all six keys survive the cap', async () => {
    ;(resolveSelfStaffId as jest.Mock)
      .mockResolvedValueOnce('staff-app-1')
      .mockResolvedValueOnce('staff-app-1')

    const first = await facadeTranscribePOST(post(), noRoute)
    const second = await facadeTranscribePOST(post(), noRoute)

    expect(await second.json()).toEqual(await first.json())
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(2)
    expect(receipts[1].detail).toEqual({
      duration_seconds: 5400,
      cost_cents: 0,
      cents_reserved: 0,
      debit_recorded: true,
      replayed: true,
      staff_id: 'staff-app-1',
    })
    expect(Object.keys(receipts[1].detail as object)).toHaveLength(6)
    expect(receipts[1].severity).toBeUndefined()
  })

  // G1 (Greptile 4/5, fix round 2): same claim as the web door's g1 test above
  // — the hook's success row only ever carried the four receipt fields, never
  // staff_id, though the refusal row (t7 above) already does. selfStaffId is
  // already resolved for the voice reference; no new lookup.
  it('g1 resolved caller → the hook’s success row carries staff_id (already resolved for the reference)', async () => {
    ;(resolveSelfStaffId as jest.Mock).mockResolvedValueOnce('staff-app-1')

    const res = await facadeTranscribePOST(post(), noRoute)

    expect(res.status).toBe(200)
    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(1)
    expect(receipts[0].detail).toMatchObject({ staff_id: 'staff-app-1' })
    // This door names a storage path, never a customer — never invented.
    expect(receipts[0].detail).not.toHaveProperty('customer_id')
  })

  it('t8 the true-up is lost → the hook’s OWN row is severity warning too (fix round 3)', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    headBytes.current = 3_000_000
    recordUsage.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('core down'))

    const res = await facadeTranscribePOST(post(), noRoute)

    expect(res.status).toBe(200)
    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(1)
    // m14: the route never sets ctx.auditSeverity → this stays undefined.
    // m15: the hook ignores ctx.auditSeverity → this stays undefined.
    expect(receipts[0].severity).toBe('warning')
    expect(receipts[0].detail).toMatchObject({ cents_reserved: 5, debit_recorded: false })
    errorLog.mockRestore()
  })
  // ⚖ S57 F1: the hook's row takes the meter's one severity rule too.
  it('s57 f1l a replay whose memo still owes a true-up, under another call’s live lease → the hook’s row is soft (no warning), six keys, debit_deferred_reason lease_busy', async () => {
    const key = conformingKey('business-1')
    memoStore.set(`trc/${key}.ja.json`, JSON.stringify({ v: 1, result: { transcript: 'the held answer' }, duration_seconds: 5400, written_at: '', trueUp: { reserveCents: 1, costCents: 45, deltaCents: 44 } }))
    leaseStore.set(`trc/${key}.ja.lease.json`, JSON.stringify({ v: 1, expires_at: Date.now() + 60_000 }))
    const res = await facadeTranscribePOST(post(), noRoute)
    expect(res.status).toBe(200)
    expect(recordUsage).not.toHaveBeenCalled()
    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(1)
    expect(receipts[0].severity).toBeUndefined()
    expect(receipts[0].detail).toMatchObject({ replayed: true, debit_recorded: false, debit_deferred_reason: 'lease_busy' })
    // Five receipt keys + the deferral reason — inside the hook's cap of 8.
    expect(Object.keys(receipts[0].detail as object)).toHaveLength(6)
  })
})

// ── fix round 4 — THE LEDGER IS WRITTEN BEFORE THE MONEY MOVES ──────────────
//
// Greptile round 2 on PR #863: "after the third failed recordUsage the debit is
// permanently absent from the ledger that enforces the cap, so later limit
// checks can admit spend beyond it." Three attempts cannot close that; the
// ORDER can. These are the claims that hold it shut.
describe('the reserve — a ledger row before any yen is spent', () => {
  const runOneJob = async (job: Record<string, unknown> = baseJob) => {
    claim.mockResolvedValueOnce(job).mockResolvedValueOnce(null)
    await processRecordingJobs(10_000)
  }
  let errorLog: jest.SpyInstance

  beforeEach(() => {
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorLog.mockRestore()
  })

  it('m16 the reserve is written BEFORE the provider runs — the estimate matched, so nothing follows it', async () => {
    await runOneJob()

    expect(order).toEqual(['consume', 'recordUsage(reserve)', 'deepgram'])
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledWith('transcribe', null, null, 45)
    expect(rows('recording.transcribe')[0].detail).toMatchObject({
      cost_cents: 45,
      cents_reserved: 45,
      debit_recorded: true,
    })
  })

  it('m19 the estimate under-shot → the TRUE-UP follows the provider, for the difference only', async () => {
    // 3 MB ÷ 6,000 B/s = 500 s → 5 ¢ reserved; the provider says 90 minutes.
    headBytes.current = 3_000_000

    await runOneJob()

    expect(order).toEqual([
      'consume',
      'recordUsage(reserve)',
      'deepgram',
      'recordUsage(delta)',
    ])
    expect(recordUsage).toHaveBeenCalledTimes(2)
    expect(recordUsage).toHaveBeenNthCalledWith(1, 'transcribe', null, null, 5)
    // 40, not 45: the ledger already holds the 5 it reserved.
    expect(recordUsage).toHaveBeenNthCalledWith(2, 'transcribe', null, null, 40)
    expect(rows('recording.transcribe')[0].detail).toMatchObject({
      cost_cents: 45,
      cents_reserved: 5,
      debit_recorded: true,
    })
  })

  it('m17 the ledger will not take the reserve → the provider is NEVER called and no karute is written', async () => {
    recordUsage.mockRejectedValue(new Error('core down'))

    await runOneJob()

    expect(recordUsage).toHaveBeenCalledTimes(3) // the three attempts, then a refusal
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(transcribeWithDeepgram).not.toHaveBeenCalled()
    expect(upsertSegments).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    // The job is REQUEUED, not spend-limited: nothing was spent, so this take
    // must come back when core is well. Only a classified ceiling refusal earns
    // the AI_SPEND_LIMIT word (t4's law, one door further up).
    expect(fail).toHaveBeenCalledWith('job-1', 'transcription ledger unavailable')
    expect(fail).not.toHaveBeenCalledWith('job-1', AI_SPEND_LIMIT)
  })

  it('the refusal files its own row — severity warning, reason ledger_unavailable', async () => {
    recordUsage.mockRejectedValue(new Error('core down'))

    await runOneJob()

    expect(rows('recording.transcribe')).toHaveLength(0)
    const refusals = rows('recording.transcribe_refused')
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      severity: 'warning',
      actorType: 'system',
      businessId: 'biz-1',
      targetId: 'sess-1',
      detail: {
        door: 'job',
        reason: 'ledger_unavailable',
        // The ledger never answered, so it named no numbers — and the row says
        // that rather than inventing them.
        cost_used_cents: null,
        cost_cap_cents: null,
      },
    })
  })

  it('the size cannot be read → the FLOOR is reserved (30 ¢), and a short take still bills its own 3 ¢', async () => {
    headBytes.current = null
    deepgramResult.durationSec = 300

    await runOneJob()

    // Reserve = the floor; the provider then came back SHORTER than the
    // estimate, so there is no true-up and the over-reservation stands.
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledWith('transcribe', null, null, 30)
    expect(rows('recording.transcribe')[0].detail).toMatchObject({
      duration_seconds: 300,
      cost_cents: 3,
      cents_reserved: 30,
      debit_recorded: true,
    })
  })

  // ⚖ m18 — THE RESERVE IS NOT A CLIENT'S NUMBER EITHER (fix round 2's rule,
  // extended to the estimate). The payload below says five seconds; the object
  // is 32.4 MB, which is ninety minutes. A wall that reserved from the payload
  // would put 1 ¢ on the ledger and then spend 45.
  it('m18 the reserve comes from the object’s own bytes, never the job payload’s duration', async () => {
    await runOneJob({ ...baseJob, payload: { ...baseJob.payload, duration_seconds: 5 } })

    expect(recordUsage).toHaveBeenNthCalledWith(1, 'transcribe', null, null, 45)
    expect(recordUsage).not.toHaveBeenCalledWith('transcribe', null, null, 1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://x/audio',
      expect.objectContaining({ method: 'HEAD' }),
    )
  })

  it('the two interactive doors answer 502 when the ledger will not take the reserve', async () => {
    recordUsage.mockRejectedValue(new Error('core down'))

    const webRes = await webTranscribePOST(
      new Request('https://s/api/ai/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          audioUrl: 'https://test-local.supabase.co/storage/audio.webm',
          locale: 'ja',
        }),
      }),
    )

    expect(webRes.status).toBe(502)
    expect(await webRes.json()).toEqual({ error: 'transcription ledger unavailable' })
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
  })
})

describe('the reserve on the buffer door (the web FormData path)', () => {
  it('bytes come from the buffer itself — no HEAD, same rules', async () => {
    const form = new FormData()
    // 3,000,000 B ÷ 6,000 B/s = 500 s → 5 ¢ reserved; the provider says 5,400.
    form.append(
      'audio',
      new File([new Uint8Array(3_000_000)], 'take.webm', { type: 'audio/webm' }),
    )
    form.append('locale', 'ja')

    const res = await webTranscribePOST(
      new Request('https://s/api/ai/transcribe', { method: 'POST', body: form }),
    )

    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(order).toEqual([
      'consume',
      'recordUsage(reserve)',
      'deepgram',
      'recordUsage(delta)',
    ])
    expect(recordUsage).toHaveBeenNthCalledWith(1, 'transcribe', null, null, 5)
    expect(recordUsage).toHaveBeenNthCalledWith(2, 'transcribe', null, null, 40)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          duration_seconds: 5400,
          cost_cents: 45,
          cents_reserved: 5,
          debit_recorded: true,
          replayed: false,
        },
      }),
    )
  })
})

// ── fix round 5 — A PROVIDER FAILURE GIVES ITS RESERVE BACK ─────────────────
//
// Blind lens on f7ca09484, MEDIUM 2: a GENUINE provider failure (Deepgram 5xx,
// a timeout, a throw) after the reserve landed left the reserve standing — and
// the worker RETRIES, reserving again each time. Up to max_attempts × the
// estimate would sit on the rolling cap for a recording that was never
// transcribed, so one Deepgram outage could refuse honest work for the rest of
// the day. The reserve is now RELEASED on a throw: one negative row, of exactly
// the reserve, on the same route.
//
// ⚖ AND THAT IS NOT A REFUND. A provider ANSWER is never given back, however
// far short of the estimate it came in. Only the throw — where no money was
// spent at all — releases. The two mutants that blur the line (m20 release on
// success, m21 refund the over-estimate) are the reason these are separate
// claims rather than one.
//
// ⚖ NARROWED IN FIX ROUND 6 (Greptile round 3 on PR #863). "The provider threw"
// was too big a word for "the provider did not bill us". A catch that treats
// EVERY exception as proof of no spend also releases when the socket dropped
// mid-answer, when the client timed out, and when a 2xx body would not parse —
// and each of those can happen AFTER Deepgram accepted and billed the request.
// A requeueing worker would then spend on every attempt while handing back
// every reserve: billed money erased from the very number the cap is computed
// from, the dangerous direction. Only a NON-2xX ANSWER — a `DeepgramHttpError`,
// thrown from one branch of one function — is a refusal we know was not billed.
// Everything ambiguous keeps its reserve.
describe('the release — a provider that ANSWERS non-2xx gives the reserve back', () => {
  const runOneJob = async (job: Record<string, unknown> = baseJob) => {
    claim.mockResolvedValueOnce(job).mockResolvedValueOnce(null)
    await processRecordingJobs(10_000)
  }
  /** Deepgram reached, Deepgram said no — the order push stays honest so the
   *  release can be pinned as happening AFTER the money would have moved. The
   *  error is thrown at the module edge here because these tests are about what
   *  the WALL does with it; the three cases below prove the real wrapper is
   *  what produces it, and produces it for that case ONLY. */
  const providerRefuses = () =>
    transcribeUrlWithDeepgram.mockImplementationOnce(async () => {
      order.push('deepgram')
      throw new DeepgramHttpError(503, 'Service Unavailable', 'upstream')
    })
  const REFUSAL_MESSAGE = 'Deepgram 503 Service Unavailable: upstream'

  /** THE REAL PROVIDER WRAPPER, run against one stubbed HTTP answer. The whole
   *  claim of the fix-round-6 cases is WHICH error `parseDeepgram` throws, and
   *  that is only visible when parseDeepgram actually runs — a mocked module
   *  would let a wrapper that threw the typed error from its PARSE branch too
   *  (m26) pass unnoticed. */
  const realTranscribeUrl = jest.requireActual<typeof import('@/lib/deepgram')>('@/lib/deepgram')
    .transcribeUrlWithDeepgram
  const providerHttp = (answer: () => Response) => {
    deepgramHttp.next = answer
    transcribeUrlWithDeepgram.mockImplementationOnce(async (...a: unknown[]) => {
      order.push('deepgram')
      return realTranscribeUrl(...(a as Parameters<typeof realTranscribeUrl>))
    })
  }
  /** Every cents figure the ledger was handed, in order. */
  const ledger = () => recordUsage.mock.calls.map((c) => (c as unknown[])[3] as number)
  let errorLog: jest.SpyInstance

  beforeEach(() => {
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorLog.mockRestore()
  })

  it('the provider answers non-2xx → ONE negative row of exactly the reserve, and the error leaves unchanged', async () => {
    providerRefuses()

    await runOneJob()

    // +45 reserved, −45 released: the ledger nets to nothing for a recording
    // that was never transcribed.
    expect(ledger()).toEqual([45, -45])
    expect(recordUsage).toHaveBeenNthCalledWith(2, 'transcribe', null, null, -45)
    expect(order).toEqual([
      'consume',
      'recordUsage(reserve)',
      'deepgram',
      'recordUsage(release)',
    ])
    // m22: the release is the reserve, not a cent more or less.
    expect(recordUsage).not.toHaveBeenCalledWith('transcribe', null, null, -46)
    // The provider's own error reaches the worker unchanged — the job requeues
    // by attempts rather than wearing the spend-limit word.
    expect(fail).toHaveBeenCalledWith('job-1', `transcription_failed: ${REFUSAL_MESSAGE}`)
    expect(fail).not.toHaveBeenCalledWith('job-1', AI_SPEND_LIMIT)
    expect(complete).not.toHaveBeenCalled()
    // NO receipt (nothing was transcribed) and NO true-up (nothing to true up).
    expect(rows('recording.transcribe')).toHaveLength(0)
    expect(errorLog).not.toHaveBeenCalledWith(
      '[ai-usage] reserve RELEASE lost after 3 attempts:',
      expect.anything(),
    )
  })

  // ── THE THREE CASES FIX ROUND 6 SEPARATES ─────────────────────────────────
  // All three reach the REAL provider wrapper, because the difference between
  // them is made inside it.

  it('m25 Deepgram itself answers 502 → the real wrapper throws the typed error and the reserve comes back', async () => {
    providerHttp(() => new Response('upstream boom', { status: 502, statusText: 'Bad Gateway' }))

    await runOneJob()

    expect(ledger()).toEqual([45, -45])
    expect(recordUsage).toHaveBeenNthCalledWith(2, 'transcribe', null, null, -45)
    expect(order).toEqual([
      'consume',
      'recordUsage(reserve)',
      'deepgram',
      'recordUsage(release)',
    ])
    // The message the two interactive routes have always surfaced, unchanged by
    // the class it now travels in.
    expect(fail).toHaveBeenCalledWith('job-1', 'transcription_failed: Deepgram 502 Bad Gateway: upstream boom')
    expect(rows('recording.transcribe')).toHaveLength(0)
  })

  it('m24 the request never lands (the socket drops) → NO release: Deepgram may have billed it', async () => {
    providerHttp(() => {
      throw new TypeError('fetch failed')
    })

    await runOneJob()

    // The reserve STAYS. An over-count is the safe direction; erasing a spend
    // Deepgram may already have billed is not.
    expect(ledger()).toEqual([45])
    expect(ledger().every((c) => c > 0)).toBe(true)
    expect(order).toEqual(['consume', 'recordUsage(reserve)', 'deepgram'])
    expect(fail).toHaveBeenCalledWith('job-1', 'transcription_failed: fetch failed')
    expect(rows('recording.transcribe')).toHaveLength(0)
  })

  it('m26 Deepgram answers 200 with a body that will not parse → NO release: it accepted the request', async () => {
    // The most expensive shape of this bug: the provider transcribed the audio,
    // billed us for it, and only the reading of its answer failed.
    providerHttp(() => new Response('<html>not json</html>', { status: 200 }))

    await runOneJob()

    expect(ledger()).toEqual([45])
    expect(ledger().every((c) => c > 0)).toBe(true)
    expect(order).toEqual(['consume', 'recordUsage(reserve)', 'deepgram'])
    expect(recordUsage).not.toHaveBeenCalledWith('transcribe', null, null, -45)
    expect(complete).not.toHaveBeenCalled()
    expect(rows('recording.transcribe')).toHaveLength(0)
    // The error is the PARSE's own — proof the real `res.json()` ran and that
    // the typed error was NOT what came out of it (m26). Matched loosely
    // because the exact wording is the JSON parser's, and it moves with Node.
    const reason = (fail.mock.calls[0] as unknown[])[1] as string
    expect(reason).toMatch(/JSON/i)
    expect(reason).not.toMatch(/^Deepgram /)
    expect(reason).not.toMatch(/unexpected non-HEAD fetch/)
  })

  it('m20 the provider ANSWERS → no negative row is ever written', async () => {
    await runOneJob()

    expect(ledger()).toEqual([45])
    expect(ledger().every((c) => c > 0)).toBe(true)
    expect(order).toEqual(['consume', 'recordUsage(reserve)', 'deepgram'])
    expect(rows('recording.transcribe')[0].detail).toMatchObject({ debit_recorded: true })
  })

  it('m21 the provider answers SHORTER than the estimate → still no refund, the over-reservation stands', async () => {
    // 32.4 MB reserved 45 ¢; the take turns out to be five minutes (3 ¢). The
    // 42 ¢ difference is NOT given back — only a throw releases.
    deepgramResult.durationSec = 300

    await runOneJob()

    expect(ledger()).toEqual([45])
    expect(recordUsage).not.toHaveBeenCalledWith('transcribe', null, null, -42)
    expect(rows('recording.transcribe')[0].detail).toMatchObject({
      duration_seconds: 300,
      cost_cents: 3,
      cents_reserved: 45,
      debit_recorded: true,
    })
  })

  it('the release cannot land after three attempts → written down, the reserve stays, the error still leaves unchanged', async () => {
    providerRefuses()
    // The reserve lands; every release attempt fails.
    recordUsage.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('core down'))

    await runOneJob()

    expect(recordUsage).toHaveBeenCalledTimes(4) // 1 reserve + 3 release attempts
    expect(ledger()).toEqual([45, -45, -45, -45])
    // ONE line, and it is the RELEASE's own — never the lost-DEBIT line, which
    // means the opposite thing (an under-count, the dangerous direction).
    // Counted by MESSAGE, not by total: the worker logs its own
    // `[jobs] recording job … failed:` line beside it, as it does for every
    // failed job, and that one is not this claim.
    expect(
      errorLog.mock.calls.filter((c) => c[0] === '[ai-usage] reserve RELEASE lost after 3 attempts:'),
    ).toHaveLength(1)
    expect(errorLog).toHaveBeenCalledWith(
      '[ai-usage] reserve RELEASE lost after 3 attempts:',
      expect.objectContaining({ reserveCents: 45 }),
    )
    expect(errorLog).not.toHaveBeenCalledWith(
      '[ai-usage] transcription debit LOST after 3 attempts:',
      expect.anything(),
    )
    // ⚖ The reserve simply STAYS — an over-count, the safe direction. Nothing
    // is thrown from the release itself: the provider's error is the one the
    // caller sees.
    expect(fail).toHaveBeenCalledWith('job-1', `transcription_failed: ${REFUSAL_MESSAGE}`)
    expect(rows('recording.transcribe')).toHaveLength(0)
  })

  it('m23 a retried job reserves again — over two attempts the ledger nets ONE estimate, not two', async () => {
    // Attempt 1: Deepgram answers 503. +45 then −45.
    providerRefuses()
    await runOneJob()
    expect(order).toEqual([
      'consume',
      'recordUsage(reserve)',
      'deepgram',
      'recordUsage(release)',
    ])
    // The order labels are positional WITHIN one run (a row after 'deepgram' is
    // a true-up), so attempt 2 gets its own clean slate. The `recordUsage`
    // ledger below is deliberately NOT cleared — the net across both attempts
    // is the whole claim.
    order.length = 0

    // Attempt 2, the requeue: Deepgram answers. +45, and nothing released.
    await runOneJob({ ...baseJob, attempts: 2 })

    expect(order).toEqual(['consume', 'recordUsage(reserve)', 'deepgram'])
    expect(ledger()).toEqual([45, -45, 45])
    expect(ledger().reduce((a, b) => a + b, 0)).toBe(45)
    // Twice reserved, ONCE released — a release per throw, never a spare.
    expect(ledger().filter((c) => c < 0)).toHaveLength(1)
    // The second attempt is the one that produced words: one receipt, one save.
    expect(rows('recording.transcribe')).toHaveLength(1)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('the ceiling refuses before the reserve exists → nothing to release', async () => {
    consume.mockResolvedValueOnce(REFUSED)

    await runOneJob()

    expect(recordUsage).not.toHaveBeenCalled()
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
  })
})

// ── ⚖ CHARGE ONCE, DURABLY (PR-5) ───────────────────────────────────────────
// A transcription is paid for ONCE per (business, audio object, language). The
// meter reads the memo BEFORE the ceiling, the reserve and the provider, and
// writes it only AFTER the provider answered. The assertions count the
// PROVIDER mock, the consume and the reserve — the three things that cost.
describe('charge once — the durable transcript memo', () => {
  const afterThis: Array<() => void> = []
  afterEach(() => afterThis.splice(0).forEach((undo) => undo()))
  const AUDIO = conformingKey('biz-1')
  const memoKey = (audio: string, locale: 'ja' | 'en' = 'ja') => `trc/${audio}.${locale}.json`
  const call = (audioKey: string | null | undefined, locale = 'ja') =>
    runMeteredTranscription(
      {
        synqed: fakeClient as unknown as Pick<SynqedClient, 'aiRateLimit'>,
        businessId: 'biz-1',
        door: 'app',
        audioKey,
      },
      {
        audio: { url: 'https://x/audio' },
        locale,
        diarize: true,
        reference: null,
        mode: 'off',
        businessType: null,
      },
    )

  it('t1 paid, then the same key + locale → ONE provider call, ONE consume, ONE reserve; the replay is free and identical', async () => {
    const first = await call(AUDIO)
    const second = await call(AUDIO)

    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(first.receipt).toEqual({
      duration_seconds: 5400,
      cost_cents: 45,
      cents_reserved: 45,
      debit_recorded: true,
      replayed: false,
    })
    expect(second.receipt).toEqual({
      duration_seconds: 5400,
      cost_cents: 0,
      cents_reserved: 0,
      debit_recorded: true,
      replayed: true,
    })
    expect(second.result).toEqual(first.result)
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(storageUpload).toHaveBeenCalledWith(memoKey(AUDIO), expect.any(String), {
      contentType: 'application/json',
      upsert: false,
    })
  })

  it('t3 the same audio in the OTHER language pays again, and its memo lands under its own key', async () => {
    await call(AUDIO, 'ja')
    await call(AUDIO, 'en')

    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(2)
    expect(recordUsage).toHaveBeenCalledTimes(2)
    expect(storageUpload.mock.calls.map((c) => c[0])).toEqual([
      memoKey(AUDIO, 'ja'),
      memoKey(AUDIO, 'en'),
    ])
    expect([...memoStore.keys()].sort()).toEqual([memoKey(AUDIO, 'en'), memoKey(AUDIO, 'ja')])
  })

  it('t4 an EMPTY transcript was still paid for → written, and the replay returns it with no provider call', async () => {
    deepgramResult.transcript = ''

    const first = await call(AUDIO)
    const second = await call(AUDIO)

    expect(first.result.transcript).toBe('')
    expect(second.result.transcript).toBe('')
    expect(second.receipt.replayed).toBe(true)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it('t5 another tenant’s key composes NO memo key → storage is never touched, and the call pays as today', async () => {
    const res = await call(conformingKey('biz-2'))

    expect(storageDownload).not.toHaveBeenCalled()
    expect(storageUpload).not.toHaveBeenCalled()
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(res.receipt.replayed).toBe(false)
  })

  it('t6 the web multipart arm carries no key → no memo read or write, and it pays', async () => {
    const form = new FormData()
    form.append('audio', new File([new Uint8Array(3_000_000)], 'take.webm', { type: 'audio/webm' }))
    form.append('locale', 'ja')

    const res = await webTranscribePOST(
      new Request('https://s/api/ai/transcribe', { method: 'POST', body: form }),
    )

    expect(res.status).toBe(200)
    expect(storageDownload).not.toHaveBeenCalled()
    expect(storageUpload).not.toHaveBeenCalled()
    expect(transcribeWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a DeepgramHttpError', () => new DeepgramHttpError(503, 'Service Unavailable', 'upstream')],
    ['a plain Error', () => new Error('socket hang up')],
  ])('t7 the provider throws %s → nothing is written', async (_label, error) => {
    transcribeUrlWithDeepgram.mockRejectedValueOnce(error())

    await expect(call(AUDIO)).rejects.toThrow()

    // The first read, and the re-read under the lease before paying (S57).
    expect(storageDownload).toHaveBeenCalledTimes(2)
    expect(storageUpload).not.toHaveBeenCalled()
    expect(memoStore.size).toBe(0)
  })

  it.each([
    ['answers an error', () => storageUpload.mockResolvedValueOnce({ data: null, error: { statusCode: '500', message: 'boom' } } as never)],
    ['rejects', () => storageUpload.mockRejectedValueOnce(new Error('storage down'))],
  ])('t8 the memo upload %s → the paid result is still returned, nothing thrown, ONE warn', async (_label, arrange) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    arrange()

    const res = await call(AUDIO)

    expect(res.result.transcript).toBe('こんにちは')
    expect(res.receipt.replayed).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('transcript-memo.write')
    // Status only — never the key (the business + take id).
    expect(String(warn.mock.calls[0][0])).not.toContain(AUDIO)
    warn.mockRestore()
  })

  it('t8 a duplicate refusal (two doors paid in the same moment) is SILENT — the first copy stands', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    memoStore.set(memoKey(AUDIO), 'first copy')
    // The read above misses (the other door had not landed yet), and so does the
    // re-read under the lease (S57); the write then meets the other door's copy.
    for (let i = 0; i < 2; i++) {
      storageDownload.mockResolvedValueOnce({
        data: null,
        error: { status: 400, statusCode: '404', message: 'Object not found' },
      })
    }

    const res = await call(AUDIO)

    expect(res.receipt.replayed).toBe(false)
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(memoStore.get(memoKey(AUDIO))).toBe('first copy')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // ⚖ A CORRUPT MEMO IS REPAIRED (Greptile round). Proven garbage — the object
  // came back and is not a v1 memo — is the one thing the next PAID answer may
  // replace; after that the audio is charged once again, forever.
  it.each([
    ['a body that is not JSON', '{not json'],
    ['a v2 memo', JSON.stringify({ v: 2, result: {}, duration_seconds: 1 })],
    ['a v1 memo with no result', JSON.stringify({ v: 1, duration_seconds: 1 })],
    ['a v1 memo with a string duration', JSON.stringify({ v: 1, result: {}, duration_seconds: '1' })],
  ])('t12 %s is CORRUPT → the call pays, the memo is REPAIRED (upsert:true), and the next call replays free', async (_label, body) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    memoStore.set(memoKey(AUDIO), body)

    const first = await call(AUDIO)

    expect(first.receipt.replayed).toBe(false)
    expect(storageUpload).toHaveBeenCalledWith(memoKey(AUDIO), expect.any(String), {
      contentType: 'application/json',
      upsert: true,
    })
    // Three warns, all the corrupt read — the first, the re-read under the lease
    // before paying (S57), and the re-check right before the repair (Greptile
    // round 2). The repair itself lands silently.
    expect(warn).toHaveBeenCalledTimes(3)
    for (const [line] of warn.mock.calls) expect(String(line)).toContain('transcript-memo.corrupt')

    const second = await call(AUDIO)

    expect(second.receipt.replayed).toBe(true)
    expect(second.result).toEqual(first.result)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('t12 a READABLE memo is never replaced — a hit writes nothing at all', async () => {
    const good = JSON.stringify({ v: 1, result: { transcript: 'first' }, duration_seconds: 7, written_at: '' })
    memoStore.set(memoKey(AUDIO), good)

    const res = await call(AUDIO)

    expect(res.result).toEqual({ transcript: 'first' })
    expect(storageUpload).not.toHaveBeenCalled()
    expect(memoStore.get(memoKey(AUDIO))).toBe(good)
  })

  it('t12 an UNREADABLE memo (a storage error, not proven garbage) pays, and writes create-only — the object stands', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const good = JSON.stringify({ v: 1, result: { transcript: 'first' }, duration_seconds: 7, written_at: '' })
    memoStore.set(memoKey(AUDIO), good)
    // Unreadable on the first read AND on the re-read under the lease (S57).
    storageDownload.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'storage down' } } as never)
    storageDownload.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'storage down' } } as never)

    const res = await call(AUDIO)

    expect(res.receipt.replayed).toBe(false)
    expect(storageUpload).toHaveBeenCalledWith(memoKey(AUDIO), expect.any(String), {
      contentType: 'application/json',
      upsert: false,
    })
    expect(memoStore.get(memoKey(AUDIO))).toBe(good)
    warn.mockRestore()
  })

  // ⚖ A REPAIR YIELDS TO ANOTHER CALLER'S (Greptile rounds 2–3). Two callers
  // that both read the SAME garbage both pay; the one that writes second must
  // not clobber the first one's repair. The FIRST read is the proof of garbage;
  // the second, right before the write, only asks whether someone else already
  // replaced it: a hit yields, anything else repairs.
  const CORRUPT = '{not json'
  const OTHER = JSON.stringify({ v: 1, result: { transcript: 'other caller' }, duration_seconds: 9, written_at: '' })

  it('t14a corrupt → pay → the re-check finds ANOTHER caller’s repair → no write; our answer returned, theirs stands', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    memoStore.set(memoKey(AUDIO), CORRUPT)
    // While we pay, the other caller's repair lands.
    transcribeUrlWithDeepgram.mockImplementationOnce(async () => {
      memoStore.set(memoKey(AUDIO), OTHER)
      return deepgramResult
    })

    const res = await call(AUDIO)

    expect(res.result.transcript).toBe('こんにちは')
    expect(res.receipt.replayed).toBe(false)
    // The first read, the re-read under the lease (S57), the re-check.
    expect(storageDownload).toHaveBeenCalledTimes(3)
    expect(storageUpload).not.toHaveBeenCalled()
    expect(memoStore.get(memoKey(AUDIO))).toBe(OTHER)
    warn.mockRestore()
  })

  it('t14b corrupt → pay → the re-check finds it STILL corrupt → repaired once, upsert:true', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    memoStore.set(memoKey(AUDIO), CORRUPT)

    await call(AUDIO)

    // The first read, the re-read under the lease (S57), the re-check.
    expect(storageDownload).toHaveBeenCalledTimes(3)
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(storageUpload).toHaveBeenCalledWith(memoKey(AUDIO), expect.any(String), {
      contentType: 'application/json',
      upsert: true,
    })
    expect(JSON.parse(memoStore.get(memoKey(AUDIO))!).v).toBe(1)
    warn.mockRestore()
  })

  it.each([
    ['says MISSING', { data: null, error: { status: 400, statusCode: '404', message: 'Object not found' } }],
    ['ERRORS', { data: null, error: { status: 500, message: 'storage down' } }],
  ])('t14c corrupt → pay → the re-check %s → STILL repaired, upsert:true (the first read was the proof)', async (_label, answer) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    memoStore.set(memoKey(AUDIO), CORRUPT)
    // The re-check (the next download after the provider answers) gets this.
    transcribeUrlWithDeepgram.mockImplementationOnce(async () => {
      storageDownload.mockResolvedValueOnce(answer as never)
      return deepgramResult
    })

    const res = await call(AUDIO)

    // The first read, the re-read under the lease (S57), the re-check.
    expect(storageDownload).toHaveBeenCalledTimes(3)
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(storageUpload).toHaveBeenCalledWith(memoKey(AUDIO), expect.any(String), {
      contentType: 'application/json',
      upsert: true,
    })
    // …and the garbage is gone: the object now holds this paid answer.
    expect(JSON.parse(memoStore.get(memoKey(AUDIO))!).result).toEqual(res.result)
    warn.mockRestore()
  })

  // ⚖ THE CONCURRENT-CALLERS CEILING, NAMED (Greptile round, ruled bounded).
  // Both callers miss before either provider answers, so each pays once —
  // what every call did before PR-5 — and the loser's write meets the
  // duplicate refusal: ONE memo object, and no warn.
  // S53 A5 closes this race with the lease (below); OFF keeps this answer exactly.
  it('t13 (switch OFF) two interleaved callers both miss → two charges, ONE memo, the loser’s write silent, both answered', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', false)
    afterThis.push(() => off.restore())
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    let release!: (r: DeepgramTranscribeResult) => void
    transcribeUrlWithDeepgram.mockImplementationOnce(
      () => new Promise<DeepgramTranscribeResult>((resolve) => (release = resolve)),
    )

    const first = call(AUDIO)
    // Hold the first call INSIDE the provider until the second has read the memo.
    while (transcribeUrlWithDeepgram.mock.calls.length < 1) await new Promise(setImmediate)
    const second = await call(AUDIO)
    release({ ...deepgramResult, transcript: 'first caller' })
    const firstRes = await first

    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(2)
    expect(recordUsage).toHaveBeenCalledTimes(2)
    expect(storageDownload).toHaveBeenCalledTimes(2)
    expect(storageUpload).toHaveBeenCalledTimes(2)
    expect(memoStore.size).toBe(1)
    // The second caller answered first, so its copy is the one that stands.
    expect(JSON.parse(memoStore.get(memoKey(AUDIO))!).result.transcript).toBe('こんにちは')
    expect(firstRes.result.transcript).toBe('first caller')
    expect(second.result.transcript).toBe('こんにちは')
    expect(firstRes.receipt.replayed).toBe(false)
    expect(second.receipt.replayed).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // ⚖ S53 A3 — THE MEMO IS WRITTEN BEFORE THE TRUE-UP. The true-up is up to
  // three core calls and a second of waits; a process that dies inside it (the
  // 300 s limit, a crash) used to take the PAID answer with it, and the next
  // attempt paid again. A true-up that never finishes is exactly that death as
  // the code sees it: the memo must already be readable while it hangs.
  it('a3 the TRUE-UP never finishes (the process dies inside it) → the paid answer is already remembered, and the next call replays it', async () => {
    // 600,000 B → 100 s → a 1 ¢ reserve; the 5,400 s answer owes a 44 ¢ true-up.
    headBytes.current = 600_000
    let trueUpStarted = false
    recordUsage
      .mockResolvedValueOnce(undefined) // the reserve lands
      .mockImplementationOnce(() => {
        trueUpStarted = true
        return new Promise<void>(() => {}) // …and the true-up never returns
      })

    void call(AUDIO)
    while (!trueUpStarted) await new Promise(setImmediate)

    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    const memo = await readTranscriptMemo(memoKey(AUDIO))
    expect(memo).toMatchObject({ state: 'hit', memo: { v: 1, duration_seconds: 5400, result: { transcript: 'こんにちは' } } })

    // The retry after that death reads it: no second provider call.
    const retry = await call(AUDIO)
    expect(retry.receipt.replayed).toBe(true)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it('a3 a true-up that is LOST (three failures) still leaves exactly one memo, written before the ledger calls', async () => {
    headBytes.current = 600_000
    recordUsage.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('core down'))
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})

    const paid = await call(AUDIO)

    expect(paid.receipt.debit_recorded).toBe(false)
    // S57: ONE write, ONE memo — the memo with its debt, never rewritten; and no
    // true-up object, because the ledger never took the delta.
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(memoStore.size).toBe(1)
    expect(trueUpUpload).not.toHaveBeenCalled()
    // The memo write precedes the first true-up attempt in the call order.
    const uploadOrder = storageUpload.mock.invocationCallOrder[0]
    const trueUpOrder = recordUsage.mock.invocationCallOrder[1]
    expect(uploadOrder).toBeLessThan(trueUpOrder)
    err.mockRestore()
  })

  it('a6 the switch ships ON (2026-09-28, S53)', () => {
    expect(RECORDING_SWITCHES.transcribePaidOnce).toBe(true)
  })

  it('a6 switch OFF → the pre-S53 order: a true-up that never finishes leaves NO memo (the answer dies with the process)', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', false)
    try {
      headBytes.current = 600_000
      let trueUpStarted = false
      recordUsage.mockResolvedValueOnce(undefined).mockImplementationOnce(() => {
        trueUpStarted = true
        return new Promise<void>(() => {})
      })
      void call(AUDIO)
      while (!trueUpStarted) await new Promise(setImmediate)
      expect(storageUpload).not.toHaveBeenCalled()
      expect(memoStore.size).toBe(0)
    } finally {
      off.restore()
    }
  })

  it('a6 switch OFF → a lost true-up still writes the memo, AFTER the ledger calls (the pre-S53 order)', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', false)
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      headBytes.current = 600_000
      recordUsage.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('core down'))
      await call(AUDIO)
      expect(storageUpload).toHaveBeenCalledTimes(1)
      expect(storageUpload.mock.invocationCallOrder[0]).toBeGreaterThan(recordUsage.mock.invocationCallOrder[3])
    } finally {
      err.mockRestore()
      off.restore()
    }
  })

  // ⚖ S56 — THE TRUE-UP'S DEBT (PR 1 Greptile Finding 1: "Memo can hide unpaid
  // usage"). The memo is written BEFORE the true-up (A3), so a process that
  // died between the two left a memo that replayed with a hardcoded
  // `debit_recorded: true` while the delta was never recorded. The memo now
  // carries the debt; a replay that finds it owed records the delta first.
  // ⚖ S57 (Greptile round 2 on #1086, finding 2): the memo is written ONCE and
  // never rewritten; "recorded" has ONE home — the create-only true-up object
  // beside it — and a replay records only under the lease (finding 1).
  // 600,000 B → 100 s → a 1 ¢ reserve; the 5,400 s answer costs 45 ¢ → 44 ¢ owed.
  describe('s56 the true-up debt — a replay never hides an unrecorded delta', () => {
    const DELTA = 44
    const trueUpKey = (audio: string) => `trc/${audio}.ja.trueup.json`
    const stored = () => JSON.parse(memoStore.get(memoKey(AUDIO))!) as Record<string, unknown> & {
      trueUp?: Record<string, unknown>
    }
    const recordedFact = () => trueUpStore.has(trueUpKey(AUDIO))
    const deltaCalls = () => recordUsage.mock.calls.filter((c) => (c as unknown[])[3] === DELTA)

    beforeEach(() => {
      headBytes.current = 600_000
    })

    it('s56 t1 order: the memo lands WITH its debt BEFORE recordUsage(delta); the true-up object is created AFTER it, create-only; the memo is never rewritten', async () => {
      const paid = await call(AUDIO)

      expect(paid.receipt).toEqual({
        duration_seconds: 5400,
        cost_cents: 45,
        cents_reserved: 1,
        debit_recorded: true,
        replayed: false,
      })
      expect(recordUsage.mock.calls).toEqual([
        ['transcribe', null, null, 1],
        ['transcribe', null, null, DELTA],
      ])
      // ONE memo write, create-only, carrying the debt's numbers only.
      expect(storageUpload).toHaveBeenCalledTimes(1)
      expect(storageUpload.mock.calls[0][2]).toEqual({ contentType: 'application/json', upsert: false })
      expect(stored().trueUp).toEqual({ reserveCents: 1, costCents: 45, deltaCents: DELTA })
      // Call ORDER: the memo < the true-up < the recorded fact.
      const memoAt = storageUpload.mock.invocationCallOrder[0]
      const trueUpAt = recordUsage.mock.invocationCallOrder[1]
      const factAt = trueUpUpload.mock.invocationCallOrder[0]
      expect(memoAt).toBeLessThan(trueUpAt)
      expect(trueUpAt).toBeLessThan(factAt)
      expect(trueUpUpload).toHaveBeenCalledTimes(1)
      expect(trueUpUpload.mock.calls[0][0]).toBe(trueUpKey(AUDIO))
      expect(trueUpUpload.mock.calls[0][2]).toEqual({ contentType: 'application/json', upsert: false })
      expect(JSON.parse(trueUpStore.get(trueUpKey(AUDIO))!)).toMatchObject({ v: 1, deltaCents: DELTA })
      expect(memoStore.size).toBe(1)
      expect(stored().result).toEqual(paid.result)
    })

    it('s56 t2 the writer is exhausted → debit_recorded false, the debt left owed (no true-up object); the next replay records the delta ONCE under the lease → the object created, true', async () => {
      const err = jest.spyOn(console, 'error').mockImplementation(() => {})
      recordUsage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('core down'))
        .mockRejectedValueOnce(new Error('core down')).mockRejectedValueOnce(new Error('core down'))

      const paid = await call(AUDIO)
      expect(paid.receipt.debit_recorded).toBe(false)
      expect(stored().trueUp).toEqual({ reserveCents: 1, costCents: 45, deltaCents: DELTA })
      expect(recordedFact()).toBe(false)
      const memoAfterPay = memoStore.get(memoKey(AUDIO))

      recordUsage.mockClear()
      const replay = await call(AUDIO)

      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
      expect(consume).toHaveBeenCalledTimes(1)
      expect(recordUsage.mock.calls).toEqual([['transcribe', null, null, DELTA]])
      expect(replay.receipt).toEqual({
        duration_seconds: 5400,
        cost_cents: 0,
        cents_reserved: 0,
        debit_recorded: true,
        replayed: true,
      })
      expect(replay.result).toEqual(paid.result)
      expect(recordedFact()).toBe(true)
      // The memo itself is byte-for-byte the one the payer wrote.
      expect(memoStore.get(memoKey(AUDIO))).toBe(memoAfterPay)
      err.mockRestore()
    })

    // ⚖ S57 (Greptile round 2 on #1086, finding 1): the dead payer still HOLDS its lease (its
    // finally never ran), so a replay inside the lease's life never records the delta — it says so
    // (`lease_busy`) and answers. Once that lease has expired, the next replay takes it over and
    // records the delta exactly once.
    it('s56 t2b the process DIES between the memo and the true-up (Greptile’s case) → a replay under its still-live lease records NOTHING (lease_busy); after the lease expires the next replay records the delta exactly once', async () => {
      let trueUpStarted = false
      recordUsage.mockResolvedValueOnce(undefined).mockImplementationOnce(() => {
        trueUpStarted = true
        return new Promise<void>(() => {}) // the death: the true-up never returns
      })
      void call(AUDIO)
      while (!trueUpStarted) await new Promise(setImmediate)
      expect(stored().trueUp).toEqual({ reserveCents: 1, costCents: 45, deltaCents: DELTA })

      const early = await call(AUDIO)
      expect(early.receipt).toEqual({
        duration_seconds: 5400,
        cost_cents: 0,
        cents_reserved: 0,
        debit_recorded: false,
        replayed: true,
        debit_deferred_reason: 'lease_busy',
      })
      expect(deltaCalls()).toHaveLength(1) // only the dead payer's own, never the replay's
      expect(recordedFact()).toBe(false)

      // 330 s later: the dead payer's lease has expired.
      leaseStore.set(`trc/${AUDIO}.ja.lease.json`, JSON.stringify({ v: 1, expires_at: Date.now() - 1 }))
      const replay = await call(AUDIO)

      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
      // the dead true-up, and ONE delta from the replay that held the lease.
      expect(deltaCalls()).toHaveLength(2)
      expect(recordUsage.mock.calls[2]).toEqual(['transcribe', null, null, DELTA])
      expect(replay.receipt.debit_recorded).toBe(true)
      expect(replay.receipt.replayed).toBe(true)
      expect(replay.receipt).not.toHaveProperty('debit_deferred_reason')
      expect(recordedFact()).toBe(true)
      // …and it gave the lease back (overwritten as expired, never deleted).
      expect(JSON.parse(leaseStore.get(`trc/${AUDIO}.ja.lease.json`)!).expires_at).toBe(0)
    })

    it('s56 t3 replay after success: the true-up object stands → the replay never calls recordUsage, never takes the lease, writes nothing, and debit_recorded is true', async () => {
      await call(AUDIO)
      expect(recordedFact()).toBe(true)
      recordUsage.mockClear()
      storageUpload.mockClear()
      trueUpUpload.mockClear()
      leaseUpload.mockClear()

      const replay = await call(AUDIO)

      expect(recordUsage).not.toHaveBeenCalled()
      expect(storageUpload).not.toHaveBeenCalled()
      expect(trueUpUpload).not.toHaveBeenCalled()
      expect(leaseUpload).not.toHaveBeenCalled()
      expect(replay.receipt.debit_recorded).toBe(true)
      expect(replay.receipt.replayed).toBe(true)
    })

    it('s56 t4 the replay keeps failing → the answer still comes back, debit_recorded false (no deferral reason — a lost debit), the debt still owed — never cleared, never deleted, the memo never rewritten', async () => {
      const err = jest.spyOn(console, 'error').mockImplementation(() => {})
      recordUsage.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('core down'))

      const paid = await call(AUDIO)
      const memoAfterPay = memoStore.get(memoKey(AUDIO))
      const replay = await call(AUDIO)

      expect(replay.result).toEqual(paid.result)
      expect(replay.receipt).toEqual({ duration_seconds: 5400, cost_cents: 0, cents_reserved: 0, debit_recorded: false, replayed: true })
      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
      // three attempts on the paid call, three on the replay — all for the delta.
      expect(deltaCalls()).toHaveLength(6)
      expect(memoStore.size).toBe(1)
      expect(memoStore.get(memoKey(AUDIO))).toBe(memoAfterPay)
      expect(stored().trueUp).toEqual({ reserveCents: 1, costCents: 45, deltaCents: DELTA })
      expect(recordedFact()).toBe(false)
      expect(storageUpload).toHaveBeenCalledTimes(1)
      err.mockRestore()
    })

    it('s56 t5 no delta (the reserve covered it) → no debt at all; the replay is true and calls nothing', async () => {
      headBytes.current = 32_400_000 // 5,400 s reserved = 45 ¢ = the cost
      const paid = await call(AUDIO)
      expect(paid.receipt.debit_recorded).toBe(true)
      expect(storageUpload).toHaveBeenCalledTimes(1)
      expect(stored()).not.toHaveProperty('trueUp')
      expect(trueUpUpload).not.toHaveBeenCalled()
      recordUsage.mockClear()

      const replay = await call(AUDIO)

      expect(recordUsage).not.toHaveBeenCalled()
      expect(replay.receipt.debit_recorded).toBe(true)
      expect(storageUpload).toHaveBeenCalledTimes(1)
      expect(trueUpDownload).not.toHaveBeenCalled()
    })

    it('s56 t6 a memo with NO debt (the only shape origin/main writes — after its true-up ran) → replays true, no ledger call, no write, no true-up read', async () => {
      const legacy = JSON.stringify({ v: 1, result: { transcript: 'legacy' }, duration_seconds: 5400, written_at: '' })
      memoStore.set(memoKey(AUDIO), legacy)

      const replay = await call(AUDIO)

      expect(replay.result).toEqual({ transcript: 'legacy' })
      expect(replay.receipt).toEqual({
        duration_seconds: 5400,
        cost_cents: 0,
        cents_reserved: 0,
        debit_recorded: true,
        replayed: true,
      })
      expect(recordUsage).not.toHaveBeenCalled()
      expect(storageUpload).not.toHaveBeenCalled()
      expect(trueUpDownload).not.toHaveBeenCalled()
      expect(memoStore.get(memoKey(AUDIO))).toBe(legacy)
    })

    it('s56 t7 a debt this code cannot read → debit_recorded false (never proven), no number invented, nothing written', async () => {
      const err = jest.spyOn(console, 'error').mockImplementation(() => {})
      const odd = JSON.stringify({
        v: 1,
        result: { transcript: 'odd' },
        duration_seconds: 5400,
        written_at: '',
        trueUp: { deltaCents: 'forty-four' },
      })
      memoStore.set(memoKey(AUDIO), odd)

      const replay = await call(AUDIO)

      expect(replay.result).toEqual({ transcript: 'odd' })
      expect(replay.receipt.debit_recorded).toBe(false)
      expect(replay.receipt).not.toHaveProperty('debit_deferred_reason')
      expect(recordUsage).not.toHaveBeenCalled()
      expect(storageUpload).not.toHaveBeenCalled()
      expect(trueUpUpload).not.toHaveBeenCalled()
      expect(err).toHaveBeenCalledTimes(1)
      err.mockRestore()
    })

    it('s56 t8 switch OFF → the pre-S53 order writes NO debt (the true-up already ran to its end) and no true-up object', async () => {
      const off = jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', false)
      try {
        const paid = await call(AUDIO)
        expect(paid.receipt.debit_recorded).toBe(true)
        expect(storageUpload).toHaveBeenCalledTimes(1)
        expect(storageUpload.mock.invocationCallOrder[0]).toBeGreaterThan(recordUsage.mock.invocationCallOrder[1])
        expect(stored()).not.toHaveProperty('trueUp')
        expect(trueUpUpload).not.toHaveBeenCalled()
      } finally {
        off.restore()
      }
    })

    // ⚖ S56 (stress lens N1): the debt belongs ONLY to the caller whose write CREATED the memo.
    // Here a delta IS owed: a caller that lost the create race still asks the ledger for its OWN
    // delta, and never answers for the winner's debt — no true-up object on its account, the
    // standing memo byte-for-byte.
    it.each([
      ['the ledger takes the delta', true],
      ['the ledger is exhausted', false],
    ] as const)('s56 t9 a delta is owed and the memo write meets a DUPLICATE refusal (%s) → this call owns no debt: no true-up object for the winner’s debt, the standing memo byte-for-byte, debit_recorded = the ledger’s answer', async (_label, lands) => {
      const err = jest.spyOn(console, 'error').mockImplementation(() => {})
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      if (!lands) {
        recordUsage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('core down'))
          .mockRejectedValueOnce(new Error('core down')).mockRejectedValueOnce(new Error('core down'))
      }
      // Another caller's paid answer already stands — with ITS OWN debt, still owed.
      const standing = JSON.stringify({
        v: 1,
        result: { transcript: 'the other caller' },
        duration_seconds: 5400,
        written_at: '2026-09-29T00:00:00.000Z',
        trueUp: { reserveCents: 1, costCents: 45, deltaCents: DELTA },
      })
      memoStore.set(memoKey(AUDIO), standing)
      // Our read misses (the other caller had not landed yet), and so does our re-read under the
      // lease (S57); our write then meets its copy.
      for (let i = 0; i < 2; i++) {
        storageDownload.mockResolvedValueOnce({
          data: null,
          error: { status: 400, statusCode: '404', message: 'Object not found' },
        })
      }
      try {
        const res = await call(AUDIO)

        expect(res.receipt.replayed).toBe(false)
        expect(res.result.transcript).toBe('こんにちは')
        expect(res.receipt.debit_recorded).toBe(lands)
        // THIS call's own delta: recorded once when the ledger takes it; when it is exhausted,
        // only the writer's own three attempts — never a second round.
        expect(deltaCalls()).toHaveLength(lands ? 1 : 3)
        // ONE write — the create-only attempt the duplicate refusal answered.
        expect(storageUpload).toHaveBeenCalledTimes(1)
        expect(storageUpload.mock.calls[0][2]).toEqual({ contentType: 'application/json', upsert: false })
        // The winner's debt is not ours to answer for: no true-up object, whatever our ledger said.
        expect(trueUpUpload).not.toHaveBeenCalled()
        expect(recordedFact()).toBe(false)
        // The standing memo — answer and debt — is untouched, byte for byte.
        expect(memoStore.size).toBe(1)
        expect(memoStore.get(memoKey(AUDIO))).toBe(standing)
        expect(warn).not.toHaveBeenCalled()
      } finally {
        err.mockRestore()
        warn.mockRestore()
      }
    })
  })

  // ── ⚖ S53 A5 — THE "TRANSCRIBING NOW" LEASE ───────────────────────────────
  const leaseKey = (audio: string) => `trc/${audio}.ja.lease.json`
  const liveLease = (audio: string, ms = 330_000) =>
    leaseStore.set(leaseKey(audio), JSON.stringify({ v: 1, expires_at: Date.now() + ms }))

  it('a5 E2 — a second call while the first is INSIDE the provider → 409, nothing consumed, reserved or paid; the answer then replays: ONE paid call', async () => {
    let release!: (r: DeepgramTranscribeResult) => void
    transcribeUrlWithDeepgram.mockImplementationOnce(
      () => new Promise<DeepgramTranscribeResult>((resolve) => (release = resolve)),
    )
    const first = call(AUDIO)
    while (transcribeUrlWithDeepgram.mock.calls.length < 1) await new Promise(setImmediate)
    expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBeGreaterThan(Date.now() + 300_000)
    // S54 B: written with the ONE shared TTL the client's still-working deadline reads.
    const expiresAt = JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at
    expect(expiresAt).toBeGreaterThan(Date.now() + TRANSCRIPT_LEASE_TTL_MS - 5_000)
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + TRANSCRIPT_LEASE_TTL_MS)

    const second = await call(AUDIO).then(() => 'answered', (e: unknown) => e)
    expect(second).toMatchObject({ code: 'conflict', detail: { reason: 'transcribing' } })
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledTimes(1)

    release({ ...deepgramResult })
    await first
    // Released on the way out — overwritten as expired, never deleted.
    expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBe(0)
    const third = await call(AUDIO)
    expect(third.receipt.replayed).toBe(true)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it('a5 a live lease AND a memo → the memo replays (it is read first; the lease is never consulted)', async () => {
    await call(AUDIO)
    liveLease(AUDIO)
    leaseUpload.mockClear()
    const again = await call(AUDIO)
    expect(again.receipt.replayed).toBe(true)
    expect(leaseUpload).not.toHaveBeenCalled()
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it('a5 an EXPIRED lease (its holder died) → falls open: taken over, paid, released', async () => {
    liveLease(AUDIO, -1)
    const paid = await call(AUDIO)
    expect(paid.receipt.replayed).toBe(false)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(leaseUpload).toHaveBeenCalledWith(leaseKey(AUDIO), expect.any(String), expect.objectContaining({ upsert: true }))
    expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBe(0)
  })

  it('a5 the holder’s provider FAILS → the lease is released on the way out, and the retry pays at once (never blocked for the TTL)', async () => {
    transcribeUrlWithDeepgram.mockRejectedValueOnce(new Error('socket hang up'))
    await expect(call(AUDIO)).rejects.toThrow('socket hang up')
    expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBe(0)
    const retry = await call(AUDIO)
    expect(retry.receipt.replayed).toBe(false)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(2)
  })

  it('a5 storage will not answer the lease → pays exactly as before (fail open)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    leaseUpload.mockResolvedValueOnce({ data: null, error: { statusCode: '500', message: 'storage down' } } as never)
    const paid = await call(AUDIO)
    expect(paid.receipt.replayed).toBe(false)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('a5 switch OFF → no lease is read or written at all', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', false)
    afterThis.push(() => off.restore())
    liveLease(AUDIO)
    leaseUpload.mockClear()
    await call(AUDIO)
    expect(leaseUpload).not.toHaveBeenCalled()
    expect(leaseDownload).not.toHaveBeenCalled()
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it('a5 a caller that pays regardless (replayMemo false — a colleague’s key) never waits on, nor takes, the lease', async () => {
    liveLease(AUDIO)
    leaseUpload.mockClear()
    await runMeteredTranscription(
      { synqed: fakeClient as unknown as Pick<SynqedClient, 'aiRateLimit'>, businessId: 'biz-1', door: 'web', audioKey: AUDIO, replayMemo: false },
      { audio: { url: 'https://x/audio' }, locale: 'ja', diarize: true, reference: null, mode: 'off', businessType: null },
    )
    expect(leaseUpload).not.toHaveBeenCalled()
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  const jobOn = (audio: string) => {
    claim
      .mockResolvedValueOnce({ ...baseJob, payload: { ...baseJob.payload, audio_path: audio } })
      .mockResolvedValueOnce(null)
  }

  it('a5 the WORKER on a live lease WAITS — the answer lands meanwhile → it replays; complete(), never fail() (no requeue)', async () => {
    liveLease(AUDIO)
    jobOn(AUDIO)
    const run = processRecordingJobs(10_000)
    // The other call finishes while the worker waits: its memo lands, its lease is released.
    while (leaseDownload.mock.calls.length < 1) await new Promise(setImmediate)
    memoStore.set(`trc/${AUDIO}.ja.json`, JSON.stringify({ v: 1, result: { ...deepgramResult }, duration_seconds: 5400, written_at: '' }))
    await run
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledTimes(1)
    expect(rows('recording.transcribe')[0].detail).toMatchObject({ door: 'job', replayed: true, cost_cents: 0 })
  }, 15_000)

  // ⚖ S56 — REWRITTEN. This row asserted that the worker, on a lease that
  // never clears, waited 90 s and then PAID. That was the double pay: a live
  // lease at 90 s is a holder still inside its 300 s function, not a dead one.
  // It now asserts the opposite: the wait runs its whole budget, then the job
  // FAILS with the retryable conflict word (core requeues while attempts
  // remain) — no provider call, no reserve, no complete().
  it('a5 → S56 the WORKER on a lease that never clears waits its budget, then THROWS the retryable conflict — fail() (core requeues), never a payment, never complete()', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    afterThis.push(() => jest.useRealTimers())
    liveLease(AUDIO)
    jobOn(AUDIO)
    const run = processRecordingJobs(10_000_000)
    for (let i = 0; i < 80 && fail.mock.calls.length === 0; i++) {
      await jest.advanceTimersByTimeAsync(3_000)
    }
    await run
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledTimes(1)
    expect(fail).toHaveBeenCalledWith('job-1', `transcription_failed: ${TRANSCRIPTION_IN_PROGRESS}`)
    expect(memoStore.has(`trc/${AUDIO}.ja.json`)).toBe(false)
    // Never its own lease: the only lease is the holder's, still live.
    expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBeGreaterThan(Date.now())
  })

  // ── ⚖ S56 — THE WORKER DOOR NEVER PAYS AGAINST A LIVE LEASE ───────────────
  // Fake timers, as the row above: the wait is LEASE_WORKER_WAIT_MS of 3 s
  // polls (LEASE_POLL_MS). `settle` records how a call ended without awaiting
  // it, so a row can say "not yet" at a given clock; `flush` lets the storage
  // fakes' promises (and Blob reads) run without moving the fake clock.
  const doorCall = (door: 'job' | 'from_session' | 'discard' | 'web' | 'app') =>
    runMeteredTranscription(
      { synqed: fakeClient as unknown as Pick<SynqedClient, 'aiRateLimit'>, businessId: 'biz-1', door, audioKey: AUDIO },
      { audio: { url: 'https://x/audio' }, locale: 'ja', diarize: true, reference: null, mode: 'off', businessType: null },
    )
  type Settled = { done: boolean; value?: Awaited<ReturnType<typeof doorCall>>; error?: unknown }
  const settle = (p: ReturnType<typeof doorCall>): Settled => {
    const out: Settled = { done: false }
    p.then(
      (value) => Object.assign(out, { done: true, value }),
      (error: unknown) => Object.assign(out, { done: true, error }),
    )
    return out
  }
  const flush = async () => {
    for (let i = 0; i < 25; i++) await new Promise(setImmediate)
  }
  const tick = async (ms: number) => {
    await jest.advanceTimersByTimeAsync(ms)
    await flush()
  }
  const fakeClock = () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    afterThis.push(() => jest.useRealTimers())
  }
  const untilSettled = async (out: Settled) => {
    for (let i = 0; i < 40 && !out.done; i++) await tick(0)
  }
  const takeovers = () => leaseUpload.mock.calls.filter((c) => (c[2] as { upsert?: boolean } | undefined)?.upsert === true)

  it.each(['job', 'from_session', 'discard'] as const)(
    'w1 (S56) the %s door on a lease live for the WHOLE wait, no answer ever lands → after its budget it THROWS the retryable conflict (seconds left on the lease): no provider call, no reserve, no memo, no lease of its own',
    async (door) => {
      fakeClock()
      liveLease(AUDIO) // 330 s from now: live well past the 135 s budget
      const out = settle(doorCall(door))
      await flush()
      // The budget is asked at the top of each 3 s look: the first look at or past it throws.
      const throwAt = Math.ceil(LEASE_WORKER_WAIT_MS / 3_000) * 3_000
      for (let t = 3_000; t < throwAt; t += 3_000) await tick(3_000)
      await tick(2_999)
      // One millisecond short of that look: still waiting (a bare 90 s would have ended it long ago).
      expect(out.done).toBe(false)
      await tick(1)
      await untilSettled(out)
      expect(out.done).toBe(true)
      expect(out.error).toMatchObject({
        code: 'conflict',
        message: TRANSCRIPTION_IN_PROGRESS,
        // 330 s lease − 135 s waited = 195 s left, and never under 1.
        detail: { reason: 'transcribing', retry_after_seconds: Math.ceil((330_000 - throwAt) / 1000) },
      })
      expect((out.error as { detail: { retry_after_seconds: number } }).detail.retry_after_seconds).toBeGreaterThanOrEqual(1)
      expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
      expect(consume).not.toHaveBeenCalled()
      expect(recordUsage).not.toHaveBeenCalled()
      expect(storageUpload).not.toHaveBeenCalled() // no memo written
      expect(takeovers()).toEqual([]) // never took the lease over
      // Every lease write was a refused create-only attempt; the holder's lease stands, untouched.
      expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBeGreaterThan(Date.now())
    },
  )

  it('w1b (S56) the lease clears only in the LAST poll gap, after the last look inside the budget → no takeover past the budget: one free memo read, then the throw (retry_after ≥ 1)', async () => {
    fakeClock()
    // The last in-budget look is at budget − 3 s (still live); the lease ends 0.5 s before the budget does.
    liveLease(AUDIO, LEASE_WORKER_WAIT_MS - 500)
    const out = settle(doorCall('job'))
    await flush()
    for (let t = 3_000; t <= LEASE_WORKER_WAIT_MS; t += 3_000) await tick(3_000)
    await untilSettled(out)
    expect(out.done).toBe(true)
    expect(out.error).toMatchObject({ code: 'conflict', detail: { reason: 'transcribing', retry_after_seconds: 1 } })
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
    expect(takeovers()).toEqual([])
  })

  it('w2 (S56) the answer lands MID-WAIT → the next look replays it: no provider call, no reserve, no ceiling', async () => {
    fakeClock()
    liveLease(AUDIO)
    const out = settle(doorCall('job'))
    await flush()
    await tick(3_000)
    await tick(3_000)
    expect(out.done).toBe(false)
    memoStore.set(`trc/${AUDIO}.ja.json`, JSON.stringify({ v: 1, result: { ...deepgramResult }, duration_seconds: 5400, written_at: '' }))
    await tick(3_000) // the very next look (9 s) re-reads the memo — long before the budget ends
    expect(out.done).toBe(true)
    expect(out.error).toBeUndefined()
    expect(out.value?.receipt).toMatchObject({ replayed: true, cost_cents: 0, cents_reserved: 0 })
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
    expect(takeovers()).toEqual([])
  })

  it('w3 (S56) the lease EXPIRES mid-wait with budget left → the worker takes it over, pays exactly once, writes the memo, releases the lease on the way out', async () => {
    fakeClock()
    liveLease(AUDIO, 7_000) // the holder died: its lease ends 7 s in, the budget is 135 s
    const out = settle(doorCall('job'))
    await flush()
    await tick(3_000)
    await tick(3_000)
    expect(out.done).toBe(false)
    await tick(3_000) // 9 s: expired → taken over (upsert) → pays
    await untilSettled(out)
    expect(out.done).toBe(true)
    expect(out.error).toBeUndefined()
    expect(out.value?.receipt.replayed).toBe(false)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(takeovers()).toHaveLength(2) // the takeover, then the release (both upserts)
    expect(JSON.parse(takeovers()[0][1] as string).expires_at).toBeGreaterThan(Date.now())
    expect(memoStore.has(`trc/${AUDIO}.ja.json`)).toBe(true)
    // Released in the finally — overwritten as expired, never deleted.
    expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBe(0)
  })

  it('w4 (S56) the wait budget is DERIVED from the worker function limit, never a bare number: budget = limit − reserve, over the old 90 s, under the limit, and the limit is the job route’s own maxDuration', () => {
    expect(LEASE_WORKER_FUNCTION_LIMIT_MS).toBe(JOB_ROUTE_MAX_DURATION_S * 1000)
    expect(LEASE_TAKEOVER_RESERVE_MS).toBeGreaterThan(0)
    expect(LEASE_WORKER_WAIT_MS).toBe(LEASE_WORKER_FUNCTION_LIMIT_MS - LEASE_TAKEOVER_RESERVE_MS)
    expect(LEASE_WORKER_WAIT_MS).toBeGreaterThan(90_000)
    expect(LEASE_WORKER_WAIT_MS).toBeLessThan(LEASE_WORKER_FUNCTION_LIMIT_MS)
    // and the lease outlives any holder the worker waits on
    expect(TRANSCRIPT_LEASE_TTL_MS).toBeGreaterThan(LEASE_WORKER_FUNCTION_LIMIT_MS)
  })

  // X5 (S56 stress): w4 alone passes a budget typed as a bare 135_000, because that number
  // happens to equal the derivation at 300 s. Fed another limit, the constants must follow it.
  it('w4b (S57, X5) the budget FOLLOWS the limit it is derived from: fed a 200 s limit, the takeover reserve is 115 s and the wait 85 s — a budget typed as a bare number fails here', async () => {
    let m!: typeof import('@/lib/ai/transcribe')
    await jest.isolateModulesAsync(async () => {
      jest.doMock('@/lib/jobs/job-route-limit', () => ({ JOB_ROUTE_FUNCTION_LIMIT_MS: 200_000 }))
      m = await import('@/lib/ai/transcribe')
    })
    expect(m.LEASE_WORKER_FUNCTION_LIMIT_MS).toBe(200_000)
    expect(m.LEASE_TAKEOVER_RESERVE_MS).toBe(30_000 + (200_000 - 30_000) / 2)
    expect(m.LEASE_WORKER_WAIT_MS).toBe(200_000 - (30_000 + (200_000 - 30_000) / 2))
    // …and the real module, untouched by the reload, still reads the job route's own 300 s.
    expect(LEASE_WORKER_WAIT_MS).toBe(135_000)
  })

  it.each(['web', 'app'] as const)(
    'w5 (S56) the %s door still answers a live lease AT ONCE (unchanged): no wait, the lease’s own seconds left, nothing spent',
    async (door) => {
      fakeClock()
      liveLease(AUDIO, 60_000)
      const out = settle(doorCall(door))
      await flush() // no timer is advanced: an answer here is an answer with no wait
      expect(out.done).toBe(true)
      expect(out.error).toMatchObject({
        code: 'conflict',
        message: TRANSCRIPTION_IN_PROGRESS,
        detail: { reason: 'transcribing', retry_after_seconds: 60 },
      })
      expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
      expect(consume).not.toHaveBeenCalled()
      expect(recordUsage).not.toHaveBeenCalled()
      expect(takeovers()).toEqual([])
    },
  )

  it('w6 (S56) storage will not answer about the lease → the worker still pays at once (the documented fail-open, unchanged)', async () => {
    fakeClock()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    afterThis.push(() => warn.mockRestore())
    liveLease(AUDIO)
    leaseUpload.mockResolvedValueOnce({ data: null, error: { statusCode: '500', message: 'storage down' } } as never)
    const out = settle(doorCall('job'))
    await flush()
    await untilSettled(out)
    expect(out.done).toBe(true)
    expect(out.error).toBeUndefined()
    expect(out.value?.receipt.replayed).toBe(false)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  // ⚖ S57 — A DOOR THAT TAKES THE LEASE RE-READS THE MEMO BEFORE IT PAYS. The rows above land the
  // answer while the holder's lease stays LIVE. A holder that finishes NORMALLY does two things:
  // it writes its memo, and (in its `finally`) it RELEASES its lease. A waiting door's next look
  // then finds the lease released, takes it over (`held`) — and, before S57, went straight to
  // paying: a second provider call for an answer that was already saved.
  const holderFinishes = (audio: string) => {
    memoStore.set(`trc/${audio}.ja.json`, JSON.stringify({ v: 1, result: { ...deepgramResult }, duration_seconds: 5400, written_at: '' }))
    leaseStore.set(leaseKey(audio), JSON.stringify({ v: 1, expires_at: 0 })) // released: overwritten as expired
  }

  it('w7 (S57) the holder FINISHES NORMALLY mid-wait (memo written AND lease released) → the worker takes the released lease and REPLAYS: no second provider call, no reserve, no ceiling', async () => {
    fakeClock()
    liveLease(AUDIO)
    const out = settle(doorCall('job'))
    await flush()
    await tick(3_000)
    expect(out.done).toBe(false)
    holderFinishes(AUDIO) // inside the worker's 3 s sleep
    await tick(3_000)
    await untilSettled(out)
    expect(out.done).toBe(true)
    expect(out.error).toBeUndefined()
    expect(out.value?.receipt).toMatchObject({ replayed: true, cost_cents: 0, cents_reserved: 0 })
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
    // It did take the released lease over (the upsert), and gave it back on the way out.
    expect(takeovers().length).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBe(0)
  })

  it.each(['web', 'app'] as const)(
    'w7b (S57) the %s door: the first read misses, and the holder finishes between that read and the take (memo written, lease released) → the take is `held`, the re-read under it REPLAYS — never a second payment',
    async (door) => {
      // The first memo read misses; the take then finds a released lease (the holder just finished).
      const realUpload = leaseUpload.getMockImplementation()!
      leaseUpload.mockImplementationOnce(async (key: string, body: string, opts?: { upsert?: boolean }) => {
        holderFinishes(AUDIO)
        return realUpload(key, body, opts)
      })
      const res = await doorCall(door)
      expect(res.receipt).toMatchObject({ replayed: true, cost_cents: 0 })
      expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
      expect(consume).not.toHaveBeenCalled()
      expect(recordUsage).not.toHaveBeenCalled()
      expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBe(0)
    },
  )

  // ── ⚖ S57 F1 — A REPLAY RECORDS AN OWED TRUE-UP ONLY UNDER THE LEASE ──────────────────────────────
  // Greptile round 2 on #1086, finding 1 (thread PRRT_kwDOSCB5RM6mzfjr, "Concurrent retries
  // double-charge true-ups"): the usage writer has no dedupe key, so a replay that recorded the
  // delta while the paying call was still recording it charged it twice. 600,000 B → a 1 ¢ reserve;
  // the 5,400 s answer costs 45 ¢ → 44 ¢ owed.
  const F1_DELTA = 44
  const f1DeltaCalls = () => recordUsage.mock.calls.filter((c) => (c as unknown[])[3] === F1_DELTA)
  const f1TrueUpKey = () => `trc/${AUDIO}.ja.trueup.json`
  /** A memo as another call left it: no debt (`none`), a debt still owed (`owed`), or a debt already recorded (`recorded` — its true-up object stands). */
  const seedMemo = (debt: 'none' | 'owed' | 'recorded') => {
    const memo: Record<string, unknown> = { v: 1, result: { transcript: 'the held answer' }, duration_seconds: 5400, written_at: '' }
    if (debt !== 'none') memo.trueUp = { reserveCents: 1, costCents: 45, deltaCents: F1_DELTA }
    memoStore.set(memoKey(AUDIO), JSON.stringify(memo))
    if (debt === 'recorded') trueUpStore.set(f1TrueUpKey(), JSON.stringify({ v: 1, deltaCents: F1_DELTA, recorded_at: '' }))
  }
  /** Is the audio's owed true-up recorded — by its ONE home, the true-up object? */
  const debtRecorded = () => trueUpStore.has(f1TrueUpKey())
  const holderLeaseLive = () => JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at > Date.now()

  describe('s57 F1 a replay records an owed true-up only while it HOLDS the lease', () => {
    beforeEach(() => {
      headBytes.current = 600_000
    })

    it('f1a the FIRST read finds an owed debt while another call holds the lease → never records; debit_recorded false with the reason lease_busy; the memo and the holder’s lease untouched', async () => {
      seedMemo('owed')
      const before = memoStore.get(memoKey(AUDIO))
      liveLease(AUDIO)
      const res = await call(AUDIO)
      expect(res.result).toEqual({ transcript: 'the held answer' })
      expect(res.receipt).toEqual({
        duration_seconds: 5400,
        cost_cents: 0,
        cents_reserved: 0,
        debit_recorded: false,
        replayed: true,
        debit_deferred_reason: 'lease_busy',
      })
      expect(recordUsage).not.toHaveBeenCalled()
      expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
      expect(memoStore.get(memoKey(AUDIO))).toBe(before)
      expect(holderLeaseLive()).toBe(true)
      expect(takeovers()).toEqual([])
    })

    it('f1b the FIRST read finds an owed debt and the lease is free → takes it, records the delta ONCE under it, true; the lease is given back', async () => {
      seedMemo('owed')
      const res = await call(AUDIO)
      expect(res.receipt).toEqual({ duration_seconds: 5400, cost_cents: 0, cents_reserved: 0, debit_recorded: true, replayed: true })
      expect(f1DeltaCalls()).toHaveLength(1)
      expect(debtRecorded()).toBe(true)
      expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBe(0)
      expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    })

    it('f1c the FIRST read finds an owed debt and storage will not answer about the lease → never records; debit_recorded false with the reason storage_unknown', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      afterThis.push(() => warn.mockRestore())
      seedMemo('owed')
      leaseUpload.mockResolvedValueOnce({ data: null, error: { statusCode: '500', message: 'storage down' } } as never)
      const res = await call(AUDIO)
      expect(res.receipt).toMatchObject({ debit_recorded: false, replayed: true, debit_deferred_reason: 'storage_unknown' })
      expect(recordUsage).not.toHaveBeenCalled()
      expect(debtRecorded()).toBe(false)
    })

    it('f1d THE RACE (Greptile’s case): the paying call is INSIDE its true-up, holding the lease, when a retry replays its owed memo → the retry never records; ONE delta in total, recorded by the payer', async () => {
      let finishTrueUp!: () => void
      let trueUpStarted = false
      recordUsage.mockResolvedValueOnce(undefined).mockImplementationOnce(() => {
        trueUpStarted = true
        return new Promise<void>((resolve) => (finishTrueUp = resolve))
      })
      const payer = call(AUDIO)
      while (!trueUpStarted) await new Promise(setImmediate)
      // The payer's memo stands `pending`; the payer holds the lease.
      expect(debtRecorded()).toBe(false)
      expect(holderLeaseLive()).toBe(true)

      const retry = await call(AUDIO)
      expect(retry.receipt).toMatchObject({ debit_recorded: false, replayed: true, debit_deferred_reason: 'lease_busy' })
      expect(f1DeltaCalls()).toHaveLength(1) // the payer's own, still in flight — never the retry's

      finishTrueUp()
      const paid = await payer
      expect(paid.receipt).toMatchObject({ debit_recorded: true, replayed: false })
      expect(f1DeltaCalls()).toHaveLength(1)
      expect(debtRecorded()).toBe(true)
      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    })

    // The three replay sites INSIDE the lease loop answer through the same rule — each asserts the
    // real answer from the true-up's own state, never a hardcoded one.
    it.each([
      ['none', true, undefined],
      ['recorded', true, undefined],
      ['owed', false, 'lease_busy'],
    ] as const)('f1e the loop’s MID-WAIT look finds the answer (debt: %s) while the holder’s lease is still live → debit_recorded %s, reason %s; the holder records, never this door', async (debt, recorded, reason) => {
      fakeClock()
      liveLease(AUDIO)
      const out = settle(doorCall('job'))
      await flush()
      await tick(3_000)
      expect(out.done).toBe(false)
      seedMemo(debt)
      await tick(3_000)
      await untilSettled(out)
      expect(out.error).toBeUndefined()
      expect(out.value?.receipt.replayed).toBe(true)
      expect(out.value?.receipt.debit_recorded).toBe(recorded)
      expect(out.value?.receipt.debit_deferred_reason).toBe(reason)
      expect(recordUsage).not.toHaveBeenCalled()
      expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
      expect(holderLeaseLive()).toBe(true)
    })

    it.each([
      ['none', true, 0],
      ['recorded', true, 0],
      ['owed', true, 1],
    ] as const)('f1f the holder FINISHES (memo written, lease released) with the debt %s → the worker holds the released lease, re-reads, and settles it under the lease: debit_recorded %s, %s delta call(s)', async (debt, recorded, deltas) => {
      fakeClock()
      liveLease(AUDIO)
      const out = settle(doorCall('job'))
      await flush()
      await tick(3_000)
      seedMemo(debt)
      leaseStore.set(leaseKey(AUDIO), JSON.stringify({ v: 1, expires_at: 0 }))
      await tick(3_000)
      await untilSettled(out)
      expect(out.error).toBeUndefined()
      expect(out.value?.receipt).toMatchObject({ replayed: true, debit_recorded: recorded })
      expect(out.value?.receipt).not.toHaveProperty('debit_deferred_reason')
      expect(f1DeltaCalls()).toHaveLength(deltas)
      if (debt !== 'none') expect(debtRecorded()).toBe(true)
      expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
      expect(JSON.parse(leaseStore.get(leaseKey(AUDIO))!).expires_at).toBe(0)
    })

    it('f1f′ under the held lease the ledger gives up → debit_recorded false with NO deferral reason (a lost debit, the warning row), the debt still owed', async () => {
      const err = jest.spyOn(console, 'error').mockImplementation(() => {})
      afterThis.push(() => err.mockRestore())
      recordUsage.mockRejectedValue(new Error('core down'))
      seedMemo('owed')
      const res = await doorCall('job')
      expect(res.receipt).toEqual({ duration_seconds: 5400, cost_cents: 0, cents_reserved: 0, debit_recorded: false, replayed: true })
      expect(f1DeltaCalls()).toHaveLength(3)
      expect(debtRecorded()).toBe(false)
      const row = rows('recording.transcribe')[0]
      expect(row.severity).toBe('warning')
      expect(row.detail).not.toHaveProperty('debit_deferred_reason')
    })

    // X2 (S56 stress): the answer lands in the LAST poll gap — after the last look inside the budget
    // — so only the free read AT the budget can find it.
    it.each([
      ['none', true, undefined],
      ['owed', false, 'lease_busy'],
    ] as const)('f1g (X2) the answer (debt: %s) lands in the LAST poll gap, the holder’s lease still live → the free read at the budget REPLAYS it: no throw, debit_recorded %s, reason %s', async (debt, recorded, reason) => {
      fakeClock()
      liveLease(AUDIO)
      const out = settle(doorCall('job'))
      await flush()
      const lastLook = Math.ceil(LEASE_WORKER_WAIT_MS / 3_000) * 3_000 - 3_000
      for (let t = 3_000; t <= lastLook; t += 3_000) await tick(3_000)
      expect(out.done).toBe(false)
      seedMemo(debt) // after the last in-budget look, before the budget's own read
      await tick(3_000)
      await untilSettled(out)
      expect(out.done).toBe(true)
      expect(out.error).toBeUndefined()
      expect(out.value?.receipt).toMatchObject({ replayed: true, debit_recorded: recorded })
      expect(out.value?.receipt.debit_deferred_reason).toBe(reason)
      expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
      expect(recordUsage).not.toHaveBeenCalled()
      expect(holderLeaseLive()).toBe(true)
    })

    it('f1h the audit row of a lease-busy replay is FILED, soft and distinguishable: debit_recorded false + debit_deferred_reason lease_busy, and no warning severity (never counted as a lost debit)', async () => {
      seedMemo('owed')
      liveLease(AUDIO)
      await doorCall('job')
      const receipts = rows('recording.transcribe')
      expect(receipts).toHaveLength(1)
      expect(receipts[0].severity).toBeUndefined()
      expect(receipts[0].detail).toMatchObject({ door: 'job', replayed: true, debit_recorded: false, debit_deferred_reason: 'lease_busy' })
    })

    it('f1i the severity rule, ONE home: recorded → none; lost → warning; storage_unknown → warning; lease_busy → none', () => {
      const base = { duration_seconds: 1, cost_cents: 0, cents_reserved: 0, replayed: true }
      expect(transcriptionReceiptSeverity({ ...base, debit_recorded: true })).toBeUndefined()
      expect(transcriptionReceiptSeverity({ ...base, debit_recorded: false })).toBe('warning')
      expect(transcriptionReceiptSeverity({ ...base, debit_recorded: false, debit_deferred_reason: 'storage_unknown' })).toBe('warning')
      expect(transcriptionReceiptSeverity({ ...base, debit_recorded: false, debit_deferred_reason: 'lease_busy' })).toBeUndefined()
    })

    it('f1j switch OFF: a debt an ON deploy left is still recorded only under the lease — busy → deferred; free → taken, recorded once, given back', async () => {
      const off = jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', false)
      afterThis.push(() => off.restore())
      seedMemo('owed')
      liveLease(AUDIO)
      const busy = await call(AUDIO)
      expect(busy.receipt).toMatchObject({ debit_recorded: false, debit_deferred_reason: 'lease_busy' })
      expect(recordUsage).not.toHaveBeenCalled()
      leaseStore.set(leaseKey(AUDIO), JSON.stringify({ v: 1, expires_at: 0 }))
      const free = await call(AUDIO)
      expect(free.receipt).toMatchObject({ debit_recorded: true, replayed: true })
      expect(f1DeltaCalls()).toHaveLength(1)
      expect(debtRecorded()).toBe(true)
    })
  })

  // ── ⚖ S57 F2 — "RECORDED" HAS ONE HOME, CREATE-ONLY; THE MEMO IS NEVER REWRITTEN FOR IT ────────
  // Greptile round 2 on #1086, finding 2 (thread PRRT_kwDOSCB5RM6mzfjy, "Mark updates overwrite
  // concurrent repairs"): two paid calls that both read the same corrupt memo both repair it; the
  // S56 mark rewrite then replaced the whole memo from an earlier copy and could flip `recorded`
  // back to `pending`. Here the lease falls open (storage will not answer about it) so both calls
  // pay at once — the exact path the lease cannot make exclusive.
  describe('s57 F2 the recorded fact lives in its own create-only object; concurrent repairs never revert it', () => {
    beforeEach(() => {
      headBytes.current = 600_000
    })
    /** Two calls on the same CORRUPT memo, both inside the provider together (the lease fell open
     *  for both), X answered first, then Y. `ledgerForY` = whether Y's true-up lands. */
    const twoRepairs = async (ledgerForY: boolean) => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const err = jest.spyOn(console, 'error').mockImplementation(() => {})
      afterThis.push(() => {
        warn.mockRestore()
        err.mockRestore()
      })
      memoStore.set(memoKey(AUDIO), CORRUPT)
      const down = { data: null, error: { statusCode: '500', message: 'storage down' } }
      leaseUpload.mockResolvedValueOnce(down as never).mockResolvedValueOnce(down as never)
      let deltas = 0
      recordUsage.mockImplementation(async (...a: unknown[]) => {
        if (a[3] === 44 && ++deltas > 1 && !ledgerForY) throw new Error('core down')
      })
      const answer = (transcript: string) => ({ ...deepgramResult, transcript })
      let releaseX!: (r: DeepgramTranscribeResult) => void
      let releaseY!: (r: DeepgramTranscribeResult) => void
      transcribeUrlWithDeepgram
        .mockImplementationOnce(() => new Promise<DeepgramTranscribeResult>((resolve) => (releaseX = resolve)))
        .mockImplementationOnce(() => new Promise<DeepgramTranscribeResult>((resolve) => (releaseY = resolve)))
      const x = call(AUDIO)
      const y = call(AUDIO)
      while (transcribeUrlWithDeepgram.mock.calls.length < 2) await new Promise(setImmediate)
      releaseX(answer('X'))
      const xRes = await x
      // Y's re-check right before ITS repair ran before X's repair landed: it still saw the garbage,
      // so both repair writes succeed (Greptile's case exactly).
      storageDownload.mockResolvedValueOnce({ data: new Blob([CORRUPT]), error: null } as never)
      releaseY(answer('Y'))
      const yRes = await y
      return { xRes, yRes, warn }
    }
    const trueUpKey = () => `trc/${AUDIO}.ja.trueup.json`

    it('f2a X records its delta, Y’s true-up is lost → the recorded fact STANDS (never reverted); the memo is written exactly twice (the two repairs) and never rewritten; a later replay records nothing more', async () => {
      const { xRes, yRes } = await twoRepairs(false)
      expect(xRes.receipt).toMatchObject({ replayed: false, debit_recorded: true })
      expect(yRes.receipt).toMatchObject({ replayed: false, debit_recorded: false })
      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(2) // the lease fell open: both paid
      // Only the two repairs ever touched the memo — upserts over the proven garbage — and nothing after them.
      expect(storageUpload).toHaveBeenCalledTimes(2)
      for (const c of storageUpload.mock.calls) expect(c[2]).toEqual({ contentType: 'application/json', upsert: true })
      expect(JSON.parse(memoStore.get(memoKey(AUDIO))!).result.transcript).toBe('Y')
      // The recorded fact, created once by X after its ledger took the delta, stands.
      expect(trueUpStore.has(trueUpKey())).toBe(true)
      expect(trueUpUpload).toHaveBeenCalledTimes(1)

      // One home per AUDIO, not per paid answer: Y's own lost delta is not retried by a replay once
      // X's record stands — Y's own receipt said false (the countable warning row). A residual of
      // the lease falling open, named in the PR body; the two provider payments themselves are
      // A5's stated fall-open.
      recordUsage.mockClear()
      const later = await call(AUDIO)
      expect(later.receipt).toMatchObject({ replayed: true, debit_recorded: true })
      expect(recordUsage).not.toHaveBeenCalled()
      expect(trueUpStore.has(trueUpKey())).toBe(true)
    })

    it('f2b both deltas land (two recorders, where the lease fell open) → the second create meets the duplicate refusal: ONE line says so, the FIRST record stands byte-for-byte, and no write was ever an upsert', async () => {
      const { xRes, yRes, warn } = await twoRepairs(true)
      expect(xRes.receipt.debit_recorded).toBe(true)
      expect(yRes.receipt.debit_recorded).toBe(true)
      expect(trueUpUpload).toHaveBeenCalledTimes(2)
      for (const c of trueUpUpload.mock.calls) expect(c[2]).toEqual({ contentType: 'application/json', upsert: false })
      expect(trueUpStore.get(trueUpKey())).toBe(trueUpUpload.mock.calls[0][1])
      const taken = warn.mock.calls.filter((c) => String(c[0]).includes('already recorded'))
      expect(taken).toHaveLength(1)
    })
  })
})

describe('S53 A5 — the web door answers a live lease with a retryable 409', () => {
  it('409 + Retry-After, nothing spent (the caller’s OWN row — independent of A1)', async () => {
    const key = conformingKey('business-1')
    const row = '5a0e0c1d-2b3c-4d5e-8f60-718293a4b5c6'
    jest.mocked(getCurrentUserStaffId).mockResolvedValue('login-recorder')
    recordingsGet.mockResolvedValue({ id: row, business_id: 'business-1', staff_id: 'login-recorder', store_id: 'store-a', audio_storage_path: key, duration_seconds: 60, customer_id: 'cust-1' } as never)
    leaseStore.set(`trc/${key}.ja.lease.json`, JSON.stringify({ v: 1, expires_at: Date.now() + 60_000 }))
    const res = await webTranscribePOST(
      new Request('https://s/api/ai/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioUrl: `https://test-local.supabase.co/storage/v1/object/sign/recordings/${key}?token=t`, locale: 'ja', recordingSessionId: row }),
      }),
    ).finally(() => jest.mocked(getCurrentUserStaffId).mockResolvedValue(null))
    expect(res.status).toBe(409)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await res.json()).toMatchObject({ reason: 'transcribing' })
    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })
  // ⚖ S57 F1: the web route files its OWN receipt row, through the meter's one severity rule.
  it('s57 f1k a replay whose memo still owes a true-up, under another call’s live lease → 200 with the answer; the route’s row is soft (no warning) and carries debit_deferred_reason lease_busy', async () => {
    const key = conformingKey('business-1')
    const row = '5a0e0c1d-2b3c-4d5e-8f60-718293a4b5c6'
    jest.mocked(getCurrentUserStaffId).mockResolvedValue('login-recorder')
    recordingsGet.mockResolvedValue({ id: row, business_id: 'business-1', staff_id: 'login-recorder', store_id: 'store-a', audio_storage_path: key, duration_seconds: 60, customer_id: 'cust-1' } as never)
    memoStore.set(`trc/${key}.ja.json`, JSON.stringify({ v: 1, result: { transcript: 'the held answer' }, duration_seconds: 5400, written_at: '', trueUp: { reserveCents: 1, costCents: 45, deltaCents: 44 } }))
    leaseStore.set(`trc/${key}.ja.lease.json`, JSON.stringify({ v: 1, expires_at: Date.now() + 60_000 }))
    const res = await webTranscribePOST(
      new Request('https://s/api/ai/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioUrl: `https://test-local.supabase.co/storage/v1/object/sign/recordings/${key}?token=t`, locale: 'ja', recordingSessionId: row }),
      }),
    ).finally(() => jest.mocked(getCurrentUserStaffId).mockResolvedValue(null))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ transcript: 'the held answer' })
    expect(recordUsage).not.toHaveBeenCalled()
    expect(auditWeb).toHaveBeenCalledTimes(1)
    const filed = (auditWeb as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect('severity' in filed).toBe(false)
    expect(filed.detail).toMatchObject({ replayed: true, debit_recorded: false, debit_deferred_reason: 'lease_busy' })
  })
})
