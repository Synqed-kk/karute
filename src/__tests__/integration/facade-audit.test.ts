// Audit emitter + facade hook (AUDIT-LOG-DESIGN.md; fix-plan P1 wave A).
// Proves: a facade SUCCESS on a mapped endpoint emits exactly one structured
// audit line with actor/tenant/target ids; list endpoints emit NOTHING (Liam
// ruling 2026-07-17 — names on a list are not a view); errors emit nothing;
// the PIN lockout seam now routes through the same emitter. The interim sink
// is a console JSON line — these tests pin the line shape the future core
// sink replaces. Totality (every FacadeEndpointKey has an explicit row, and
// what an UNMAPPED key does at runtime — CP6's loud floor) moved to
// facade-audit-totality.test.ts as of PR-M4 — FACADE_AUDIT_MAP is now a
// TOTAL Record<FacadeEndpointKey,...>, so "an unmapped endpoint" is no
// longer reachable through this file's normal call form (see that suite's
// `as FacadeEndpointKey` escape hatch).
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'

import { createHmac } from 'node:crypto'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { audit, FACADE_AUDIT_MAP, type FacadeEndpointKey } from '@/lib/audit'
import { recordPinFailure, _resetPinThrottle } from '@/lib/auth/pin-throttle'
import type { VerifierConfig } from '@/lib/auth/verify-bearer'
import { auditLines } from './helpers/audit-lines'

jest.mock('@/lib/staff', () => ({ businessIdForUser: jest.fn(async () => 'business-1') }))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['customers.view'])),
}))

const ISSUER = 'https://testproj.supabase.co/auth/v1'
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

function hs256Token(secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'u1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const SECRET = 'test-jwt-secret-do-not-use-in-prod'
const HS_CONFIG: VerifierConfig = { issuer: ISSUER, audience: 'authenticated', hs256Secret: SECRET, algorithms: ['HS256'] }
const authedReq = () =>
  new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } })

describe('audit() emitter', () => {
  it('emits one label-free JSON line with defaults applied', async () => {
    const lines = await auditLines(async () =>
      audit({
        category: 'settings',
        action: 'settings.permissions_change',
        actorId: 'owner-1',
        actorType: 'staff',
        businessId: 'b-1',
        targetType: 'staff',
        targetId: 's-2',
        source: 'web',
      }),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      evt: 'audit',
      category: 'settings',
      action: 'settings.permissions_change',
      actor_id: 'owner-1',
      business_id: 'b-1',
      target_type: 'staff',
      target_id: 's-2',
      severity: 'info',
      break_glass: false,
      source: 'web',
    })
    expect(typeof lines[0].at).toBe('string')
  })
})

describe('facadeHandler audit hook', () => {
  const route = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) })

  it('a mapped single-record GET emits customer.view with actor + tenant + target ids', async () => {
    const handler = facadeHandler('customer.read', async (ctx) => ok(ctx, { hi: 1 }), { config: HS_CONFIG })
    const lines = await auditLines(() => handler(authedReq(), route({ id: 'c-9' })))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'customer.view',
      category: 'customer',
      actor_id: 'u1',
      business_id: 'business-1',
      target_type: 'customer',
      target_id: 'c-9',
      source: 'facade',
    })
  })

  it('a mapped mutation emits customer.edit', async () => {
    // Mutations are revocation-checked — inject getUser like the handler suite does.
    const handler = facadeHandler('customer.update', async (ctx) => ok(ctx, { ok: true }), {
      config: HS_CONFIG,
      getUser: async () => ({ id: 'u1' }),
    })
    const lines = await auditLines(async () => {
      const res = await handler(authedReq(), route({ id: 'c-9' }))
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'customer.edit', target_id: 'c-9' })
  })

  it('customer.pack.undoRedemption never stamps its route param as the target (fix round F1: that param is a REDEMPTION id, not a customer id)', async () => {
    const handler = facadeHandler('customer.pack.undoRedemption', async (ctx) => ok(ctx, { ok: true }), {
      config: HS_CONFIG,
      getUser: async () => ({ id: 'u1' }),
    })
    // Deliberately named like a redemption id, never a customer id — the
    // wrong-target bug stamped exactly this value as target_type:'customer'.
    const lines = await auditLines(() => handler(authedReq(), route({ id: 'redemption-abc' })))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'customer.pack_undo', category: 'customer' })
    expect(lines[0].target_type).toBeNull()
    expect(lines[0].target_id).toBeNull()
  })

  it('a LIST endpoint emits nothing — names on a list are not a view (Liam 2026-07-17)', async () => {
    const handler = facadeHandler('customers.list', async (ctx) => ok(ctx, { rows: [] }), { config: HS_CONFIG })
    const lines = await auditLines(() => handler(authedReq(), route()))
    expect(lines).toHaveLength(0)
  })

  it('a pendingWave rule emits nothing — decided but not built yet (dated tracked-TODO, C2/F6)', async () => {
    // askAi.read: kind mutation, action ai.consult_session, but pendingWave
    // 'Wave W — 2026-07-27' (contract §3.1, the false AI相談-row fix) — the
    // row exists in the map, so this proves pendingWave gates emission
    // independently of kind/skip.
    const handler = facadeHandler('askAi.read', async (ctx) => ok(ctx, { ok: 1 }), { config: HS_CONFIG })
    const lines = await auditLines(() => handler(authedReq(), route()))
    expect(lines).toHaveLength(0)
  })

  it('a redirect emits nothing — only 2xx reads as a completed action', async () => {
    const handler = facadeHandler(
      'customer.read',
      async () => new Response(null, { status: 302, headers: { location: 'https://s/elsewhere' } }),
      { config: HS_CONFIG },
    )
    const lines = await auditLines(() => handler(authedReq(), route({ id: 'c-9' })))
    expect(lines).toHaveLength(0)
  })

  it('a handler FAILURE emits no audit line — errors are not actions', async () => {
    const handler = facadeHandler(
      'customer.read',
      async () => {
        throw new AppApiError('forbidden', 'no')
      },
      { config: HS_CONFIG },
    )
    const lines = await auditLines(async () => {
      const res = await handler(authedReq(), route({ id: 'c-9' }))
      expect(res.status).toBe(403)
    })
    expect(lines).toHaveLength(0)
  })
})

describe('CP6 loud floor — unmapped endpoint (contract §8)', () => {
  const route = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) })
  // FACADE_AUDIT_MAP is a TOTAL Record<FacadeEndpointKey,...> as of PR-M4 —
  // no route.ts call site can produce a bogus key anymore (tsc rejects it).
  // The `as FacadeEndpointKey` cast below is the JS-boundary escape CP6 is
  // the belt for: a future refactor, or a caller outside this type's reach.
  const prevNodeEnv = process.env.NODE_ENV
  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: prevNodeEnv, configurable: true })
  })

  it('production: console line fires every call; the durable row is rate-limited to one per window', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true })
    const bogusKey = 'totally.unmapped.cp6.rate-limit' as FacadeEndpointKey
    const handler = facadeHandler(bogusKey, async (ctx) => ok(ctx, { ok: 1 }), { config: HS_CONFIG })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const res1 = await handler(authedReq(), route())
    const res2 = await handler(authedReq(), route())
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200) // never breaks the response in production

    const parsed = warnSpy.mock.calls
      .map((args) => {
        try {
          return JSON.parse(String(args[0]))
        } catch {
          return null
        }
      })
      .filter((j): j is Record<string, unknown> => !!j)
    warnSpy.mockRestore()

    const alertLines = parsed.filter((l) => l.evt === 'audit_unmapped_endpoint' && l.endpoint === bogusKey)
    expect(alertLines).toHaveLength(2) // the primary net — fires every call, never rate-limited

    const durableLines = parsed.filter((l) => l.evt === 'audit' && l.action === 'audit.unmapped_endpoint')
    expect(durableLines).toHaveLength(1) // rate-limited — the second call's row is dropped
    expect(durableLines[0]).toMatchObject({ severity: 'warning', detail: { endpoint: bogusKey } })
  })

  it('dev/test: an unmapped key throws — loud while building, never silently mapped', async () => {
    // NODE_ENV stays at its jest default ('test') — no override.
    const bogusKey = 'totally.unmapped.cp6.dev-throw' as FacadeEndpointKey
    const handler = facadeHandler(bogusKey, async (ctx) => ok(ctx, { ok: 1 }), { config: HS_CONFIG })
    const res = await handler(authedReq(), route())
    // facadeHandler's own outer catch turns the throw into an error response
    // (the handler PROMISE still resolves — the facade's outer contract of
    // "always return a Response" is unchanged); the response itself is the
    // loud, impossible-to-miss signal in dev/test.
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('internal')
  })
})

// FACADE_AUDIT_MAP row disposition — parameterized pins (fix round F5). The
// hand-written tests above pin a handful of representative keys; these two
// suites drive facadeHandler for EVERY key in the map so flipping any single
// row's disposition (skip <-> live, dropping pendingWave, changing
// category/action/targetType) is a test failure by construction — the exact
// mistake class the director corrections in this file's history had to catch
// by hand (e.g. undoRedemption's wrong targetType, fixed alongside this).
describe('FACADE_AUDIT_MAP row disposition — every rule, parameterized', () => {
  const route = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) })
  const deps = { config: HS_CONFIG, getUser: async () => ({ id: 'u1' }) }

  // Presence-based, same as FIX 6's logFacadeAudit gate (`'pendingWave' in
  // rule`, not truthiness) — a future empty-string pendingWave marker must
  // still land in this list.
  const silentKeys = (Object.keys(FACADE_AUDIT_MAP) as FacadeEndpointKey[]).filter((key) => {
    const rule = FACADE_AUDIT_MAP[key]
    return rule.kind === 'skip' || 'pendingWave' in rule
  })
  const liveKeys = (Object.keys(FACADE_AUDIT_MAP) as FacadeEndpointKey[]).filter((key) => !silentKeys.includes(key))

  it('sanity: both groups are non-empty (an empty filter would make the loops below silently vacuous)', () => {
    expect(silentKeys.length).toBeGreaterThan(0)
    expect(liveKeys.length).toBeGreaterThan(0)
    expect(silentKeys.length + liveKeys.length).toBe(Object.keys(FACADE_AUDIT_MAP).length)
  })

  it.each(silentKeys)('%s (skip or pendingWave) emits zero audit lines', async (key) => {
    const handler = facadeHandler(key, async (ctx) => ok(ctx, { ok: 1 }), deps)
    const lines = await auditLines(() => handler(authedReq(), route({ id: 'target-1' })))
    expect(lines).toHaveLength(0)
  })

  it.each(liveKeys)(
    "%s (live) emits exactly the rule's category+action; target_id stamps only when targetType is set",
    async (key) => {
      const rule = FACADE_AUDIT_MAP[key]
      const handler = facadeHandler(key, async (ctx) => ok(ctx, { ok: 1 }), deps)
      const lines = await auditLines(() => handler(authedReq(), route({ id: 'target-1' })))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({ category: rule.category, action: rule.action, source: 'facade' })
      if (rule.targetType) {
        expect(lines[0].target_type).toBe(rule.targetType)
        expect(lines[0].target_id).toBe('target-1')
      } else {
        expect(lines[0].target_type).toBeNull()
        expect(lines[0].target_id).toBeNull()
      }
    },
  )
})

describe('PIN lockout routes through the audit emitter', () => {
  beforeEach(() => _resetPinThrottle())

  it('escalating past the failure ceiling emits auth.pin_lockout at warning severity', async () => {
    const lines = await auditLines(async () => {
      const t0 = Date.now()
      for (let i = 0; i < 6; i++) recordPinFailure('staff-a', 'staff-b', t0 + i)
    })
    const lockouts = lines.filter((l) => l.action === 'auth.pin_lockout')
    expect(lockouts.length).toBeGreaterThanOrEqual(1)
    expect(lockouts[0]).toMatchObject({
      category: 'auth',
      severity: 'warning',
      actor_id: 'staff-a',
      target_type: 'staff',
      target_id: 'staff-b',
      source: 'web',
    })
  })
})
