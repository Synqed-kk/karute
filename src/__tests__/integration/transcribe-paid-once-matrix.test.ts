/**
 * ⚖ S53 A7 — THE PAID-CALL MATRIX: at most one charge per paid answer that
 * survived, counted end to end.
 *
 * Real runAIPipeline + real globalPipeline on the client; the REAL web door
 * (/api/ai/transcribe) and the REAL phone door (/api/app/v1/ai/transcribe) on
 * the server, with the real meter, the real transcript memo, the real
 * takeKeyHolder and the real key grammar between them. Faked: the take store,
 * the recording port (its unbound mint draws a new key every time and, with
 * bindUnboundUploads ON and 'no_session', creates the row X the real mint
 * creates), the network (a response can be LOST after the server ran, or a
 * request can never leave), storage (one map), core (one fake), and Deepgram —
 * whose call count IS the paid-call count asserted in every cell.
 *
 * The layers: RECORDING_SWITCHES.transcribePaidOnce (the fix, A2–A4) ×
 * RECORDING_SWITCHES.bindUnboundUploads (the flip). OFF × OFF must reproduce
 * today, cell for cell — the structural review's "Both OFF (today)" and
 * "Flip ON, fix absent" columns (REVIEW-S53-LEG2-STRUCTURAL-OPUS.md, LAYER
 * MATRIX, outside the repo).
 *
 * The events: E1 = the automatic inner re-POST after the first POST's
 * response was lost (the server finished); E3 = a manual 再試行 after that
 * loss (the inner re-POST never left); KILL = the app dies mid-POST (the
 * server finished) and the recovery save runs the same take; BLIP = a core
 * read blip on the retry's owner check (web door only — the phone door has
 * refused that state with a 502 since S46).
 *
 * Every id is invented; nothing leaves jest.
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
process.env.SPEAKER_ID_MODE = 'off'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-local.supabase.co'
process.env.DEEPGRAM_API_KEY ??= 'test-deepgram-key'

import { createHmac, randomUUID } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))
jest.mock('@/lib/global-recorder', () => ({ globalRecorder: { awaitTakeSecured: async () => {} } }))

const BIZ = 'business-1'
const RECORDER = 'login-recorder'

// ── THE PROVIDER — its call count is the paid-call count ────────────────────
let answerSeq = 0
/** Holds the next provider call open until released (E2, the race). */
const providerHolds: Array<Promise<void>> = []
const transcribeUrlWithDeepgram = jest.fn(async () => {
  const n = ++answerSeq
  const hold = providerHolds.shift()
  if (hold) await hold
  return { transcript: `answer-${n}`, durationSec: 60, requestId: `dg-${n}`, confidence: 0.9, words: [], paragraphs: [] }
})
jest.mock('@/lib/deepgram', () => ({
  ...jest.requireActual('@/lib/deepgram'),
  transcribeUrlWithDeepgram: (...a: unknown[]) => transcribeUrlWithDeepgram(...(a as [])),
  transcribeWithDeepgram: jest.fn(),
}))

// ── STORAGE: the memo's bucket (one map) + signed read URLs ─────────────────
const bucket = new Map<string, string>()
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (key: string) => ({ data: { signedUrl: `https://test-local.supabase.co/storage/v1/object/sign/recordings/${key}?token=t` }, error: null }),
        download: async (key: string) => {
          const body = bucket.get(key)
          return body === undefined
            ? { data: null, error: { status: 400, statusCode: '404', message: 'Object not found' } }
            : { data: new Blob([body]), error: null }
        },
        upload: async (key: string, body: string, opts?: { upsert?: boolean }) => {
          if (bucket.has(key) && !opts?.upsert)
            return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
          bucket.set(key, body)
          return { data: { path: key }, error: null }
        },
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
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))

// ── CORE: the ledger (always takes the money) + the rows takeKeyHolder reads ─
type Row = { id: string; business_id: string; staff_id: string; store_id: string | null; audio_storage_path: string }
const rows = new Map<string, Row>()
/** recordings.get call numbers (1-based) that answer a 500 — the BLIP. */
const blipOnGet = new Set<number>()
let getCalls = 0
const recordingsGet = jest.fn(async (id: string) => {
  getCalls++
  if (blipOnGet.has(getCalls)) throw Object.assign(new Error('core 500'), { status: 500 })
  const row = rows.get(id)
  if (!row) throw Object.assign(new Error('nf'), { status: 404 })
  return row
})
const fakeClient = {
  aiRateLimit: {
    consume: async () => ({ allowed: true, reason: 'ok', cap: 100, used: 1, remaining: 99, costCap: 3000, costUsed: 1, resetAt: '' }),
    recordUsage: async () => {},
  },
  orgSettings: { get: jest.fn(async () => ({ settings: {} })) },
  recordings: { get: recordingsGet },
  staff: { get: jest.fn(async () => ({ id: 'staff-1', user_id: 'auth-user-1' })) },
}
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(() => fakeClient), SynqedError: class extends Error {} }))
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))
jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: jest.fn(async () => true),
  featureAllowedForBusiness: jest.fn(async () => true),
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ speaker_diarization: true })),
  orgSettingsWithClient: jest.fn(async () => ({ speaker_diarization: true })),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => BIZ),
  businessIdForUser: jest.fn(async () => BIZ),
  getCurrentUserStaffId: jest.fn(async () => RECORDER),
  getCurrentAccessToken: jest.fn(async () => 'web-cookie-token'),
  staffListByBusinessOrThrow: jest.fn(async () => []),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  ...jest.requireActual('@/lib/auth/require-permission'),
  capabilitiesForUser: jest.fn(async () => new Set(['records.write'])),
  getMyCapabilities: jest.fn(async () => new Set(['records.write'])),
  can: jest.fn(async () => true),
}))
jest.mock('@/lib/app-api/customer-facade', () => ({ resolveSelfStaffId: jest.fn(async () => RECORDER) }))
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (id: string) => id),
  resolveSynqedStaffIdForBusiness: jest.fn(async (id: string) => id),
}))
jest.mock('@/lib/audit', () => ({ ...jest.requireActual('@/lib/audit'), audit: jest.fn() }))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => {}) }))

// ── THE TAKE STORE (the device) ─────────────────────────────────────────────
type Audio = { size: number; type: string; durationSeconds?: number }
type Meta = {
  recordingSessionId?: string
  mimeType?: string
  durationMs?: number
  finalizedAt?: number
  finalizedPath?: string
  startedAt: number
  updatedAt: number
  transcript?: { finalizedPath: string; locale: string; response: unknown; at: number; fallback?: true; audio?: Audio }
  fallbackPin?: { finalizedPath: string; recordingSessionId: string | null; locale: string; audio: Audio; at: number }
}
const store = { meta: null as Meta | null }
jest.mock('@/lib/karute/take-store', () => ({
  readTakeSecureMeta: async () => (store.meta ? { ...store.meta } : null),
  ensureFinalizedPath: async (_id: string, meta: Meta) => meta.finalizedPath ?? null,
  readTakeTranscript: async () => store.meta?.transcript ?? null,
  stampTakeTranscript: async (_id: string, path: string, locale: string, response: unknown, fallback?: boolean, audio?: Audio) => {
    if (!store.meta) return
    if (fallback && store.meta.finalizedPath && store.meta.finalizedPath !== path) return
    store.meta = { ...store.meta, transcript: { finalizedPath: path, locale, response, at: 1, ...(fallback ? { fallback: true as const } : {}), ...(audio ? { audio } : {}) } }
  },
  pinTakeFallback: async (_id: string, pin: Omit<NonNullable<Meta['fallbackPin']>, 'at'>) => {
    if (!store.meta) return
    if (store.meta.finalizedPath && store.meta.finalizedPath !== pin.finalizedPath) return
    store.meta = { ...store.meta, fallbackPin: { ...pin, at: 1 } }
  },
  adoptTakeSession: async (_id: string, session: string, path: string) => {
    if (!store.meta || store.meta.recordingSessionId || store.meta.finalizedAt) return false
    store.meta = { ...store.meta, recordingSessionId: session, finalizedAt: 1, finalizedPath: path }
    return true
  },
}))
// The attach (ensureAudioOnServer) cannot land in any cell here: the fallback
// is what is under test. It answers null, as a refused take-key mint does.
jest.mock('@/lib/recording/secure-take', () => ({ ensureAudioOnServer: async () => null }))

// ── THE PORT (web or phone) ─────────────────────────────────────────────────
let platform: 'web' | 'phone' = 'web'
const mints: string[] = []
const keyFor = () => `app_${BIZ}_${randomUUID()}.webm`
const signed = (key: string) => `https://test-local.supabase.co/storage/v1/object/sign/recordings/${key}?token=t`
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    get aiBase() {
      return platform === 'web' ? '/api/ai' : '/api/app/v1/ai'
    },
    prepareTranscription: async (_b: Blob, finalizedPath: string | null, opts?: { attachOutcome?: string; takeRow?: string }) => {
      let path = finalizedPath
      let minted: string | null = null
      if (!path) {
        path = keyFor()
        mints.push(path)
        // The real mint: a row born on this key only with the flip ON and 'no_session'.
        if (RECORDING_SWITCHES.bindUnboundUploads && opts?.attachOutcome === 'no_session') {
          minted = randomUUID()
          rows.set(minted, { id: minted, business_id: BIZ, staff_id: RECORDER, store_id: null, audio_storage_path: path })
        }
      }
      const row = (finalizedPath ? opts?.takeRow : minted) ?? null
      const at = platform === 'web' ? { audioUrl: signed(path) } : { path }
      return { body: row ? { ...at, recordingSessionId: row } : at, path, recordingSessionId: minted }
    },
  }),
}))

// ── THE NETWORK ─────────────────────────────────────────────────────────────
/** Per /transcribe POST, in order: undefined = delivered · 'lose' = the server
 *  ran to the end, the response never came back · 'unreached' = never left ·
 *  'drop' = the connection drops while the server is still running (E2). */
const net: Array<'lose' | 'unreached' | 'drop' | undefined> = []
/** Holds a delivered-or-lost response after the server finished (the kill). */
const responseHolds: Array<Promise<void> | undefined> = []
const inFlight: Array<Promise<unknown>> = []
/** S54 B: every wait a served 409 asked for (web: `Retry-After`; phone: the
 *  body's `error.retry_after_seconds`) — the run's still-working pause, made
 *  immediate below like the 1.5 s one — and a hook told of each 409 served. */
const stillWorkingWaits = new Set<number>()
let onStillWorking: (() => void) | null = null
let stillWorkingServed = 0
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const bearer = () => {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'auth-user-1', iss: `${process.env.AUTH_SUPABASE_URL}/auth/v1`, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', process.env.AUTH_SUPABASE_JWT_SECRET!).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const serve = (url: string, body: string): Promise<Response> =>
  url.startsWith('/api/app/v1/')
    ? facadeTranscribePOST(
        new Request(`https://s${url}`, { method: 'POST', headers: { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' }, body }),
        { params: Promise.resolve({}) },
      )
    : webTranscribePOST(new Request(`https://s${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }))
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({
    apiFetch: async (url: string, init: { body: string }) => {
      if (url.endsWith('/transcribe')) {
        const how = net.shift()
        if (how === 'unreached') throw new TypeError('Failed to fetch')
        const served = serve(url, init.body)
        if (how === 'drop') {
          inFlight.push(served)
          throw new TypeError('Failed to fetch')
        }
        const res = await served
        if (res.status === 409) {
          const asked = res.headers.get('Retry-After') ?? (await res.clone().json()).error?.retry_after_seconds
          // …and (S55) the same wait as the client caps it — both made immediate below.
          stillWorkingWaits.add(Number(asked) * 1000).add(Math.min(Number(asked) * 1000, STILL_WORKING_WAIT_CAP_MS))
          stillWorkingServed++
          onStillWorking?.()
        }
        const hold = responseHolds.shift()
        if (hold) await hold
        if (how === 'lose') throw new TypeError('Failed to fetch')
        return res
      }
      const answer = url.endsWith('/extract') ? { entries: [] } : { summary: 'まとめ' }
      return { ok: true, json: async () => answer } as unknown as Response
    },
  }),
}))

// fetchWithRetry's 1.5 s pause before its one re-POST, and (S54 B) the wait a
// served 409 asked for (the lease's seconds left) — immediate here.
const realSetTimeout = global.setTimeout
jest
  .spyOn(global, 'setTimeout')
  .mockImplementation(((fn: () => void, ms?: number) =>
    realSetTimeout(fn, ms === 1500 || (ms !== undefined && stillWorkingWaits.has(ms)) ? 0 : ms)) as typeof setTimeout)
// The meter's HEAD for the reserve's size.
global.fetch = (async () => ({ headers: new Headers({ 'content-length': '360000' }) })) as unknown as typeof fetch

import { globalPipeline } from '@/lib/global-pipeline'
import { STILL_WORKING_WAIT_CAP_MS } from '@/lib/ai-pipeline'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { POST as webTranscribePOST } from '@/app/api/ai/transcribe/route'
import { POST as facadeTranscribePOST } from '@/app/api/app/v1/ai/transcribe/route'

const TAKE = '3f9a1c2e-5b4d-4e6f-8a7b-1c2d3e4f5a6b'
const TAKE_KEY = `app_${BIZ}_${TAKE}.webm`
const SESSION = '6d2e1f0a-3b4c-4d5e-9f8a-7b6c5d4e3f2a'
const memory = new Blob(['in-memory: every chunk the recorder captured'], { type: 'audio/webm' })
const tick = () => new Promise((r) => realSetTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 600 && globalPipeline.state === 'processing'; i++) await tick()
}
type RunContext = Parameters<typeof globalPipeline.start>[1]

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  transcribeUrlWithDeepgram.mockClear()
  answerSeq = 0
  providerHolds.length = 0
  bucket.clear()
  rows.clear()
  blipOnGet.clear()
  getCalls = 0
  net.length = 0
  responseHolds.length = 0
  inFlight.length = 0
  mints.length = 0
  stillWorkingWaits.clear()
  onStillWorking = null
  stillWorkingServed = 0
  store.meta = null
})
afterEach(async () => {
  globalPipeline.reset()
  await Promise.allSettled(inFlight)
})

// ── THE SCENARIOS (each returns nothing; the cell counts provider calls) ────
/** The run's own context for a take (or none). */
const ctxFor = (takeId: string | null, recordingSessionId: string | null = null): RunContext => ({
  locale: 'ja',
  customers: [],
  takeId,
  duration: 42,
  recordingSessionId,
  serverRowMissing: recordingSessionId === null,
})
const takeFinalizedAtF = () => {
  store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', durationMs: 42_000, finalizedAt: 1, finalizedPath: TAKE_KEY, startedAt: 0, updatedAt: 1 }
  rows.set(SESSION, { id: SESSION, business_id: BIZ, staff_id: RECORDER, store_id: null, audio_storage_path: TAKE_KEY })
}
/** No row, no finalized key, the attach cannot land → 'no_session'. */
const bareTake = () => {
  store.meta = { mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
}
/** A row the take knows (not holding the fallback's key), the attach cannot land → 'attach_failed'. */
const takeWithRow = () => {
  store.meta = { recordingSessionId: SESSION, mimeType: 'audio/webm', durationMs: 42_000, startedAt: 0, updatedAt: 1 }
  rows.set(SESSION, { id: SESSION, business_id: BIZ, staff_id: RECORDER, store_id: null, audio_storage_path: TAKE_KEY })
}
/** Run once; while the run ends in error, 再試行 (at most twice). */
const runAndRetry = async (ctx: RunContext) => {
  globalPipeline.start(memory, ctx)
  await settle()
  for (let i = 0; i < 2 && globalPipeline.state === 'error'; i++) {
    globalPipeline.retry()
    await settle()
  }
  expect(globalPipeline.state).toBe('review')
}
/** E1: the first response is lost, the inner re-POST is delivered. */
const e1 = (ctx: RunContext) => {
  net.push('lose', undefined)
  return runAndRetry(ctx)
}
/** E3: the first response is lost AND the inner re-POST never leaves → 再試行. */
const e3 = (ctx: RunContext) => {
  net.push('lose', 'unreached')
  return runAndRetry(ctx)
}
/** KILL: the POST reaches the server (it pays and remembers), the app dies; the recovery save runs. */
const kill = async (ctx: RunContext) => {
  let die!: () => void
  responseHolds.push(new Promise<void>((r) => (die = r)))
  net.push('lose', 'unreached')
  globalPipeline.start(memory, ctx)
  for (let i = 0; i < 200 && transcribeUrlWithDeepgram.mock.calls.length === 0; i++) await tick()
  for (let i = 0; i < 20; i++) await tick()
  globalPipeline.reset() // the relaunch: nothing of the run survives in memory
  die() // the dead connection (and its tab lock) goes with the process
  for (let i = 0; i < 20; i++) await tick()
  globalPipeline.start(memory, ctx) // the recovery save of the same take
  await settle()
  expect(globalPipeline.state).toBe('review')
}
/** BLIP (web): the first response is lost; the inner re-POST's owner read blips. */
const blip = (ctx: RunContext) => {
  blipOnGet.add(2)
  net.push('lose', undefined)
  return runAndRetry(ctx)
}

/** E2 (the race, S53 A5): the first POST's connection drops while the server is
 *  still inside the provider; the inner re-POST reaches it meanwhile. With the
 *  lease that re-POST is answered 409 — and (S54 B) the run stays on
 *  「文字起こし中...」 (never the error card, never a 再試行): the first call is
 *  let finish at that 409, the run waits what it asked and asks again, and the
 *  saved answer replays. */
const e2 = async (ctx: RunContext) => {
  let finish!: () => void
  providerHolds.push(new Promise<void>((r) => (finish = r)))
  net.push('drop', undefined)
  onStillWorking = () => {
    expect(globalPipeline.state).toBe('processing')
    expect(globalPipeline.step).toBe('transcribing')
    finish()
  }
  globalPipeline.start(memory, ctx)
  await settle()
  finish()
  await Promise.allSettled(inFlight)
  await settle()
  expect(globalPipeline.state).toBe('review')
}

type Cell = [fixOffFlipOff: number, fixOffFlipOn: number, fixOnFlipOff: number, fixOnFlipOn: number]
type Scenario = [name: string, setup: () => RunContext, event: (ctx: RunContext) => Promise<void>, web: Cell, phone: Cell]
const SCENARIOS: Scenario[] = [
  ['normal take F · E1', () => (takeFinalizedAtF(), ctxFor(TAKE, SESSION)), e1, [1, 1, 1, 1], [1, 1, 1, 1]],
  ['normal take F · E3', () => (takeFinalizedAtF(), ctxFor(TAKE, SESSION)), e3, [1, 1, 1, 1], [1, 1, 1, 1]],
  ['normal take F · core blip on the retry', () => (takeFinalizedAtF(), ctxFor(TAKE, SESSION)), blip, [2, 2, 1, 1], [1, 1, 1, 1]],
  // S53 A1 (the web door replays 'no_row' too; ruling given — Liam,
  // 2026-09-28 19:5x JST: 「I think both. Yes to both.」) turns
  // every web fix-ON cell whose key no row holds from 2 into 1 — the phone
  // door's answer since S46.
  ['no_session with a take · E1', () => (bareTake(), ctxFor(TAKE)), e1, [2, 1, 1, 1], [1, 1, 1, 1]],
  ['no_session with a take · E3', () => (bareTake(), ctxFor(TAKE)), e3, [2, 1, 1, 1], [2, 1, 1, 1]],
  ['no_session · app killed mid-POST → recovery', () => (bareTake(), ctxFor(TAKE)), kill, [2, 1, 1, 1], [2, 1, 1, 1]],
  ['attach_failed · E1', () => (takeWithRow(), ctxFor(TAKE, SESSION)), e1, [2, 2, 1, 1], [1, 1, 1, 1]],
  ['attach_failed · E3', () => (takeWithRow(), ctxFor(TAKE, SESSION)), e3, [2, 2, 1, 1], [2, 2, 1, 1]],
  ['take-less · E1', () => ctxFor(null), e1, [2, 1, 1, 1], [1, 1, 1, 1]],
  ['take-less · E3', () => ctxFor(null), e3, [2, 2, 1, 1], [2, 2, 1, 1]],
  // S53 A5 (the lease; ruling given — Liam, 2026-09-28 19:5x JST: 「I think both. Yes to both.」):
  // the race pays once only with it.
  ['normal take F · E2 (the race)', () => (takeFinalizedAtF(), ctxFor(TAKE, SESSION)), e2, [2, 2, 1, 1], [2, 2, 1, 1]],
  ['no_session with a take · E2 (the race)', () => (bareTake(), ctxFor(TAKE)), e2, [2, 2, 1, 1], [2, 2, 1, 1]],
]
const LAYERS: Array<[label: string, fixOn: boolean, flipOn: boolean, column: 0 | 1 | 2 | 3]> = [
  ['fix OFF · flip OFF (today)', false, false, 0],
  ['fix OFF · flip ON', false, true, 1],
  ['fix ON · flip OFF', true, false, 2],
  ['fix ON · flip ON', true, true, 3],
]

describe.each(LAYERS)('paid calls — %s', (_label, fixOn, flipOn, column) => {
  let restore: Array<{ restore(): void }> = []
  beforeEach(() => {
    restore = [
      jest.replaceProperty(RECORDING_SWITCHES as { transcribePaidOnce: boolean }, 'transcribePaidOnce', fixOn),
      jest.replaceProperty(RECORDING_SWITCHES as { bindUnboundUploads: boolean }, 'bindUnboundUploads', flipOn),
    ]
  })
  afterEach(() => restore.forEach((r) => r.restore()))

  describe.each(['web', 'phone'] as const)('%s', (door) => {
    it.each(SCENARIOS)('%s', async (_name, setup, event, web, phone) => {
      platform = door
      await event(setup())
      expect(transcribeUrlWithDeepgram).toHaveBeenCalledTimes((door === 'web' ? web : phone)[column])
      // S54 B: the race meets the lease's 409 (and rides it out) exactly when the fix is ON.
      if (event === e2) expect(stillWorkingServed > 0).toBe(fixOn)
    })
  })
})
