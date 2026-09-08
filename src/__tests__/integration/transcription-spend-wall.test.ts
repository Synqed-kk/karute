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
const originalFetch = global.fetch
const fetchMock = jest.fn(async (url: unknown, init?: { method?: string }) => {
  if (init?.method !== 'HEAD') throw new Error(`unexpected non-HEAD fetch: ${String(url)}`)
  if (headBytes.current == null) throw new Error('storage unreachable')
  return { headers: new Headers({ 'content-length': String(headBytes.current) }) }
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

afterAll(() => {
  global.fetch = originalFetch
})

beforeEach(() => {
  jest.clearAllMocks()
  order.length = 0
  headBytes.current = 32_400_000
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
    expect(rows('recording.transcribe_refused')[0].detail).toMatchObject({ door: 'discard' })
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
        },
      }),
    )
    // ⚖ fix round 3, m13: a lost debit on THIS route's own row is severity
    // 'warning' too — the same one-query answer the wrapper's receipt gives
    // the other three doors.
    expect(auditWeb).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' }))
    errorLog.mockRestore()
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
    // Four keys since fix round 4 — still well inside the hook's cap of 8
    // (handler.ts) — and none of them reaches the client: the body is the
    // provider's own.
    expect(Object.keys(receipts[0].detail as object)).toHaveLength(4)
    expect(Object.keys(await res.json()).sort()).toEqual(['confidence', 'durationSec', 'transcript'])
    // A landed debit is an ordinary row (fix round 3 — same default as every
    // other route the hook serves).
    expect(receipts[0].severity).toBeUndefined()
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
describe('the release — a provider that throws gives the reserve back', () => {
  const runOneJob = async (job: Record<string, unknown> = baseJob) => {
    claim.mockResolvedValueOnce(job).mockResolvedValueOnce(null)
    await processRecordingJobs(10_000)
  }
  /** Deepgram reached, Deepgram threw — the order push stays honest so the
   *  release can be pinned as happening AFTER the money would have moved. */
  const providerThrows = (message = 'deepgram 503') =>
    transcribeUrlWithDeepgram.mockImplementationOnce(async () => {
      order.push('deepgram')
      throw new Error(message)
    })
  /** Every cents figure the ledger was handed, in order. */
  const ledger = () => recordUsage.mock.calls.map((c) => (c as unknown[])[3] as number)
  let errorLog: jest.SpyInstance

  beforeEach(() => {
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorLog.mockRestore()
  })

  it('the provider throws → ONE negative row of exactly the reserve, and the error leaves unchanged', async () => {
    providerThrows()

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
    expect(fail).toHaveBeenCalledWith('job-1', 'deepgram 503')
    expect(fail).not.toHaveBeenCalledWith('job-1', AI_SPEND_LIMIT)
    expect(complete).not.toHaveBeenCalled()
    // NO receipt (nothing was transcribed) and NO true-up (nothing to true up).
    expect(rows('recording.transcribe')).toHaveLength(0)
    expect(errorLog).not.toHaveBeenCalledWith(
      '[ai-usage] reserve RELEASE lost after 3 attempts:',
      expect.anything(),
    )
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
    providerThrows()
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
    expect(fail).toHaveBeenCalledWith('job-1', 'deepgram 503')
    expect(rows('recording.transcribe')).toHaveLength(0)
  })

  it('m23 a retried job reserves again — over two attempts the ledger nets ONE estimate, not two', async () => {
    // Attempt 1: Deepgram throws. +45 then −45.
    providerThrows()
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
