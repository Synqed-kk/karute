/**
 * S60 A3 — THE METER REFUSES AN UNREADABLE AUDIO BEFORE ANYTHING THAT COSTS.
 *
 * One choke point (runMeteredTranscription), between the memo read and the
 * rate-limit consume: an audio whose head opens with no container the
 * recorders make is refused with AudioUnreadableError — ZERO consume, ZERO
 * ledger rows, ZERO provider calls, ZERO marks (M2) — and every door answers
 * it in its own shape: the facade 422 {error:{code}}, the web route 422 flat
 * on both arms, the discard door `failed` on the wire with the reason in one
 * log line (REV 2.3 A2), the job fail(id, 'audio_unreadable').
 *
 * The scaffold (every mock) is the spend-wall suite's own, copied so the
 * same fakes count the same money.
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
import { HEADERLESS_HEAD, WEBM_HEAD } from './helpers/container-head-fetch'

/** What the stored object's head says to the meter's ranged probe. */
const probeHead: { current: Uint8Array } = { current: WEBM_HEAD }
/** The switch, read live through a getter so a test can turn it OFF. */
const switches = { ...jest.requireActual('@/lib/recording/recording-switches').RECORDING_SWITCHES }
jest.mock('@/lib/recording/recording-switches', () => ({
  get RECORDING_SWITCHES() {
    return switches
  },
}))

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
const fetchMock = jest.fn(async (url: unknown, init?: { method?: string; headers?: Record<string, string> }) => {
  // S60 A3: the meter's head probe (Range: bytes=0-63) gets a real webm head, never the queued Deepgram answer.
  if (init?.headers?.Range === 'bytes=0-63') return new Response(probeHead.current.slice(), { status: 206 })
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
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl,
        download: (...a: unknown[]) => storageDownload(...(a as [string])),
        upload: (...a: unknown[]) => storageUpload(...(a as [string, string])),
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
import { AudioUnreadableError, runMeteredTranscription } from '@/lib/ai/transcribe'
import { AppApiError } from '@/lib/app-api/errors'
import { can } from '@/lib/auth/require-permission'
import { conformingKey, rescueKey } from './helpers/recording-key-fixtures'
import { POST as facadeDiscardTranscriptPOST } from '@/app/api/app/v1/recordings/discards/transcript/route'
import { transcribeAndPersistDiscard } from '@/actions/recording-discard-transcript'
import { resolveSelfStaffId as resolveSelfStaffIdMock } from '@/lib/app-api/customer-facade'
import { getCurrentUserStaffId as getCurrentUserStaffIdMock } from '@/lib/staff'

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
  // Reset, for the same reason as consume: the t2c rows whose key fails the
  // grammar never reach `can`, and their queued answer must not leak.
  ;(can as jest.Mock).mockReset()
  ;(can as jest.Mock).mockResolvedValue(true)
})

// ── S60 A3 ──────────────────────────────────────────────────────────────────
const probeFetches = () =>
  fetchMock.mock.calls.filter((c) => (c[1] as { headers?: Record<string, string> } | undefined)?.headers?.Range)
const nothingSpent = () => {
  expect(consume).not.toHaveBeenCalled()
  expect(recordUsage).not.toHaveBeenCalled()
  expect(transcribeUrlWithDeepgram).not.toHaveBeenCalled()
  expect(transcribeWithDeepgram).not.toHaveBeenCalled()
  // M2: the meter writes no mark (nor anything else) to storage.
  expect(storageUpload).not.toHaveBeenCalled()
  // No HEAD for the reserve, no provider fetch: at most the one probe.
  expect(fetchMock.mock.calls.length).toBe(probeFetches().length)
}

beforeEach(() => {
  probeHead.current = WEBM_HEAD
  switches.finalizeProbe = true
})

const meterCall = (
  audio: { url: string } | { buffer: Buffer; mimeType: string },
  audioKey: string | null = null,
) =>
  runMeteredTranscription(
    { synqed: fakeClient as unknown as Pick<SynqedClient, 'aiRateLimit'>, businessId: 'biz-1', door: 'app', audioKey },
    { audio, locale: 'ja', diarize: true, reference: null, mode: 'off', businessType: null },
  )

describe('S60 A3 — the meter choke point', () => {
  it('URL arm, headerless head → AudioUnreadableError before any consume, reserve, provider call or mark', async () => {
    probeHead.current = HEADERLESS_HEAD

    const err = await meterCall({ url: 'https://x/audio' }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AudioUnreadableError)
    expect(err).toBeInstanceOf(AppApiError)
    expect((err as AudioUnreadableError).code).toBe('audio_unreadable')
    expect((err as AudioUnreadableError).status).toBe(422)
    expect((err as AudioUnreadableError).message).toBe('audio_unreadable')
    expect((err as AudioUnreadableError).firstByte).toBe(0)
    expect((err as AudioUnreadableError).bytesRead).toBe(14)
    expect(probeFetches()).toHaveLength(1)
    nothingSpent()
  })

  it('buffer arm, 14 headerless bytes → the same refusal, no fetch at all', async () => {
    const err = await meterCall({ buffer: Buffer.alloc(14), mimeType: 'audio/webm' }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AudioUnreadableError)
    expect(fetchMock).not.toHaveBeenCalled()
    nothingSpent()
  })

  it('buffer arm, 10 bytes → unknown (too short to judge) → today\'s path, consumed once', async () => {
    const out = await meterCall({ buffer: Buffer.alloc(10), mimeType: 'audio/webm' })

    expect(out.receipt.replayed).toBe(false)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(transcribeWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it('URL arm, a real webm head → today\'s path, one probe then the reserve HEAD', async () => {
    await meterCall({ url: 'https://x/audio' })

    expect(probeFetches()).toHaveLength(1)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it('a memo hit is answered before any probe (already paid) — zero probe fetches', async () => {
    const AUDIO = conformingKey('biz-1')
    await meterCall({ url: 'https://x/audio' }, AUDIO)
    fetchMock.mockClear()
    consume.mockClear()
    probeHead.current = HEADERLESS_HEAD

    const replay = await meterCall({ url: 'https://x/audio' }, AUDIO)

    expect(replay.receipt.replayed).toBe(true)
    expect(probeFetches()).toHaveLength(0)
    expect(consume).not.toHaveBeenCalled()
  })

  it('the meter never reads the extension: a .webm key holding MP4 bytes passes', async () => {
    probeHead.current = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0])

    await meterCall({ url: 'https://x/audio.webm' }, conformingKey('biz-1'))

    expect(consume).toHaveBeenCalledTimes(1)
  })
})

describe('S60 A3 — every door answers the refusal in its own shape', () => {
  it('phone facade → 422 {error:{code:"audio_unreadable"}}, never internal/500', async () => {
    probeHead.current = HEADERLESS_HEAD
    const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
    const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const header = b64({ alg: 'HS256', typ: 'JWT' })
    const payload = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
    const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')

    const res = await facadeTranscribePOST(
      new Request('https://s/api/app/v1/ai/transcribe', {
        method: 'POST',
        headers: { authorization: `Bearer ${header}.${payload}.${sig}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: conformingKey('business-1'), locale: 'ja' }),
      }),
      { params: Promise.resolve({}) },
    )

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toEqual({ error: { code: 'audio_unreadable', message: 'audio_unreadable' } })
    nothingSpent()
  })

  it('web route, JSON arm (14 headerless bytes stored) → 422 {error:"audio_unreadable"}', async () => {
    probeHead.current = HEADERLESS_HEAD

    const res = await webTranscribePOST(
      new Request('https://s/api/ai/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioUrl: 'https://test-local.supabase.co/storage/audio.webm', locale: 'ja' }),
      }),
    )

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'audio_unreadable' })
    nothingSpent()
  })

  it('web route, FormData arm (14 headerless bytes) → 422 {error:"audio_unreadable"}', async () => {
    const form = new FormData()
    form.append('audio', new File([new Uint8Array(14)], 'take.webm', { type: 'audio/webm' }))
    form.append('locale', 'ja')

    const res = await webTranscribePOST(new Request('https://s/api/ai/transcribe', { method: 'POST', body: form }))

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'audio_unreadable' })
    expect(fetchMock).not.toHaveBeenCalled()
    nothingSpent()
  })

  it('discard door → `failed` on the wire (REV 2.3 A2), the reason in ONE log line, nothing spent', async () => {
    probeHead.current = HEADERLESS_HEAD
    const OWN_KEY_DISCARD = conformingKey('biz-1')
    listDiscards.mockResolvedValue({
      events: [{ id: 'd-1', recording_session_id: 'sess-1', source: 'STAFF', reason: '事故' }],
    })
    recordingsGet.mockResolvedValue({ duration_seconds: 60, customer_id: 'cust-1', audio_storage_path: OWN_KEY_DISCARD })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const out = await transcribeAndPersistDiscardWithClient(
      fakeClient as unknown as Pick<
        SynqedClient,
        'recordings' | 'recordingDiscards' | 'customers' | 'orgSettings' | 'aiRateLimit'
      >,
      { staffId: 'staff-A', businessId: 'biz-1' },
      { recordingSessionId: 'sess-1', audioPath: OWN_KEY_DISCARD, durationSeconds: 600, locale: 'ja' },
    )

    expect(out).toEqual({ error: 'failed' })
    const refusedLines = warn.mock.calls.filter((c) => c[0] === '[discard-transcript] refused')
    expect(refusedLines).toHaveLength(1)
    expect(JSON.parse(String(refusedLines[0][1]))).toEqual({
      reason: 'audio_unreadable',
      recording_session_id: 'sess-1',
      first_byte: 0,
      bytes_read: 14,
    })
    expect(upsertSegments).not.toHaveBeenCalled()
    nothingSpent()
    warn.mockRestore()
  })

  it('job door → fail(id, "audio_unreadable") via the sentinel, nothing spent', async () => {
    probeHead.current = HEADERLESS_HEAD
    claim.mockResolvedValueOnce(baseJob).mockResolvedValueOnce(null)

    await processRecordingJobs(10_000)

    expect(fail).toHaveBeenCalledWith('job-1', 'audio_unreadable')
    expect(complete).not.toHaveBeenCalled()
    nothingSpent()
  })
  it('job door, the exhausting round → fail(id, "audio_unreadable") AND the transcribe_failed row names the reason, never "other"', async () => {
    probeHead.current = HEADERLESS_HEAD
    const exhausted = { ...baseJob, attempts: 3, max_attempts: 3 }
    claim.mockResolvedValueOnce(exhausted).mockResolvedValueOnce(null)
    fail.mockResolvedValueOnce({ ...exhausted, status: 'FAILED' })

    await processRecordingJobs(10_000)

    expect(fail).toHaveBeenCalledWith('job-1', 'audio_unreadable')
    const failedRows = rows('recording.transcribe_failed')
    expect(failedRows).toHaveLength(1)
    expect((failedRows[0].detail as Record<string, unknown>).reason).toBe('audio_unreadable')
    expect(complete).not.toHaveBeenCalled()
    nothingSpent()
  })
})

// S5 — the discard door's two wrappers, driven end to end with an unreadable
// object: each passes the core's `failed` through unchanged (REV 2.3 A2).
describe('S60 A3 — the discard door\'s two wrappers answer `failed` on the wire', () => {
  const DISCARD_KEY = conformingKey('business-1')
  const arrangeDiscard = () => {
    probeHead.current = HEADERLESS_HEAD
    listDiscards.mockResolvedValue({
      events: [{ id: 'd-1', recording_session_id: 'sess-1', source: 'STAFF', reason: '事故' }],
    })
    recordingsGet.mockResolvedValue({ duration_seconds: 60, customer_id: 'cust-1', audio_storage_path: DISCARD_KEY })
    return jest.spyOn(console, 'warn').mockImplementation(() => {})
  }
  const refusedLine = (warn: jest.SpyInstance) => {
    const lines = warn.mock.calls.filter((c) => c[0] === '[discard-transcript] refused')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(String(lines[0][1]))).toEqual({
      reason: 'audio_unreadable',
      recording_session_id: 'sess-1',
      first_byte: 0,
      bytes_read: 14,
    })
  }
  const input = { recordingSessionId: 'sess-1', audioPath: DISCARD_KEY, durationSeconds: 600, locale: 'ja' }

  it('facade POST → HTTP 200 {error:"failed"}, the refused line, nothing spent', async () => {
    const warn = arrangeDiscard()
    ;(resolveSelfStaffIdMock as jest.Mock).mockResolvedValueOnce('staff-1')
    const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
    const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const header = b64({ alg: 'HS256', typ: 'JWT' })
    const payload = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
    const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')

    const res = await facadeDiscardTranscriptPOST(
      new Request('https://s/api/app/v1/recordings/discards/transcript', {
        method: 'POST',
        headers: { authorization: `Bearer ${header}.${payload}.${sig}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
      { params: Promise.resolve({}) },
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'failed' })
    refusedLine(warn)
    expect(upsertSegments).not.toHaveBeenCalled()
    nothingSpent()
    warn.mockRestore()
  })

  it('cookie action → {error:"failed"}, the refused line, nothing spent', async () => {
    const warn = arrangeDiscard()
    ;(getCurrentUserStaffIdMock as jest.Mock).mockResolvedValueOnce('staff-A').mockResolvedValueOnce('staff-A')

    const out = await transcribeAndPersistDiscard(input)

    expect(out).toEqual({ error: 'failed' })
    refusedLine(warn)
    expect(upsertSegments).not.toHaveBeenCalled()
    nothingSpent()
    warn.mockRestore()
  })
})

describe('S60 A3 — switch OFF: no probe, today\'s answers byte for byte', () => {
  const webPost = () =>
    webTranscribePOST(
      new Request('https://s/api/ai/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioUrl: 'https://test-local.supabase.co/storage/audio.webm', locale: 'ja' }),
      }),
    )

  it('meter, both arms: zero probe fetches, the headerless audio is paid for exactly as before', async () => {
    switches.finalizeProbe = false
    probeHead.current = HEADERLESS_HEAD

    await meterCall({ url: 'https://x/audio' })
    await meterCall({ buffer: Buffer.alloc(14), mimeType: 'audio/webm' })

    expect(probeFetches()).toHaveLength(0)
    expect(consume).toHaveBeenCalledTimes(2)
    expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes(1)
    expect(transcribeWithDeepgram).toHaveBeenCalledTimes(1)
  })

  it('web JSON arm: the OFF answer on a headerless object is byte-identical to today\'s answer', async () => {
    const onReadable = await webPost()
    const onText = await onReadable.text()
    jest.clearAllMocks()
    switches.finalizeProbe = false
    probeHead.current = HEADERLESS_HEAD

    const off = await webPost()

    expect(off.status).toBe(onReadable.status)
    expect(await off.text()).toBe(onText)
    expect(probeFetches()).toHaveLength(0)
  })
})
