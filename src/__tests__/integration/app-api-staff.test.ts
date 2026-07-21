// Staff CRUD + avatar facade routes (design-parity packet 12 §S4a). Single-
// source: every route calls the SAME core the web action calls
// (createStaffCore/updateStaffCore/deleteStaffCore/uploadStaffAvatarCore,
// src/actions/staff.ts). Pins: capability gates, Idempotency-Key on create,
// exactly one audit row per successful write (source: 'facade'), and the
// silence contract (denied/failed write → no audit row).
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
  SynqedError: class extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))
// src/actions/staff.ts also exports the web createStaff/updateStaff/etc.
// actions (unused here, but the module graph pulls them in with
// createStaffCore et al.) — those import next-intl/server, real ESM jest
// can't parse; mock it the same way every other suite that touches this
// module does.
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

const mockCapabilities = jest.fn(async () => new Set(['staff.invite', 'staff.manage']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

jest.mock('@/lib/subscription/feature-gate', () => ({
  staffAddAllowedWithClient: jest.fn(async () => ({ allowed: true })),
}))

jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1' }]),
}))

// profiles lookup used by updateStaffCore/deleteStaffCore — null = synqed-only
// staff (routes to the synqed client); a row = profile-backed (routes to the
// Supabase update).
let profileRow: { id: string } | null = null
let profileUpdateError: { message: string } | null = null
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) builder[m] = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({ data: profileRow })
    ;(builder as { update: unknown }).update = () => {
      const chain: Record<string, unknown> = {}
      chain.eq = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ error: profileUpdateError })
      return chain
    }
    return { from: () => builder }
  },
}))

jest.mock('@/lib/synqed/staff-map', () => ({
  lookupSynqedStaffId: jest.fn(async () => 'synqed-7'),
}))

const staffCreate = jest.fn(async () => ({ id: 'staff-new' }))
const staffUpdate = jest.fn(async () => ({}))
const staffDelete = jest.fn(async () => ({}))
const staffUploadAvatar = jest.fn(async () => ({ avatar_url: 'https://cdn.test/a.png' }))
const fakeClient = {
  staff: { create: staffCreate, update: staffUpdate, delete: staffDelete, uploadAvatar: staffUploadAvatar },
}
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { POST as createPOST } from '@/app/api/app/v1/staff/route'
import { PATCH as updatePATCH, DELETE as deleteDELETE } from '@/app/api/app/v1/staff/[id]/route'
import { POST as avatarPOST } from '@/app/api/app/v1/staff/[id]/avatar/route'
import { SynqedError } from '@synqed-kk/client'
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
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const noParams = { params: Promise.resolve({}) }

const VALID_STAFF = { name: 'New Hire', position: '', email: '', phone: '' }

const postReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://s/api/app/v1/staff', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', 'idempotency-key': 'test-key-1', ...headers },
    body: JSON.stringify(body),
  })
const patchReq = (id: string, body: unknown) =>
  new Request(`https://s/api/app/v1/staff/${id}`, {
    method: 'PATCH',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const deleteReq = (id: string) =>
  new Request(`https://s/api/app/v1/staff/${id}`, { method: 'DELETE', headers: auth })

// A minimal valid PNG header the avatar route's magic-byte sniff accepts.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
function avatarForm(): FormData {
  const fd = new FormData()
  fd.set('file', new File([PNG_BYTES], 'a.png', { type: 'image/png' }))
  return fd
}
const avatarReq = (id: string, form: FormData) =>
  new Request(`https://s/api/app/v1/staff/${id}/avatar`, { method: 'POST', headers: auth, body: form })

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['staff.invite', 'staff.manage']))
  profileRow = null
  profileUpdateError = null
  staffCreate.mockResolvedValue({ id: 'staff-new' })
  staffUpdate.mockResolvedValue({})
  staffDelete.mockResolvedValue({})
  staffUploadAvatar.mockResolvedValue({ avatar_url: 'https://cdn.test/a.png' })
})

describe('POST /api/app/v1/staff (create)', () => {
  it('missing staff.invite → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await createPOST(postReq(VALID_STAFF), noParams)
    expect(res.status).toBe(403)
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('missing Idempotency-Key → 400, no write', async () => {
    const res = await createPOST(postReq(VALID_STAFF, { 'idempotency-key': '' }), noParams)
    expect(res.status).toBe(400)
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('happy path → 201 { id }, exactly one staff.add audit row, source facade', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await createPOST(postReq(VALID_STAFF), noParams)
    })
    expect(res.status).toBe(201)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    expect(await res.json()).toEqual({ id: 'staff-new' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'staff',
      action: 'staff.add',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_id: 'staff-new',
      source: 'facade',
    })
  })

  it('a denied write emits no audit row', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const lines = await auditLines(async () => {
      await createPOST(postReq(VALID_STAFF), noParams)
    })
    expect(lines).toHaveLength(0)
  })

  it('plan gate at the limit → soft 200 { error } (matches web), no write, no audit row', async () => {
    const { staffAddAllowedWithClient } = jest.requireMock('@/lib/subscription/feature-gate')
    ;(staffAddAllowedWithClient as jest.Mock).mockResolvedValueOnce({
      allowed: false,
      count: 3,
      limit: 3,
    })
    let res!: Response
    const lines = await auditLines(async () => {
      res = await createPOST(postReq(VALID_STAFF), noParams)
    })
    // The Bearer-scoped client + businessId reach the gate — the cookie-bound
    // staffAddAllowed() would have failed open on every facade request.
    expect(staffAddAllowedWithClient).toHaveBeenCalledWith(
      fakeClient,
      'business-1',
      expect.any(Function),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'Staff limit reached for the current plan.' })
    expect(staffCreate).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })
})

describe('PATCH /api/app/v1/staff/[id] (update)', () => {
  it('missing staff.manage → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await updatePATCH(patchReq('staff-9', VALID_STAFF), params('staff-9'))
    expect(res.status).toBe(403)
    expect(staffUpdate).not.toHaveBeenCalled()
  })

  it('happy path (synqed-only staff) → 200 { ok: true }, one staff.update row, source facade', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await updatePATCH(patchReq('staff-9', VALID_STAFF), params('staff-9'))
    })
    expect(res.status).toBe(200)
    expect(staffUpdate).toHaveBeenCalledWith('staff-9', { name: 'New Hire', email: null })
    expect(await res.json()).toEqual({ ok: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'staff.update', target_id: 'staff-9', source: 'facade' })
  })

  it('a failed write emits no audit row (silence contract)', async () => {
    staffUpdate.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const res = await updatePATCH(patchReq('staff-9', VALID_STAFF), params('staff-9'))
      expect(res.status).toBe(502)
    })
    expect(lines).toHaveLength(0)
  })
})

describe('DELETE /api/app/v1/staff/[id]', () => {
  it('missing staff.manage → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
    expect(res.status).toBe(403)
    expect(staffDelete).not.toHaveBeenCalled()
  })

  it('happy path → 200 { ok: true }, one staff.remove row at notice, source facade', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'staff.remove', severity: 'notice', target_id: 'staff-9', source: 'facade' })
  })

  it('the 400 guard (last-member) rides the 2xx body VERBATIM, no audit row', async () => {
    staffDelete.mockRejectedValueOnce(new SynqedError(400, 'Cannot delete the last staff member.'))
    const lines = await auditLines(async () => {
      const res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ error: 'Cannot delete the last staff member.' })
    })
    expect(lines).toHaveLength(0)
  })
})

describe('POST /api/app/v1/staff/[id]/avatar', () => {
  it('missing staff.manage → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await avatarPOST(avatarReq('staff-9', avatarForm()), params('staff-9'))
    expect(res.status).toBe(403)
    expect(staffUploadAvatar).not.toHaveBeenCalled()
  })

  it('a non-image content-type → 400, no write', async () => {
    const fd = new FormData()
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' }))
    const res = await avatarPOST(avatarReq('staff-9', fd), params('staff-9'))
    expect(res.status).toBe(400)
    expect(staffUploadAvatar).not.toHaveBeenCalled()
  })

  it('a declared image/png with non-image bytes → 400 (magic-byte sniff), no write', async () => {
    const fd = new FormData()
    fd.set('file', new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], 'fake.png', { type: 'image/png' }))
    const res = await avatarPOST(avatarReq('staff-9', fd), params('staff-9'))
    expect(res.status).toBe(400)
    expect(staffUploadAvatar).not.toHaveBeenCalled()
  })

  it('happy path → 201 { url }, one staff.avatar_update row at info, source facade', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await avatarPOST(avatarReq('staff-9', avatarForm()), params('staff-9'))
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ url: 'https://cdn.test/a.png' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.avatar_update',
      severity: 'info',
      target_id: 'staff-9',
      source: 'facade',
    })
  })
})
