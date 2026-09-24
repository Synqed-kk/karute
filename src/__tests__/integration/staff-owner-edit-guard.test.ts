/**
 * Owner-row EDIT guard (updateStaffCore) — both doors.
 *
 * The defect this pins shut: any `staff.manage` holder (the shipped manager
 * preset) could rename the OWNER's row to `_system_removed_…` through the
 * ordinary edit dialog (web) or PATCH /api/app/v1/staff/[id] (facade). The
 * identity seam (businessIdForUser) then refused the owner as
 * membership_inactive — the owner locked out, reversible only in the database.
 *
 * Now: the owner row is edited by the owner only (web `noPermission`, facade
 * 403 forbidden), a failed profile lookup fails CLOSED before any write, and
 * the owner still editing their own row keeps working. The caller holds the
 * REAL manager preset; the REAL web action, facade PATCH, facade clamp and
 * core run end to end over a one-row in-memory profiles table.
 */
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  revalidateTag: jest.fn(),
}))
// Echo the i18n key so assertions read 'noPermission' / 'somethingWentWrong'.
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))

// Who is calling — the manager by default, the owner for the self-edit pins.
let caller = 'manager-1'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: caller } }, error: null }) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

// One persisted owner row: update() mutates it, single()/maybeSingle() read it.
const OWNER = { id: 'owner-1', customer_id: 'business-1', full_name: '北野 オーナー', display_role: 'owner' }
let row: Record<string, unknown> = { ...OWNER }
let lookupError: { message: string } | null = null
const updatePayloads: Record<string, unknown>[] = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.maybeSingle = async () => (lookupError ? { data: null, error: lookupError } : { data: row, error: null })
    b.single = async () => ({ data: row, error: null })
    b.update = (p: Record<string, unknown>) => {
      updatePayloads.push(p)
      row = { ...row, ...p }
      const c: Record<string, unknown> = {}
      c.eq = () => c
      c.then = (r: (v: unknown) => unknown) => r({ error: null })
      return c
    }
    return { from: () => b, auth: { admin: { updateUserById: jest.fn(async () => ({ error: null })) } } }
  },
}))

// The caller's capabilities: the REAL manager preset (the owner's own for the
// self-edit pins).
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  const { ROLE_PRESETS } = jest.requireActual('@/lib/auth/permissions')
  const caps = () => new Set(caller === 'owner-1' ? ROLE_PRESETS.owner : ROLE_PRESETS.manager)
  return { ...actual, capabilitiesForUser: async () => caps(), can: async (c: string) => caps().has(c) }
})
jest.mock('@/lib/staff', () => ({
  ...jest.requireActual('@/lib/staff'),
  getBusinessId: jest.fn(async () => 'business-1'),
  // facade identity for the CALLER
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'manager-1' }, { id: 'owner-1' }]),
}))
// Web clamp: both shipped presets that hold staff.manage carry stores.viewAll,
// so the real rule passes; the clamp is not what this file is about.
jest.mock('@/lib/auth/store-scope', () => ({ staffWriteInScope: jest.fn(async () => true) }))
const resolveWebActorId = jest.fn(async (): Promise<string | null> => caller)
jest.mock('@/lib/audit-web', () => ({
  resolveWebActorId: () => resolveWebActorId(),
  resolveWebAuditContext: jest.fn(async () => ({ actorId: caller, businessId: 'business-1' })),
}))
jest.mock('@/lib/audit', () => ({ ...jest.requireActual('@/lib/audit'), audit: jest.fn() }))
jest.mock('@/lib/synqed/staff-map', () => ({ lookupSynqedStaffIdForBusiness: jest.fn(async () => 'synqed-owner') }))
const fakeClient = { staff: { update: jest.fn(async () => ({})), delete: jest.fn(async () => ({})) } }
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

import { updateStaff, deleteStaff } from '@/actions/staff'
import { PATCH } from '@/app/api/app/v1/staff/[id]/route'
const realStaff = jest.requireActual('@/lib/staff') as typeof import('@/lib/staff')

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64({ sub: caller, iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const patchOwner = (body: unknown) =>
  PATCH(
    new Request('https://s/api/app/v1/staff/owner-1', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'owner-1' }) },
  )

const EVIL = { name: '_system_removed_北野 オーナー', position: '', email: '', phone: '' }
const CLEAN = { name: '別名', position: '', email: '', phone: '' }

beforeEach(() => {
  caller = 'manager-1'
  row = { ...OWNER }
  lookupError = null
  updatePayloads.length = 0
  resolveWebActorId.mockImplementation(async () => caller)
  fakeClient.staff.update.mockClear()
})

it('control: deleteStaff on the owner row is REFUSED (the delete guard, unchanged)', async () => {
  expect(await deleteStaff('owner-1')).toEqual({ error: 'noPermission' })
  expect(updatePayloads).toHaveLength(0)
})

// The role is compared lower-cased, like every other owner check: a row
// carrying 'OWNER' (older data, a hand edit) must not slip either guard.
describe("an owner row stored as 'OWNER' is still the owner", () => {
  beforeEach(() => {
    row = { ...OWNER, display_role: 'OWNER' }
  })

  it('deleteStaff → noPermission, nothing written', async () => {
    expect(await deleteStaff('owner-1')).toEqual({ error: 'noPermission' })
    expect(updatePayloads).toHaveLength(0)
  })

  it('a manager renaming it to a CLEAN name → web noPermission, facade 403, nothing written', async () => {
    expect(await updateStaff('owner-1', CLEAN)).toEqual({ error: 'noPermission' })
    const res = await patchOwner(CLEAN)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'forbidden' })
    expect(updatePayloads).toHaveLength(0)
  })
})

// The exploit itself. Refused on BOTH doors, whichever layer answers first
// (the reserved-name rule or the owner guard) — nothing is written and the
// owner is still admitted by the REAL identity seam.
it('WEB: a manager can no longer rename the OWNER to _system_removed_ — owner still admitted', async () => {
  const r = await updateStaff('owner-1', EVIL)
  expect(r).toEqual({ error: expect.any(String) })
  expect(updatePayloads).toHaveLength(0)
  expect(fakeClient.staff.update).not.toHaveBeenCalled()
  await expect(realStaff.businessIdForUser('owner-1')).resolves.toBe('business-1')
})

it('FACADE: PATCH /staff/owner-1 with the same name is refused — owner still admitted', async () => {
  const res = await patchOwner(EVIL)
  expect(res.status).toBeGreaterThanOrEqual(400)
  expect(res.status).toBeLessThan(500)
  expect(updatePayloads).toHaveLength(0)
  expect(fakeClient.staff.update).not.toHaveBeenCalled()
  await expect(realStaff.businessIdForUser('owner-1')).resolves.toBe('business-1')
})

// The guard on its own: a perfectly ordinary name, still the owner's row.
it('WEB: a manager renaming the owner to a CLEAN name → noPermission, nothing written', async () => {
  expect(await updateStaff('owner-1', CLEAN)).toEqual({ error: 'noPermission' })
  expect(updatePayloads).toHaveLength(0)
  expect(fakeClient.staff.update).not.toHaveBeenCalled()
})

it('FACADE: a manager renaming the owner to a CLEAN name → 403 forbidden, nothing written', async () => {
  const res = await patchOwner(CLEAN)
  expect(res.status).toBe(403)
  expect((await res.json()).error).toMatchObject({ code: 'forbidden' })
  expect(updatePayloads).toHaveLength(0)
})

it('a NULL actor is refused on the owner row too (never equals the owner id)', async () => {
  resolveWebActorId.mockImplementation(async () => null)
  expect(await updateStaff('owner-1', CLEAN)).toEqual({ error: 'noPermission' })
  expect(updatePayloads).toHaveLength(0)
})

it('WEB: the OWNER editing their OWN row is allowed', async () => {
  caller = 'owner-1'
  expect(await updateStaff('owner-1', CLEAN)).toBeUndefined()
  expect(updatePayloads).toEqual([expect.objectContaining({ full_name: '別名' })])
})

it('FACADE: the OWNER editing their OWN row is allowed', async () => {
  caller = 'owner-1'
  const res = await patchOwner(CLEAN)
  expect(res.status).toBe(200)
  expect(updatePayloads).toEqual([expect.objectContaining({ full_name: '別名' })])
})

it('a manager editing a NON-owner row is untouched by the guard', async () => {
  row = { id: 'staff-9', customer_id: 'business-1', full_name: '山田', display_role: 'stylist' }
  expect(await updateStaff('staff-9', CLEAN)).toBeUndefined()
  expect(updatePayloads).toEqual([expect.objectContaining({ full_name: '別名' })])
})

// The reserved-name rule on its own: a NON-owner row, where the owner guard
// has nothing to say — both doors still refuse a system-row name, any case.
it.each(['_system_x', '_SYSTEM_x'])('a manager naming a NON-owner row %j is refused on both doors', async (name) => {
  row = { id: 'staff-9', customer_id: 'business-1', full_name: '山田', display_role: 'stylist' }
  const body = { ...CLEAN, name }
  expect(await updateStaff('staff-9', body)).toEqual({ error: expect.any(String) })
  const res = await PATCH(
    new Request('https://s/api/app/v1/staff/staff-9', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'staff-9' }) },
  )
  expect(res.status).toBe(400)
  expect(updatePayloads).toHaveLength(0)
  expect(fakeClient.staff.update).not.toHaveBeenCalled()
})

describe('a failed profile lookup fails CLOSED — no write on either door', () => {
  beforeEach(() => {
    lookupError = { message: 'db down' }
  })

  it('WEB → the generic fallback, no profile write, no core write', async () => {
    expect(await updateStaff('owner-1', CLEAN)).toEqual({ error: 'somethingWentWrong' })
    expect(updatePayloads).toHaveLength(0)
    expect(fakeClient.staff.update).not.toHaveBeenCalled()
  })

  it('FACADE → 502 upstream_unavailable, no profile write, no core write', async () => {
    const res = await patchOwner(CLEAN)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatchObject({ code: 'upstream_unavailable' })
    expect(updatePayloads).toHaveLength(0)
    expect(fakeClient.staff.update).not.toHaveBeenCalled()
  })
})
