// Staff invite facade routes (design-parity packet 12 §S4b). Uses the REAL
// createInviteCore/listInvitesWithClient/revokeInviteCore (src/actions/invites.ts).
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

const mockCapabilities = jest.fn(async () => new Set(['staff.invite']))
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
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
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
}
const invitesList = jest.fn(async () => ({
  invites: [
    { id: 'inv-1', email: 'a@test.com', role: 'STYLIST', status: 'pending', created_at: '2026-01-01', expires_at: '2026-01-08' },
  ] as FakeInvite[],
}))
const invitesUpdateStatus = jest.fn(async () => ({}))
const staffList = jest.fn(async () => ({ staff: [] as { id: string; user_id?: string | null }[] }))
const fakeClient = {
  invites: { create: invitesCreate, list: invitesList, updateStatus: invitesUpdateStatus },
  staff: { list: staffList },
}
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET, POST } from '@/app/api/app/v1/invites/route'
import { DELETE } from '@/app/api/app/v1/invites/[id]/route'
import { auditLines } from './helpers/audit-lines'

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

const VALID_INVITE = { email: 'newhire@example.com', role: 'STYLIST' }

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
  mockCapabilities.mockResolvedValue(new Set(['staff.invite']))
  staffListByBusinessOrThrow.mockResolvedValue([
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
  ])
  existingMember = null
  memberEmailRows = []
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

  it('happy path → 201 { token }, exactly one staff.invite_create row, ids-only detail (never the email)', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await POST(postReq(VALID_INVITE), noParams)
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('token')
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.invite_create',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_id: null, // brand-new hire — no staff row yet
      detail: { invite_id: 'inv-new', role: 'STYLIST', reinvite: false },
      source: 'facade',
    })
    expect(JSON.stringify(lines[0])).not.toContain('newhire@example.com')
  })

  it('invitedBy (the SDK create call\'s invited_by field) is the roster-resolved self id, never caller-supplied', async () => {
    await POST(postReq(VALID_INVITE), noParams)
    expect(invitesCreate).toHaveBeenCalledWith(expect.objectContaining({ invited_by: 'auth-user-1' }))
  })

  it('a caller absent from the roster → invited_by is null, write still proceeds', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([])
    const res = await POST(postReq(VALID_INVITE), noParams)
    expect(res.status).toBe(201)
    expect(invitesCreate).toHaveBeenCalledWith(expect.objectContaining({ invited_by: null }))
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
