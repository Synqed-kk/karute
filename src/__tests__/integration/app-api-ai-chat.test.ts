// AI相談 chat facade twin (design-parity F-9b). Pins: Bearer/capability/
// revocation (ai.chat is a compute-POST on customer data → server round-trip) ·
// strict body validation · the store clamp runs BEFORE the rate-limit consume
// (store_forbidden never burns quota) · #347 scope semantics through the core
// (clamped staff → their store; viewAll even store-pinned → business-wide,
// exact web-route parity) · contextDeps wiring (businessId-explicit cached
// list, no cookie reads) · NO plan gate (web parity — chat is rate-limited,
// not entitlement-gated). The LLM/context core itself is mocked.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null }
const getUser = { fn: jest.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'auth-user-1' } }, error: null })) }
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }) }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['customers.view']) }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const enforceRate = jest.fn(async () => {})
const reportUsage = jest.fn(async () => {})
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimitWithClient: (...a: unknown[]) => enforceRate(...(a as [])),
  reportAiUsageWithClient: (...a: unknown[]) => reportUsage(...(a as [])),
}))
jest.mock('@/actions/org-settings', () => ({ orgSettingsWithClient: jest.fn(async () => ({ business_type: 'beauty_chiropractic' })) }))
jest.mock('@/lib/openai', () => ({ openai: { chat: { completions: { create: jest.fn() } } } }))
jest.mock('@/lib/prompts', () => ({ getChatSystemPrompt: jest.fn(() => 'system') }))
const cachedListFor = jest.fn(async () => [])
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => []),
  getCachedCustomerListFor: (...a: unknown[]) => cachedListFor(...(a as [])),
}))

const runChat = jest.fn(async (_params?: unknown) => ({ reply: 'AIの回答', contextLabel: undefined as string | undefined, usage: null as { tokensIn: number; tokensOut: number } | null }))
jest.mock('@/lib/ai/karute-chat', () => ({
  ...jest.requireActual('@/lib/ai/karute-chat'),
  runKaruteChat: (...a: unknown[]) => runChat(...(a as [])),
}))

// Business-scoped client — the clamp's stores/staffStores + (unused here) reads.
const storesGet = jest.fn(async (id: string) => {
  if (id !== 'store-ginza') throw new Error('not this tenant')
  return { id }
})
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const fakeClient = {
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
  customers: { list: jest.fn(async () => ({ customers: [] })) },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: jest.fn(() => fakeClient) }))

// Wave W2: spy on the emitter while keeping the REAL map/types — the generic
// facade hook (logFacadeAudit) now emits ai.consult_session on every 2xx of
// this route, enriched by ctx.auditDetail/auditStoreId.
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: jest.fn(),
}))

import { POST } from '@/app/api/app/v1/ai/chat/route'
import { AppApiError } from '@/lib/app-api/errors'

const auditSpy = (jest.requireMock('@/lib/audit') as { audit: jest.Mock }).audit

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
const post = (headers: Record<string, string>, body: unknown) =>
  new Request('https://s/api/app/v1/ai/chat', { method: 'POST', headers, body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  getUser.fn.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  runChat.mockResolvedValue({ reply: 'AIの回答', contextLabel: undefined, usage: null })
})

describe('POST /api/app/v1/ai/chat — auth + validation', () => {
  it('missing Bearer → 401, core never called', async () => {
    const res = await POST(post({ 'content-type': 'application/json' }, { message: 'x' }), noRoute)
    expect(res.status).toBe(401)
    expect(runChat).not.toHaveBeenCalled()
  })

  it('revoked staffer → 401 via the server round-trip (ai.chat is revocation-sensitive)', async () => {
    getUser.fn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'revoked' } })
    const res = await POST(post(auth, { message: 'x' }), noRoute)
    expect(res.status).toBe(401)
    expect(getUser.fn).toHaveBeenCalled()
    expect(runChat).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no consume, no core', async () => {
    capabilities.current = new Set()
    const res = await POST(post(auth, { message: 'x' }), noRoute)
    expect(res.status).toBe(403)
    expect(enforceRate).not.toHaveBeenCalled()
    expect(runChat).not.toHaveBeenCalled()
  })

  it('blank message → 400 validation', async () => {
    const res = await POST(post(auth, { message: '   ' }), noRoute)
    expect(res.status).toBe(400)
    expect(runChat).not.toHaveBeenCalled()
  })

  it('unknown key → 400 (strict schema)', async () => {
    const res = await POST(post(auth, { message: 'x', spoofed: true }), noRoute)
    expect(res.status).toBe(400)
  })
})

describe('store clamp + scope semantics (#347 parity through the core)', () => {
  it('store-id of another tenant → 403 BEFORE any rate-limit consume', async () => {
    const res = await POST(post({ ...auth, 'store-id': 'store-foreign' }, { message: 'x' }), noRoute)
    expect(res.status).toBe(403)
    expect(enforceRate).not.toHaveBeenCalled()
    expect(runChat).not.toHaveBeenCalled()
  })

  it('clamped staff (assigned ginza) → core context scoped to their store', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-ginza'] })
    const res = await POST(post(auth, { message: 'x', locale: 'ja' }), noRoute)
    expect(res.status).toBe(200)
    expect(runChat).toHaveBeenCalledWith(expect.objectContaining({ scopedStoreId: 'store-ginza' }))
  })

  it('viewAll pinned to a store → core context stays business-wide (web parity)', async () => {
    capabilities.current = new Set(['customers.view', 'stores.viewAll'])
    const res = await POST(post({ ...auth, 'store-id': 'store-ginza' }, { message: 'x' }), noRoute)
    expect(res.status).toBe(200)
    expect(runChat).toHaveBeenCalledWith(expect.objectContaining({ scopedStoreId: undefined }))
  })
})

describe('happy path + accounting', () => {
  it('200 { reply }; context_label omitted when absent; consume + usage on the chat route key', async () => {
    runChat.mockResolvedValueOnce({ reply: 'こんにちは', contextLabel: undefined, usage: { tokensIn: 10, tokensOut: 20 } })
    const res = await POST(post(auth, { message: 'x', locale: 'ja', history: [{ role: 'user', content: 'a' }] }), noRoute)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reply).toBe('こんにちは')
    expect(json).not.toHaveProperty('context_label')
    expect(enforceRate).toHaveBeenCalledWith(expect.anything(), 'chat')
    expect(reportUsage).toHaveBeenCalledWith(expect.anything(), 'chat', 10, 20)
  })

  it('context_label present when the core labels the slice', async () => {
    runChat.mockResolvedValueOnce({ reply: 'ok', contextLabel: '田中様のカルテ3件', usage: null })
    const res = await POST(post(auth, { message: 'x', context_hint: { customer_id: 'c-1' } }), noRoute)
    const json = await res.json()
    expect(json.context_label).toBe('田中様のカルテ3件')
    // The hint reached the core parsed, not raw.
    expect(runChat).toHaveBeenCalledWith(expect.objectContaining({ contextHint: { customer_id: 'c-1' } }))
  })

  it('contextDeps: businessId-explicit cached list, same business-scoped client (no cookie reads)', async () => {
    await POST(post(auth, { message: 'x' }), noRoute)
    const params = runChat.mock.calls[0][0] as { contextDeps: { synqed: unknown; customers: () => Promise<unknown> } }
    expect(params.contextDeps.synqed).toBe(fakeClient)
    await params.contextDeps.customers()
    expect(cachedListFor).toHaveBeenCalledWith('business-1')
  })

  it('rate limited → 429, core never called', async () => {
    enforceRate.mockRejectedValueOnce(new AppApiError('rate_limited', 'slow down'))
    const res = await POST(post(auth, { message: 'x' }), noRoute)
    expect(res.status).toBe(429)
    expect(runChat).not.toHaveBeenCalled()
  })
})

describe('監査ログ Wave W2 — the generic hook emits ai.consult_session per exchange', () => {
  it('2xx exchange: ONE facade emit with first_turn/history_len enrichment (first exchange = the session row)', async () => {
    const res = await POST(post(auth, { message: '肩こりの相談', locale: 'ja' }), noRoute)
    expect(res.status).toBe(200)
    const calls = auditSpy.mock.calls.filter(([e]) => e.action === 'ai.consult_session')
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toEqual(
      expect.objectContaining({
        category: 'ai',
        action: 'ai.consult_session',
        source: 'facade',
        businessId: 'business-1',
        storeId: undefined,
        detail: expect.objectContaining({ first_turn: true, history_len: 0 }),
      }),
    )
    // Closed detail shape (blind-round F1): the hook bounds detail keys but
    // has no PII guard — a regression adding message content to
    // ctx.auditDetail must fail HERE, not ride through objectContaining.
    // (No request-id header sent → no client_request_id fallback key.)
    expect(Object.keys(calls[0][0].detail).sort()).toEqual(['first_turn', 'history_len'])
  })

  it('over-budget history: history_len counts the CAPPED turns, not the raw client array', async () => {
    // Two turns totalling ~35k chars — capHistory (30k budget) drops the
    // oldest, so post-cap length is 1 while the raw array has 2. Kills the
    // `history_len: raw.length` mutant the short-history tests can't see.
    const res = await POST(
      post(auth, {
        message: 'x',
        history: [
          { role: 'user', content: 'a'.repeat(20000) },
          { role: 'assistant', content: 'b'.repeat(15000) },
        ],
      }),
      noRoute,
    )
    expect(res.status).toBe(200)
    const [e] = auditSpy.mock.calls.filter(([ev]) => ev.action === 'ai.consult_session')[0]
    expect(e.detail).toEqual(expect.objectContaining({ first_turn: false, history_len: 1 }))
  })

  it('later exchange: first_turn false, history_len counts the capped history', async () => {
    const res = await POST(
      post(auth, {
        message: '続き',
        history: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
        ],
      }),
      noRoute,
    )
    expect(res.status).toBe(200)
    const [e] = auditSpy.mock.calls.filter(([ev]) => ev.action === 'ai.consult_session')[0]
    expect(e.detail).toEqual(expect.objectContaining({ first_turn: false, history_len: 2 }))
  })

  it("clamped staff: the row carries the clamp's store as its store lens", async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-ginza'] })
    const res = await POST(post(auth, { message: 'x' }), noRoute)
    expect(res.status).toBe(200)
    const [e] = auditSpy.mock.calls.filter(([ev]) => ev.action === 'ai.consult_session')[0]
    expect(e.storeId).toBe('store-ginza')
  })

  it('viewAll (business-wide context): no store lens on the row', async () => {
    capabilities.current = new Set(['customers.view', 'stores.viewAll'])
    const res = await POST(post({ ...auth, 'store-id': 'store-ginza' }, { message: 'x' }), noRoute)
    expect(res.status).toBe(200)
    const [e] = auditSpy.mock.calls.filter(([ev]) => ev.action === 'ai.consult_session')[0]
    expect(e.storeId).toBeUndefined()
  })

  it('errors are not actions: 403 (capability) and 429 (rate limit) emit nothing', async () => {
    capabilities.current = new Set()
    const forbidden = await POST(post(auth, { message: 'x' }), noRoute)
    expect(forbidden.status).toBe(403)

    capabilities.current = new Set(['customers.view'])
    enforceRate.mockRejectedValueOnce(new AppApiError('rate_limited', 'slow down'))
    const limited = await POST(post(auth, { message: 'x' }), noRoute)
    expect(limited.status).toBe(429)

    expect(auditSpy.mock.calls.filter(([e]) => e.action === 'ai.consult_session')).toHaveLength(0)
  })
})
