/**
 * Invite-role cap — hold what you grant, on both doors.
 *
 * The defect this pins shut: createInvite (web) and POST /api/app/v1/invites
 * (facade) gated only on `staff.invite`, and accepting an invite seeds the
 * person with the role's FULL preset (synqedRoleToPreset → ROLE_PRESETS:
 * ADMIN = manager). A branch-clamped custom role holding `staff.invite` could
 * therefore mint a manager — every store, staff.manage, settings, exports.
 *
 * Now createInviteCore refuses, before any read or write, unless the caller
 * holds EVERY capability in the invited role's preset — for all three roles —
 * with the machine code INVITE_ROLE_EXCEEDS_CALLER (the dialog maps it to the
 * existing common.noPermission copy). Creation only: an invite already minted
 * is not re-checked at accept.
 */
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: jest.fn(),
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'branch-inviter' } }, error: null }) } }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

// The breaker's caller: a CUSTOM role with staff.invite + the practitioner
// work set, no staff.manage / stores.viewAll — clamped to one store.
const BRANCH_INVITER = ['staff.invite', 'customers.view', 'customers.manage', 'bookings.manage', 'records.write']
let callerCaps = new Set<string>(BRANCH_INVITER)
let capsUnreadable = false
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return {
    ...actual,
    requireCapability: async (c: string) => {
      if (!callerCaps.has(c)) throw new Error('You do not have permission to perform this action.')
    },
    can: async (c: string) => callerCaps.has(c),
    getMyCapabilities: async () => {
      if (capsUnreadable) throw new Error('profiles read failed')
      return callerCaps
    },
    // facade identity (Bearer)
    capabilitiesForUser: async () => callerCaps,
  }
})
jest.mock('@/lib/auth/store-scope', () => ({
  staffWriteInScope: jest.fn(async () => true),
  resolveStoreScope: jest.fn(async () => ({ storeId: 'ginza', viewAll: false, allowedStoreIds: ['ginza'], degraded: false })),
}))
jest.mock('@/lib/subscription/feature-gate', () => ({
  staffAddAllowed: async () => ({ allowed: true }),
  staffAddAllowedWithClient: async () => ({ allowed: true }),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'branch-inviter'),
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'branch-inviter' }]),
}))
jest.mock('@/lib/audit-web', () => ({
  resolveWebActorId: jest.fn(async () => 'branch-inviter'),
  resolveWebAuditContext: jest.fn(async () => ({ actorId: 'branch-inviter', businessId: 'business-1' })),
  auditWeb: jest.fn(),
}))
jest.mock('@/lib/audit', () => ({ ...jest.requireActual('@/lib/audit'), audit: jest.fn(), auditDurable: jest.fn() }))
const mintCard = jest.fn(async () => ({ id: 'card-new' }))
jest.mock('@/lib/staff/new-card', () => ({
  ...jest.requireActual('@/lib/staff/new-card'),
  createAndPlaceStaffCard: () => mintCard(),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.ilike = () => b
    b.maybeSingle = async () => ({ data: null, error: null }) // not yet a member
    return { from: () => b }
  },
}))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
const invitesCreate = jest.fn<Promise<{ id: string; created_at: string }>, [Record<string, unknown>]>(async () => ({
  id: 'inv-1',
  created_at: new Date().toISOString(),
}))
const fake = {
  invites: { create: invitesCreate, list: async () => ({ invites: [] }), updateStatus: jest.fn() },
  audit: {},
  staff: { create: jest.fn(), delete: jest.fn() },
  staffStores: { get: async () => ({ store_ids: ['ginza'] }), set: jest.fn() },
  stores: { list: async () => ({ stores: [{ id: 'ginza', is_primary: true }] }) },
}
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: async () => fake, newSynqedClient: () => fake }))

import { createInvite } from '@/actions/invites'
import { POST } from '@/app/api/app/v1/invites/route'
import { createInviteCore, type InviteCreateDeps } from '@/lib/invites/invites.core'
import { INVITE_ROLE_EXCEEDS_CALLER } from '@/lib/auth/store-gate'
import { ROLE_PRESETS, type Capability } from '@/lib/auth/permissions'
import type { InviteRole } from '@/lib/validations/invite'

const REFUSED = { error: INVITE_ROLE_EXCEEDS_CALLER }
const STORE = '00000000-0000-4000-8000-000000000001'
const fresh = (role: InviteRole) => ({ email: 'mine@example.com', role, name: '新人', storeIds: [STORE] })

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64({ sub: 'branch-inviter', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const postInvite = (body: unknown) =>
  POST(
    new Request('https://s/api/app/v1/invites', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer()}`,
        'content-type': 'application/json',
        'idempotency-key': 'role-cap-1',
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )

beforeEach(() => {
  callerCaps = new Set(BRANCH_INVITER)
  capsUnreadable = false
  invitesCreate.mockClear()
  mintCard.mockClear()
})

describe('the breaker reproduction, inverted — the clamped staff.invite holder asks for ADMIN', () => {
  it('WEB: refused with the machine code; no card minted, invites.create never called', async () => {
    expect(await createInvite(fresh('ADMIN'))).toEqual(REFUSED)
    expect(mintCard).not.toHaveBeenCalled()
    expect(invitesCreate).not.toHaveBeenCalled()
  })

  it('FACADE: refused with the machine code; no card minted, invites.create never called', async () => {
    const res = await postInvite(fresh('ADMIN'))
    // A business-level refusal rides the 2xx body, like STAFF_LIMIT_REACHED —
    // the phone's port hands the code to the same dialog map as web.
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(REFUSED)
    expect(mintCard).not.toHaveBeenCalled()
    expect(invitesCreate).not.toHaveBeenCalled()
  })

  it('the same caller may still invite a STYLIST (they hold that whole preset) — both doors', async () => {
    expect(await createInvite(fresh('STYLIST'))).toEqual({ token: expect.any(String) })
    const res = await postInvite(fresh('STYLIST'))
    expect(res.status).toBe(201)
    expect(invitesCreate).toHaveBeenCalledTimes(2)
    expect(invitesCreate.mock.calls.map((c) => c[0].role)).toEqual(['STYLIST', 'STYLIST'])
  })

  it('WEB: unreadable capabilities refuse (fail closed)', async () => {
    callerCaps = new Set(ROLE_PRESETS.owner)
    capsUnreadable = true
    // Still refused before anything is written — but a THROWN read is an
    // outage, answered with the dialog's create-failed code, never the
    // permission line (Round 3 leg 5, 2026-09-25, D-S23-1).
    expect(await createInvite(fresh('ASSISTANT'))).toEqual({ error: 'STAFF_CREATE_FAILED' })
    expect(mintCard).not.toHaveBeenCalled()
    expect(invitesCreate).not.toHaveBeenCalled()
  })
})

describe('the core cap, all three roles', () => {
  const deps = (caps: Set<Capability> | null): InviteCreateDeps => ({
    actorId: 'branch-inviter',
    source: 'web',
    requestId: 'req-1',
    creatorAllowedStoreIds: null,
    callerCapabilities: caps as Set<Capability>,
  })
  const holder = (role: keyof typeof ROLE_PRESETS) => new Set<Capability>(['staff.invite', ...ROLE_PRESETS[role]])
  const invite = (caps: Set<Capability> | null, role: InviteRole) =>
    createInviteCore(fake as never, 'business-1', deps(caps), 'branch-inviter', fresh(role))

  it('a STYLIST-preset holder: STYLIST allowed, ADMIN refused', async () => {
    expect(await invite(holder('practitioner'), 'STYLIST')).toEqual({ token: expect.any(String) })
    expect(await invite(holder('practitioner'), 'ADMIN')).toEqual(REFUSED)
    expect(invitesCreate).toHaveBeenCalledTimes(1)
  })

  it('an ASSISTANT-preset holder: ASSISTANT allowed, STYLIST refused (records.write)', async () => {
    expect(await invite(holder('frontdesk'), 'ASSISTANT')).toEqual({ token: expect.any(String) })
    expect(await invite(holder('frontdesk'), 'STYLIST')).toEqual(REFUSED)
    expect(invitesCreate).toHaveBeenCalledTimes(1)
  })

  it('the owner and the manager presets may invite every role', async () => {
    for (const role of ['owner', 'manager'] as const) {
      for (const r of ['ADMIN', 'STYLIST', 'ASSISTANT'] as const) {
        expect(await invite(new Set(ROLE_PRESETS[role]), r)).toEqual({ token: expect.any(String) })
      }
    }
  })

  it('null or empty capabilities refuse every role, before anything is written', async () => {
    for (const r of ['ADMIN', 'STYLIST', 'ASSISTANT'] as const) {
      expect(await invite(null, r)).toEqual(REFUSED)
      expect(await invite(new Set(), r)).toEqual(REFUSED)
    }
    expect(mintCard).not.toHaveBeenCalled()
    expect(invitesCreate).not.toHaveBeenCalled()
  })
})
