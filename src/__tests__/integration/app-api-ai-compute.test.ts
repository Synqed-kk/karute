// Recording-flow AI compute + brief (packet 08 Decision 1/2). Verifies: the F-A1
// plan-gate ordering (locked → per-surface contract with ZERO rate-limit consume
// + ZERO LLM call), the transcribe storage-key grammar proof (anything but a key
// minted here → not_found before any mint/Deepgram), the VOICE-ISOLATION rule (the voiceprint
// reference is the CALLER's own selfStaffId, never the roster), the brief tenancy
// 404/502 split, and Bearer/capability/revocation. OPENAI/Deepgram keys are never
// present — every LLM/transcription core is mocked.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null }
const getUser = { fn: jest.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'auth-user-1' } }, error: null })) }
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }) }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['records.write', 'customers.view']) }
const roster = { current: [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }] as Array<{ id: string; full_name: string; display_role: string }> }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster.current),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const planAllowed = { current: true }
jest.mock('@/lib/subscription/feature-gate', () => ({ featureAllowedForBusiness: jest.fn(async () => planAllowed.current) }))

const enforceRate = jest.fn(async () => {})
const reportUsage = jest.fn(async () => {})
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimitWithClient: (...a: unknown[]) => enforceRate(...(a as [])),
  reportAiUsageWithClient: (...a: unknown[]) => reportUsage(...(a as [])),
}))

const runTranscription = jest.fn(async () => ({ transcript: 'T', durationSec: 1, confidence: 0.9 }))
const loadRef = jest.fn(async () => null)
jest.mock('@/lib/ai/transcribe', () => ({
  runTranscription: (...a: unknown[]) => runTranscription(...(a as [])),
  speakerIdMode: () => 'shadow',
  loadStaffReferenceForStaff: (...a: unknown[]) => loadRef(...(a as [])),
}))
const runExtract = jest.fn(async () => ({ result: { entries: [] }, usage: null }))
jest.mock('@/lib/ai/karute-extract', () => ({ runKaruteExtraction: (...a: unknown[]) => runExtract(...(a as [])) }))
const runSummary = jest.fn(async () => ({ result: { summary: 'S' }, usage: null }))
jest.mock('@/lib/ai/karute-summarize', () => ({ runKaruteSummary: (...a: unknown[]) => runSummary(...(a as [])) }))
const runSuggest = jest.fn(async () => ({ result: { suggestions: [{ text: 'x', type: 'note' }] }, usage: null }))
jest.mock('@/lib/ai/karute-suggestions', () => ({ runKaruteSuggestions: (...a: unknown[]) => runSuggest(...(a as [])) }))
const getBrief = jest.fn(async () => ({ isFirstTimeVisit: false, lastVisitDate: '', lastVisitAgo: '', hooks: [], concerns: [], lastProduct: null, recommendedFocus: null, reservationMemo: null, memoAnalysis: [] }))
jest.mock('@/lib/karute/ai-brief', () => ({ getAiPreSessionBriefWithClient: (...a: unknown[]) => getBrief(...(a as [])) }))
jest.mock('@/actions/org-settings', () => ({ orgSettingsWithClient: jest.fn(async () => ({ speaker_diarization: true })) }))
jest.mock('@/lib/ai-cache', () => ({ getCachedAI: jest.fn(async () => null), setCachedAI: jest.fn(async () => {}) }))
jest.mock('@/actions/karute', () => ({ getCustomerKaruteRecordsWithClient: jest.fn(async () => []) }))

const createSignedUrl = jest.fn(async (p: string) => ({ data: { signedUrl: 'https://x/read/' + p }, error: null }))
const removeObj = jest.fn(async () => ({ error: null }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ storage: { from: () => ({ createSignedUrl, remove: removeObj }) } }) }))

const customersGet = jest.fn(async (id: string) => { if (id !== 'cust-1') throw Object.assign(new Error('x'), { status: id === 'cust-boom' ? 500 : 404 }); return { id, name: 'Y', visit_count: 2, notes: null } })
const fakeClient = { customers: { get: customersGet }, appointments: { get: jest.fn(async () => ({ notes: null })) } }
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { POST as transcribePOST } from '@/app/api/app/v1/ai/transcribe/route'
import { POST as extractPOST } from '@/app/api/app/v1/ai/extract/route'
import { POST as summarizePOST } from '@/app/api/app/v1/ai/summarize/route'
import { POST as suggestPOST } from '@/app/api/app/v1/ai/suggestions/route'
import { GET as briefGET } from '@/app/api/app/v1/customers/[id]/ai/pre-session-brief/route'
import { AppApiError } from '@/lib/app-api/errors'
import { conformingKey, refusedKeys } from './helpers/recording-key-fixtures'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer(sub = 'auth-user-1') {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' }
const noRoute = { params: Promise.resolve({}) }
const custRoute = (id = 'cust-1') => ({ params: Promise.resolve({ id }) })
const post = (headers: Record<string, string>, body: unknown) => new Request('https://s/x', { method: 'POST', headers, body: JSON.stringify(body) })
// The transcribe facade takes a STORAGE KEY, and the tenancy gate now matches the
// minted grammar positively — every fixture below must be a real one.
const OWN_PATH = conformingKey('business-1')
const get = (path: string, headers = { authorization: auth.authorization }) => new Request('https://s/x' + path, { headers })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['records.write', 'customers.view'])
  planAllowed.current = true
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
})

describe('plan-gate matrix (F-A1: locked → per-surface, ZERO consume, ZERO LLM)', () => {
  beforeEach(() => { planAllowed.current = false })
  it('transcribe locked → 403, no consume, no core', async () => {
    const res = await transcribePOST(post(auth, { path: OWN_PATH, locale: 'ja' }), noRoute)
    expect(res.status).toBe(403)
    expect(enforceRate).not.toHaveBeenCalled()
    expect(runTranscription).not.toHaveBeenCalled()
  })
  it('extract locked → 403, no consume, no core', async () => {
    const res = await extractPOST(post(auth, { transcript: 't' }), noRoute)
    expect(res.status).toBe(403)
    expect(enforceRate).not.toHaveBeenCalled()
    expect(runExtract).not.toHaveBeenCalled()
  })
  it('summarize locked → 403, no consume, no core', async () => {
    const res = await summarizePOST(post(auth, { transcript: 't' }), noRoute)
    expect(res.status).toBe(403)
    expect(enforceRate).not.toHaveBeenCalled()
    expect(runSummary).not.toHaveBeenCalled()
  })
  it('suggestions locked → 200 [] (best-effort), no consume, no core', async () => {
    const res = await suggestPOST(post(auth, { summary: 's' }), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).suggestions).toEqual([])
    expect(enforceRate).not.toHaveBeenCalled()
    expect(runSuggest).not.toHaveBeenCalled()
  })
  it('brief locked → 200 null (best-effort), no core', async () => {
    const res = await briefGET(get('/?locale=ja'), custRoute('cust-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).brief).toBeNull()
    expect(getBrief).not.toHaveBeenCalled()
  })
})

describe('transcribe — storage-path tenancy + voice isolation', () => {
  // One row per grammar class (helpers/recording-key-fixtures). Half carry this
  // caller's OWN prefix — the bare `startsWith` this gate used to be took them.
  it.each(refusedKeys('business-1'))(
    'refuses %s → not_found BEFORE any signed-URL mint or Deepgram',
    async (_label, path) => {
      const res = await transcribePOST(post(auth, { path }), noRoute)
      expect(res.status).toBe(404)
      expect(createSignedUrl).not.toHaveBeenCalled()
      expect(runTranscription).not.toHaveBeenCalled()
    },
  )
  it('a non-string path is refused by the schema, before the fence → 400', async () => {
    // typeof guard proved on the server-action arm (recording-jobs-tenant-key);
    // here zod's `z.string()` meets a non-string first. Either way it never
    // reaches the service-role mint.
    const res = await transcribePOST(post(auth, { path: 12345 }), noRoute)
    expect(res.status).toBe(400)
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(runTranscription).not.toHaveBeenCalled()
  })
  it('happy → 200; voiceprint reference loaded for the CALLER own selfStaffId only', async () => {
    const res = await transcribePOST(post(auth, { path: OWN_PATH, locale: 'ja' }), noRoute)
    expect(res.status).toBe(200)
    // Voice-isolation: loadStaffReferenceForStaff called with THIS caller's staff id.
    expect(loadRef).toHaveBeenCalledWith(expect.anything(), 'auth-user-1')
    expect(removeObj).toHaveBeenCalledWith([OWN_PATH])
  })
  it('early gate failure (rate limit) AFTER upload → object still deleted', async () => {
    enforceRate.mockRejectedValueOnce(new AppApiError('rate_limited', 'slow down'))
    const res = await transcribePOST(post(auth, { path: OWN_PATH, locale: 'ja' }), noRoute)
    expect(res.status).toBe(429)
    expect(removeObj).toHaveBeenCalledWith([OWN_PATH])
    expect(runTranscription).not.toHaveBeenCalled()
  })
  it('transcription failure → object still deleted (no orphaned audio)', async () => {
    runTranscription.mockRejectedValueOnce(new Error('deepgram down'))
    const res = await transcribePOST(post(auth, { path: OWN_PATH, locale: 'ja' }), noRoute)
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(removeObj).toHaveBeenCalledWith([OWN_PATH])
  })
  it('missing capability → 403', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await transcribePOST(post(auth, { path: OWN_PATH }), noRoute)
    expect(res.status).toBe(403)
  })
  it('revoked → 401 (server round-trip)', async () => {
    getUser.fn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'revoked' } })
    const res = await transcribePOST(post(auth, { path: OWN_PATH }), noRoute)
    expect(res.status).toBe(401)
  })
})

describe('extract/summarize happy + validation', () => {
  it('extract happy → 200; consume AFTER the plan gate', async () => {
    const res = await extractPOST(post(auth, { transcript: 't', locale: 'ja' }), noRoute)
    expect(res.status).toBe(200)
    expect(enforceRate).toHaveBeenCalledWith(expect.anything(), 'extract')
  })
  it('extract missing transcript → 400 validation', async () => {
    const res = await extractPOST(post(auth, { locale: 'ja' }), noRoute)
    expect(res.status).toBe(400)
  })
})

describe('suggestions — tenant-aware cache key', () => {
  it('key carries the FULL transcript + businessType (no 500-char prefix collisions)', async () => {
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache') as { getCachedAI: jest.Mock }
    const long = 'あ'.repeat(600)
    const res = await suggestPOST(post(auth, { transcript: long, locale: 'ja' }), noRoute)
    expect(res.status).toBe(200)
    expect(getCachedAI).toHaveBeenCalledWith('suggestions',
      expect.objectContaining({ transcript: long, businessType: null }))
  })
})

describe('brief GET — tenancy', () => {
  it('happy → 200 { brief }', async () => {
    const res = await briefGET(get('/?locale=ja'), custRoute('cust-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).brief).toBeTruthy()
  })
  it('cross-tenant customerId → 404 before the generator', async () => {
    const res = await briefGET(get('/'), custRoute('cust-x'))
    expect(res.status).toBe(404)
    expect(getBrief).not.toHaveBeenCalled()
  })
  it('appointment of ANOTHER customer → its memo never reaches the brief', async () => {
    ;(fakeClient.appointments.get as jest.Mock).mockResolvedValueOnce({ customer_id: 'cust-OTHER', notes: '他客のメモ' })
    const res = await briefGET(get('/?appointmentId=appt-9'), custRoute('cust-1'))
    expect(res.status).toBe(200)
    expect(getBrief).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ reservationMemo: null }))
  })
  it('appointment of THIS customer → its memo flows into the brief', async () => {
    ;(fakeClient.appointments.get as jest.Mock).mockResolvedValueOnce({ customer_id: 'cust-1', notes: '本人のメモ' })
    const res = await briefGET(get('/?appointmentId=appt-1'), custRoute('cust-1'))
    expect(res.status).toBe(200)
    expect(getBrief).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ reservationMemo: '本人のメモ' }))
  })
  it('genuine upstream tenancy read → 502', async () => {
    const res = await briefGET(get('/'), custRoute('cust-boom'))
    expect(res.status).toBe(502)
  })
  it('missing Bearer → 401', async () => {
    const res = await briefGET(new Request('https://s/x'), custRoute('cust-1'))
    expect(res.status).toBe(401)
  })
})
