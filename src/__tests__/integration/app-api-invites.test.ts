// Staff invite facade routes (design-parity packet 12 §S4b). Uses the REAL
// createInviteCore/listInvitesWithClient/revokeInviteCore
// (src/lib/invites/invites.core.ts).
// Pins: 'staff.invite' gate on all three · Idempotency-Key on create only ·
// invitedBy is the roster-resolved self id (selfRow idiom), never
// caller-supplied · the plan gate (staffAddAllowedWithClient) skips for
// re-invites (staffId present) · exactly one staff.invite_create/
// staff.invite_revoke audit row per successful write, ids-only detail ·
// listInvites degrades to [] on a read failure.
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
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))

// The inviter also holds the practitioner preset every STYLIST invite below
// seeds (hold what you grant — the role cap itself is invite-role-cap.test.ts).
const INVITER = ['staff.invite', 'records.write', 'customers.view', 'customers.manage', 'bookings.manage']
const mockCapabilities = jest.fn(async () => new Set(INVITER))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

jest.mock('@/lib/subscription/feature-gate', () => ({
  staffAddAllowedWithClient: jest.fn(async () => ({ allowed: true })),
}))

const staffListByBusinessOrThrow = jest.fn(async (..._a: unknown[]) => [
  { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: (...a: unknown[]) => staffListByBusinessOrThrow(...a),
}))

// email-exists lookup used by createInviteCore.
let existingMember: { id: string } | null = null
// Rows memberEmailsForBusiness's awaited select resolves to (the linked-badge
// lookup awaits the chain directly, no maybeSingle — hence the thenable).
let memberEmailRows: { email: string | null }[] = []
// `serviceOverride` = the removed-staff helper's in-memory profiles table,
// installed only while it runs the REAL roster read.
const serviceOverride = { current: null as unknown }
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    if (serviceOverride.current) return serviceOverride.current
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'ilike', 'eq']) builder[m] = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({ data: existingMember })
    ;(builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: memberEmailRows })
    return { from: () => builder }
  },
}))

const invitesCreate = jest.fn(async () => ({ id: 'inv-new' }))
type FakeInvite = {
  id: string
  email: string
  role: string
  status: string
  created_at: string
  expires_at: string
  invited_staff_id?: string
  invited_by?: string
}
const invitesList = jest.fn(async () => ({
  invites: [
    { id: 'inv-1', email: 'a@test.com', role: 'STYLIST', status: 'pending', created_at: '2026-01-01', expires_at: '2026-01-08' },
  ] as FakeInvite[],
}))
const invitesUpdateStatus = jest.fn(async () => ({}))
const staffList = jest.fn(async () => ({ staff: [] as { id: string; user_id?: string | null }[] }))
// Store assignments the re-invite clamp reads (ensureStaffWriteInScope):
// keyed by staff id so a test can put the CALLER and the TARGET in different
// branches. Default = everyone floating (empty assignment = works in every
// store), the unclamped path every pre-clamp pin in this file was written
// against.
let storeAssignments: Record<string, string[]> = {}
const staffStoresGet = jest.fn(async (id: string) => ({ store_ids: storeAssignments[id] ?? [] }))
// ⚖ Liam 2026-09-16: a FRESH invite MAKES the staff card before the invite
// exists (name + store), so this door reaches the staff/stores write ports too.
// ONE store here, so the carve-out holds and the existing pins — which are about
// invited_by, the audit row and the re-invite clamp — keep their shape.
const staffCreate = jest.fn(async () => ({ id: 'card-new' }))
const staffDelete = jest.fn(async () => ({}))
const storesList = jest.fn(async () => ({ stores: [{ id: 'store-a', is_primary: true }] }))
const staffStoresSet = jest.fn(async () => ({}))
const fakeClient = {
  // InviteClient requires `audit` (Greptile #978 R1 F3: the revoke reads the mint row back).
  audit: { list: jest.fn() },
  invites: { create: invitesCreate, list: invitesList, updateStatus: invitesUpdateStatus },
  staff: { list: staffList, create: staffCreate, delete: staffDelete },
  staffStores: { get: staffStoresGet, set: staffStoresSet },
  stores: { list: storesList },
}
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET, POST } from '@/app/api/app/v1/invites/route'
import { DELETE } from '@/app/api/app/v1/invites/[id]/route'
import { rosterOf, unplaceableRow, BUSINESS } from './helpers/removed-staff'
import { auditLines } from './helpers/audit-lines'
import { STORE_SCOPE_UNVERIFIED } from '@/lib/auth/store-lock'

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
const auth = { authorization: `Bearer ${bearer()}` }
const noParams = { params: Promise.resolve({}) }
const params = (id: string) => ({ params: Promise.resolve({ id }) })

// A fresh invite now carries the person's NAME — the card is named by a human,
// never by an email address.
const VALID_INVITE = { email: 'newhire@example.com', role: 'STYLIST', name: '新人' }

const getReq = () => new Request('https://s/api/app/v1/invites', { headers: auth })
const postReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://s/api/app/v1/invites', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', 'idempotency-key': 'test-key-1', ...headers },
    body: JSON.stringify(body),
  })
const deleteReq = (id: string) =>
  new Request(`https://s/api/app/v1/invites/${id}`, { method: 'DELETE', headers: auth })

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(INVITER))
  staffListByBusinessOrThrow.mockResolvedValue([
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
  ])
  existingMember = null
  memberEmailRows = []
  storeAssignments = {}
  staffStoresGet.mockImplementation(async (id: string) => ({ store_ids: storeAssignments[id] ?? [] }))
  invitesCreate.mockResolvedValue({ id: 'inv-new' })
  invitesList.mockResolvedValue({
    invites: [
      { id: 'inv-1', email: 'a@test.com', role: 'STYLIST', status: 'pending', created_at: '2026-01-01', expires_at: '2026-01-08' },
    ],
  })
  invitesUpdateStatus.mockResolvedValue({})
})

describe('GET /api/app/v1/invites', () => {
  it('missing staff.invite → 403, no read', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(403)
    expect(invitesList).not.toHaveBeenCalled()
  })

  it('happy path → 200 with the pending invites, filtered/mapped', async () => {
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invites).toEqual([
      { id: 'inv-1', email: 'a@test.com', role: 'STYLIST', status: 'pending', created_at: '2026-01-01', expires_at: '2026-01-08', linked: false },
    ])
  })

  it('a pending invite whose email is already a member login → linked: true (ghost invite shows 接続済み, not eternal 保留中)', async () => {
    memberEmailRows = [{ email: 'A@test.com' }] // case-insensitive match
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    expect((await res.json()).invites[0]).toMatchObject({ id: 'inv-1', linked: true })
  })

  it('no email match but the invite-origin card is already WIRED → linked: true (Greptile #626 P1: a profile with no email value must not hide the connection)', async () => {
    memberEmailRows = [{ email: null }] // the member's profile carries no email
    invitesList.mockResolvedValue({
      invites: [
        { id: 'inv-2', email: 'b@test.com', role: 'STYLIST', status: 'pending', created_at: '2026-01-01', expires_at: '2026-01-08', invited_staff_id: 'card-7' },
      ],
    })
    staffList.mockResolvedValue({ staff: [{ id: 'card-7', user_id: 'auth-uid-7' }] })
    const res = await GET(getReq(), noParams)
    expect((await res.json()).invites[0]).toMatchObject({ id: 'inv-2', linked: true })
  })

  it('invite-origin card exists but is UNWIRED → linked stays false (a truly pending invite never badges)', async () => {
    invitesList.mockResolvedValue({
      invites: [
        { id: 'inv-3', email: 'c@test.com', role: 'STYLIST', status: 'pending', created_at: '2026-01-01', expires_at: '2026-01-08', invited_staff_id: 'card-8' },
      ],
    })
    staffList.mockResolvedValue({ staff: [{ id: 'card-8', user_id: null }] })
    const res = await GET(getReq(), noParams)
    expect((await res.json()).invites[0]).toMatchObject({ id: 'inv-3', linked: false })
  })

  it('an UNPLACEABLE caller with staff.invite (real roster read over a null-name profile — door layer alone) → 403 store_forbidden STORE_SCOPE_UNVERIFIED, the invites list never read', async () => {
    const roster = await rosterOf(
      [unplaceableRow('auth-user-1'), { id: 'colleague-1', full_name: '佐藤', customer_id: BUSINESS }],
      (c) => (serviceOverride.current = c),
    )
    expect(roster.map((s) => s.id)).toEqual(['colleague-1'])
    staffListByBusinessOrThrow.mockResolvedValue(roster as never)
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'store_forbidden', message: STORE_SCOPE_UNVERIFIED })
    expect(invitesList).not.toHaveBeenCalled()
  })

  it('the roster READ fails → 200 with the same empty shape the web list answers, the invites list never read', async () => {
    staffListByBusinessOrThrow.mockRejectedValueOnce(new Error('profiles down'))
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await GET(getReq(), noParams)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ invites: [] })
      expect(invitesList).not.toHaveBeenCalled()
    } finally {
      err.mockRestore()
    }
  })

  it('a roster caller → the list is read and returned unchanged (the gate lets them through)', async () => {
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    expect(invitesList).toHaveBeenCalledTimes(1)
    expect((await res.json()).invites).toHaveLength(1)
  })

  it('a read failure degrades to [] (web-exact tolerance)', async () => {
    invitesList.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    expect((await res.json()).invites).toEqual([])
  })
})

describe('POST /api/app/v1/invites (create)', () => {
  it('missing staff.invite → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await POST(postReq(VALID_INVITE), noParams)
    expect(res.status).toBe(403)
    expect(invitesCreate).not.toHaveBeenCalled()
  })

  it('missing Idempotency-Key → 400, no write', async () => {
    const res = await POST(postReq(VALID_INVITE, { 'idempotency-key': '' }), noParams)
    expect(res.status).toBe(400)
    expect(invitesCreate).not.toHaveBeenCalled()
  })

  it('happy path → 201 { token }, the card row + the invite row, ids-only detail (never the email)', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await POST(postReq(VALID_INVITE), noParams)
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('token')
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    // ⚖ Liam 2026-09-16: a fresh invite MAKES the card, so two rows are the
    // honest record — the staff member was added, and an invite was created
    // for them. The invite row now names the card instead of carrying null.
    expect(lines.map((l) => l.action)).toEqual(['staff.add', 'staff.invite_create'])
    expect(lines[1]).toMatchObject({
      action: 'staff.invite_create',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_id: 'card-new',
      detail: { invite_id: 'inv-new', role: 'STYLIST', reinvite: false },
      source: 'facade',
    })
    expect(JSON.stringify(lines)).not.toContain('newhire@example.com')
  })

  it('invitedBy (the SDK create call\'s invited_by field) is the roster-resolved self id, never caller-supplied', async () => {
    await POST(postReq(VALID_INVITE), noParams)
    expect(invitesCreate).toHaveBeenCalledWith(expect.objectContaining({ invited_by: 'auth-user-1' }))
  })

  it('a caller absent from the roster → refused, nothing written (⚖ fold round 3, F7)', async () => {
    // This used to proceed with `invited_by: null` — written when a fresh
    // invite created nothing. It MINTS a staff card now, so it is a write door
    // that must fail closed: core answers `{ store_ids: [] }` for an auth id it
    // holds no staff row for, byte-identical to genuinely floating staff, so an
    // unplaceable caller read as unclamped and could place a hire anywhere.
    // resolveWriteStoreScope asks roster-placement FIRST — the same posture web
    // takes (a null staff id is `degraded` there, which maps to `[]`).
    staffListByBusinessOrThrow.mockResolvedValue([])
    const res = await POST(postReq(VALID_INVITE), noParams)
    expect(res.status).toBe(403)
    expect(invitesCreate).not.toHaveBeenCalled()
  })

  it('an UNPLACEABLE caller (real roster read over a null-name profile — door layer alone) → refused, nothing written', async () => {
    const roster = await rosterOf(
      [unplaceableRow('auth-user-1'), { id: 'colleague-1', full_name: '佐藤', customer_id: BUSINESS }],
      (c) => (serviceOverride.current = c),
    )
    expect(roster.map((s) => s.id)).toEqual(['colleague-1'])
    staffListByBusinessOrThrow.mockResolvedValue(roster as never)
    const res = await POST(postReq(VALID_INVITE), noParams)
    expect(res.status).toBe(403)
    expect(invitesCreate).not.toHaveBeenCalled()
  })

  it('an existing member email → business-level { error }, no SDK write, no audit row', async () => {
    existingMember = { id: 'profile-1' }
    const lines = await auditLines(async () => {
      const res = await POST(postReq(VALID_INVITE), noParams)
      expect(res.status).toBe(200)
      expect((await res.json()).error).toMatch(/already a member/i)
    })
    expect(invitesCreate).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('plan gate at the limit → soft 200 { error: STAFF_LIMIT_REACHED } (matches web), no write, no audit row', async () => {
    const { staffAddAllowedWithClient } = jest.requireMock('@/lib/subscription/feature-gate')
    ;(staffAddAllowedWithClient as jest.Mock).mockResolvedValueOnce({ allowed: false })
    const lines = await auditLines(async () => {
      const res = await POST(postReq(VALID_INVITE), noParams)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ error: 'STAFF_LIMIT_REACHED' })
    })
    expect(invitesCreate).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('the plan gate is SKIPPED for a re-invite (staffId present) — an existing member email still gates first', async () => {
    const { staffAddAllowedWithClient } = jest.requireMock('@/lib/subscription/feature-gate')
    const res = await POST(postReq({ ...VALID_INVITE, staffId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), noParams)
    expect(res.status).toBe(201)
    expect(staffAddAllowedWithClient).not.toHaveBeenCalled()
  })

  it('a denied write emits no audit row', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const lines = await auditLines(async () => {
      await POST(postReq(VALID_INVITE), noParams)
    })
    expect(lines).toHaveLength(0)
  })
})

describe('DELETE /api/app/v1/invites/[id] (revoke)', () => {
  it('missing staff.invite → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await DELETE(deleteReq('inv-9'), params('inv-9'))
    expect(res.status).toBe(403)
    expect(invitesUpdateStatus).not.toHaveBeenCalled()
  })

  it('happy path → 200 { ok: true }, exactly one staff.invite_revoke row carrying the invite id', async () => {
    // ⚖ I4 — the row being cancelled has to BE in the list: a revoke whose
    // invite the list does not carry is a "could not check the card" case and
    // writes its own notice row. This is the ordinary happy path — an
    // email-only invite, no card behind it, one row.
    invitesList.mockResolvedValue({
      invites: [
        { id: 'inv-9', email: 'b@test.com', role: 'STYLIST', status: 'pending', created_at: '2026-01-01', expires_at: '2026-01-08' },
      ],
    })
    let res!: Response
    const lines = await auditLines(async () => {
      res = await DELETE(deleteReq('inv-9'), params('inv-9'))
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(invitesUpdateStatus).toHaveBeenCalledWith('inv-9', 'revoked')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.invite_revoke',
      business_id: 'business-1',
      detail: { invite_id: 'inv-9' },
      source: 'facade',
    })
  })

  it('a failed SDK write → { error }, no audit row (silence contract)', async () => {
    invitesUpdateStatus.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const res = await DELETE(deleteReq('inv-9'), params('inv-9'))
      expect(res.status).toBe(200)
      expect((await res.json()).error).toBe('core down')
    })
    expect(lines).toHaveLength(0)
  })

  it('a denied write emits no audit row', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const lines = await auditLines(async () => {
      await DELETE(deleteReq('inv-9'), params('inv-9'))
    })
    expect(lines).toHaveLength(0)
  })
})

// ─── Actor store-scope clamp on RE-INVITES (ensureStaffWriteInScope) ────────
// A staffId names an EXISTING staff card, and acceptInvite rewrites that
// card's user_id (chooseStaffToLink → staff.update) — so an out-of-scope
// re-invite would hand another branch's staff record, and its history, to a
// login of the caller's choosing. Fresh invites add nobody and stay unclamped.
describe("re-invites are clamped to the caller's stores", () => {
  const CALLER = 'auth-user-1' // the Bearer sub this suite signs with
  const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const reinvite = () => POST(postReq({ ...VALID_INVITE, staffId: TARGET }), noParams)

  it('out-of-scope target → 403 store_forbidden, no invite created, no audit row', async () => {
    storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
    const lines = await auditLines(async () => {
      const res = await reinvite()
      expect(res.status).toBe(403)
      expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
    })
    expect(invitesCreate).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('in-scope target (shared branch) → passes unchanged', async () => {
    storeAssignments = { [CALLER]: ['store-a', 'store-b'], [TARGET]: ['store-b'] }
    const res = await reinvite()
    expect(res.status).toBe(201)
    expect(invitesCreate).toHaveBeenCalled()
  })

  it('stores.viewAll → passes, the assignment is never consulted', async () => {
    mockCapabilities.mockResolvedValue(new Set([...INVITER, 'stores.viewAll']))
    storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
    const res = await reinvite()
    expect(res.status).toBe(201)
    // ⚖ 2026-09-16 fold round 2: the CALLER's own assignment is read once at the
    // identity seam (the front gate reads the unassigned verdict itself, for
    // every non-viewAll request). What this pins is that the DOOR asks for
    // nothing beyond it — no target's row, no second read.
    expect(staffStoresGet.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it("a failed lookup of the caller's own assignment fails closed → 403", async () => {
    staffStoresGet.mockImplementation(async (id: string) => {
      if (id === CALLER) throw new Error('core down')
      return { store_ids: ['store-b'] }
    })
    const res = await reinvite()
    expect(res.status).toBe(403)
    expect(invitesCreate).not.toHaveBeenCalled()
  })

  it('a FRESH invite reads the CALLER\'s stores, never a target\'s', async () => {
    // ⚖ Liam 2026-09-16: there is no target to clamp on a fresh invite — the
    // card does not exist yet, this door makes it. What IS read is the
    // CREATOR's own assignment, because the new card may only be placed inside
    // it. The re-invite clamp (a TARGET's assignment) still never runs.
    storeAssignments = { [CALLER]: ['store-a'] }
    const res = await POST(postReq(VALID_INVITE), noParams)
    expect(res.status).toBe(201)
    // Every assignment read on this door is the CALLER's own: the front gate's
    // at the identity seam, and the creator-subset check's for the card it is
    // about to place. The re-invite clamp (a TARGET's row) never runs.
    expect(staffStoresGet).toHaveBeenCalledWith(CALLER)
    expect(staffStoresGet.mock.calls.every(([id]) => id === CALLER)).toBe(true)
    expect(invitesCreate).toHaveBeenCalled()
  })
})

// ─── The other half of the same surface: LIST + REVOKE ──────────────────────
// Creating the re-invite was clamped; seeing and cancelling one was not. The
// list HIDES an out-of-scope re-invite row (isolation law — never show it and
// then refuse the button) and the revoke refuses it at the server door.
describe('pending re-invites: list hides, revoke refuses', () => {
  const CALLER = 'auth-user-1'
  const TARGET = 'card-9'
  const FRESH = { id: 'inv-fresh', email: 'a@test.com', role: 'STYLIST', status: 'pending', created_at: '2026-01-01', expires_at: '2026-01-08' }
  const REINVITE = { ...FRESH, id: 'inv-reinvite', email: 'b@test.com', invited_staff_id: TARGET }

  beforeEach(() => {
    invitesList.mockResolvedValue({ invites: [FRESH, REINVITE] })
  })

  it('a creator can list and revoke their own invite while the target is storeless', async () => {
    storeAssignments = { [CALLER]: ['store-a'], [TARGET]: [] }
    invitesList.mockResolvedValue({ invites: [{ ...REINVITE, invited_by: CALLER }] })
    const listed = await GET(getReq(), noParams)
    expect(listed.status).toBe(200)
    expect((await listed.json()).invites.map((i: { id: string }) => i.id)).toEqual([REINVITE.id])
    const revoked = await DELETE(deleteReq(REINVITE.id), params(REINVITE.id))
    expect(revoked.status).toBe(200)
    expect(await revoked.json()).toEqual({ ok: true })
    expect(invitesUpdateStatus).toHaveBeenCalledWith(REINVITE.id, 'revoked')
  })

  it('a creator cannot list or revoke their own invite after its target is placed outside their stores', async () => {
    storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
    invitesList.mockResolvedValue({ invites: [{ ...REINVITE, invited_by: CALLER }] })
    const listed = await GET(getReq(), noParams)
    expect(listed.status).toBe(200)
    expect((await listed.json()).invites).toEqual([])
    const lines = await auditLines(async () => {
      const revoked = await DELETE(deleteReq(REINVITE.id), params(REINVITE.id))
      expect(revoked.status).toBe(403)
      expect((await revoked.json()).error).toMatchObject({ code: 'store_forbidden' })
    })
    expect(invitesUpdateStatus).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('an unreadable self-created target gets no list or revoke exemption', async () => {
    storeAssignments = { [CALLER]: ['store-a'] }
    invitesList.mockResolvedValue({ invites: [{ ...REINVITE, invited_by: CALLER }] })
    staffStoresGet.mockImplementation(async (id: string) => {
      if (id === TARGET) throw new Error('core down')
      return { store_ids: storeAssignments[id] ?? [] }
    })
    const listed = await GET(getReq(), noParams)
    expect(listed.status).toBe(200)
    expect((await listed.json()).invites).toEqual([])
    const revoked = await DELETE(deleteReq(REINVITE.id), params(REINVITE.id))
    expect(revoked.status).toBe(403)
    expect((await revoked.json()).error).toMatchObject({ code: 'store_forbidden' })
    expect(invitesUpdateStatus).not.toHaveBeenCalled()
  })

  it('clamped viewer: the out-of-scope re-invite row is DROPPED, the fresh row stays', async () => {
    storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    expect((await res.json()).invites.map((i: { id: string }) => i.id)).toEqual(['inv-fresh'])
  })

  it('clamped viewer sharing the branch: both rows stay', async () => {
    storeAssignments = { [CALLER]: ['store-a', 'store-b'], [TARGET]: ['store-b'] }
    const res = await GET(getReq(), noParams)
    expect((await res.json()).invites.map((i: { id: string }) => i.id)).toEqual([
      'inv-fresh',
      'inv-reinvite',
    ])
  })

  it('stores.viewAll: both rows stay and no assignment is consulted', async () => {
    mockCapabilities.mockResolvedValue(new Set(['staff.invite', 'stores.viewAll']))
    storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
    const res = await GET(getReq(), noParams)
    expect((await res.json()).invites).toHaveLength(2)
    // ⚖ 2026-09-16 fold round 2: the CALLER's own assignment is read once at the
    // identity seam (the front gate reads the unassigned verdict itself, for
    // every non-viewAll request). What this pins is that the DOOR asks for
    // nothing beyond it — no target's row, no second read.
    expect(staffStoresGet.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('revoking an out-of-scope re-invite → 403 store_forbidden, core untouched, no audit row', async () => {
    storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
    const lines = await auditLines(async () => {
      const res = await DELETE(deleteReq(REINVITE.id), params(REINVITE.id))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
    })
    expect(invitesUpdateStatus).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('revoking an in-scope re-invite → passes unchanged', async () => {
    storeAssignments = { [CALLER]: ['store-a', 'store-b'], [TARGET]: ['store-b'] }
    const res = await DELETE(deleteReq(REINVITE.id), params(REINVITE.id))
    expect(res.status).toBe(200)
    expect(invitesUpdateStatus).toHaveBeenCalledWith(REINVITE.id, 'revoked')
  })

  it('revoking as a viewAll caller pays no CLAMP lookup — and a broken lookup cannot block them', async () => {
    // The clamp free-passes viewAll, so the read that feeds IT is pure cost and
    // a pure new failure mode for an owner. ⚖ FOLD ROUND 3 (F4): the invite ROW
    // is now load-bearing for every caller (it names the card a revoked fresh
    // invite leaves behind), so the core reads it once, quietly — and a broken
    // read still cannot block the revoke, which is the half that matters.
    mockCapabilities.mockResolvedValue(new Set(['staff.invite', 'stores.viewAll']))
    invitesList.mockRejectedValue(new Error('core down'))
    const res = await DELETE(deleteReq(REINVITE.id), params(REINVITE.id))
    expect(res.status).toBe(200)
    // ⚖ 2026-09-16 fold round 2: the CALLER's own assignment is read once at the
    // identity seam (the front gate reads the unassigned verdict itself, for
    // every non-viewAll request). What this pins is that the DOOR asks for
    // nothing beyond it — no target's row, no second read.
    expect(staffStoresGet.mock.calls.length).toBeLessThanOrEqual(1)
    expect(invitesUpdateStatus).toHaveBeenCalledWith(REINVITE.id, 'revoked')
  })

  it('revoking a FRESH invite is never clamped, even for a clamped caller', async () => {
    storeAssignments = { [CALLER]: ['store-a'] }
    const res = await DELETE(deleteReq(FRESH.id), params(FRESH.id))
    expect(res.status).toBe(200)
    // ⚖ 2026-09-16 fold round 2: the CALLER's own assignment is read once at the
    // identity seam (the front gate reads the unassigned verdict itself, for
    // every non-viewAll request). What this pins is that the DOOR asks for
    // nothing beyond it — no target's row, no second read.
    expect(staffStoresGet.mock.calls.length).toBeLessThanOrEqual(1)
    expect(invitesUpdateStatus).toHaveBeenCalledWith(FRESH.id, 'revoked')
  })
})
