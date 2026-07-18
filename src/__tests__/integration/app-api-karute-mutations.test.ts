// Session-detail MUTATION facade (packet 07 Decision 2 + §Build 3 + §Build 7).
// The regenerate write path + outcome upsert — the highest customer-data class
// (recording-privacy + AI-on-PII). Verifies: the server-verify path (every write
// is revocation-sensitive → getUser round-trip), the recording-privacy ACL
// server-gate on regenerate (no LLM/no write when the viewer can't see the raw
// transcript), the shared rate-limit accounting (429 → classified), the
// Idempotency-Key requirement, tenancy proof BEFORE any write, server-derived
// customerId on outcome, and the extract/summary integrity pins. The LLM cores
// are mocked (no OPENAI_API_KEY ever); the Bearer verifier runs for real.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

const revoked = { current: false }
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => (revoked.current ? { data: { user: null }, error: null } : { data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['records.write']) }
const roster = { current: [{ id: 'auth-user-1', full_name: '田中' }] as Array<{ id: string; full_name: string }> }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => roster.current),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

// The record drives the ACL (staff_id) + tenancy (get throws 404 for foreign id).
const REC = { current: { id: 'kar-1', created_at: '2026-06-01T03:00:00Z', transcript: 'RAW', staff_id: 'auth-user-1', customer_id: 'cust-1', entries: [{ id: 'old-1' }] } as Record<string, unknown> }
const recGet = jest.fn(async (id: string) => {
  if (id !== 'kar-1') throw Object.assign(new Error('nope'), { status: 404 })
  return REC.current
})
const addEntry = jest.fn(async () => ({ id: 'new-1' }))
const deleteEntry = jest.fn(async () => undefined)
const update = jest.fn(async () => undefined)
const custGet = jest.fn(async () => ({ name: '山田 花子' }))
const upsertOutcome = jest.fn()
const consume = jest.fn()
const recordUsage = jest.fn()
const fakeClient = {
  karuteRecords: { get: (id: string) => recGet(id), addEntry, deleteEntry, update },
  customers: { get: custGet },
  karuteOutcomes: { upsert: (arg: unknown) => upsertOutcome(arg) },
  aiRateLimit: { consume: (r: string) => consume(r), recordUsage: (...a: unknown[]) => recordUsage(...a) },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))
jest.mock('@/actions/org-settings', () => ({ orgSettingsWithClient: async () => ({ business_type: 'salon' }) }))

// LLM cores mocked — no OpenAI client, no key. Individual tests override.
type Usage = { tokensIn: number; tokensOut: number } | null
const runExtract = jest.fn(async (): Promise<{ result: { entries: unknown[] }; usage: Usage }> => ({ result: { entries: [{ category: 'symptom', title: '肩こり', source_quote: 'q', confidence_score: 0.9 }] }, usage: { tokensIn: 10, tokensOut: 5 } }))
const runSummary = jest.fn(async (): Promise<{ result: { summary: string }; usage: Usage }> => ({ result: { summary: '・肩こり改善傾向' }, usage: { tokensIn: 8, tokensOut: 3 } }))
jest.mock('@/lib/ai/karute-extract', () => ({ runKaruteExtraction: () => runExtract() }))
jest.mock('@/lib/ai/karute-summarize', () => ({ runKaruteSummary: () => runSummary() }))

import { POST as regenerate, OPTIONS as regenerateOptions } from '@/app/api/app/v1/karute/[id]/regenerate/route'
import { POST as outcome, OPTIONS as outcomeOptions } from '@/app/api/app/v1/karute/[id]/outcome/route'

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
const idem = { ...auth, 'Idempotency-Key': 'k1' }
const routeFor = (id: string) => ({ params: Promise.resolve({ id }) })
const jsonReq = (body: unknown, headers: Record<string, string> = auth) =>
  new Request('https://s/x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['records.write'])
  roster.current = [{ id: 'auth-user-1', full_name: '田中' }]
  revoked.current = false
  REC.current = { id: 'kar-1', created_at: '2026-06-01T03:00:00Z', transcript: 'RAW', staff_id: 'auth-user-1', customer_id: 'cust-1', entries: [{ id: 'old-1' }] }
  consume.mockResolvedValue({ allowed: true })
  runExtract.mockResolvedValue({ result: { entries: [{ category: 'symptom', title: '肩こり', source_quote: 'q', confidence_score: 0.9 }] }, usage: { tokensIn: 10, tokensOut: 5 } })
  runSummary.mockResolvedValue({ result: { summary: '・肩こり改善傾向' }, usage: { tokensIn: 8, tokensOut: 3 } })
})

// ── regenerate ────────────────────────────────────────────────────────────────
describe('POST /karute/[id]/regenerate (Decision 2)', () => {
  it('happy path (owner): applies entries + summary → 200 {added,removed}', async () => {
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.added).toBe(1)
    expect(body.removed).toBe(1)
    expect(addEntry).toHaveBeenCalled()
    expect(deleteEntry).toHaveBeenCalledWith('kar-1', 'old-1')
    expect(update).toHaveBeenCalledWith('kar-1', { ai_summary: '・肩こり改善傾向' })
  })

  it('missing Idempotency-Key → 400, no LLM/no write', async () => {
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: auth }), routeFor('kar-1'))
    expect(res.status).toBe(400)
    expect(runExtract).not.toHaveBeenCalled()
    expect(addEntry).not.toHaveBeenCalled()
  })

  it('ACL: a non-owner without recordings.viewAll → 403, NO LLM, NO write', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff' }
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-1'))
    expect(res.status).toBe(403)
    expect(runExtract).not.toHaveBeenCalled()
    expect(addEntry).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('ACL: a recordings.viewAll caller regenerates any staff’s record → 200', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff' }
    capabilities.current = new Set(['records.write', 'recordings.viewAll'])
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect(addEntry).toHaveBeenCalled()
  })

  it('extract failure → NO write, old entries intact', async () => {
    runExtract.mockRejectedValueOnce(new Error('llm down'))
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).error).toContain('No changes applied')
    expect(addEntry).not.toHaveBeenCalled()
    expect(deleteEntry).not.toHaveBeenCalled()
  })

  it('empty extraction → NO delete, old entries kept', async () => {
    runExtract.mockResolvedValueOnce({ result: { entries: [] }, usage: null })
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).error).toContain('No entries extracted')
    expect(addEntry).not.toHaveBeenCalled()
    expect(deleteEntry).not.toHaveBeenCalled()
  })

  it('summary failure → entries STILL applied + warning', async () => {
    runSummary.mockRejectedValueOnce(new Error('summary down'))
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.added).toBe(1)
    expect(body.warning).toBeDefined()
    expect(addEntry).toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('rate-limit cap hit → 429 classified, NO LLM/no write', async () => {
    consume.mockResolvedValueOnce({ allowed: false, reason: 'daily_cost', cap: 100, costCap: 500, costUsed: 500, resetAt: 't' })
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-1'))
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('rate_limited')
    expect(runExtract).not.toHaveBeenCalled()
    expect(addEntry).not.toHaveBeenCalled()
  })

  it('summarize cap hit AFTER extract consume → 200, extraction applied, summary skipped (no wasted slot)', async () => {
    consume.mockImplementation(async (r: string) =>
      r === 'summarize'
        ? { allowed: false, reason: 'daily_cost', cap: 100, costCap: 500, costUsed: 500, resetAt: 't' }
        : { allowed: true },
    )
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.added).toBe(1) // extraction ran and applied
    expect(body.warning).toBeDefined() // summary downgraded, surfaced as warning
    expect(runExtract).toHaveBeenCalled()
    expect(runSummary).not.toHaveBeenCalled()
    consume.mockResolvedValue({ allowed: true })
  })

  it('cross-tenant / missing karute id → 404, no LLM/no write', async () => {
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-OTHER'))
    expect(res.status).toBe(404)
    expect(runExtract).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no downstream', async () => {
    capabilities.current = new Set()
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-1'))
    expect(res.status).toBe(403)
    expect(recGet).not.toHaveBeenCalled()
  })

  it('missing Bearer → 401, no downstream', async () => {
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: { 'Idempotency-Key': 'k1' } }), routeFor('kar-1'))
    expect(res.status).toBe(401)
    expect(recGet).not.toHaveBeenCalled()
  })

  it('revoked staffer (getUser null) → 401 via the server round-trip, no write', async () => {
    revoked.current = true
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('kar-1'))
    expect(res.status).toBe(401)
    expect(addEntry).not.toHaveBeenCalled()
  })
})

// ── outcome ─────────────────────────────────────────────────────────────────
describe('POST /karute/[id]/outcome (§Build 3)', () => {
  it('happy path: upserts with the SERVER-derived customerId', async () => {
    const res = await outcome(jsonReq({ status: 'success', isFirstVisit: true }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect(upsertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ karute_record_id: 'kar-1', customer_id: 'cust-1', outcome: 'success', is_first_visit: true, decided_by: 'auth-user-1' }),
    )
  })

  it('customerId is DERIVED from the record — a spoofed body customerId is rejected (strict)', async () => {
    const res = await outcome(jsonReq({ status: 'success', customerId: 'cust-EVIL' }), routeFor('kar-1'))
    expect(res.status).toBe(400)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('invalid status → validation 400, no write', async () => {
    const res = await outcome(jsonReq({ status: 'maybe' }), routeFor('kar-1'))
    expect(res.status).toBe(400)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('invalid reason → validation 400, no write', async () => {
    const res = await outcome(jsonReq({ status: 'no_deal', reason: 'nope' }), routeFor('kar-1'))
    expect(res.status).toBe(400)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('cross-tenant / missing karute id → 404 BEFORE the upsert', async () => {
    const res = await outcome(jsonReq({ status: 'success' }), routeFor('kar-OTHER'))
    expect(res.status).toBe(404)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no write', async () => {
    capabilities.current = new Set()
    const res = await outcome(jsonReq({ status: 'success' }), routeFor('kar-1'))
    expect(res.status).toBe(403)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('revoked staffer → 401 via server round-trip, no write', async () => {
    revoked.current = true
    const res = await outcome(jsonReq({ status: 'success' }), routeFor('kar-1'))
    expect(res.status).toBe(401)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })
})

// ── OPTIONS preflight ─────────────────────────────────────────────────────────
describe('OPTIONS preflight — shell origin, no auth', () => {
  it.each([['regenerate', regenerateOptions], ['outcome', outcomeOptions]] as const)(
    '%s → 204 + Allow-Origin, no downstream',
    async (_n, handler) => {
      const res = await handler(new Request('https://s/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), routeFor('kar-1'))
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
      expect(recGet).not.toHaveBeenCalled()
    },
  )
})
