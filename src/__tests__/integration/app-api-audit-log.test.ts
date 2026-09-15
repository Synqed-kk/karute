// Facade: 監査ログ list (design-parity packet 17 §S3). Pins: the route shares
// the SAME twin the web listAuditLog() action delegates to
// (listAuditLogWithClient, src/actions/audit-log.ts) · gate is 'audit.view'
// AND 'stores.viewAll' (PR B2 §4, canReadAuditLog — checked BEFORE any
// read) · the client is scoped to the Bearer identity's
// businessId · query filters reach synqed.audit.list with the web action's
// exact mapping · every call fires exactly one privacy.audit_log.view row
// (source:'facade', actorId = roster self-row id, target stamped only when
// present) and pays the roster read on every invocation (contract §3.1,
// PR-M1 — no more client-gated skip) · a Bearer user absent
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

const mockCapabilities = jest.fn(async () => new Set(['audit.view', 'stores.viewAll']))
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
/** Mirrors the real SDK: AuditClient.list is a PROTOTYPE method that reads
 *  `this` — a receiver-losing call in the shared twin rejects here exactly
 *  like prod (same fidelity upgrade as audit-log-action.test.ts; a plain
 *  `{ list }` literal cannot catch that bug class). */
class ThisSensitiveAuditClient {
  constructor(private impl: jest.Mock) {}
  async list(q: unknown) {
    return this.impl(q)
  }
}
// R7-1: customers.list backs resolveTargetLabels' batch — empty by default
// (every OTHER test's coreEvent target_id is 'cus-1', non-UUID, so it never
// reaches this call); the reassign DTO pins below override it.
const customersList = jest.fn(async () => ({ customers: [] as { id: string; name: string }[] }))
const fakeClient = { audit: new ThisSensitiveAuditClient(auditList), customers: { list: customersList } }
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
  // PR B2 §4: the gate is audit.view AND stores.viewAll now — the default
  // fixture carries both so every OTHER test in this file keeps exercising
  // what it always tested. The authz block below overrides this per case.
  mockCapabilities.mockResolvedValue(new Set(['audit.view', 'stores.viewAll']))
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

  // PR B2 §4 (⚖ 8/17 STORE ISOLATION LAW): audit.view ALONE is no longer
  // enough — rows carry no store yet, so a branch-restricted audit.view
  // holder must not read every store's log.
  it('audit.view WITHOUT stores.viewAll → 403, zero core reads, zero audit() calls', async () => {
    mockCapabilities.mockResolvedValue(new Set(['audit.view']))
    const lines = await auditLines(async () => {
      const res = await GET(getReq(), noParams)
      expect(res.status).toBe(403)
    })
    expect(auditList).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('audit.view AND stores.viewAll → 200', async () => {
    mockCapabilities.mockResolvedValue(new Set(['audit.view', 'stores.viewAll']))
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    expect(auditList).toHaveBeenCalled()
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

  it('every call fires exactly one privacy.audit_log.view row: source facade, actorId = roster self-row id, businessId threaded', async () => {
    const lines = await auditLines(async () => {
      const res = await GET(getReq(), noParams)
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'privacy',
      action: 'privacy.audit_log.view',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      source: 'facade',
    })
    expect(lines[0].target_id).toBeNull()
  })

  it('targetId stamps the target on the row', async () => {
    const lines = await auditLines(async () => {
      await GET(getReq({ targetId: 'cus-9' }), noParams)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ target_type: 'customer', target_id: 'cus-9' })
  })

  it('a paging call also reads the roster and fires its own row — per-invocation, not per-open (contract §3.1)', async () => {
    const lines = await auditLines(async () => {
      const res = await GET(getReq({ page: '2' }), noParams)
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(staffListByBusinessOrThrow).toHaveBeenCalled()
  })

  it('a Bearer user absent from the roster → actorId:null, not a throw', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'someone-else', full_name: 'X', display_role: 'stylist' },
    ])
    const lines = await auditLines(async () => {
      const res = await GET(getReq(), noParams)
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

  // The route's OWN exact-totals pin (probe-binding fix follow-through): the
  // twin's count probes must survive the DTO boundary as numbers — this is
  // the assertion that goes null-and-red if a probe ever loses its receiver
  // again, independent of audit-log-action.test.ts's pins on the twin.
  it('exact strip totals ride the DTO: 警告 = nvWarn, 重大 = nvCrit (G2, round-4: counted separately), 緊急 = break-glass total, 変更 = nvAll − nvWarn − nvCrit (Wave V restore)', async () => {
    // exclude_views-sensitive totals so the assertion also proves the twin
    // picked the HIDDEN-state pair (nvWarn 3 / nvCrit 2), not the shown pair
    // (warnAll 8 / critAll 4).
    auditList.mockImplementation(async (opts: Record<string, unknown>) => {
      const total =
        opts.severity === 'warn'
          ? opts.exclude_views
            ? 3
            : 8
          : opts.severity === 'critical'
            ? opts.exclude_views
              ? 2
              : 4
            : opts.break_glass
              ? 4
              : 9
      return { events: [coreEvent()], total, page: 1, page_size: (opts.page_size as number) ?? 100 }
    })
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: true
      warningsTotal: number | null
      criticalTotal: number | null
      breakGlassTotal: number | null
      changesTotal: number | null
    }
    expect(body.warningsTotal).toBe(3)
    expect(body.criticalTotal).toBe(2)
    expect(body.breakGlassTotal).toBe(4)
    // nvAll (exclude_views, no severity → the mock's 9) minus the nv pair.
    expect(body.changesTotal).toBe(9 - 3 - 2)
  })

  // R7-1 (Liam's phone review, 8/23): the facade DTO gains the additive
  // reassign_customer_line field, built by the SAME twin the web action
  // calls — pin 4.
  it('R7-1: reassign_customer_line rides the DTO for a karute.customer_reassign row', async () => {
    customersList.mockResolvedValueOnce({
      customers: [
        { id: '00000000-0000-4000-8000-0000000000f1', name: '田中 美咲' },
        { id: '00000000-0000-4000-8000-0000000000f2', name: '佐藤 花子' },
      ],
    })
    auditList.mockResolvedValue({
      events: [
        coreEvent({
          category: 'karute',
          action: 'karute.customer_reassign',
          target_type: 'karute',
          target_id: 'kar-1',
          detail: {
            from_customer_id: '00000000-0000-4000-8000-0000000000f1',
            to_customer_id: '00000000-0000-4000-8000-0000000000f2',
            same_day_burn_count: 0,
            photo_count: 0,
          },
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; events: { reassign_customer_line?: string }[] }
    expect(body.events[0].reassign_customer_line).toBe('田中 美咲 → 佐藤 花子')
  })

  it('R7-1: a non-reassign row omits reassign_customer_line harmlessly — existing DTO parse pins stay green', async () => {
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; events: { reassign_customer_line?: string }[] }
    expect(body.events[0].reassign_customer_line).toBeUndefined()
  })

  // G2 (round-4 line-audit): the facade twin accepts the two real core
  // literals — 'warn' and 'critical' — straight through; the round-2/3
  // virtual 'warnings' literal is deleted and now falls into "unrecognized".
  it('severity=warn reaches synqed.audit.list as severity "warn" on the main call', async () => {
    const res = await GET(getReq({ severity: 'warn' }), noParams)
    expect(res.status).toBe(200)
    const mainCall = auditList.mock.calls.find(
      ([opts]) => opts.page_size === 100 && opts.severity === 'warn',
    )
    expect(mainCall).toBeDefined()
  })

  it('severity=critical reaches synqed.audit.list as severity "critical" on the main call', async () => {
    const res = await GET(getReq({ severity: 'critical' }), noParams)
    expect(res.status).toBe(200)
    const mainCall = auditList.mock.calls.find(
      ([opts]) => opts.page_size === 100 && opts.severity === 'critical',
    )
    expect(mainCall).toBeDefined()
  })

  it('an unrecognized severity value (e.g. the deleted "warnings" literal, or "info") is ignored — no severity reaches core', async () => {
    for (const value of ['warnings', 'info']) {
      auditList.mockClear()
      const res = await GET(getReq({ severity: value }), noParams)
      expect(res.status).toBe(200)
      const mainCall = auditList.mock.calls.find(([opts]) => opts.page_size === 100)
      expect(mainCall?.[0].severity).toBeUndefined()
    }
  })

  // R1 (round-2 line-audit): the query string is a legal combination even
  // though the shipped UI never produces it — breakGlass wins, mirroring the
  // twin's own normalization.
  it('breakGlass=1 & severity=critical together → severity is ignored, one core read only', async () => {
    const res = await GET(getReq({ breakGlass: '1', severity: 'critical' }), noParams)
    expect(res.status).toBe(200)
    expect(auditList).toHaveBeenCalledTimes(1)
    expect(auditList).toHaveBeenCalledWith(
      expect.objectContaining({ break_glass: true, severity: undefined }),
    )
  })

  // PR D1 amendment 4 F5: targetType reaches synqed.audit.list AND the DTO
  // never widens past the four recognized values.
  it('targetType=recording reaches synqed.audit.list as target_type "recording"', async () => {
    const res = await GET(getReq({ targetId: 'sess-1', targetType: 'recording' }), noParams)
    expect(res.status).toBe(200)
    const mainCall = auditList.mock.calls.find(([opts]) => opts.page_size === 100)
    expect(mainCall?.[0]).toEqual(
      expect.objectContaining({ target_type: 'recording', target_id: 'sess-1' }),
    )
  })

  it('an unrecognized targetType value (e.g. "order") is ignored — falls back to the customer default', async () => {
    const res = await GET(getReq({ targetId: 'cus-9', targetType: 'order' }), noParams)
    expect(res.status).toBe(200)
    const mainCall = auditList.mock.calls.find(([opts]) => opts.page_size === 100)
    expect(mainCall?.[0]).toEqual(
      expect.objectContaining({ target_type: 'customer', target_id: 'cus-9' }),
    )
  })

  // PR D1 §1: request_id/store_id are additive wire fields — same
  // nullable+optional parse-boundary contract as actor_label (T3) above.
  it('request_id/store_id ride the DTO verbatim when core sends them', async () => {
    auditList.mockResolvedValue({
      events: [coreEvent({ request_id: 'req-1', store_id: 'store-9' })],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; events: { request_id: string | null; store_id: string | null }[] }
    expect(body.events[0].request_id).toBe('req-1')
    expect(body.events[0].store_id).toBe('store-9')
  })

  it('the DTO parse boundary normalizes an absent request_id/store_id to null (old cached shape)', async () => {
    auditList.mockResolvedValue({ events: [coreEvent()], total: 1, page: 1, page_size: 100 })
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; events: { request_id: string | null; store_id: string | null }[] }
    expect(body.events[0].request_id).toBeNull()
    expect(body.events[0].store_id).toBeNull()
  })

  // PR D1 §2: the belt's own drop count rides the DTO as a plain number.
  it('folded rides the DTO as a number (0 on an ordinary page)', async () => {
    const res = await GET(getReq(), noParams)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; folded: number }
    expect(body.folded).toBe(0)
  })
})
