// Session-detail SCREEN facade read (packet 07 §Build 2, inventory #5 — the
// highest customer-data class: recording-privacy + AI-on-PII). Verifies the route
// contract: capability gate, KARUTE tenancy proof BEFORE the wave (404 on
// missing/cross-tenant, 502 on genuine upstream), the transcript recording-privacy
// ACL applied SERVER-side (this batch's headline), the failure contract
// (customer/consent → 502; outcome null + photos [] pre-ruled exceptions), and
// the additive DTO. The REAL buildKaruteDetailScreen runs so the ACL is exercised
// end-to-end; all network mocked; the Bearer verifier runs for real.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))
process.env.SYNQED_CORE_URL ??= 'https://synqed-core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-synqed-core-key'
// staff-map's card-id→profile-id forward lookup (recorder-lock fix) reads
// this same roster via `new SynqedClient(...).staff.list()` — mocked here
// rather than via '@/lib/synqed/client' (staff-map imports the SDK class
// directly). Default empty: existing profile-id-stamped owner rows resolve
// via the `?? original` fallback (no card-id match), unaffected.
const synqedStaffRoster = { current: [] as Array<{ id: string; user_id: string | null; email: string | null }> }
// FIX ROUND 2 (post-Greptile P1): models a roster-fetch/core-outage failure
// so the staff-map forward lookup's fail-open contract can be pinned here.
const synqedStaffRosterRejects = { current: false }
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({
    staff: {
      list: async () => {
        if (synqedStaffRosterRejects.current) throw new Error('roster fetch failed')
        return { staff: synqedStaffRoster.current }
      },
    },
  })),
  SynqedError: class extends Error {},
}))

const capabilities = { current: new Set<string>(['customers.view']) }
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

// Raw synqed karute record. staff_id drives the recording-privacy ACL.
// recording_session_id: 'sess-1' on both the karute and the default photo
// fixture — packet PR 9a §③, the karute-scoped photo display. Matching by
// default keeps the pre-existing fixtures representing the common
// post-9b-camera-row case (session stamped, photo folds into the DTO); the
// mismatched/null cases get their own dedicated tests below.
const KAR = {
  current: {
    id: '00000000-0000-4000-8000-000000000008', created_at: '2026-06-01T03:00:00Z', ai_summary: '・肩こり改善傾向', transcript: 'RAW TRANSCRIPT TEXT',
    business_id: 'business-1', customer_id: 'cust-1', staff_id: 'other-staff', recording_session_id: 'sess-1',
    entries: [{ id: 'e1', category: 'SYMPTOM', content: '肩こり', original_quote: null, confidence: 0.9, is_manual: false, created_at: '2026-06-01T03:05:00Z' }],
  } as Record<string, unknown>,
}
// UUID-shaped (root-cause fix, 2026-08-29 packet): logFacadeAudit only
// stamps params.id as an audit target when it's UUID-shaped.
const karuteGet = jest.fn(async (id: string) => {
  if (id === 'kar-upstream') throw Object.assign(new Error('boom'), { status: 500 })
  if (id !== '00000000-0000-4000-8000-000000000008') throw Object.assign(new Error('nope'), { status: 404 })
  return KAR.current
})
const getConsent = jest.fn(async () => ({ consent: { policy_version: 'v0' } }))
const listPhotos = jest.fn(async () => ({ photos: [{ id: 'p1', signed_url: 'https://x/p1', category: 'before', caption: null, recording_session_id: 'sess-1' as string | null }] }))
// Return type spelled out (not inferred from the null default) so the #689
// version-gate tests below can resolve a real outcome row through this mock.
type OutcomeRow = { outcome: string; reason: string | null; is_first_visit: boolean; decided_at: string | null; auto_decided: boolean }
const outcomeGet = jest.fn(async (): Promise<OutcomeRow | null> => null)
const fakeClient = {
  karuteRecords: { get: (id: string) => karuteGet(id) },
  customers: { getConsent, listPhotos },
  karuteOutcomes: { get: outcomeGet },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

const CUSTOMER = { id: 'cust-1', name: '山田 花子', phone: '090', email: 'h@example.com', date_of_birth: '1990-01-01', gender: 'female', visit_count: 3, last_visit_at: '2026-05-01T00:00:00Z' }
const getCustomerWithClient = jest.fn(async (_c: unknown, id: string) => {
  if (id !== 'cust-1') throw new Error('404 cross-tenant')
  return CUSTOMER
})
jest.mock('@/lib/customers/queries', () => ({ getCustomerWithClient: (c: unknown, id: string) => getCustomerWithClient(c, id) }))
jest.mock('@/lib/customers/list-all', () => ({ listAllCustomers: jest.fn(async () => ({ customers: [{ id: 'cust-1', name: '山田 花子' }], total: 1 })) }))

import { GET, OPTIONS } from '@/app/api/app/v1/screens/karute/[id]/route'
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
const routeFor = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (init: RequestInit = {}) => new Request('https://s/api/app/v1/screens/karute/x', init)

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  roster.current = [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]
  synqedStaffRoster.current = []
  synqedStaffRosterRejects.current = false
  KAR.current = { id: '00000000-0000-4000-8000-000000000008', created_at: '2026-06-01T03:00:00Z', ai_summary: '・肩こり改善傾向', transcript: 'RAW TRANSCRIPT TEXT', business_id: 'business-1', customer_id: 'cust-1', staff_id: 'other-staff', recording_session_id: 'sess-1', entries: [{ id: 'e1', category: 'SYMPTOM', content: '肩こり', original_quote: null, confidence: 0.9, is_manual: false, created_at: '2026-06-01T03:05:00Z' }] }
  getConsent.mockResolvedValue({ consent: { policy_version: 'v0' } })
  listPhotos.mockResolvedValue({ photos: [{ id: 'p1', signed_url: 'https://x/p1', category: 'before', caption: null, recording_session_id: 'sess-1' }] })
  outcomeGet.mockResolvedValue(null)
})

describe('GET /api/app/v1/screens/karute/[id] (packet 07 §Build 2)', () => {
  it('returns the screen DTO; folds photos; carries viewerRole', async () => {
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.karuteId).toBe('00000000-0000-4000-8000-000000000008')
    expect(dto.customerId).toBe('cust-1')
    expect(dto.header.customerName).toBe('山田 花子')
    expect(dto.header.phone).toBe('090')
    expect(dto.header.visitNumber).toBe(3)
    expect(dto.entries.length).toBe(1)
    expect(dto.photos).toEqual([{ id: 'p1', signedUrl: 'https://x/p1', category: 'before', caption: null }])
    expect(dto.viewerRole).toBe('practitioner')
    expect(dto.consentOnFile).toBe(true)
  })

  // F4 pin 8 (facade half) — staffCanReassignRecords tracks the
  // records.reassign capability exactly, twin of the web-page test in
  // reassign-flag-threading.test.ts.
  it('F4: staffCanReassignRecords is false without records.reassign', async () => {
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    const dto = await res.json()
    expect(dto.staffCanReassignRecords).toBe(false)
  })

  it('F4: staffCanReassignRecords is true when the caller holds records.reassign', async () => {
    capabilities.current = new Set(['customers.view', 'records.reassign'])
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    const dto = await res.json()
    expect(dto.staffCanReassignRecords).toBe(true)
  })

  it('ACL: a non-owner viewer without recordings.viewAll → transcript:null + transcriptRestricted:true', async () => {
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    const dto = await res.json()
    expect(dto.transcript).toBeNull()
    expect(dto.transcriptRestricted).toBe(true)
  })

  it('ACL: the recording owner sees the raw transcript', async () => {
    KAR.current = { ...KAR.current, staff_id: 'auth-user-1' }
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    const dto = await res.json()
    expect(dto.transcript).toBe('RAW TRANSCRIPT TEXT')
    expect(dto.transcriptRestricted).toBe(false)
  })

  it('ACL: a recordings.viewAll caller sees any staff’s transcript', async () => {
    capabilities.current = new Set(['customers.view', 'recordings.viewAll'])
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    const dto = await res.json()
    expect(dto.transcript).toBe('RAW TRANSCRIPT TEXT')
    expect(dto.transcriptRestricted).toBe(false)
  })

  // Recorder-lock fix (⚖ Liam 8/22, packet 2026-08-30): the karute's staff_id
  // sometimes carries a synqed-core staff CARD id (whose user_id holds the
  // recorder's auth uid) instead of the profile id. This is the bug's exact
  // shape — without the card→profile translation the recorder was locked
  // out of her OWN transcript.
  it('ACL: a card-id-stamped owner row resolves via staff-map — the recorder (card user_id) sees her own raw transcript', async () => {
    synqedStaffRoster.current = [{ id: 'card-101', user_id: 'auth-user-1', email: null }]
    KAR.current = { ...KAR.current, staff_id: 'card-101' }
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    const dto = await res.json()
    expect(dto.transcript).toBe('RAW TRANSCRIPT TEXT')
    expect(dto.transcriptRestricted).toBe(false)
  })

  // Three-way access pin (⚖ Liam 8/22, verbatim packet requirement) — with a
  // CARD-ID-stamped owner row, all three ACL outcomes hold simultaneously:
  // viewAll sees everyone's, the card's own user_id sees her own, and any
  // other staff without viewAll sees none.
  describe('ACL: card-id-stamped owner — three-way access pin', () => {
    beforeEach(() => {
      synqedStaffRoster.current = [{ id: 'card-101', user_id: 'auth-user-1', email: null }]
      KAR.current = { ...KAR.current, staff_id: 'card-101' }
      roster.current = [
        { id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' },
        { id: 'auth-manager', full_name: '店長', display_role: 'manager' },
        { id: 'auth-user-2', full_name: '鈴木', display_role: 'practitioner' },
      ]
    })

    it('owner/viewAll viewer sees ALL transcripts (viewAll branch untouched)', async () => {
      capabilities.current = new Set(['customers.view', 'recordings.viewAll'])
      const headers = { authorization: `Bearer ${bearer('auth-manager')}` }
      const res = await GET(req({ headers }), routeFor('00000000-0000-4000-8000-000000000008'))
      const dto = await res.json()
      expect(dto.transcript).toBe('RAW TRANSCRIPT TEXT')
      expect(dto.transcriptRestricted).toBe(false)
    })

    it('the recorder (the card’s user_id) sees her OWN transcript', async () => {
      const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
      const dto = await res.json()
      expect(dto.transcript).toBe('RAW TRANSCRIPT TEXT')
      expect(dto.transcriptRestricted).toBe(false)
    })

    it('any other staff without viewAll sees NONE (transcript null + transcriptRestricted true)', async () => {
      const headers = { authorization: `Bearer ${bearer('auth-user-2')}` }
      const res = await GET(req({ headers }), routeFor('00000000-0000-4000-8000-000000000008'))
      const dto = await res.json()
      expect(dto.transcript).toBeNull()
      expect(dto.transcriptRestricted).toBe(true)
    })
  })

  // Fail-open (FIX ROUND 2, post-Greptile P1): the forward lookup runs
  // BEFORE the owner/viewAll checks, so a roster-fetch/core outage must
  // never break a read path that never needed the translation.
  describe('ACL: staff-map roster fetch failure — fail-open', () => {
    it('profile-id-stamped owner still sees her own raw transcript (translation never needed)', async () => {
      synqedStaffRosterRejects.current = true
      KAR.current = { ...KAR.current, staff_id: 'auth-user-1' }
      const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
      expect(res.status).toBe(200)
      const dto = await res.json()
      expect(dto.transcript).toBe('RAW TRANSCRIPT TEXT')
      expect(dto.transcriptRestricted).toBe(false)
    })

    it('card-id-stamped owner row + viewAll viewer still sees the transcript (viewAll never needed the translation)', async () => {
      synqedStaffRosterRejects.current = true
      KAR.current = { ...KAR.current, staff_id: 'card-101' }
      capabilities.current = new Set(['customers.view', 'recordings.viewAll'])
      const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
      expect(res.status).toBe(200)
      const dto = await res.json()
      expect(dto.transcript).toBe('RAW TRANSCRIPT TEXT')
      expect(dto.transcriptRestricted).toBe(false)
    })
  })

  it('cross-tenant / missing karute id → 404, BEFORE any wave read', async () => {
    const res = await GET(req({ headers: auth }), routeFor('kar-OTHER'))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('not_found')
    expect(getCustomerWithClient).not.toHaveBeenCalled()
    expect(listPhotos).not.toHaveBeenCalled()
  })

  it('genuine karute upstream failure (non-404) → 502, never a false 404', async () => {
    const res = await GET(req({ headers: auth }), routeFor('kar-upstream'))
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })

  it('missing Bearer (cookie present) → 401, no downstream call', async () => {
    const res = await GET(req({ headers: { cookie: 'sb=x' } }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(401)
    expect(karuteGet).not.toHaveBeenCalled()
  })

  it('missing capability → 403, before tenancy/wave', async () => {
    capabilities.current = new Set()
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(403)
    expect(karuteGet).not.toHaveBeenCalled()
  })

  it('customer read failure → 502 (page swallows to null; facade must not)', async () => {
    getCustomerWithClient.mockRejectedValueOnce(new Error('customer down'))
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(502)
  })

  it('consent read failure → 502', async () => {
    getConsent.mockRejectedValueOnce(new Error('consent down'))
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(502)
  })

  it('photos read failure stays PAGE-PARITY graceful → still 200 (empty photo card)', async () => {
    listPhotos.mockRejectedValueOnce(new Error('storage down'))
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    expect((await res.json()).photos).toEqual([])
  })

  // packet 2026-08-09 PR 9a §③ follow-up — the DEVICE screen leaked the
  // customer's whole photo gallery onto every karute; scopeKarutePhotos now
  // gates it here too (shared with the web page's PhotoRecordsServer).
  it('a mismatched-session photo does NOT reach the DTO', async () => {
    listPhotos.mockResolvedValueOnce({ photos: [{ id: 'p-other', signed_url: 'https://x/other', category: 'after', caption: null, recording_session_id: 'sess-OTHER' }] })
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    expect((await res.json()).photos).toEqual([])
  })

  it('a matching-session photo DOES reach the DTO', async () => {
    listPhotos.mockResolvedValueOnce({ photos: [{ id: 'p1', signed_url: 'https://x/p1', category: 'before', caption: null, recording_session_id: 'sess-1' }] })
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    expect((await res.json()).photos).toEqual([{ id: 'p1', signedUrl: 'https://x/p1', category: 'before', caption: null }])
  })

  it('karute with no recording_session_id → zero photos even when unstamped photos exist (null rule)', async () => {
    KAR.current = { ...KAR.current, recording_session_id: null }
    listPhotos.mockResolvedValueOnce({ photos: [{ id: 'p1', signed_url: 'https://x/p1', category: 'before', caption: null, recording_session_id: null }] })
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    expect((await res.json()).photos).toEqual([])
  })

  it('outcome read failure stays null (pre-ruled exception) → still 200', async () => {
    outcomeGet.mockRejectedValueOnce(new Error('outcome down'))
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBeNull()
  })

  // #689 P1 — the merge→shell-update window. Shells baked before 4.7/code-13
  // parse the outcome with a strict enum that has no 'revisit'; serving one
  // bricks their whole detail screen, so the route withholds it from any
  // client that does not send the revisit-aware bundle's app-version marker.
  const REVISIT = { outcome: 'revisit', reason: null, is_first_visit: false, decided_at: '2026-08-10T01:00:00Z', auto_decided: false }

  it('revisit outcome + NO app-version (old baked shell) → outcome null, rest of the screen intact', async () => {
    outcomeGet.mockResolvedValue(REVISIT)
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.outcome).toBeNull()
    expect(dto.karuteId).toBe('00000000-0000-4000-8000-000000000008')
    expect(dto.entries.length).toBe(1)
  })

  it('revisit outcome + app-version present (revisit-aware bundle) → the full outcome is served', async () => {
    outcomeGet.mockResolvedValue(REVISIT)
    const res = await GET(req({ headers: { ...auth, 'app-version': 'thin-2026-08-10' } }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toMatchObject({ outcome: 'revisit', is_first_visit: false, auto_decided: false })
  })

  it('a NON-revisit outcome passes through untouched with no app-version', async () => {
    outcomeGet.mockResolvedValue({ ...REVISIT, outcome: 'success' })
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toMatchObject({ outcome: 'success' })
  })

  // #689 P1b — the gate is an ALLOWLIST of the frozen baked enum, not a
  // 'revisit' denylist: a value invented after those shells were baked breaks
  // them exactly the same way, so it must mask too.
  it('an unknown future outcome value + NO app-version → masked (allowlist)', async () => {
    outcomeGet.mockResolvedValue({ ...REVISIT, outcome: 'foo' })
    const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBeNull()
  })

  it('an unknown future outcome value + app-version present → served', async () => {
    outcomeGet.mockResolvedValue({ ...REVISIT, outcome: 'foo' })
    const res = await GET(req({ headers: { ...auth, 'app-version': 'thin-2026-08-10' } }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toMatchObject({ outcome: 'foo' })
  })

  // The gate-removal metric: this key going quiet is how we learn the fielded
  // population has taken the 4.7/code-13 bake.
  it('a masked read emits outcome_masked on karute.view; an unmasked one does not', async () => {
    outcomeGet.mockResolvedValue(REVISIT)
    const masked = await auditLines(async () => {
      expect((await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))).status).toBe(200)
    })
    expect(masked.filter((l) => l.action === 'karute.view')[0].detail).toMatchObject({
      outcome_masked: true,
      customer_id: 'cust-1',
    })

    const served = await auditLines(async () => {
      const res = await GET(req({ headers: { ...auth, 'app-version': 'thin-2026-08-10' } }), routeFor('00000000-0000-4000-8000-000000000008'))
      expect(res.status).toBe(200)
    })
    expect(served.filter((l) => l.action === 'karute.view')[0].detail).not.toHaveProperty('outcome_masked')
  })

  it('locale=en accepted; unknown locale falls back to ja', async () => {
    const en = await GET(new Request('https://s/x?locale=en', { headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(en.status).toBe(200)
    const bad = await GET(new Request('https://s/x?locale=zz', { headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(bad.status).toBe(200)
  })

  // Wave V: the REAL route's karute.view emit, pinned end-to-end (mutation
  // lens find — the seam mechanism alone, tested in facade-audit.test.ts,
  // would not catch this route hardcoding or dropping the flag). The real
  // buildKaruteDetailScreen + real audit() run; only network is mocked.
  it('emits ONE karute.view whose transcript_shown is FALSE for an ACL-restricted viewer (transcript exists, withheld)', async () => {
    const lines = await auditLines(async () => {
      const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
      expect(res.status).toBe(200)
    })
    const views = lines.filter((l) => l.action === 'karute.view')
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({
      category: 'karute',
      target_type: 'karute',
      target_id: '00000000-0000-4000-8000-000000000008',
      source: 'facade',
      detail: { transcript_shown: false, customer_id: 'cust-1' },
    })
  })

  it('emits transcript_shown TRUE for the recording owner (the transcript actually shipped)', async () => {
    KAR.current = { ...KAR.current, staff_id: 'auth-user-1' }
    const lines = await auditLines(async () => {
      const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
      expect(res.status).toBe(200)
    })
    const views = lines.filter((l) => l.action === 'karute.view')
    expect(views).toHaveLength(1)
    expect(views[0].detail).toMatchObject({ transcript_shown: true, customer_id: 'cust-1' })
  })

  it('emits transcript_shown FALSE when the record has no transcript at all (owner viewing)', async () => {
    KAR.current = { ...KAR.current, staff_id: 'auth-user-1', transcript: null }
    const lines = await auditLines(async () => {
      const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
      expect(res.status).toBe(200)
    })
    const views = lines.filter((l) => l.action === 'karute.view')
    expect(views).toHaveLength(1)
    expect(views[0].detail).toMatchObject({ transcript_shown: false })
  })

  it('a customer-less karute (manual/legacy record) emits with customer_id:null — no crash, honest join input', async () => {
    KAR.current = { ...KAR.current, customer_id: null, staff_id: 'auth-user-1' }
    const lines = await auditLines(async () => {
      const res = await GET(req({ headers: auth }), routeFor('00000000-0000-4000-8000-000000000008'))
      expect(res.status).toBe(200)
    })
    const views = lines.filter((l) => l.action === 'karute.view')
    expect(views).toHaveLength(1)
    expect(views[0].detail).toMatchObject({ transcript_shown: true, customer_id: null })
  })

  it('a 404 open emits NO karute.view — a missing record is not a view (7/17 ruling, facade side)', async () => {
    const lines = await auditLines(async () => {
      const res = await GET(req({ headers: auth }), routeFor('kar-nope'))
      expect(res.status).toBe(404)
    })
    expect(lines.filter((l) => l.action === 'karute.view')).toHaveLength(0)
  })

  it('OPTIONS shell-origin preflight → 204 + Allow-Origin, no downstream', async () => {
    const res = await OPTIONS(new Request('https://s/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), routeFor('00000000-0000-4000-8000-000000000008'))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
    expect(karuteGet).not.toHaveBeenCalled()
  })
})
