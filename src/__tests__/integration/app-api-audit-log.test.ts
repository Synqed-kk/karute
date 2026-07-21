// Facade: 監査ログ list (design-parity packet 17 §S3). Pins: the route shares
// the SAME twin the web listAuditLog() action delegates to
// (listAuditLogWithClient, src/actions/audit-log.ts) · gate is 'audit.view'
// (checked BEFORE any read) · the client is scoped to the Bearer identity's
// businessId · query filters reach synqed.audit.list with the web action's
// exact mapping · logOpen=1 fires exactly one privacy.audit_log_view row
// (source:'facade', actorId = roster self-row id, target stamped only when
// present) and pays the roster read ONLY on that path · a Bearer user absent
// from the roster degrades to actorId:null, never a throw · a core failure
// rides a 2xx { ok:false, error:'failed' } — never a throw.
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
// @synqed-kk/client is ESM; audit()'s durable sink lazy-imports it — mock at
// the seam, same as app-api-stores.test.ts (its own audit() calls hit the
// identical path via createStoreCore).
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))

const mockCapabilities = jest.fn(async () => new Set(['audit.view']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

const staffListByBusinessOrThrow = jest.fn(async (..._a: unknown[]) => [
  { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: (...a: unknown[]) => staffListByBusinessOrThrow(...a),
}))

function coreEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    at: '2026-07-21T00:00:00.000Z',
    actor_id: 'staff-1',
    actor_type: 'staff',
    category: 'customer',
    action: 'customer.edit',
    target_type: 'customer',
    target_id: 'cus-1',
    target_label: null,
    detail: null,
    break_glass: false,
    severity: 'info',
    ...overrides,
  }
}

const auditList = jest.fn(async (_opts: Record<string, unknown>) => ({
  events: [coreEvent()],
  total: 1,
  page: 1,
  page_size: 100,
}))
const fakeClient = { audit: { list: auditList } }
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET } from '@/app/api/app/v1/audit-log/route'
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

const getReq = (query: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  const qs = new URLSearchParams(query).toString()
  return new Request(`https://s/api/app/v1/audit-log${qs ? `?${qs}` : ''}`, {
    headers: { ...auth, ...headers },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['audit.view']))
  staffListByBusinessOrThrow.mockResolvedValue([
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
  ])
  auditList.mockResolvedValue({ events: [coreEvent()], total: 1, page: 1, page_size: 100 })
})

describe('GET /api/app/v1/audit-log', () => {
  it('missing Bearer → 401, zero core reads', async () => {
    const res = await GET(new Request('https://s/api/app/v1/audit-log'), noParams)
    expect(res.status).toBe(401)
    expect(auditList).not.toHaveBeenCalled()
  })

  it('missing audit.view → 403, zero core reads, zero audit() calls', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const lines = await auditLines(async () => {
      const res = await GET(getReq(), noParams)
      expect(res.status).toBe(403)
    })
    expect(auditList).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('constructs the synqed client scoped to the Bearer identity\'s businessId', async () => {
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
  })

  it('filters reach synqed.audit.list with the web action\'s exact query mapping', async () => {
    const res = await GET(
      getReq({
        category: 'customer',
        actorId: 'staff-7',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-06-30T00:00:00.000Z',
        targetId: 'cus-9',
        includeViews: '1',
        breakGlass: '1',
        page: '3',
      }),
      noParams,
    )
    expect(res.status).toBe(200)
    expect(auditList).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'customer',
        actor_id: 'staff-7',
        target_type: 'customer',
        target_id: 'cus-9',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-06-30T00:00:00.000Z',
        break_glass: true,
        page: 3,
        page_size: 100,
      }),
    )
  })

  it('logOpen=1 fires exactly one privacy.audit_log_view row: source facade, actorId = roster self-row id, businessId threaded', async () => {
    const lines = await auditLines(async () => {
      const res = await GET(getReq({ logOpen: '1' }), noParams)
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'privacy',
      action: 'privacy.audit_log_view',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      source: 'facade',
    })
    expect(lines[0].target_id).toBeNull()
  })

  it('logOpen=1 + targetId stamps the target on the open row', async () => {
    const lines = await auditLines(async () => {
      await GET(getReq({ logOpen: '1', targetId: 'cus-9' }), noParams)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ target_type: 'customer', target_id: 'cus-9' })
  })

  it('no logOpen: zero audit() calls AND the roster is never read', async () => {
    const lines = await auditLines(async () => {
      const res = await GET(getReq(), noParams)
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(0)
    expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
  })

  it('a Bearer user absent from the roster + logOpen=1 → actorId:null, not a throw', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'someone-else', full_name: 'X', display_role: 'stylist' },
    ])
    const lines = await auditLines(async () => {
      const res = await GET(getReq({ logOpen: '1' }), noParams)
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].actor_id).toBeNull()
  })

  it('a core failure rides a 2xx { ok:false, error:"failed" } — parity envelope, never a throw', async () => {
    auditList.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, error: 'failed' })
  })

  it('default request (no includeViews) sends exclude_views:true on the main feed call (T2)', async () => {
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    const mainCall = auditList.mock.calls.find(([opts]) => opts.page_size === 100)
    expect(mainCall?.[0].exclude_views).toBe(true)
  })

  it('includeViews:1 omits exclude_views on the main feed call (T2)', async () => {
    const res = await GET(getReq({ includeViews: '1' }), noParams)
    expect(res.status).toBe(200)
    const mainCall = auditList.mock.calls.find(([opts]) => opts.page_size === 100)
    expect(mainCall?.[0].exclude_views).toBeUndefined()
  })

  it('the DTO parse boundary normalizes an absent actor_label to null (T3)', async () => {
    auditList.mockResolvedValue({ events: [coreEvent()], total: 1, page: 1, page_size: 100 })
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; events: { actor_label: string | null }[] }
    expect(body.events[0].actor_label).toBeNull()
  })

  it('the DTO parse boundary passes a real actor_label through verbatim (T3)', async () => {
    auditList.mockResolvedValue({
      events: [coreEvent({ actor_label: '田中 美香' })],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const res = await GET(getReq(), noParams)
    const body = (await res.json()) as { ok: true; events: { actor_label: string | null }[] }
    expect(body.events[0].actor_label).toBe('田中 美香')
  })
})
