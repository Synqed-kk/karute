// AI-slot facade reads (packet 07 Decision 1 + §Build 4). The two Suspense-streamed
// AI cards as resource-scoped GETs: body-prediction (customer-anchored) + suggested-
// message (karute-anchored). Verifies: capability gate, the status-aware tenancy
// proof BEFORE any LLM/cache call (cross-tenant → 404, genuine upstream → 502), the
// best-effort null payload as a 200 (NOT a 502 — the pre-ruled exception), and that
// the suggested-message prompt anchors (customerName/summary) are DERIVED
// server-side from the record. The generators are mocked (their null-on-missing-key
// / locked / failure paths are their own contract); the Bearer verifier runs real.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['customers.view']) }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1', full_name: '田中' }]),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const custGet = jest.fn(async (id: string) => {
  if (id === 'cust-upstream') throw Object.assign(new Error('boom'), { status: 500 })
  if (id !== 'cust-1') throw Object.assign(new Error('nope'), { status: 404 })
  return { id, name: '山田 花子' }
})
const karGet = jest.fn(async (id: string) => {
  if (id === 'kar-upstream') throw Object.assign(new Error('boom'), { status: 500 })
  if (id !== 'kar-1') throw Object.assign(new Error('nope'), { status: 404 })
  return { id, ai_summary: '・肩こり改善傾向', customer_id: 'cust-1' }
})
const fakeClient = { customers: { get: (id: string) => custGet(id) }, karuteRecords: { get: (id: string) => karGet(id) } }
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

const getCustomerKaruteRecordsWithClient = jest.fn(async () => [{ id: 'k1', created_at: '2026-06-01' }, { id: 'k2', created_at: '2026-05-01' }])
jest.mock('@/actions/karute', () => ({ getCustomerKaruteRecordsWithClient: () => getCustomerKaruteRecordsWithClient() }))

const getBodyPredictionWithClient = jest.fn(async (): Promise<unknown> => ({ headline: 'h', confidence: 70, delta: null, recommended: '1〜2週間後', recommendedSub: null, rationaleSummary: 'r' }))
jest.mock('@/lib/karute/ai-body-prediction', () => ({ getBodyPredictionWithClient: () => getBodyPredictionWithClient() }))
type MsgParams = { summary: string; customerName: string; customerId: string | null; karuteId: string; locale: string }
const getSuggestedFollowUpWithClient = jest.fn<Promise<unknown>, [unknown, string, string, string, MsgParams]>(async () => ({ channel: 'LINE', body: 'draft body' }))
jest.mock('@/lib/karute/ai-outreach', () => ({ getSuggestedFollowUpWithClient: (s: unknown, b: string, a: string, r: string, p: MsgParams) => getSuggestedFollowUpWithClient(s, b, a, r, p) }))

import { GET as bodyPrediction, OPTIONS as bodyOptions } from '@/app/api/app/v1/customers/[id]/ai/body-prediction/route'
import { GET as suggestedMessage, OPTIONS as msgOptions } from '@/app/api/app/v1/karute/[id]/ai/suggested-message/route'

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
const auth = { authorization: `Bearer ${bearer()}` }
const routeFor = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (init: RequestInit = {}) => new Request('https://s/x', init)

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  getBodyPredictionWithClient.mockResolvedValue({ headline: 'h', confidence: 70, delta: null, recommended: '1〜2週間後', recommendedSub: null, rationaleSummary: 'r' })
  getSuggestedFollowUpWithClient.mockResolvedValue({ channel: 'LINE', body: 'draft body' })
})

describe('GET /customers/[id]/ai/body-prediction (Decision 1)', () => {
  it('happy path → 200 { prediction }', async () => {
    const res = await bodyPrediction(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).prediction.headline).toBe('h')
  })
  it('generator miss (locked/no-key/failure) → 200 { prediction: null } (NOT a 502)', async () => {
    getBodyPredictionWithClient.mockResolvedValueOnce(null)
    const res = await bodyPrediction(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).prediction).toBeNull()
  })
  it('cross-tenant / missing customer id → 404 BEFORE any LLM/records call', async () => {
    const res = await bodyPrediction(req({ headers: auth }), routeFor('cust-x'))
    expect(res.status).toBe(404)
    expect(getCustomerKaruteRecordsWithClient).not.toHaveBeenCalled()
    expect(getBodyPredictionWithClient).not.toHaveBeenCalled()
  })
  it('genuine tenancy-proof upstream failure → 502 (not a false 404)', async () => {
    const res = await bodyPrediction(req({ headers: auth }), routeFor('cust-upstream'))
    expect(res.status).toBe(502)
    expect(getBodyPredictionWithClient).not.toHaveBeenCalled()
  })
  it('missing capability → 403', async () => {
    capabilities.current = new Set()
    const res = await bodyPrediction(req({ headers: auth }), routeFor('cust-1'))
    expect(res.status).toBe(403)
    expect(custGet).not.toHaveBeenCalled()
  })
  it('missing Bearer → 401', async () => {
    const res = await bodyPrediction(req({ headers: { cookie: 'sb=x' } }), routeFor('cust-1'))
    expect(res.status).toBe(401)
  })
  it('OPTIONS shell origin → 204, no downstream', async () => {
    const res = await bodyOptions(new Request('https://s/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), routeFor('cust-1'))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  })
})

describe('GET /karute/[id]/ai/suggested-message (Decision 1)', () => {
  it('happy path → 200 { draft }; prompt anchors DERIVED server-side from the record', async () => {
    const res = await suggestedMessage(req({ headers: auth }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).draft.body).toBe('draft body')
    // summary + customerName come from the record/customer, never the client.
    const [, , actorId, requestId, params] = getSuggestedFollowUpWithClient.mock.calls[0]
    expect(params.summary).toBe('・肩こり改善傾向')
    expect(params.customerName).toBe('山田 花子')
    expect(params.karuteId).toBe('kar-1')
    // 2026-07-29 honesty split: the record's customer threads through for the
    // 生成 row's detail; actor/requestId thread from the verified identity so
    // a real generation stamps the same requestId as this request's view row.
    expect(params.customerId).toBe('cust-1')
    expect(actorId).toBe('auth-user-1')
    expect(typeof requestId).toBe('string')
    expect(requestId.length).toBeGreaterThan(0)
    // Exactly ONE generator invocation per request — a double-call bug would
    // double OpenAI cost and the 生成 row (blind-round find: nothing pinned
    // the call count anywhere).
    expect(getSuggestedFollowUpWithClient).toHaveBeenCalledTimes(1)
  })

  it('hook row is the VIEW twin and carries detail.customer_id (Wave V name-join canon)', async () => {
    const { auditLines } = await import('./helpers/audit-lines')
    const lines = await auditLines(async () => {
      const res = await suggestedMessage(req({ headers: auth }), routeFor('kar-1'))
      expect(res.status).toBe(200)
    })
    const hookRows = lines.filter((l) => l.action === 'ai.suggested_message_view')
    expect(hookRows).toHaveLength(1)
    expect(hookRows[0]).toMatchObject({
      category: 'ai',
      target_type: 'karute',
      target_id: 'kar-1',
      detail: expect.objectContaining({ customer_id: 'cust-1' }),
      source: 'facade',
    })
    // And no 生成 row from a mocked cache-served draft — the mutation action
    // may only ever be emitted by the real generation branch.
    expect(lines.filter((l) => l.action === 'ai.suggested_message')).toHaveLength(0)
  })
  it('generator miss (locked/no-summary/failure) → 200 { draft: null }', async () => {
    getSuggestedFollowUpWithClient.mockResolvedValueOnce(null)
    const res = await suggestedMessage(req({ headers: auth }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).draft).toBeNull()
  })
  it('cross-tenant / missing karute id → 404 BEFORE any LLM call', async () => {
    const res = await suggestedMessage(req({ headers: auth }), routeFor('kar-x'))
    expect(res.status).toBe(404)
    expect(getSuggestedFollowUpWithClient).not.toHaveBeenCalled()
  })
  it('genuine tenancy-proof upstream failure → 502', async () => {
    const res = await suggestedMessage(req({ headers: auth }), routeFor('kar-upstream'))
    expect(res.status).toBe(502)
    expect(getSuggestedFollowUpWithClient).not.toHaveBeenCalled()
  })
  it('missing capability → 403', async () => {
    capabilities.current = new Set()
    const res = await suggestedMessage(req({ headers: auth }), routeFor('kar-1'))
    expect(res.status).toBe(403)
    expect(karGet).not.toHaveBeenCalled()
  })
  it('OPTIONS shell origin → 204', async () => {
    const res = await msgOptions(new Request('https://s/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), routeFor('kar-1'))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  })
})
