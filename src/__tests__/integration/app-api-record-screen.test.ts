// Record-home SCREEN facade read (packet 08 §Build 2, inventory #6 — the
// recording flow). Verifies: capability gate, the store clamp, the target-
// resolution contract (explicit appointmentId/customerId cross-tenant →
// not_found; walk-in resolution), the §Build 2 failure contract (wave-1 upstream
// → 502; wave-2 named grace reads keep page parity), the RECORDING-PRIVACY
// invariant (recentRecordings carries NO transcript), and the additive DTO. The
// REAL buildRecordScreen runs; all network mocked; the Bearer verifier runs.
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

const capabilities = { current: new Set<string>(['customers.view', 'stores.viewAll']) }
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
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: jest.fn(async () => ({ ticket_packs_enabled: true, noise_suppression: true, pack_presets: [], staff_can_customize_packs: true })),
}))

// synqed client — appointments/karute/staff/customers/packs.
const APPTS = {
  current: [
    { id: 'appt-1', staff_id: 'auth-user-1', customer_id: 'cust-1', starts_at: '2026-07-14T02:00:00Z', duration_minutes: 60, title: 'cut', notes: null, created_at: '2026-07-01T00:00:00Z', status: 'CONFIRMED', source: 'MANUAL' },
  ] as Array<Record<string, unknown>>,
}
const upstream = { appts: false }
const apptList = jest.fn(async () => {
  if (upstream.appts) throw Object.assign(new Error('boom'), { status: 500 })
  return { appointments: APPTS.current }
})
const apptGet = jest.fn(async (id: string) => {
  if (id !== 'appt-today-other') throw Object.assign(new Error('nope'), { status: 404 })
  return { id, staff_id: 'auth-user-1', customer_id: 'cust-1', starts_at: '2026-07-13T02:00:00Z', duration_minutes: 60, title: 'x', notes: null, created_at: '2026-07-01T00:00:00Z', status: 'CONFIRMED', source: 'MANUAL' }
})
const CUSTOMER = { id: 'cust-1', name: '山田 花子', visit_count: 3, created_at: '2026-01-01T00:00:00Z', last_visit_at: '2026-05-01T00:00:00Z', is_existing_customer: true, notes: null }
const customersGet = jest.fn(async (id: string) => {
  if (id !== 'cust-1') throw Object.assign(new Error('cross-tenant'), { status: 404 })
  return CUSTOMER
})
const fakeClient = {
  appointments: { list: apptList, get: apptGet },
  karuteRecords: { list: jest.fn(async () => ({ karute_records: [{ id: 'kar-1', appointment_id: null, customer_id: 'cust-1', created_at: '2026-05-01T03:00:00Z', ai_summary: '・肩こり改善', entry_count: 2, entries: [] }] })) },
  staff: { list: jest.fn(async () => ({ staff: [{ id: 'auth-user-1', user_id: 'auth-user-1', name: '田中' }] })) },
  customers: { get: customersGet, getConsent: jest.fn(async () => ({ consent: { granted_at: '2026-05-01T00:00:00Z' } })) },
  packs: { listPacks: jest.fn(async () => []), listRedemptions: jest.fn(async () => []), getLifecycle: jest.fn(async () => null) },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))
jest.mock('@/lib/customers/list-all', () => ({ listAllCustomers: jest.fn(async () => ({ customers: [{ id: 'cust-1', name: '山田 花子', created_at: '2026-01-01T00:00:00Z', is_existing_customer: true, visit_count: 3, has_ticket_pack: false, karute_number: 1 }], total: 1 })) }))
jest.mock('@/lib/customers/queries', () => ({ getCustomerWithClient: jest.fn(async (_c: unknown, id: string) => { if (id !== 'cust-1') throw new Error('404'); return CUSTOMER }) }))

import { GET, OPTIONS } from '@/app/api/app/v1/screens/record/route'

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
const route = { params: Promise.resolve({}) }
const req = (path = '', headers: Record<string, string> = auth) =>
  new Request(`https://s/api/app/v1/screens/record${path}`, { headers })

beforeEach(() => {
  capabilities.current = new Set(['customers.view', 'stores.viewAll'])
  upstream.appts = false
})

describe('GET /api/app/v1/screens/record', () => {
  it('happy path → 200 DTO; recentRecordings carry NO transcript field', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nextAppointment?.customerId).toBe('cust-1')
    expect(body.viewerRole).toBe('practitioner')
    expect(Array.isArray(body.recentRecordings)).toBe(true)
    for (const r of body.recentRecordings) {
      expect(r).not.toHaveProperty('transcript')
    }
  })

  it('missing Bearer → 401', async () => {
    const res = await GET(req('', {}), route)
    expect(res.status).toBe(401)
  })

  it('missing capability → 403', async () => {
    capabilities.current = new Set(['bookings.manage'])
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
  })

  it('cross-tenant explicit appointmentId → not_found (404)', async () => {
    const res = await GET(req('?appointmentId=appt-cross'), route)
    expect(res.status).toBe(404)
  })

  it('cross-tenant explicit customerId (walk-in) → not_found (404)', async () => {
    const res = await GET(req('?customerId=cust-cross'), route)
    expect(res.status).toBe(404)
  })

  it('wave-1 upstream failure → 502 (never a false empty-200)', async () => {
    upstream.appts = true
    const res = await GET(req(), route)
    expect(res.status).toBe(502)
  })

  it('wave-2 consent read failure keeps page parity (200, consentDate null)', async () => {
    fakeClient.customers.getConsent.mockImplementationOnce(async () => { throw new Error('consent down') })
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.consentDate).toBeNull()
  })

  it('OPTIONS → 204 preflight (shell-origin CORS, no auth)', async () => {
    const res = await OPTIONS(new Request('https://s/api/app/v1/screens/record', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), route)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  })
})
