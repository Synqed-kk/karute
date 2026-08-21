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
  // Same tenant, ANOTHER store, another customer — the deep-link path the
  // store clamp governs (F1). Deliberately not in today's set, so it can only
  // be reached through resolveExplicitAppointmentForClient.
  if (id === 'appt-other-store') {
    return { id, staff_id: 'auth-user-1', customer_id: 'cust-2', starts_at: '2026-07-13T02:00:00Z', duration_minutes: 60, title: 'x', notes: null, created_at: '2026-07-01T00:00:00Z', status: 'CONFIRMED', source: 'MANUAL', store_id: 'store-B' }
  }
  if (id !== 'appt-today-other') throw Object.assign(new Error('nope'), { status: 404 })
  return { id, staff_id: 'auth-user-1', customer_id: 'cust-1', starts_at: '2026-07-13T02:00:00Z', duration_minutes: 60, title: 'x', notes: null, created_at: '2026-07-01T00:00:00Z', status: 'CONFIRMED', source: 'MANUAL' }
})
const CUSTOMER = { id: 'cust-1', name: '山田 花子', visit_count: 3, created_at: '2026-01-01T00:00:00Z', last_visit_at: '2026-05-01T00:00:00Z', is_existing_customer: true, notes: null }
const customersGet = jest.fn(async (id: string) => {
  if (id !== 'cust-1') throw Object.assign(new Error('cross-tenant'), { status: 404 })
  return CUSTOMER
})
// The store clamp's two reads — a viewAll caller never reaches either, so they
// exist for the clamped cases below (store-id header → tenancy check, then the
// caller's assignment).
const storesGet = jest.fn(async () => ({ id: 'store-A' }))
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const fakeClient = {
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
  appointments: { list: apptList, get: apptGet },
  karuteRecords: { list: jest.fn(async () => ({ karute_records: [{ id: 'kar-1', appointment_id: null, customer_id: 'cust-1', created_at: '2026-05-01T03:00:00Z', ai_summary: '・肩こり改善', entry_count: 2, entries: [] }] })) },
  staff: { list: jest.fn(async () => ({ staff: [{ id: 'auth-user-1', user_id: 'auth-user-1', name: '田中' }] })) },
  customers: { get: customersGet, getConsent: jest.fn(async () => ({ consent: { granted_at: '2026-05-01T00:00:00Z' } })) },
  packs: { listPacks: jest.fn(async () => []), listRedemptions: jest.fn(async () => []), getLifecycle: jest.fn(async () => null) },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))
// cust-1 has an event at store-A; cust-2 is the other branch's. The fake
// stands in for core's server-side store filter, so a dropped clamp shows up
// as the other branch's customer sitting in the record picker.
const CUST_A = { id: 'cust-1', name: '山田 花子', created_at: '2026-01-01T00:00:00Z', is_existing_customer: true, visit_count: 3, has_ticket_pack: false, karute_number: 1 }
const CUST_B = { id: 'cust-2', name: '佐藤 次郎', created_at: '2026-02-01T00:00:00Z', is_existing_customer: false, visit_count: 0, has_ticket_pack: false, karute_number: 2 }
const listAllCustomers = jest.fn(async (_client: unknown, opts?: { store_id?: string | null }) =>
  opts?.store_id === 'store-A'
    ? { customers: [CUST_A], total: 1 }
    : { customers: [CUST_A, CUST_B], total: 2 },
)
jest.mock('@/lib/customers/list-all', () => ({
  listAllCustomers: (client: unknown, opts?: { store_id?: string | null }) =>
    listAllCustomers(client, opts),
}))
jest.mock('@/lib/customers/queries', () => ({ getCustomerWithClient: jest.fn(async (_c: unknown, id: string) => { if (id !== 'cust-1') throw new Error('404'); return CUSTOMER }) }))

import { GET, OPTIONS } from '@/app/api/app/v1/screens/record/route'
import { RecordScreenDTO } from '@/lib/app-api/record-screen-dto'

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
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  listAllCustomers.mockClear()
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

  // ── picker-dialog v2 additions, both compat directions ────────────────
  // The pair-16 phone bundle carries its OWN (pre-v2) copy of this schema.
  // Neither direction may break at the next bake:
  //   forward  — an old client meets the new keys. Every DTO object here is a
  //              plain z.object (no .strict()), which STRIPS unknown keys, so
  //              the old copy parses the new payload and simply ignores them.
  //   backward — this schema meets a pre-v2 payload (a device-cached response
  //              replayed by screen-prefetch). Both new fields are optional.
  it('v2 picker fields ship, and BOTH client generations still parse', async () => {
    // With a target bound the picker is unreachable, so the whole-tenant facts
    // array is deliberately NOT built (buildRecordScreen's gate).
    const bound = await (await GET(req(), route)).json()
    expect(bound.customerFacts).toEqual([])
    expect(bound.nearbyBookings[0].customerId).toBe('cust-1')

    // No booking today → the picker IS reachable → the facts ship.
    const saved = APPTS.current
    APPTS.current = []
    const body = await (await GET(req(), route)).json()
    APPTS.current = saved

    expect(body.nextAppointment).toBeNull()
    expect(body.customerFacts[0]).toMatchObject({ id: 'cust-1' })

    // FORWARD: an old client's schema is this one minus the v2 keys. Model it
    // with an extra unknown key — non-strict objects strip, never throw.
    const forward = RecordScreenDTO.parse({
      ...bound,
      unknownFutureKey: 'from a newer server',
      nearbyBookings: bound.nearbyBookings.map((b: Record<string, unknown>) => ({
        ...b,
        unknownRowKey: 1,
      })),
    })
    expect(forward).not.toHaveProperty('unknownFutureKey')
    expect(forward.nearbyBookings[0]).not.toHaveProperty('unknownRowKey')

    // BACKWARD: a pre-v2 payload has neither field at all.
    const preV2 = { ...bound }
    delete preV2.customerFacts
    preV2.nearbyBookings = bound.nearbyBookings.map((b: Record<string, unknown>) => {
      const row = { ...b }
      delete row.customerId
      return row
    })
    const backward = RecordScreenDTO.parse(preV2)
    expect(backward.customerFacts).toBeUndefined()
    expect(backward.nearbyBookings[0].customerId).toBeUndefined()
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

  // staffCanDeletePhotos is derived from the caller's OWN Bearer-resolved
  // capability set (Liam ruling 8/9 — photo delete is the records.delete
  // tier), never a client flag. The device reads this to decide whether the
  // discard dialog shows 写真も削除 at all, so the wire value is the contract.
  it('records.delete in the set → staffCanDeletePhotos true', async () => {
    capabilities.current = new Set(['customers.view', 'stores.viewAll', 'records.delete'])
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    expect((await res.json()).staffCanDeletePhotos).toBe(true)
  })

  it('no records.delete → staffCanDeletePhotos false', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    expect((await res.json()).staffCanDeletePhotos).toBe(false)
  })

  // F1 — the explicit-appointmentId DEEP LINK is store-clamped, the Bearer twin
  // of getAppointmentById's check (actions/appointments.ts:202-209). Without it
  // a branch-restricted caller could bind ANY booking in the tenant by id, and
  // read the customer's name off the resolved row.
  it('a clamped caller cannot deep-link a booking in ANOTHER store — it behaves as not-found', async () => {
    capabilities.current = new Set(['customers.view'])
    staffStoresGet.mockResolvedValue({ store_ids: ['store-A'] })
    const res = await GET(
      req('?appointmentId=appt-other-store', { ...auth, 'store-id': 'store-A' }),
      route,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // Fell through to the default target (today's own booking) — never bound to
    // the other store's row, and cust-2's name never reaches the caller.
    expect(body.nextAppointment?.id).toBe('appt-1')
    expect(body.nextAppointment?.customerId).toBe('cust-1')
    expect(JSON.stringify(body)).not.toContain('佐藤 次郎')
  })

  it('a viewAll caller still resolves the same cross-store booking', async () => {
    const res = await GET(req('?appointmentId=appt-other-store'), route)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nextAppointment?.id).toBe('appt-other-store')
    expect(body.nextAppointment?.customerId).toBe('cust-2')
  })

  // ⚖ Liam 2026-08-17 store isolation, record-picker half. Copies the sessions
  // route's precedent: enforceStore keeps the clamp on even while searching, so
  // a branch staff's picker can never reach another store's customers.
  it('a clamped caller’s record picker carries ONLY their store’s customers', async () => {
    capabilities.current = new Set(['customers.view'])
    staffStoresGet.mockResolvedValue({ store_ids: ['store-A'] })
    const res = await GET(req('', { ...auth, 'store-id': 'store-A' }), route)
    expect(res.status).toBe(200)
    expect(listAllCustomers).toHaveBeenCalledWith(fakeClient, {
      store_id: 'store-A',
      enforceStore: true,
      sort_by: 'created_at',
      sort_order: 'asc',
    })
    const ids = (await res.json()).customers.map((c: { id: string }) => c.id)
    expect(ids).toEqual(['cust-1'])
  })

  it('a viewAll caller keeps the business-wide list, unchanged', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    expect(listAllCustomers).toHaveBeenCalledWith(fakeClient, {
      sort_by: 'created_at',
      sort_order: 'asc',
    })
    const ids = (await res.json()).customers.map((c: { id: string }) => c.id)
    expect(ids).toEqual(['cust-1', 'cust-2'])
  })

  it('OPTIONS → 204 preflight (shell-origin CORS, no auth)', async () => {
    const res = await OPTIONS(new Request('https://s/api/app/v1/screens/record', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }), route)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  })
})
