/**
 * 経営メンバー WRITE SEAM (PR A) — the packet's hard gate, pinned three ways.
 *
 * The flag is the one field on this form whose write path is easy to break
 * silently:
 *   1. zod strips unknown keys, so an un-declared `isManagement` would make the
 *      facade PATCH return 200 on a body it quietly discarded;
 *   2. the roster is served from an 86400s `unstable_cache` tagged
 *      'staff-list', so a write that lands but never invalidates reads as
 *      "the toggle didn't save" for up to a day;
 *   3. the column is snake_case in Supabase and camelCase everywhere else, so
 *      a mis-mapped key writes nothing and throws nothing.
 *
 * Each of the three gets an assertion below, against the REAL core / REAL web
 * action / REAL facade route — mocked only at the Supabase chain.
 *
 * NOTE (fix round 8/18, A1): the packet asked for `updateTag('staff-list')` to
 * move INTO `updateStaffCore` so the facade PATCH invalidates the web roster
 * cache too. That move is BLOCKED — `updateTag` is Server-Action-only in Next
 * 16 and throws inside a Route Handler, which is exactly what
 * `facade-core-updatetag-ban.test.ts` exists to prevent. So the invalidation
 * pin below is on the WEB action, where it actually lives; the facade half is
 * an open adjudication, not a covered seam.
 */

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

import { createHmac } from 'node:crypto'

const updateTag = jest.fn()
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: (...a: unknown[]) => updateTag(...a),
}))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))

// Every payload handed to profiles.update(), in order — the whole point of
// this file is what is INSIDE these objects.
let updatePayloads: Record<string, unknown>[] = []
// null = synqed-only staff (the core routes to the synqed client and never
// touches profiles); a row = profile-backed, which is where the flag lives.
let profileRow: { id: string } | null = { id: 'p-kitano' }
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({ data: profileRow })
    ;(builder as { update: unknown }).update = (payload: Record<string, unknown>) => {
      updatePayloads.push(payload)
      const chain: Record<string, unknown> = {}
      chain.eq = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ error: null })
      return chain
    }
    return { from: () => builder }
  },
}))

const mockCapabilities = jest.fn(async () => new Set(['staff.manage']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return {
    ...actual,
    capabilitiesForUser: () => mockCapabilities(),
    can: async (c: string) => (await mockCapabilities()).has(c),
  }
})

jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1' }]),
}))
jest.mock('@/lib/audit-web', () => ({
  resolveWebActorId: jest.fn(async () => 'auth-user-1'),
  resolveWebAuditContext: jest.fn(async () => ({ actorId: 'auth-user-1', businessId: 'business-1' })),
}))
// Spread the real module — the facade handler imports more than `audit` from
// here (the endpoint→action map), and a bare stub 500s the route.
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: jest.fn(),
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  lookupSynqedStaffId: jest.fn(async () => 'synqed-7'),
  lookupSynqedStaffIdForBusiness: jest.fn(async () => 'synqed-7'),
}))

const fakeClient = { staff: { update: jest.fn(async () => ({})) } }
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))

import { updateStaff, updateStaffCore } from '@/actions/staff'
import { PATCH } from '@/app/api/app/v1/staff/[id]/route'

// The core only ever touches synqed.staff.update on the synqed-only branch,
// which these profile-backed cases never take — a full SynqedClient stub would
// be nine dead methods.
const asStaffClient = fakeClient as unknown as Parameters<typeof updateStaffCore>[0]

const BASE = { name: '北野', position: '', email: '', phone: '' }

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
const patchReq = (id: string, body: unknown) =>
  new Request(`https://s/api/app/v1/staff/${id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  jest.clearAllMocks()
  updatePayloads = []
  profileRow = { id: 'p-kitano' }
  mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
})

describe('A2(i) — the roster cache is invalidated on a toggle write', () => {
  it("updateStaff fires updateTag('staff-list')", async () => {
    await updateStaff('p-kitano', { ...BASE, isManagement: true })
    expect(updateTag).toHaveBeenCalledWith('staff-list')
  })

  it('…and still does on a plain name edit (the tag is not flag-conditional)', async () => {
    await updateStaff('p-kitano', BASE)
    expect(updateTag).toHaveBeenCalledWith('staff-list')
  })
})

describe('A2(ii) — the core writes the snake_case column', () => {
  it('isManagement: true → profiles.update({ is_management: true })', async () => {
    const res = await updateStaffCore(
      asStaffClient,
      'business-1',
      { actorId: 'auth-user-1', source: 'web' },
      'p-kitano',
      { ...BASE, isManagement: true },
    )
    expect(res).toEqual({ ok: true })
    expect(updatePayloads).toHaveLength(1)
    expect(updatePayloads[0]).toMatchObject({ is_management: true })
  })

  it('isManagement: false is a REAL write (un-flagging must not be a no-op)', async () => {
    await updateStaffCore(
      asStaffClient,
      'business-1',
      { actorId: 'auth-user-1', source: 'web' },
      'p-kitano',
      { ...BASE, isManagement: false },
    )
    expect(updatePayloads[0]).toMatchObject({ is_management: false })
  })

  it('an ABSENT key leaves the stored flag alone — a name edit never clears it', async () => {
    await updateStaffCore(
      asStaffClient,
      'business-1',
      { actorId: 'auth-user-1', source: 'web' },
      'p-kitano',
      BASE,
    )
    expect(updatePayloads[0]).not.toHaveProperty('is_management')
  })
})

describe('A2(iii) — facade PATCH round-trip', () => {
  it('{ isManagement: true } survives the route zod and reaches the column', async () => {
    const res = await PATCH(patchReq('p-kitano', { ...BASE, isManagement: true }), {
      params: Promise.resolve({ id: 'p-kitano' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    // The failure this pins: staffProfileSchema silently dropping the key
    // would still produce 200 { ok: true } — only the payload proves it.
    expect(updatePayloads).toHaveLength(1)
    expect(updatePayloads[0]).toMatchObject({ is_management: true })
  })
})
