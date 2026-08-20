/**
 * PR-B1 fix round 1, T-4 + C-1 + C-2 — the recovery server surfaces' gates.
 *
 * Two new read/write seams reach booked-customer data on the phone path:
 * GET /recovery/day-facts (the picker's rows + the day's 回数券 truth) and the
 * recovery flag on POST /customers/[id]/packs/redeem. Both must carry the
 * repo's own gate for this data class — records.write AND customers.view, the
 * pairing screens/record already uses — and the burn must carry its
 * recovery-resolved marker on the phone, not only in the browser.
 */
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string) => k,
  getLocale: async () => 'ja',
}))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))

// The REAL FACADE_AUDIT_MAP stays live (the handler's success hook reads it);
// only the emitter is captured, so C-2's route detail is observable.
const audit = jest.fn()
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => audit(...(a as [])),
}))

const capabilities = { current: new Set<string>(['records.write', 'customers.view']) }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1', full_name: '原' }]),
}))
const requireCapability = jest.fn(async (cap: string) => {
  if (!capabilities.current.has(cap)) throw new Error('forbidden')
})
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
  requireCapability: (cap: string) => requireCapability(cap),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ storeId: 'store-A' })),
}))
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({}),
  getSynqedClient: async () => ({}),
}))

const storeClamp = { throws: false }
jest.mock('@/lib/app-api/store-clamp', () => ({
  resolveStoreForRequest: jest.fn(async () => {
    if (storeClamp.throws) {
      const { AppApiError } = jest.requireActual('@/lib/app-api/errors')
      throw new AppApiError('forbidden', 'store_forbidden')
    }
    return { storeId: 'store-A' }
  }),
}))

const buildRecoveryDayFacts = jest.fn(async (_c: unknown, _i?: unknown) => ({
  date: '2026-08-18',
  bookings: [],
  packs: [],
  redeemed: { appointmentIds: [], customerIds: [] },
}))
jest.mock('@/lib/karute/recovery-facts', () => ({
  buildRecoveryDayFacts: (c: unknown, i: unknown) => buildRecoveryDayFacts(c, i),
}))

// Redeem-route deps (C-2).
const redeemSessionActionWithClient = jest.fn(
  async (_c: unknown, _s: unknown, _i: unknown) => ({ ok: true, redemptionId: 'red-1' }),
)
jest.mock('@/actions/packs', () => ({
  redeemSessionActionWithClient: (c: unknown, s: unknown, i: unknown) =>
    redeemSessionActionWithClient(c, s, i),
}))
jest.mock('@/lib/app-api/customer-facade', () => ({
  proveCustomerInBusiness: jest.fn(async () => {}),
  provePackForCustomer: jest.fn(async () => {}),
  requireIdempotencyKey: jest.fn(() => {}),
  resolveSelfStaffId: jest.fn(async () => 'staff-1'),
}))

import { GET as dayFacts } from '@/app/api/app/v1/recovery/day-facts/route'
import { POST as redeem } from '@/app/api/app/v1/customers/[id]/packs/redeem/route'

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
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const call = (qs: string) =>
  dayFacts(
    new Request(`https://x/api/app/v1/recovery/day-facts?${qs}`, {
      headers: { authorization: `Bearer ${bearer()}` },
    }),
    { params: Promise.resolve({}) },
  )

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['records.write', 'customers.view'])
  storeClamp.throws = false
})

describe('GET /recovery/day-facts — gates (C-1)', () => {
  it('serves the day with both capabilities', async () => {
    const res = await call('date=2026-08-18')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ date: '2026-08-18' })
  })

  it('403s without customers.view — booked-customer data needs its own gate', async () => {
    capabilities.current = new Set(['records.write'])
    expect((await call('date=2026-08-18')).status).toBe(403)
  })

  it('403s without records.write', async () => {
    capabilities.current = new Set(['customers.view'])
    expect((await call('date=2026-08-18')).status).toBe(403)
  })

  it('rejects a malformed date rather than guessing a day', async () => {
    expect((await call('date=yesterday')).status).toBe(400)
    expect((await call('')).status).toBe(400)
  })

  it('a store-clamp refusal is an ERROR, never a quietly empty day', async () => {
    storeClamp.throws = true
    const res = await call('date=2026-08-18')
    expect(res.status).toBe(403)
    expect(buildRecoveryDayFacts).not.toHaveBeenCalled()
  })

  it('threads the clamped store and the pinned customer into the derivation', async () => {
    await call('date=2026-08-18&pinnedCustomerId=cust-1')
    expect(buildRecoveryDayFacts.mock.calls[0][1]).toMatchObject({
      dateYmd: '2026-08-18',
      storeId: 'store-A',
      pinnedCustomerId: 'cust-1',
    })
  })

  it('an upstream failure degrades to the EXPLICIT unavailable shape', async () => {
    buildRecoveryDayFacts.mockRejectedValueOnce(new Error('core down'))
    const res = await call('date=2026-08-18')
    expect(res.status).toBe(200)
    // A-5: the client must be able to tell this apart from a quiet day.
    expect(await res.json()).toMatchObject({ unavailable: true, redeemed: null })
  })
})

describe('the WEB action carries the same gates (C-1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getRecoveryDayFacts } = require('@/actions/recovery') as typeof import('@/actions/recovery')

  it('serves the day with both capabilities', async () => {
    const r = await getRecoveryDayFacts({ date: '2026-08-18' })
    expect(r.unavailable).toBeUndefined()
    expect(requireCapability).toHaveBeenCalledWith('records.write')
    expect(requireCapability).toHaveBeenCalledWith('customers.view')
  })

  it('a denied capability returns the honest-EMPTY shape, never a partial day', async () => {
    capabilities.current = new Set(['records.write'])
    const r = await getRecoveryDayFacts({ date: '2026-08-18' })
    // Explicitly unavailable — the banner blocks the save behind a retry
    // rather than saving with the money question silently skipped.
    expect(r).toMatchObject({ unavailable: true, redeemed: null, bookings: [], packs: [] })
    expect(buildRecoveryDayFacts).not.toHaveBeenCalled()
  })

  it('a malformed date never reaches a read', async () => {
    const r = await getRecoveryDayFacts({ date: '18/08/2026' })
    expect(r.unavailable).toBe(true)
    expect(requireCapability).not.toHaveBeenCalled()
  })
})

describe('POST packs/redeem — the recovery flag (C-2 + B-9)', () => {
  const post = (body: unknown) =>
    redeem(
      new Request('https://x/api/app/v1/customers/cust-1/packs/redeem', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer()}`,
          'content-type': 'application/json',
          'idempotency-key': 'idem-1',
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: 'cust-1' }) },
    )

  beforeEach(() => {
    capabilities.current = new Set(['customers.view'])
  })

  it('forwards `recovery` to the shared core so D5s guard runs on the phone too', async () => {
    const res = await post({ packId: 'pack-1', recovery: true, redeemedOn: '2026-08-18' })
    expect(res.status).toBe(201)
    expect(redeemSessionActionWithClient.mock.calls[0][2]).toMatchObject({
      recovery: true,
      redeemedOn: '2026-08-18',
      customerId: 'cust-1',
    })
  })

  // C-2: the build round claimed the facade twin could carry no per-call
  // detail. It can — ctx.auditDetail, the same seam karute outcome/entry-edits
  // use — so the recovery-resolved marker reaches reconcile from the PHONE,
  // not only from the browser.
  it('tags the phone burn recovery-resolved on its audit row', async () => {
    await post({ packId: 'pack-1', recovery: true })
    const row = audit.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'customer.pack_redeem',
    )
    expect(row).toBeDefined()
    expect((row![0] as { detail?: Record<string, unknown> }).detail).toMatchObject({
      resolved_via: 'recovery',
    })
  })

  it('a NORMAL phone burn carries no recovery marker', async () => {
    await post({ packId: 'pack-1' })
    const row = audit.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'customer.pack_redeem',
    )
    expect((row?.[0] as { detail?: Record<string, unknown> })?.detail?.resolved_via).toBeUndefined()
  })

  it('B-9: an already-recorded burn is a 409 conflict, not a 502', async () => {
    redeemSessionActionWithClient.mockResolvedValueOnce({
      ok: false,
      error: 'already_redeemed',
    } as never)
    const res = await post({ packId: 'pack-1', recovery: true })
    expect(res.status).toBe(409)
  })

  it('still 409s on below_zero, and 502s on anything genuinely upstream', async () => {
    redeemSessionActionWithClient.mockResolvedValueOnce({ ok: false, error: 'below_zero' } as never)
    expect((await post({ packId: 'pack-1' })).status).toBe(409)
    redeemSessionActionWithClient.mockResolvedValueOnce({ ok: false, error: 'boom' } as never)
    expect((await post({ packId: 'pack-1' })).status).toBe(502)
  })
})

export {}
