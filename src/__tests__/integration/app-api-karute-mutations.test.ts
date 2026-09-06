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
  // regenerateKarute (the cookie web wrapper) resolves the viewer via this —
  // the facade route never calls it (Bearer identity instead).
  getCurrentUserStaffId: jest.fn(async () => 'auth-user-1'),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
  // regenerateKarute-only imports (the facade route never calls these).
  requireCapability: jest.fn(async () => undefined),
  // The web wrapper resolves the caller's whole set and asks holdsOwnerKeys —
  // regenerating a COLLEAGUE's record is an ACT, so it keys on the owner's hand
  // rather than the named grant (⚖ 9/3 council; Greptile #848 point 1).
  getMyCapabilities: jest.fn(async () => capabilities.current),
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
/** The caller's store assignment — the ACT door's store half (fix round 7).
 *  Default [] = floating → unrestricted, so every pre-existing case stands. */
const staffStoresGet = jest.fn(async (_id: string) => ({ store_ids: [] as string[] }))
/** The WEB wrapper's own scope primitive. Default: unrestricted. */
const webScope = {
  current: {
    storeId: null as string | null,
    viewAll: true,
    allowedStoreIds: null as string[] | null,
    degraded: false,
  },
}
/** The web act doors call viewerScopeForActs (auth/store-scope.ts); its own
 *  fail-closed behaviour is unit-pinned in store-scope.test.ts against the real
 *  seams. Here it is the SEAM: what the door does with each answer. */
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => webScope.current),
  viewerScopeForActs: jest.fn(async () =>
    webScope.current.degraded ? [] : webScope.current.allowedStoreIds,
  ),
}))
/** The recording row behind the karute — read by the regenerate gate ONLY when
 *  the karute names no store of its own (③ fix round 4). Every pre-existing
 *  fixture leaves `recording_session_id` unset, so this mock stays untouched
 *  by them; the store-law cases below opt in. */
const REC_ROW = { current: { id: 'sess-1', store_id: null as string | null } }
const recordingsGet = jest.fn(async (_id: string) => REC_ROW.current)
const fakeClient = {
  staffStores: { get: (id: string) => staffStoresGet(id) },
  recordings: { get: (id: string) => recordingsGet(id) },
  stores: { get: jest.fn(async () => ({ id: 'store-a' })) },
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
import { regenerateKarute, regenerateKaruteEntries } from '@/actions/regenerate-karute'
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
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  REC_ROW.current = { id: 'sess-1', store_id: null }
  recordingsGet.mockImplementation(async () => REC_ROW.current)
  webScope.current = { storeId: null, viewAll: true, allowedStoreIds: null, degraded: false }
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

  // Fix round (success-only audit law): the facade hook auto-emits from
  // ctx.auditDetail/ctx.auditSuppress set by the route itself — see
  // handler.ts's FacadeContext + regenerate/route.ts.
  it('facade audit: SUCCESS → exactly ONE karute.entries_regenerate line with counts detail', async () => {
    const lines = await auditLines(async () => {
      const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'karute.entries_regenerate',
      target_type: 'karute',
      target_id: '00000000-0000-4000-8000-000000000007',
      source: 'facade',
    })
    // Exact shape (fix round F-3): detail is ids/counts only, never entry
    // text — toMatchObject would let an injected extra key (e.g. entry_title)
    // silently leak through.
    expect(lines[0].detail).toEqual({ added: 1, removed: 1 })
  })

  it('facade audit: SOFT FAILURE (no transcript, HTTP 200 {error}) → ZERO karute.entries_regenerate lines', async () => {
    REC.current = { ...REC.current, transcript: '' }
    const lines = await auditLines(async () => {
      const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
      expect(res.status).toBe(200)
      expect((await res.json()).error).toContain('No transcript')
    })
    expect(lines).toHaveLength(0)
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

  it('ACL: the OWNER’S HAND (both keys) regenerates any staff’s record → 200', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff' }
    capabilities.current = new Set(['records.write', 'business.manage', 'recordings.viewAll'])
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(200)
    expect(addEntry).toHaveBeenCalled()
  })

  // ⚖ THE NAMED GRANTEE TWIN (9/3 council; Greptile #848 point 1). Regenerating
  // REWRITES a colleague's record off the same raw transcript — an ACT, not a
  // read — so the read-only grant buys no reach here. Same 403, same silence.
  it('ACL: a NAMED GRANTEE (recordings.viewAll alone) is refused → 403, NO LLM, NO write', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff' }
    capabilities.current = new Set(['records.write', 'recordings.viewAll'])
    const res = await regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor('00000000-0000-4000-8000-000000000007'))
    expect(res.status).toBe(403)
    expect(runExtract).not.toHaveBeenCalled()
    expect(addEntry).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
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

// ── regenerateKarute (web cookie wrapper twin, lane 2026-08-30) ────────────────
// Same orchestration as the facade route above (regenerateKaruteWithClient),
// through the cookie web action instead of the Bearer route — proves the
// success-only karute.entries_regenerate auditWeb row (unproven walker ceiling,
// see AUDITED_CORES's regenerate-karute.ts entry) actually fires on success and
// never on a soft failure.
describe('regenerateKarute — web wrapper twin (lane 2026-08-30)', () => {
  it('success: exactly one karute.entries_regenerate audit line, detail = counts only', async () => {
    const lines = await auditLines(async () => {
      const result = await regenerateKarute('00000000-0000-4000-8000-000000000007')
      expect(result.error).toBeUndefined()
      expect(result.added).toBe(1)
      expect(result.removed).toBe(1)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'karute.entries_regenerate',
      target_type: 'karute',
      target_id: '00000000-0000-4000-8000-000000000007',
      source: 'web',
    })
    // Exact shape (fix round F-3): detail is ids/counts only, never entry
    // text — toMatchObject would let an injected extra key (e.g. entry_title)
    // silently leak through.
    expect(lines[0].detail).toEqual({ added: 1, removed: 1 })
  })

  // ⚖ THE NAMED GRANT REWRITES NOTHING, ON THE DESKTOP (fix round 4). The
  // FACADE half is pinned above; mutating the wrapper's own
  // `holdsOwnerKeys(capabilities)` back to `.has('recordings.viewAll')` left
  // every web-wrapper case green, because they only ever ran the caller against
  // their OWN record (blind round 2, L2 F3). The message is the AppApiError the
  // orchestration throws, mapped to `{ error }` by the wrapper's catch.
  it('a NAMED GRANTEE (recordings.viewAll alone) cannot rewrite a colleague’s record — NO LLM, NO audit line', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff' }
    capabilities.current = new Set(['records.write', 'recordings.viewAll'])
    const lines = await auditLines(async () => {
      await expect(regenerateKarute('00000000-0000-4000-8000-000000000007')).resolves.toEqual({
        error: 'You cannot regenerate a recording you are not allowed to view.',
      })
    })
    expect(runExtract).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('…while the OWNER’S HAND (both keys + unrestricted scope) rewrites the same colleague’s record', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff' }
    capabilities.current = new Set(['records.write', 'business.manage', 'recordings.viewAll'])
    const result = await regenerateKarute('00000000-0000-4000-8000-000000000007')
    expect(result.error).toBeUndefined()
    expect(runExtract).toHaveBeenCalled()
  })

  it('soft failure (extract error): No changes applied, NO audit line', async () => {
    runExtract.mockRejectedValueOnce(new Error('llm down'))
    const lines = await auditLines(async () => {
      const result = await regenerateKarute('00000000-0000-4000-8000-000000000007')
      expect(result.error).toContain('No changes applied')
    })
    expect(lines).toHaveLength(0)
  })
})

// ── regenerateKaruteEntries (bulk web wrapper twin, fix round F-2) ────────────
// Same success-only audit law as regenerateKarute above, through the standalone
// bulk-regen surface (RegenerateAllForCustomerButton → regenerateKaruteEntries,
// regenerate-karute.ts) instead of the single-karute cookie action.
describe('regenerateKaruteEntries — bulk web wrapper twin (fix round F-2)', () => {
  const NEW_ENTRY = { category: 'symptom', title: '肩こり', source_quote: 'q', confidence_score: 0.9 } as const

  it('success: exactly one karute.entries_regenerate audit line, detail = counts only', async () => {
    const lines = await auditLines(async () => {
      const result = await regenerateKaruteEntries('00000000-0000-4000-8000-000000000007', [NEW_ENTRY])
      expect(result.error).toBeUndefined()
      expect(result.added).toBe(1)
      expect(result.removed).toBe(1)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'karute.entries_regenerate',
      target_type: 'karute',
      target_id: '00000000-0000-4000-8000-000000000007',
      source: 'web',
    })
    // Exact shape (fix round F-3): detail is ids/counts only, never entry
    // text — toMatchObject would let an injected extra key silently leak
    // through.
    expect(lines[0].detail).toEqual({ added: 1, removed: 1 })
  })

  it('soft failure ({error} from regenerateKaruteEntriesWithClient, e.g. the add-loop failing): NO audit line', async () => {
    addEntry.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const result = await regenerateKaruteEntries('00000000-0000-4000-8000-000000000007', [NEW_ENTRY])
      expect(result.error).toContain('No changes applied')
    })
    expect(lines).toHaveLength(0)
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

// ── ⚖ THE OWNER'S HAND REACHES ONLY WHERE SHE CAN SEE (fix round 7) ─────────
// Greptile #848 review 2, point 2: the ACT doors now obey the same store law
// the READ doors obey. A hand-granted both-keys branch manager is the first
// person to hold the pair WITHOUT stores.viewAll — she may rewrite records in
// her own store and nowhere else. The compare lives in the shared core, so
// both transports answer one karute the same way.
describe('regenerate — the owner’s hand honours the store law', () => {
  const BOTH = ['records.write', 'business.manage', 'recordings.viewAll']
  const ID = '00000000-0000-4000-8000-000000000007'
  const colleaguesKaruteInStoreB = () => {
    REC.current = { ...REC.current, staff_id: 'other-staff', store_id: 'store-b' }
  }
  const post = () =>
    regenerate(new Request('https://s/x', { method: 'POST', headers: idem }), routeFor(ID))

  // ── FACADE ────────────────────────────────────────────────────────────────
  it('facade: both keys, CLAMPED to store-a, a store-B karute → 403, NO LLM, NO write', async () => {
    colleaguesKaruteInStoreB()
    capabilities.current = new Set(BOTH)
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    const res = await post()
    expect(res.status).toBe(403)
    expect(runExtract).not.toHaveBeenCalled()
    expect(addEntry).not.toHaveBeenCalled()
  })

  it('facade: the SAME caller on a store-A karute → 200', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff', store_id: 'store-a' }
    capabilities.current = new Set(BOTH)
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    const res = await post()
    expect(res.status).toBe(200)
    expect(addEntry).toHaveBeenCalled()
  })

  it('facade: stores.viewAll (owner / manager preset) reaches any store, and reads no assignment', async () => {
    colleaguesKaruteInStoreB()
    capabilities.current = new Set([...BOTH, 'stores.viewAll'])
    const res = await post()
    expect(res.status).toBe(200)
    expect(staffStoresGet).not.toHaveBeenCalled()
  })

  it('facade: an UNREADABLE assignment fails the reach closed → 403', async () => {
    colleaguesKaruteInStoreB()
    capabilities.current = new Set(BOTH)
    staffStoresGet.mockRejectedValue(new Error('core down'))
    expect((await post()).status).toBe(403)
  })

  // ── WEB ───────────────────────────────────────────────────────────────────
  it('web: both keys, CLAMPED to store-a, a store-B karute → refused, NO LLM', async () => {
    colleaguesKaruteInStoreB()
    capabilities.current = new Set(BOTH)
    webScope.current = { storeId: 'store-a', viewAll: false, allowedStoreIds: ['store-a'], degraded: false }
    await expect(regenerateKarute(ID)).resolves.toEqual({
      error: 'You cannot regenerate a recording you are not allowed to view.',
    })
    expect(runExtract).not.toHaveBeenCalled()
  })

  it('web: the SAME caller on a store-A karute → rewrites it', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff', store_id: 'store-a' }
    capabilities.current = new Set(BOTH)
    webScope.current = { storeId: 'store-a', viewAll: false, allowedStoreIds: ['store-a'], degraded: false }
    const result = await regenerateKarute(ID)
    expect(result.error).toBeUndefined()
    expect(runExtract).toHaveBeenCalled()
  })

  it('web: a DEGRADED scope fails the reach closed', async () => {
    colleaguesKaruteInStoreB()
    capabilities.current = new Set(BOTH)
    webScope.current = { storeId: null, viewAll: false, allowedStoreIds: null, degraded: true }
    await expect(regenerateKarute(ID)).resolves.toEqual({
      error: 'You cannot regenerate a recording you are not allowed to view.',
    })
    expect(runExtract).not.toHaveBeenCalled()
  })

  // ⚖ THE THROWN ARM IS NOT PINNABLE HERE, ON PURPOSE (fix round 9). The door
  // never sees a throw: viewerScopeForActs catches it and answers `[]`, so a
  // "thrown" case at this level would run the DEGRADED case above under another
  // name. The real arm is unit-pinned in store-scope.test.ts against the real
  // seams ("a THROWN resolve → [] , never null"), which is where M23 kills.

  // ── ⚖ AN ACT IS NEVER MORE PERMISSIVE THAN THE READ (③ fix round 4) ───────
  // Greptile's fixture at the SERVER gate: the karute names no store, its
  // recording row names store-9, the caller is a both-keys manager clamped to
  // store-a. The read doors already hide this record from her, so the act must
  // refuse it — the same value, through readDoorStoreId. The two button flags
  // are pinned at their own doors (reassign-flag-threading-web-page /
  // app-api-karute-detail-screen).
  const nullStoreKaruteWithRow = (rowStore: string | null) => {
    REC.current = { ...REC.current, staff_id: 'other-staff', store_id: null, recording_session_id: 'sess-1' }
    REC_ROW.current = { id: 'sess-1', store_id: rowStore }
  }

  it('facade: a NULL-store karute whose RECORDING names store-9 → 403 for a store-a manager', async () => {
    nullStoreKaruteWithRow('store-9')
    capabilities.current = new Set(BOTH)
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    const res = await post()
    expect(res.status).toBe(403)
    expect(runExtract).not.toHaveBeenCalled()
    expect(addEntry).not.toHaveBeenCalled()
    expect(recordingsGet).toHaveBeenCalledWith('sess-1')
  })

  // The KARUTE leads — and the row is not even read, which is the whole reason
  // the fetch is guarded: the common shape pays nothing.
  it('facade: the KARUTE still leads when it has one — store-a karute, row unread → 200', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff', store_id: 'store-a', recording_session_id: 'sess-1' }
    REC_ROW.current = { id: 'sess-1', store_id: 'store-9' }
    capabilities.current = new Set(BOTH)
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    expect((await post()).status).toBe(200)
    expect(recordingsGet).not.toHaveBeenCalled()
  })

  it('facade: BOTH null is genuinely unlabelled — 全店舗/legacy, 200', async () => {
    nullStoreKaruteWithRow(null)
    capabilities.current = new Set(BOTH)
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    expect((await post()).status).toBe(200)
  })

  // ⚖ AN UNREADABLE ROW IS CLOSED FOR A CLAMPED HAND (fix round 6, Greptile
  // #849 review 2). THIS CASE USED TO PIN THE OPPOSITE: a failed row read
  // reading as "no store" — the pre-③ answer, OPEN — held as the accepted
  // trade against refusing a 再生成 on a storage blip. It is the fail-open
  // Greptile named, and the trade was wrong at the strongest door of the
  // three: a store we could not READ is not a record with no store, and the
  // cost of closing it is a refusal that lasts exactly as long as the blip.
  it('facade: an UNREADABLE recording row REFUSES a store-a manager → 403, NO LLM', async () => {
    nullStoreKaruteWithRow('store-9')
    recordingsGet.mockRejectedValue(new Error('core down'))
    capabilities.current = new Set(BOTH)
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    expect((await post()).status).toBe(403)
    expect(runExtract).not.toHaveBeenCalled()
  })

  it('facade: …but an UNRESTRICTED hand (stores.viewAll) still rewrites it → 200', async () => {
    nullStoreKaruteWithRow('store-9')
    recordingsGet.mockRejectedValue(new Error('core down'))
    capabilities.current = new Set([...BOTH, 'stores.viewAll'])
    expect((await post()).status).toBe(200)
  })

  // The recorder passes on the own-recording branch, which never reaches the
  // store leg — a storage blip cannot cost her her own 再生成.
  it('facade: …and the RECORDER’s own record is rewritten through the same blip → 200', async () => {
    nullStoreKaruteWithRow('store-9')
    REC.current = { ...REC.current, staff_id: 'auth-user-1' }
    recordingsGet.mockRejectedValue(new Error('core down'))
    capabilities.current = new Set(['records.write'])
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    expect((await post()).status).toBe(200)
  })

  // …and a karute that NAMES a store never asks the row at all, so a throwing
  // read changes nothing. This is the guard itself, pinned against the throw
  // rather than only against a resolving row.
  it('facade: a karute WITH a store never reads the row — a throwing read changes nothing → 200', async () => {
    REC.current = { ...REC.current, staff_id: 'other-staff', store_id: 'store-a', recording_session_id: 'sess-1' }
    recordingsGet.mockRejectedValue(new Error('core down'))
    capabilities.current = new Set(BOTH)
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
    expect((await post()).status).toBe(200)
    expect(recordingsGet).not.toHaveBeenCalled()
  })

  it('web: the same NULL-store karute + store-9 row is refused there too', async () => {
    nullStoreKaruteWithRow('store-9')
    capabilities.current = new Set(BOTH)
    webScope.current = { storeId: 'store-a', viewAll: false, allowedStoreIds: ['store-a'], degraded: false }
    await expect(regenerateKarute(ID)).resolves.toEqual({
      error: 'You cannot regenerate a recording you are not allowed to view.',
    })
    expect(runExtract).not.toHaveBeenCalled()
  })

  it('the RECORDER’s own record is untouched by any of it', async () => {
    REC.current = { ...REC.current, staff_id: 'auth-user-1', store_id: 'store-b' }
    capabilities.current = new Set(['records.write'])
    webScope.current = { storeId: 'store-a', viewAll: false, allowedStoreIds: ['store-a'], degraded: false }
    const result = await regenerateKarute(ID)
    expect(result.error).toBeUndefined()
  })
})
