// P2 — the walk-in double-burn hole (core #69, SDK 1.28.0 options.idempotencyKey).
//
// Core dedupes redemption creates on Idempotency-Key EQUALITY, so real dedup
// needs a client that sends the SAME key twice. None does YET — idemPost mints
// one per call (thin/ports/actions.vite.ts:243-250), so a re-tap sends a new
// key — which makes that the QUEUED client half and this the SERVER half. What
// these tests pin is the plumbing that half is made of: whatever key the client
// sends reaches the SDK boundary unchanged (same key in → same key out, distinct
// keys stay distinct), and an unkeyed caller still sends no header at all. They
// drive the real seams where a client-supplied key exists — the facade walk-in
// route and the shared booking-burn core — and always assert at the SDK
// boundary, i.e. the header core will really see.
//
// Nothing between the entry point and the SDK is mocked: route →
// redeemSessionActionWithClient → addRedemptionWithClient → packs.addRedemption
// all run for real, against a fake SynqedClient.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1', full_name: '田中' }]),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['customers.view', 'bookings.manage'])),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))
jest.mock('@/lib/customers/queries', () => ({
  getCustomerWithClient: jest.fn(async (_c: unknown, id: string) => ({ id })),
}))
// Only the EMITTERS are stubbed — FACADE_AUDIT_MAP and friends must stay real
// (the facade handler indexes into it on every success).
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: jest.fn(),
  auditWeb: jest.fn(),
}))

// The SDK call under test — the ONE place a key becomes a real header.
const addRedemption = jest.fn(async () => ({ id: 'red-1' }))
const APPT = {
  id: 'appt-1',
  customer_id: 'cust-1',
  status: 'SCHEDULED',
  starts_at: '2026-08-26T02:00:00.000Z',
  created_at: '2026-08-25T02:00:00.000Z',
  store_id: null,
}
const fakeSynqed = {
  packs: {
    addRedemption: (...a: unknown[]) => addRedemption(...(a as [])),
    listPacks: async () => [
      { id: 'pack-1', kind: 'pack', status: 'active', pack_size: 10, unit_price: 5000, purchased_at: '2026-08-01' },
    ],
    listRedemptions: async () => [],
    listRecentRedemptions: async () => [],
  },
  appointments: {
    list: async () => ({ appointments: [] }),
    get: async () => APPT,
    update: async () => APPT,
  },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeSynqed,
  getSynqedClient: async () => fakeSynqed,
}))

import { POST as packRedeem } from '@/app/api/app/v1/customers/[id]/packs/redeem/route'
import { addRedemptionWithClient } from '@/lib/packs/store'
import { cancelAppointmentCore, markNoShowAppointmentCore } from '@/lib/appointments/mutations'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const route = (id: string) => ({ params: Promise.resolve({ id }) })
/** One walk-in burn request, carrying the key the client minted for this call. */
const walkInBurn = (key: string) =>
  new Request('https://s/x', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer()}`,
      'Idempotency-Key': key,
      'Content-Type': 'application/json',
    },
    // appointmentId null = the walk-in shape: no booking, so the DB's partial
    // unique index cannot dedupe and the key is the ONLY protection.
    body: JSON.stringify({ packId: 'pack-1', appointmentId: null }),
  })
/** The options arg of the Nth SDK addRedemption call — what becomes the header. */
const sdkOptions = (n: number) =>
  (addRedemption.mock.calls[n] as unknown[] | undefined)?.[1] as { idempotencyKey?: string } | undefined

beforeEach(() => {
  jest.clearAllMocks()
  addRedemption.mockResolvedValue({ id: 'red-1' })
})

describe('walk-in burn — the key reaches the SDK', () => {
  it('THE PLUMBING PIN: one key sent twice reaches the SDK unchanged both times', async () => {
    // Same key in → same key out: route → action → store → SDK forwards it
    // verbatim, which is exactly what core's equality dedup needs to see.
    // SENDING it twice is the CLIENT's job and is queued, not done here — so
    // this pins the forwarding, not a live double-burn defense.
    const key = 'action-key-abc'
    expect((await packRedeem(walkInBurn(key), route('cust-1'))).status).toBe(201)
    expect((await packRedeem(walkInBurn(key), route('cust-1'))).status).toBe(201)

    expect(addRedemption).toHaveBeenCalledTimes(2)
    expect(sdkOptions(0)?.idempotencyKey).toBe(key)
    expect(sdkOptions(1)?.idempotencyKey).toBe(key)
    // Once a client DOES send one key twice, this is what core receives — one
    // key, twice — and replays instead of burning a second session.
    expect(sdkOptions(1)?.idempotencyKey).toBe(sdkOptions(0)?.idempotencyKey)
  })

  it('two DISTINCT actions send distinct keys (a real second burn still burns)', async () => {
    expect((await packRedeem(walkInBurn('action-key-1'), route('cust-1'))).status).toBe(201)
    expect((await packRedeem(walkInBurn('action-key-2'), route('cust-1'))).status).toBe(201)

    expect(sdkOptions(0)?.idempotencyKey).toBe('action-key-1')
    expect(sdkOptions(1)?.idempotencyKey).toBe('action-key-2')
    expect(sdkOptions(0)?.idempotencyKey).not.toBe(sdkOptions(1)?.idempotencyKey)
  })

  it('the burn really is the walk-in shape — no appointment for the index to dedupe on', async () => {
    await packRedeem(walkInBurn('action-key-abc'), route('cust-1'))
    expect((addRedemption.mock.calls[0] as unknown[])[0]).toMatchObject({
      appointment_id: null,
      customer_id: 'cust-1',
      pack_id: 'pack-1',
    })
  })
})

describe('booking-linked burn — the key reaches the SDK', () => {
  it('the no-show core forwards the caller Idempotency-Key onto the redemption write', async () => {
    const res = await markNoShowAppointmentCore(
      fakeSynqed as never,
      'appt-1',
      { burnPack: true },
      'staff-1',
      {
        actorId: 'auth-user-1',
        businessId: 'business-1',
        source: 'facade',
        requestId: 'req-1',
        idempotencyKey: 'booking-action-key',
      },
    )

    expect(res).toMatchObject({ success: true })
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(sdkOptions(0)?.idempotencyKey).toBe('booking-action-key')
    expect((addRedemption.mock.calls[0] as unknown[])[0]).toMatchObject({ appointment_id: 'appt-1' })
  })

  it('the cancel core forwards it too — the no-show twin is not the only path', async () => {
    const res = await cancelAppointmentCore(
      fakeSynqed as never,
      'appt-1',
      { reason: 'cancel-same-day-contact', burnPack: true },
      'staff-1',
      {
        actorId: 'auth-user-1',
        businessId: 'business-1',
        source: 'facade',
        requestId: 'req-1',
        idempotencyKey: 'cancel-action-key',
      },
    )

    expect(res).toMatchObject({ success: true })
    expect(sdkOptions(0)?.idempotencyKey).toBe('cancel-action-key')
  })

  it('same booking key sent twice → SAME key both times', async () => {
    const actor = {
      actorId: 'auth-user-1',
      businessId: 'business-1',
      source: 'facade' as const,
      requestId: 'req-1',
      idempotencyKey: 'booking-action-key',
    }
    await markNoShowAppointmentCore(fakeSynqed as never, 'appt-1', { burnPack: true }, 'staff-1', actor)
    await markNoShowAppointmentCore(fakeSynqed as never, 'appt-1', { burnPack: true }, 'staff-1', actor)
    expect(addRedemption).toHaveBeenCalledTimes(2)
    expect(sdkOptions(1)?.idempotencyKey).toBe(sdkOptions(0)?.idempotencyKey)
  })
})

describe('unkeyed callers', () => {
  it('NO key → no options object, i.e. no header — byte-identical to before the bump', async () => {
    // Pins store.ts's ternary ONLY — this calls addRedemptionWithClient
    // directly, never the unkeyed call sites themselves (the auto-burn cron,
    // the web cookie action), which carry their own comments for why they stay
    // unkeyed. What it proves: no key → no options object → no header.
    await addRedemptionWithClient(fakeSynqed as never, {
      packId: 'pack-1',
      customerId: 'cust-1',
      redeemedOn: '2026-08-26',
    })
    expect(addRedemption).toHaveBeenCalledTimes(1)
    expect(sdkOptions(0)).toBeUndefined()
  })
})
