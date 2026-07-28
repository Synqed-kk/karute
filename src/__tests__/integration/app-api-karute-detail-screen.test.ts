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
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

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
const KAR = {
  current: {
    id: 'kar-1', created_at: '2026-06-01T03:00:00Z', ai_summary: '・肩こり改善傾向', transcript: 'RAW TRANSCRIPT TEXT',
    business_id: 'business-1', customer_id: 'cust-1', staff_id: 'other-staff',
    entries: [{ id: 'e1', category: 'SYMPTOM', content: '肩こり', original_quote: null, confidence: 0.9, is_manual: false, created_at: '2026-06-01T03:05:00Z' }],
  } as Record<string, unknown>,
}
const karuteGet = jest.fn(async (id: string) => {
  if (id === 'kar-upstream') throw Object.assign(new Error('boom'), { status: 500 })
  if (id !== 'kar-1') throw Object.assign(new Error('nope'), { status: 404 })
  return KAR.current
})
const getConsent = jest.fn(async () => ({ consent: { policy_version: 'v0' } }))
const listPhotos = jest.fn(async () => ({ photos: [{ id: 'p1', signed_url: 'https://x/p1', category: 'before', caption: null }] }))
const outcomeGet = jest.fn(async () => null)
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
  KAR.current = { id: 'kar-1', created_at: '2026-06-01T03:00:00Z', ai_summary: '・肩こり改善傾向', transcript: 'RAW TRANSCRIPT TEXT', business_id: 'business-1', customer_id: 'cust-1', staff_id: 'other-staff', entries: [{ id: 'e1', category: 'SYMPTOM', content: '肩こり', original_quote: null, confidence: 0.9, is_manual: false, created_at: '2026-06-01T03:05:00Z' }] }
  getConsent.mockResolvedValue({ consent: { policy_version: 'v0' } })
  listPhotos.mockResolvedValue({ photos: [{ id: 'p1', signed_url: 'https://x/p1', category: 'before', caption: null }] })
  outcomeGet.mockResolvedValue(null)
})

describe('GET /api/app/v1/screens/karute/[id] (packet 07 §Build 2)', () => {
  it('returns the screen DTO; folds photos; carries viewerRole', async () => {
    const res = await GET(req({ headers: auth }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.karuteId).toBe('kar-1')
    expect(dto.customerId).toBe('cust-1')
    expect(dto.header.customerName).toBe('山田 花子')
    expect(dto.header.phone).toBe('090')
    expect(dto.header.visitNumber).toBe(3)
    expect(dto.entries.length).toBe(1)
    expect(dto.photos).toEqual([{ id: 'p1', signedUrl: 'https://x/p1', category: 'before', caption: null }])
    expect(dto.viewerRole).toBe('practitioner')
    expect(dto.consentOnFile).toBe(true)
  })

  it('ACL: a non-owner viewer without recordings.viewAll → transcript:null + transcriptRestricted:true', async () => {
    const res = await GET(req({ headers: auth }), routeFor('kar-1'))
    const dto = await res.json()
    expect(dto.transcript).toBeNull()
    expect(dto.transcriptRestricted).toBe(true)
  })

  it('ACL: the recording owner sees the raw transcript', async () => {
    KAR.current = { ...KAR.current, staff_id: 'auth-user-1' }
    const res = await GET(req({ headers: auth }), routeFor('kar-1'))
    const dto = await res.json()
    expect(dto.transcript).toBe('RAW TRANSCRIPT TEXT')
    expect(dto.transcriptRestricted).toBe(false)
  })

  it('ACL: a recordings.viewAll caller sees any staff’s transcript', async () => {
    capabilities.current = new Set(['customers.view', 'recordings.viewAll'])
    const res = await GET(req({ headers: auth }), routeFor('kar-1'))
    const dto = await res.json()
    expect(dto.transcript).toBe('RAW TRANSCRIPT TEXT')
    expect(dto.transcriptRestricted).toBe(false)
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
    const res = await GET(req({ headers: { cookie: 'sb=x' } }), routeFor('kar-1'))
    expect(res.status).toBe(401)
    expect(karuteGet).not.toHaveBeenCalled()
  })

  it('missing capability → 403, before tenancy/wave', async () => {
    capabilities.current = new Set()
    const res = await GET(req({ headers: auth }), routeFor('kar-1'))
    expect(res.status).toBe(403)
    expect(karuteGet).not.toHaveBeenCalled()
  })

  it('customer read failure → 502 (page swallows to null; facade must not)', async () => {
    getCustomerWithClient.mockRejectedValueOnce(new Error('customer down'))
    const res = await GET(req({ headers: auth }), routeFor('kar-1'))
    expect(res.status).toBe(502)
  })

  it('consent read failure → 502', async () => {
    getConsent.mockRejectedValueOnce(new Error('consent down'))
    const res = await GET(req({ headers: auth }), routeFor('kar-1'))
    expect(res.status).toBe(502)
  })

  it('photos read failure stays PAGE-PARITY graceful → still 200 (empty photo card)', async () => {
    listPhotos.mockRejectedValueOnce(new Error('storage down'))
    const res = await GET(req({ headers: auth }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).photos).toEqual([])
  })

  it('outcome read failure stays null (pre-ruled exception) → still 200', async () => {
    outcomeGet.mockRejectedValueOnce(new Error('outcome down'))
    const res = await GET(req({ headers: auth }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBeNull()
  })

  it('locale=en accepted; unknown locale falls back to ja', async () => {
    const en = await GET(new Request('https://s/x?locale=en', { headers: auth }), routeFor('kar-1'))
    expect(en.status).toBe(200)
    const bad = await GET(new Request('https://s/x?locale=zz', { headers: auth }), routeFor('kar-1'))
    expect(bad.status).toBe(200)
  })

  // Wave V: the REAL route's karute.view emit, pinned end-to-end (mutation
  // lens find — the seam mechanism alone, tested in facade-audit.test.ts,
  // would not catch this route hardcoding or dropping the flag). The real
  // buildKaruteDetailScreen + real audit() run; only network is mocked.
  it('emits ONE karute.view whose transcript_shown is FALSE for an ACL-restricted viewer (transcript exists, withheld)', async () => {
    const lines = await auditLines(async () => {
      const res = await GET(req({ headers: auth }), routeFor('kar-1'))
      expect(res.status).toBe(200)
    })
    const views = lines.filter((l) => l.action === 'karute.view')
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({
      category: 'karute',
      target_type: 'karute',
      target_id: 'kar-1',
      source: 'facade',
      detail: { transcript_shown: false, customer_id: 'cust-1' },
    })
  })

  it('emits transcript_shown TRUE for the recording owner (the transcript actually shipped)', async () => {
    KAR.current = { ...KAR.current, staff_id: 'auth-user-1' }
    const lines = await auditLines(async () => {
      const res = await GET(req({ headers: auth }), routeFor('kar-1'))
      expect(res.status).toBe(200)
    })
    const views = lines.filter((l) => l.action === 'karute.view')
    expect(views).toHaveLength(1)
    expect(views[0].detail).toMatchObject({ transcript_shown: true, customer_id: 'cust-1' })
  })

  it('emits transcript_shown FALSE when the record has no transcript at all (owner viewing)', async () => {
    KAR.current = { ...KAR.current, staff_id: 'auth-user-1', transcript: null }
    const lines = await auditLines(async () => {
      const res = await GET(req({ headers: auth }), routeFor('kar-1'))
      expect(res.status).toBe(200)
    })
    const views = lines.filter((l) => l.action === 'karute.view')
    expect(views).toHaveLength(1)
    expect(views[0].detail).toMatchObject({ transcript_shown: false })
  })

  it('a customer-less karute (manual/legacy record) emits with customer_id:null — no crash, honest join input', async () => {
    KAR.current = { ...KAR.current, customer_id: null, staff_id: 'auth-user-1' }
    const lines = await auditLines(async () => {
      const res = await GET(req({ headers: auth }), routeFor('kar-1'))
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
    const res = await OPTIONS(new Request('https://s/x', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), routeFor('kar-1'))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
    expect(karuteGet).not.toHaveBeenCalled()
  })
})
