// Dashboard pack mutation facade routes (design-parity Gap B-1 PR 2): dismiss
// visit-reconcile / dismiss pack-alert / log customer-contact. Pins: baseline
// capability 403s with no write · dismiss-alert's alerts.manage manager gate
// 403s with no write · strict input schemas → 400 · NO Idempotency-Key
// required (none of these three are redeem-class — see the routes' own
// comments) · RPC-style passthrough (the action's { ok, error? } rides the
// 200 body VERBATIM, incl. the tolerant 'no staff identity' business outcome)
// · the PATH customer id is what reaches the write, never a body-supplied one.
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
  }),
}))
// @synqed-kk/client is ESM (jest node20 can't parse it) and rides in via
// customer-facade → customers/queries — mock both at the seam (same fix
// app-api-appointments-mutations.test.ts uses).
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))
jest.mock('@/lib/customers/queries', () => ({
  getCustomerWithClient: jest.fn(async () => ({ id: 'cust-1' })),
}))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [
    { id: 'auth-user-1', full_name: 'Viewer' },
  ]),
}))
const mockCapabilities = jest.fn(async () => new Set(['customers.view', 'alerts.manage']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

const addVisitDismissal = jest.fn(async () => ({ ok: true }))
const addAlertDismissal = jest.fn(async () => ({ ok: true }))
const addContact = jest.fn(async () => ({ ok: true }))
const fakeClient = {
  packs: { addVisitDismissal, addAlertDismissal, addContact },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
}))

import { POST as reconcileDismissPOST } from '@/app/api/app/v1/customers/[id]/packs/reconcile/dismiss/route'
import { POST as alertDismissPOST } from '@/app/api/app/v1/customers/[id]/packs/alerts/dismiss/route'
import { POST as contactPOST } from '@/app/api/app/v1/customers/[id]/packs/contact/route'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    sub: 'auth-user-1',
    iss: ISSUER,
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
  })
  const sig = createHmac('sha256', SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}` }
const json = { 'content-type': 'application/json' }
// Deliberately NO idempotency-key header — pins that none of these three
// routes require one.
const post = (url: string, body: unknown | undefined, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { ...auth, ...json, ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view', 'alerts.manage']))
  addVisitDismissal.mockResolvedValue({ ok: true })
  addAlertDismissal.mockResolvedValue({ ok: true })
  addContact.mockResolvedValue({ ok: true })
})

describe('POST /api/app/v1/customers/[id]/packs/reconcile/dismiss', () => {
  const URL_ = 'https://s/api/app/v1/customers/cust-1/packs/reconcile/dismiss'

  it('missing capability → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await reconcileDismissPOST(post(URL_, { visitDay: '2026-07-20' }), params('cust-1'))
    expect(res.status).toBe(403)
    expect(addVisitDismissal).not.toHaveBeenCalled()
  })

  it('malformed visitDay → 400 (strict schema), no write', async () => {
    const res = await reconcileDismissPOST(post(URL_, { visitDay: 'tomorrow' }), params('cust-1'))
    expect(res.status).toBe(400)
    expect(addVisitDismissal).not.toHaveBeenCalled()
  })

  it('unknown field → 400 (strict schema), no write', async () => {
    const res = await reconcileDismissPOST(
      post(URL_, { visitDay: '2026-07-20', extra: 'nope' }),
      params('cust-1'),
    )
    expect(res.status).toBe(400)
    expect(addVisitDismissal).not.toHaveBeenCalled()
  })

  it('happy path (no idempotency key sent) → 200 { ok: true }; PATH id reaches the write', async () => {
    const res = await reconcileDismissPOST(
      post(URL_, { visitDay: '2026-07-20', appointmentId: 'appt-9' }),
      params('cust-1'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(addVisitDismissal).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 'cust-1', visit_day: '2026-07-20', appointment_id: 'appt-9' }),
    )
  })

  it('a body-supplied customerId is IGNORED — the path id wins', async () => {
    const res = await reconcileDismissPOST(
      post(URL_, { visitDay: '2026-07-20', customerId: 'someone-else' }),
      params('cust-1'),
    )
    // customerId isn't in the schema → .strict() rejects the unknown field.
    expect(res.status).toBe(400)
  })

  it('a write failure rides the { ok: false } body verbatim, not a 502', async () => {
    addVisitDismissal.mockRejectedValueOnce(new Error('core down'))
    const res = await reconcileDismissPOST(post(URL_, { visitDay: '2026-07-20' }), params('cust-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
  })
})

describe('POST /api/app/v1/customers/[id]/packs/alerts/dismiss', () => {
  const URL_ = 'https://s/api/app/v1/customers/cust-1/packs/alerts/dismiss'

  it('missing alerts.manage capability → 403, no write (manager gate)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    const res = await alertDismissPOST(post(URL_, {}), params('cust-1'))
    expect(res.status).toBe(403)
    expect(addAlertDismissal).not.toHaveBeenCalled()
  })

  it('happy path, no body → 200 { ok: true }', async () => {
    const res = await alertDismissPOST(post(URL_, undefined), params('cust-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(addAlertDismissal).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 'cust-1', dismissed_by: 'auth-user-1' }),
    )
  })

  it('unlinked staff identity → 200 { ok: false, error: "no staff identity" } (RPC passthrough)', async () => {
    const { staffListByBusinessOrThrow } = jest.requireMock('@/lib/staff') as {
      staffListByBusinessOrThrow: jest.Mock
    }
    staffListByBusinessOrThrow.mockResolvedValueOnce([]) // viewer has no roster row
    const res = await alertDismissPOST(post(URL_, {}), params('cust-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, error: 'no staff identity' })
    expect(addAlertDismissal).not.toHaveBeenCalled()
  })

  it('unknown field → 400 (strict schema)', async () => {
    const res = await alertDismissPOST(post(URL_, { bogus: true }), params('cust-1'))
    expect(res.status).toBe(400)
  })

  it('a body-supplied customerId is IGNORED — .strict() rejects the unknown field', async () => {
    const res = await alertDismissPOST(
      post(URL_, { customerId: 'someone-else' }),
      params('cust-1'),
    )
    expect(res.status).toBe(400)
    expect(addAlertDismissal).not.toHaveBeenCalled()
  })
})

describe('POST /api/app/v1/customers/[id]/packs/contact', () => {
  const URL_ = 'https://s/api/app/v1/customers/cust-1/packs/contact'

  it('missing capability → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await contactPOST(post(URL_, { channel: 'phone' }), params('cust-1'))
    expect(res.status).toBe(403)
    expect(addContact).not.toHaveBeenCalled()
  })

  it('bad channel → 400 (schema enum), no write', async () => {
    const res = await contactPOST(post(URL_, { channel: 'carrier_pigeon' }), params('cust-1'))
    expect(res.status).toBe(400)
    expect(addContact).not.toHaveBeenCalled()
  })

  it('happy path → 200 { ok: true }', async () => {
    const res = await contactPOST(
      post(URL_, { channel: 'line', note: '  再来店の相談  ' }),
      params('cust-1'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(addContact).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'cust-1',
        channel: 'line',
        note: '再来店の相談',
        contacted_by: 'auth-user-1',
      }),
    )
  })

  it('no capability gate beyond baseline — ANY staff may log a contact', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    const res = await contactPOST(post(URL_, { channel: 'sms' }), params('cust-1'))
    expect(res.status).toBe(200)
  })

  it('unlinked staff identity → 200 { ok: false, error: "no staff identity" } (RPC passthrough)', async () => {
    const { staffListByBusinessOrThrow } = jest.requireMock('@/lib/staff') as {
      staffListByBusinessOrThrow: jest.Mock
    }
    staffListByBusinessOrThrow.mockResolvedValueOnce([]) // viewer has no roster row
    const res = await contactPOST(post(URL_, { channel: 'phone' }), params('cust-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, error: 'no staff identity' })
    expect(addContact).not.toHaveBeenCalled()
  })

  it('a body-supplied customerId is IGNORED — .strict() rejects the unknown field', async () => {
    const res = await contactPOST(
      post(URL_, { channel: 'phone', customerId: 'someone-else' }),
      params('cust-1'),
    )
    expect(res.status).toBe(400)
    expect(addContact).not.toHaveBeenCalled()
  })
})
