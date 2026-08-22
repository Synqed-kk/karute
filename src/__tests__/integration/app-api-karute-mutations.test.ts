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
// Recorder-lock fix (2026-08-30 packet): regenerateKaruteWithClient now
// calls staff-map's card-id→profile-id lookup on every non-null staff_id.
// Defaults to null, which `?? original` in the caller resolves back to the
// raw id — preserving every other test's existing ACL behavior (this
// suite's fixtures stamp staff_id with a profile id already). One
// dedicated case below overrides the mock per-call (mockResolvedValueOnce)
// to pin the Change-4 translation wiring itself.
jest.mock('@/lib/synqed/staff-map', () => ({
  lookupProfileIdForSynqedStaffId: jest.fn(async () => null),
  lookupProfileIdForSynqedStaffIdForBusiness: jest.fn(async () => null),
}))

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
// UUID-shaped (root-cause fix, 2026-08-29 packet): logFacadeAudit only
// stamps params.id as an audit target when it's UUID-shaped.
const REC = { current: { id: '00000000-0000-4000-8000-000000000007', created_at: '2026-06-01T03:00:00Z', transcript: 'RAW', staff_id: 'auth-user-1', customer_id: 'cust-1', entries: [{ id: 'old-1' }] } as Record<string, unknown> }
const recGet = jest.fn(async (id: string) => {
  if (id !== '00000000-0000-4000-8000-000000000007') throw Object.assign(new Error('nope'), { status: 404 })
  return REC.current
})
const addEntry = jest.fn(async () => ({ id: 'new-1' }))
const deleteEntry = jest.fn(async () => undefined)
const update = jest.fn(async () => undefined)
const custGet = jest.fn(async () => ({ name: '山田 花子' }))
const upsertOutcome = jest.fn()
const consume = jest.fn()
const recordUsage = jest.fn()
// Reads the 'revisit' eligibility guard makes. Defaults = a brand-new prospect
// with no stored outcome and no history, so a test must opt IN to eligibility.
const getOutcome = jest.fn(async (): Promise<{ outcome: string } | null> => null)
const listPacks = jest.fn(async (): Promise<Array<{ status: string; kind: string }>> => [])
const listKaruteRecords = jest.fn(
  async (): Promise<{ karute_records: Array<{ id: string; recording_session_id: string | null }> }> => ({
    karute_records: [],
  }),
)
const fakeClient = {
  karuteRecords: {
    get: (id: string) => recGet(id),
    addEntry,
    deleteEntry,
    update,
    list: listKaruteRecords,
  },
  customers: { get: custGet },
  packs: { listPacks },
  karuteOutcomes: { upsert: (arg: unknown) => upsertOutcome(arg), get: getOutcome },
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

// Plan gate (P4) — default open (billing disarmed posture); the plan-locked test flips it.
const planGate = jest.fn(async (..._args: unknown[]) => {
  void _args // typed rest keeps the 2-arg facade call signature; de2cf37 lint pattern
  return true
})
jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: (...args: unknown[]) => planGate(...args),
  featureAllowedForBusiness: (...args: unknown[]) => planGate(...args),
}))

import { POST as regenerate, OPTIONS as regenerateOptions } from '@/app/api/app/v1/karute/[id]/regenerate/route'
import { POST as outcome, OPTIONS as outcomeOptions } from '@/app/api/app/v1/karute/[id]/outcome/route'
import { lookupProfileIdForSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { auditLines } from './helpers/audit-lines'

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
  REC.current = { id: '00000000-0000-4000-8000-000000000007', created_at: '2026-06-01T03:00:00Z', transcript: 'RAW', staff_id: 'auth-user-1', customer_id: 'cust-1', entries: [{ id: 'old-1' }] }
  consume.mockResolvedValue({ allowed: true })
  planGate.mockResolvedValue(true)
  runExtract.mockResolvedValue({ result: { entries: [{ category: 'symptom', title: '肩こり', source_quote: 'q', confidence_score: 0.9 }] }, usage: { tokensIn: 10, tokensOut: 5 } })
  runSummary.mockResolvedValue({ result: { summary: '・肩こり改善傾向' }, usage: { tokensIn: 8, tokensOut: 3 } })
})

// ── regenerate ────────────────────────────────────────────────────────────────
describe('POST /karute/[id]/regenerate (Decision 2)', () => {
  it('happy path (owner): applies entries + summary → 200 {added,removed}', async () => {
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.added).toBe(1)
    expect(body.removed).toBe(1)
    expect(addEntry).toHaveBeenCalled()
    expect(deleteEntry).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000007', 'old-1')
    expect(update).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000007', { ai_summary: '・肩こり改善傾向' })
  })

  it('missing Idempotency-Key → 400, no LLM/no write', async () => {
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: auth }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(400)
    expect(runExtract).not.toHaveBeenCalled()
    expect(addEntry).not.toHaveBeenCalled()
  })

  it('ACL: a non-owner without recordings.viewAll → 403, NO LLM, NO write', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff' }
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(403)
    expect(runExtract).not.toHaveBeenCalled()
    expect(addEntry).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('ACL: a recordings.viewAll caller regenerates any staff’s record → 200', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff' }
    capabilities.current = new Set(['records.write', 'recordings.viewAll'])
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    expect(addEntry).toHaveBeenCalled()
  })

  it('recorder-lock fix: a CARD-id owner translates to the caller’s profile id → 200 (Change 4 pin)', async () => {
    REC.current = { ...REC.current, staff_id: 'card-101' }
    ;(lookupProfileIdForSynqedStaffIdForBusiness as jest.Mock).mockResolvedValueOnce('auth-user-1')
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    expect(lookupProfileIdForSynqedStaffIdForBusiness).toHaveBeenCalledWith('card-101', 'business-1')
    expect(addEntry).toHaveBeenCalled()
  })

  it('plan-locked (aiKaruteGeneration) → 403, NO quota consume, NO LLM, NO write', async () => {
    planGate.mockResolvedValue(false)
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(403)
    expect(consume).not.toHaveBeenCalled() // gated BEFORE quota burn
    expect(runExtract).not.toHaveBeenCalled()
    expect(addEntry).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    // Facade Bearer path threads the verified business id explicitly.
    expect(planGate).toHaveBeenCalledWith(expect.any(String), 'aiKaruteGeneration')
  })

  it('extract failure → NO write, old entries intact', async () => {
    runExtract.mockRejectedValueOnce(new Error('llm down'))
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    expect((await res.json()).error).toContain('No changes applied')
    expect(addEntry).not.toHaveBeenCalled()
    expect(deleteEntry).not.toHaveBeenCalled()
  })

  it('empty extraction → NO delete, old entries kept', async () => {
    runExtract.mockResolvedValueOnce({ result: { entries: [] }, usage: null })
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    expect((await res.json()).error).toContain('No entries extracted')
    expect(addEntry).not.toHaveBeenCalled()
    expect(deleteEntry).not.toHaveBeenCalled()
  })

  it('summary failure → entries STILL applied + warning', async () => {
    runSummary.mockRejectedValueOnce(new Error('summary down'))
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.added).toBe(1)
    expect(body.warning).toBeDefined()
    expect(addEntry).toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('rate-limit cap hit → 429 classified, NO LLM/no write', async () => {
    consume.mockResolvedValueOnce({ allowed: false, reason: 'daily_cost', cap: 100, costCap: 500, costUsed: 500, resetAt: 't' })
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
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
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
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
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(403)
    expect(recGet).not.toHaveBeenCalled()
  })

  it('missing Bearer → 401, no downstream', async () => {
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: { 'Idempotency-Key': 'k1' } }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(401)
    expect(recGet).not.toHaveBeenCalled()
  })

  it('revoked staffer (getUser null) → 401 via the server round-trip, no write', async () => {
    revoked.current = true
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(401)
    expect(addEntry).not.toHaveBeenCalled()
  })
})

// ── outcome ─────────────────────────────────────────────────────────────────
describe('POST /karute/[id]/outcome (§Build 3)', () => {
  it('happy path: upserts with the SERVER-derived customerId', async () => {
    const res = await outcome(jsonReq({ status: 'success', isFirstVisit: true }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    expect(upsertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ karute_record_id: '00000000-0000-4000-8000-000000000007', customer_id: 'cust-1', outcome: 'success', is_first_visit: true, decided_by: 'auth-user-1' }),
    )
  })

  it('Wave W3: a 2xx emits karute.outcome_set carrying the ROUTE-set customer_id detail (pins outcome/route.ts ctx.auditDetail, not just the seam machinery)', async () => {
    const lines = await auditLines(async () => {
      const res = await outcome(jsonReq({ status: 'success' }), routeFor('00000000-0000-4000-8000-000000000007'))
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'karute.outcome_set',
      target_type: 'karute',
      target_id: '00000000-0000-4000-8000-000000000007',
      source: 'facade',
    })
    expect(lines[0].detail).toMatchObject({ customer_id: 'cust-1' })
  })

  it('customerId is DERIVED from the record — a spoofed body customerId is rejected (strict)', async () => {
    const res = await outcome(jsonReq({ status: 'success', customerId: 'cust-EVIL' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(400)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('invalid status → validation 400, no write', async () => {
    const res = await outcome(jsonReq({ status: 'maybe' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(400)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('invalid reason → validation 400, no write', async () => {
    const res = await outcome(jsonReq({ status: 'no_deal', reason: 'nope' }), routeFor('00000000-0000-4000-8000-000000000007'))
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
    const res = await outcome(jsonReq({ status: 'success' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(403)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('revoked staffer → 401 via server round-trip, no write', async () => {
    revoked.current = true
    const res = await outcome(jsonReq({ status: 'success' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(401)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })
})

// ── OPTIONS preflight ─────────────────────────────────────────────────────────
describe('OPTIONS preflight — shell origin, no auth', () => {
  it.each([['regenerate', regenerateOptions], ['outcome', outcomeOptions]] as const)(
    '%s → 204 + Allow-Origin, no downstream',
    async (_n, handler) => {
      const res = await handler(new Request('https://s/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), routeFor('00000000-0000-4000-8000-000000000007'))
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
      expect(recGet).not.toHaveBeenCalled()
    },
  )
})

// The PUT edit path persists NOTHING before the label write — it IS the label
// write — so a rejection there is honest and stays a 400. Pinned so the facade
// SAVE route's keep-the-record fix can never leak into this route.
describe('POST /karute/[id]/outcome — an ineligible revisit is still a 400 here', () => {
  beforeEach(() => {
    getOutcome.mockResolvedValue(null)
    listPacks.mockResolvedValue([])
    listKaruteRecords.mockResolvedValue({ karute_records: [] })
    // Restored explicitly: clearAllMocks wipes calls, not implementations, so a
    // rejection set by one test would otherwise leak into the next.
    custGet.mockResolvedValue({ name: '山田 花子' })
  })

  it('first-visit prospect → 400, nothing written', async () => {
    const res = await outcome(jsonReq({ status: 'revisit' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(400)
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('UNKNOWN → a RETRYABLE upstream error, never a validation 400', async () => {
    // This route persists nothing, so an infra blip must fail honestly rather
    // than blame the client with a 4xx.
    getOutcome.mockRejectedValue(new Error('core down'))
    listPacks.mockRejectedValue(new Error('core down'))
    listKaruteRecords.mockRejectedValue(new Error('core down'))
    custGet.mockRejectedValue(new Error('core down'))
    const res = await outcome(jsonReq({ status: 'revisit' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).not.toBe(400)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('returning customer → 200 and the row is written', async () => {
    listKaruteRecords.mockResolvedValue({
      karute_records: [{ id: 'kar-old', recording_session_id: 'sess-earlier' }],
    })
    const res = await outcome(jsonReq({ status: 'revisit' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    expect(upsertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ karute_record_id: '00000000-0000-4000-8000-000000000007', outcome: 'revisit' }),
    )
  })
})

// #689 P1b — the read gate's symmetric half. The screens route hides a stored
// 'revisit' from header-absent (pre-4.7/code-13) shells, which renders 未記録
// with a live 記録 button; without this gate that button silently overwrites
// the revisit label.
describe('POST /karute/[id]/outcome — an old shell cannot overwrite a masked revisit', () => {
  const newShell = { ...auth, 'app-version': 'thin-2026-08-10' }
  beforeEach(() => {
    // Implementations survive clearAllMocks, so rejections set by the suite
    // above would otherwise leak in (same reason as that describe's reset).
    getOutcome.mockResolvedValue(null)
    listPacks.mockResolvedValue([])
    listKaruteRecords.mockResolvedValue({ karute_records: [] })
    custGet.mockResolvedValue({ name: '山田 花子' })
  })

  it('stored revisit + NO app-version → Japanese validation 400, NOTHING written', async () => {
    getOutcome.mockResolvedValue({ outcome: 'revisit' })
    const res = await outcome(jsonReq({ status: 'success' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('アプリを更新')
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('stored revisit + app-version present → the new-shell edit still writes', async () => {
    getOutcome.mockResolvedValue({ outcome: 'revisit' })
    const res = await outcome(jsonReq({ status: 'success' }, newShell), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    expect(upsertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ karute_record_id: '00000000-0000-4000-8000-000000000007', outcome: 'success' }),
    )
  })

  it('stored UNKNOWN future value + NO app-version → same rejection (allowlist, symmetric with the read gate)', async () => {
    getOutcome.mockResolvedValue({ outcome: 'foo' })
    const res = await outcome(jsonReq({ status: 'success' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('アプリを更新')
    expect(upsertOutcome).not.toHaveBeenCalled()
  })

  it('stored NON-revisit + NO app-version → old shells keep editing normally', async () => {
    getOutcome.mockResolvedValue({ outcome: 'success' })
    const res = await outcome(jsonReq({ status: 'no_deal' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    expect(upsertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ karute_record_id: '00000000-0000-4000-8000-000000000007', outcome: 'no_deal' }),
    )
  })

  it('stored-outcome read FAILS + NO app-version → fail-open, the write proceeds', async () => {
    getOutcome.mockRejectedValue(new Error('core down'))
    const res = await outcome(jsonReq({ status: 'success' }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    expect(upsertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ karute_record_id: '00000000-0000-4000-8000-000000000007', outcome: 'success' }),
    )
  })
})
