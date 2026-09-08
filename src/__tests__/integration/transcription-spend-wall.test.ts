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
 * The cents are pinned in both directions: the pure estimator, and the two
 * fallbacks a real spend can arrive with (the row's hint, then the named floor
 * — a real spend is never debited as zero).
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
process.env.SPEAKER_ID_MODE = 'off'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-local.supabase.co'

import { createHmac } from 'node:crypto'
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
const deepgramResult = {
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
jest.mock('@/lib/deepgram', () => ({
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
    order.push('recordUsage')
    return (recordUsage as (...x: unknown[]) => Promise<void>)(...a)
  },
}

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
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl,
        download: jest.fn(async () => ({ data: null, error: { message: 'none' } })),
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
import { transcribeAndPersistDiscardWithClient } from '@/actions/recording-discard-transcript'
import type { SynqedClient } from '@synqed-kk/client'
import { estimateTranscriptionCostCents } from '@/lib/ai-rate-limit'
import { AI_SPEND_LIMIT } from '@/lib/recording/job-errors'
import { POST as webTranscribePOST } from '@/app/api/ai/transcribe/route'
import { POST as facadeTranscribePOST } from '@/app/api/app/v1/ai/transcribe/route'
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

beforeEach(() => {
  jest.clearAllMocks()
  order.length = 0
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
    [600, 5],
    [3600, 30],
    [1, 1],
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
      },
    })
  })

  it('t2 the debit rides the provider’s answer — an EMPTY_TRANSCRIPT job is still billed, BEFORE it throws', async () => {
    deepgramResult.transcript = '   '
    deepgramResult.durationSec = 5400

    await runOneJob()

    expect(recordUsage).toHaveBeenCalledWith('transcribe', null, null, 45)
    expect(fail).toHaveBeenCalledWith('job-1', 'EMPTY_TRANSCRIPT')
    // The order is the claim: ask → spend → debit, and only then the throw.
    expect(order).toEqual(['consume', 'deepgram', 'recordUsage'])
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
        recording_session_id: 'sess-1',
        attempt: 1,
        rescued: false,
      },
    })
    expect(rows('recording.transcribe_refused')).toHaveLength(0)
  })

  it('t3 no duration from the provider → the row’s own hint is billed (600 s → 5 ¢)', async () => {
    deepgramResult.durationSec = 0

    await runOneJob()

    expect(recordUsage).toHaveBeenCalledWith('transcribe', null, null, 5)
  })

  it('t3 no duration anywhere → the named floor is billed (3600 s → 30 ¢), never zero', async () => {
    deepgramResult.durationSec = 0

    await runOneJob({ ...baseJob, payload: { ...baseJob.payload, duration_seconds: undefined } })

    expect(recordUsage).toHaveBeenCalledWith('transcribe', null, null, 30)
  })

  it('t4 an UNREADABLE ledger refuses: the job fails with that error, nothing is spent or debited', async () => {
    consume.mockRejectedValueOnce(new Error('core unreachable'))

    await runOneJob()

    expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
    expect(recordUsage).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledWith('job-1', 'core unreachable')
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
    expect(rows('recording.transcribe_refused')[0].detail).toMatchObject({ door: 'discard' })
  })

  it('allowed → the words land, the minutes are debited once, and ONE receipt says door discard', async () => {
    const res = await transcribeAndPersistDiscardWithClient(discardCore, actor, input)

    expect(res).toEqual({ ok: true })
    expect(consume).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledWith('transcribe', null, null, 45)
    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(1)
    expect(receipts[0].detail).toMatchObject({
      door: 'discard',
      duration_seconds: 5400,
      cost_cents: 45,
      recording_session_id: 'sess-1',
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

  it('t7 the route files ONE receipt, carrying the two numbers the meter debited', async () => {
    await webTranscribePOST(post({ audioUrl: 'https://test-local.supabase.co/storage/audio.webm', locale: 'ja' }))

    // The wrapper stays silent for this door — the route's own row is the one.
    expect(rows('recording.transcribe')).toHaveLength(0)
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'recording',
        action: 'recording.transcribe',
        detail: { duration_seconds: 5400, cost_cents: 45 },
      }),
    )
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

  it('t7 the hook’s row carries the two numbers, and the wrapper files none of its own', async () => {
    await facadeTranscribePOST(post(), noRoute)

    const receipts = rows('recording.transcribe')
    expect(receipts).toHaveLength(1)
    expect(receipts[0].source).toBe('facade')
    expect(receipts[0].detail).toMatchObject({ duration_seconds: 5400, cost_cents: 45 })
  })
})
