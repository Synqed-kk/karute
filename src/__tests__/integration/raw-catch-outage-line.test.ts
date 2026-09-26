/**
 * A synqed-core OUTAGE inside a WRITE catch answers the failure line (S33, Round 3 —
 * the raw-English-line class, leg 1; D-S33-1/2).
 *
 * coreFailureLine answers only a TYPED AppApiError. A direct SDK call never throws one:
 * a non-2xx is the SDK's own SynqedError (`status` + core's own text), a network drop a
 * native TypeError ('fetch failed'). So six write catches printed English during an
 * outage — the PIN pad (web AND phone: the facade calls the same cores), 結果の記録,
 * 同意の取得, the settings sections, カルテ delete. classifyCoreThrow maps exactly those
 * two outage shapes onto the typed class; every other throw keeps main's answer
 * byte-for-byte (values taken from origin/main 7300314c6).
 *
 * Lesson 83/87: each site runs its REAL exported action — the real roster chain and the
 * real gate (an owner, so the try reaches the SDK call); only the SOURCES are mocked
 * (supabase, the client factory, the SDK method under test). Every row asserts the armed
 * SDK method actually ran, so a gate refusal can never pass for a pinned answer.
 * Probes: T  TypeError('fetch failed') · S5 SynqedError 503 · S4 SynqedError 409 ·
 *         D  a plain-Error denial thrown in the same try.
 */
// The PIN facade route's Bearer verifier + revocation round-trip (app-api-staff-pin.test.ts's harness).
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'actor-1' } }, error: null }) } }),
}))
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
// The REAL ja dictionary behind getTranslations, so a pin compares the exact line staff read.
jest.mock('next-intl/server', () => {
  const ja = jest.requireActual<Record<string, Record<string, unknown>>>('../../../messages/ja.json')
  return {
    getTranslations: jest.fn(async (ns: string) => (key: string) => ja[ns]?.[key]),
    getLocale: jest.fn(async () => 'ja'),
  }
})
jest.mock('@/lib/audit', () => ({
  audit: jest.fn(),
  auditDurable: jest.fn(async () => true),
  // facadeHandler classifies its audit row from the real table.
  FACADE_AUDIT_MAP: jest.requireActual<typeof import('@/lib/audit')>('@/lib/audit').FACADE_AUDIT_MAP,
}))
jest.mock('@/lib/audit-store-lock', () => ({ ensureRecordStoreInScopeAudited: jest.fn() }))
jest.mock('@/lib/audit-web', () => ({
  auditWeb: jest.fn(async () => {}),
  resolveWebActorId: jest.fn(async () => 'actor-1'),
  resolveWebBusinessId: jest.fn(async () => 'biz-1'),
  resolveWebAuditContext: jest.fn(async () => ({ actorId: 'actor-1', businessId: 'biz-1' })),
}))
// The lock's scope source (cookies + the primary-store read) — an owner's viewAll scope.
jest.mock('@/lib/auth/store-scope', () => ({
  ...jest.requireActual<typeof import('@/lib/auth/store-scope')>('@/lib/auth/store-scope'),
  resolveStoreScope: jest.fn(async () => ({ storeId: null, viewAll: true, allowedStoreIds: null, degraded: false })),
}))
jest.mock('@/lib/synqed/staff-pager', () => ({ listAllCoreStaff: jest.fn(async () => []) }))
// staff.ts lazily imports the ESM-only SDK; jest cannot load it, so a stub stands in.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    staff = {}
  },
}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

// ── the sources the real roster chain reads (the caller is the owner) ────────
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: { id: 'actor-1' } } }),
    },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'ilike', 'not', 'in']) chain[m] = () => chain
    chain.single = async () => ({ data: { customer_id: 'biz-1', full_name: 'Owner' }, error: null })
    chain.order = async () => ({
      data: [
        {
          id: 'actor-1', full_name: 'Owner', created_at: '2026-01-01T00:00:00Z', display_role: 'owner', position: null,
          email: null, phone: null, avatar_url: null, pin_hash: null, customer_id: 'biz-1', is_management: false,
        },
      ],
      error: null,
    })
    chain.maybeSingle = async () => ({
      data: { display_role: 'owner', permission_role: 'owner', permissions: null },
      error: null,
    })
    return { from: () => chain }
  },
}))

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppApiError } from '@/lib/app-api/errors'
import { classifyCoreThrow } from '@/lib/auth/core-failure-line'
import { STORE_SCOPE_UNVERIFIED } from '@/lib/auth/store-lock'
import { ensureRecordStoreInScopeAudited } from '@/lib/audit-store-lock'
import { getSynqedClient, newSynqedClient } from '@/lib/synqed/client'
import { setStaffPin, removeStaffPin, setStaffPinCore, removeStaffPinCore } from '@/actions/staff-pin'
import { updateKaruteOutcome } from '@/actions/karute-outcome'
import { grantCustomerConsent } from '@/actions/customers'
import { upsertOrgSettings, writeOrgSettingsBlobWithClient } from '@/actions/org-settings'
import { deleteKaruteRecord } from '@/actions/karute'
import { PUT, DELETE } from '@/app/api/app/v1/staff/[id]/pin/route'

const JA = JSON.parse(readFileSync(join(process.cwd(), 'messages', 'ja.json'), 'utf8'))
const FAILURE_LINE: string = JA.common.somethingWentWrong
const DENIAL = 'You do not have permission to perform this action.'

/** The SDK's own class, byte-for-byte (node_modules/@synqed-kk/client/dist/client.js:145-151). */
class SynqedError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'SynqedError'
  }
}

describe('classifyCoreThrow — maps ONLY the two SDK outage shapes onto the typed class', () => {
  const outage = (e: unknown, message: string) => {
    const out = classifyCoreThrow(e)
    expect(out).toBeInstanceOf(AppApiError)
    expect(out).toMatchObject({ name: 'AppApiError', code: 'upstream_unavailable', status: 502, message })
    // The original rides `cause` (non-enumerable, never on the wire).
    expect((out as Error).cause).toBe(e)
  }

  it('a network drop (TypeError) → upstream_unavailable, the original on cause', () => {
    outage(new TypeError('fetch failed'), 'synqed-core call failed (TypeError): fetch failed')
  })

  it.each([500, 502, 503])('an SDK %i → upstream_unavailable, the status + core text in the message', (status) => {
    outage(new SynqedError(status, 'synqed-core: down'), `synqed-core call failed (SynqedError ${status}): synqed-core: down`)
  })

  it.each([400, 403, 404, 409, 499])('an SDK %i is core\'s own refusal → the SAME object back', (status) => {
    const e = new SynqedError(status, 'refused')
    expect(classifyCoreThrow(e)).toBe(e)
  })

  it.each([
    ['a plain-Error denial', new Error(DENIAL)],
    ['an AppApiError internal (status 500 — not an SDK error)', new AppApiError('internal', 'synqed-core client unavailable')],
    ['an AppApiError upstream_unavailable', new AppApiError('upstream_unavailable', 'synqed-core roster fetch failed')],
    ['an AppApiError store_forbidden', new AppApiError('store_forbidden', STORE_SCOPE_UNVERIFIED)],
    ['an AppApiError not_found', new AppApiError('not_found', 'karute record not found')],
    ['an Error named SynqedError with a non-numeric status', Object.assign(new SynqedError(503, 'x'), { status: '503' })],
    ['a plain object shaped like an SDK error', { name: 'SynqedError', status: 503, message: 'x' }],
    ['a string', 'fetch failed'],
    ['null', null],
    ['undefined', undefined],
  ])('%s → the SAME value back', (_label, e) => {
    expect(classifyCoreThrow(e)).toBe(e)
  })

  it('the SDK still names its error class the way the classifier recognises it', () => {
    const sdk = readFileSync(join(process.cwd(), 'node_modules', '@synqed-kk', 'client', 'dist', 'client.js'), 'utf8')
    expect(sdk).toContain("this.name = 'SynqedError';")
    expect(sdk).toContain('this.status = status;')
    expect(sdk).toContain('throw new SynqedError(res.status,')
  })

  it('a throwing status or name getter → the SAME object back, never a throw inside the catch', () => {
    class HostileStatus extends Error {
      name = 'SynqedError'
      get status(): number {
        throw new Error('status getter')
      }
    }
    class HostileName extends Error {
      status = 503
      get name(): string {
        throw new Error('name getter')
      }
    }
    for (const e of [new HostileStatus('x'), new HostileName('x')]) {
      expect(() => classifyCoreThrow(e)).not.toThrow()
      expect(classifyCoreThrow(e)).toBe(e)
    }
  })
})

// ── the six write catches, through the REAL actions ──────────────────────────
const sdk = {
  staff: { setPin: jest.fn(), removePin: jest.fn() },
  karuteRecords: { get: jest.fn(), delete: jest.fn() },
  customers: { grantConsent: jest.fn() },
  orgSettings: { get: jest.fn(), upsert: jest.fn() },
}
const RECORD = { id: 'karute-1', store_id: null, customer_id: 'cust-1', staff_id: 'actor-1', recording_session_id: null, appointment_id: null }
const storeLock = ensureRecordStoreInScopeAudited as unknown as jest.Mock

let consoleError: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  sdk.staff.setPin.mockImplementation(async () => undefined)
  sdk.staff.removePin.mockImplementation(async () => undefined)
  sdk.karuteRecords.get.mockImplementation(async () => RECORD)
  sdk.karuteRecords.delete.mockImplementation(async () => undefined)
  sdk.customers.grantConsent.mockImplementation(async () => ({ id: 'consent-1' }))
  sdk.orgSettings.get.mockImplementation(async () => ({ settings: {} }))
  sdk.orgSettings.upsert.mockImplementation(async () => ({}))
  storeLock.mockImplementation(() => undefined)
  ;(getSynqedClient as unknown as jest.Mock).mockImplementation(async () => sdk)
})
afterEach(() => consoleError.mockRestore())

const failureLogs = (tag: string) =>
  consoleError.mock.calls.filter((c) => String(c[0]).startsWith(`${tag} typed synqed-core failure (upstream_unavailable):`))
const anyFailureLog = () => consoleError.mock.calls.filter((c) => String(c[0]).includes('typed synqed-core failure'))

interface Site {
  fn: string
  tag: string
  /** The SDK method the site's try calls — armed to reject, asserted to have run. */
  method: jest.Mock
  call: () => Promise<unknown>
  /** The site's result shape around the error string. */
  wrap: (error: string) => unknown
  /** Main's answer for a non-outage throw — the `??` fallback, byte-for-byte. */
  fallback: (e: Error) => string
  /** Core's own 4xx refusal text for this call. */
  refusal: string
}
const errorOnly = (error: string) => ({ error })
const rawMessage = (e: Error) => e.message

const SITES: Site[] = [
  {
    fn: 'setStaffPin',
    tag: '[staff-pin]',
    method: sdk.staff.setPin,
    call: () => setStaffPin('actor-1', '1234'),
    wrap: errorOnly,
    fallback: rawMessage,
    refusal: 'PIN already set',
  },
  {
    fn: 'removeStaffPin',
    tag: '[staff-pin]',
    method: sdk.staff.removePin,
    call: () => removeStaffPin('actor-1'),
    wrap: errorOnly,
    fallback: rawMessage,
    refusal: 'No PIN to remove',
  },
  {
    fn: 'updateKaruteOutcome',
    tag: '[karute-outcome]',
    method: sdk.karuteRecords.get,
    call: () => updateKaruteOutcome('karute-1', { status: 'success' }),
    wrap: errorOnly,
    // 'karute record not found' is a matched literal (12+ tests) — its bytes stay.
    fallback: () => 'karute record not found',
    refusal: 'Karute record not found',
  },
  {
    fn: 'grantCustomerConsent',
    tag: '[customers]',
    method: sdk.customers.grantConsent,
    call: () => grantCustomerConsent('cust-1'),
    wrap: (error) => ({ ok: false, error }),
    fallback: rawMessage,
    refusal: 'Consent already granted',
  },
  {
    fn: 'upsertOrgSettings',
    tag: '[org-settings]',
    method: sdk.orgSettings.upsert,
    call: () => upsertOrgSettings({ salon_name: 'Salon' }),
    wrap: errorOnly,
    fallback: rawMessage,
    refusal: 'Settings version conflict',
  },
  {
    fn: 'deleteKaruteRecord',
    tag: '[karute]',
    method: sdk.karuteRecords.delete,
    call: () => deleteKaruteRecord('karute-1'),
    wrap: errorOnly,
    fallback: rawMessage,
    refusal: 'Karute record is locked',
  },
]

type Probe = 'T' | 'S5' | 'S4' | 'D'
const throwFor = (site: Site, probe: Probe): Error =>
  ({
    T: () => new TypeError('fetch failed'),
    S5: () => new SynqedError(503, 'synqed-core: Service Unavailable'),
    S4: () => new SynqedError(409, site.refusal),
    D: () => new Error(DENIAL),
  })[probe]()
const OUTAGE_LOG = {
  T: { errName: 'AppApiError', errStatus: 502, errMessage: 'synqed-core call failed (TypeError): fetch failed' },
  S5: {
    errName: 'AppApiError',
    errStatus: 502,
    errMessage: 'synqed-core call failed (SynqedError 503): synqed-core: Service Unavailable',
  },
}

describe('THE FAILURE LINE is the ja common.somethingWentWrong', () => {
  it('reads エラーが発生しました。', () => {
    expect(FAILURE_LINE).toBe('エラーが発生しました。')
  })
})

describe.each(SITES)('$fn — a write catch around a raw SDK call', (site) => {
  it.each(['T', 'S5'] as const)(
    '(%s) a synqed-core outage → the failure line, one bounded log carrying the code and the SDK detail',
    async (probe) => {
      site.method.mockImplementation(async () => Promise.reject(throwFor(site, probe)))
      const res = await site.call()
      expect(site.method).toHaveBeenCalledTimes(1)
      expect(res).toEqual(site.wrap(FAILURE_LINE))
      const lines = failureLogs(site.tag)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toHaveLength(2)
      expect(lines[0][1]).toEqual(OUTAGE_LOG[probe])
    },
  )

  it.each(['S4', 'D'] as const)('(%s) core\'s own refusal / a denial → main\'s answer, byte-for-byte', async (probe) => {
    const thrown = throwFor(site, probe)
    site.method.mockImplementation(async () => Promise.reject(thrown))
    const res = await site.call()
    expect(site.method).toHaveBeenCalledTimes(1)
    expect(res).toEqual(site.wrap(site.fallback(thrown)))
    expect(anyFailureLog()).toHaveLength(0)
  })
})

describe('updateKaruteOutcome — the store lock\'s own AppApiError refusals keep their message', () => {
  it.each([
    ['store_forbidden (a degraded scope)', new AppApiError('store_forbidden', STORE_SCOPE_UNVERIFIED)],
    ['not_found (out of store)', new AppApiError('not_found', 'karute record not found')],
  ])('%s → err.message, no failure line', async (_label, refusal) => {
    storeLock.mockImplementation(() => {
      throw refusal
    })
    const res = await updateKaruteOutcome('karute-1', { status: 'success' })
    expect(sdk.karuteRecords.get).toHaveBeenCalledTimes(1)
    expect(storeLock).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ error: refusal.message })
    expect(anyFailureLog()).toHaveLength(0)
  })

  it('a core 404 on the read keeps the exact bytes \'karute record not found\'', async () => {
    sdk.karuteRecords.get.mockImplementation(async () => Promise.reject(new SynqedError(404, 'Karute record not found')))
    expect(await updateKaruteOutcome('karute-1', { status: 'success' })).toEqual({ error: 'karute record not found' })
  })
})

// The phone's PIN pad and settings PATCH call these exact cores and pass `{ error }` through
// verbatim (staff/[id]/pin/route.ts, org-settings/route.ts) — so the fix lives in the core.
describe('the phone doors share the cores — the line rides the facade\'s 2xx body too', () => {
  const facade = { actorId: 'auth-user-1', source: 'facade' as const, requestId: 'req-1' }
  const client = sdk as never
  it.each([
    ['setStaffPinCore', () => setStaffPinCore(client, 'biz-1', facade, 'actor-1', '1234', 'actor-1'), sdk.staff.setPin],
    ['removeStaffPinCore', () => removeStaffPinCore(client, 'biz-1', facade, 'actor-1', 'actor-1'), sdk.staff.removePin],
    ['writeOrgSettingsBlobWithClient', () => writeOrgSettingsBlobWithClient(client, { salon_name: 'Salon' }), sdk.orgSettings.upsert],
  ] as const)('%s: an outage → the line; core\'s own 4xx → its own bytes', async (_fn, call, method) => {
    method.mockImplementation(async () => Promise.reject(new TypeError('fetch failed')))
    expect(await call()).toEqual({ error: FAILURE_LINE })
    method.mockImplementation(async () => Promise.reject(new SynqedError(409, 'refused by core')))
    expect(await call()).toEqual({ error: 'refused by core' })
    expect(method).toHaveBeenCalledTimes(2)
  })
})


// The phone's PIN pad itself: the REAL facade route (Bearer verify → identity → roster self →
// the shared core), its 2xx business-result passthrough carrying the core's answer.
describe('PIN facade route — the phone reads the same answer in the 2xx body', () => {
  const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
  const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const bearer = () => {
    const now = Math.floor(Date.now() / 1000)
    const head = b64({ alg: 'HS256', typ: 'JWT' })
    const body = b64({ sub: 'actor-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
    return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`
  }
  const url = 'https://s/api/app/v1/staff/actor-1/pin'
  const params = { params: Promise.resolve({ id: 'actor-1' }) }
  const routes = [
    ['PUT', sdk.staff.setPin, () =>
      PUT(new Request(url, { method: 'PUT', headers: { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' }, body: JSON.stringify({ pin: '1234' }) }), params)],
    ['DELETE', sdk.staff.removePin, () =>
      DELETE(new Request(url, { method: 'DELETE', headers: { authorization: `Bearer ${bearer()}` } }), params)],
  ] as const
  beforeEach(() => (newSynqedClient as unknown as jest.Mock).mockImplementation(() => sdk))

  it.each(routes)('%s: a network drop on the SDK write → 200 { error: the ja line }', async (_m, method, run) => {
    method.mockImplementation(async () => Promise.reject(new TypeError('fetch failed')))
    const res = await run()
    expect(method).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: FAILURE_LINE })
    expect(failureLogs('[staff-pin]')).toHaveLength(1)
  })

  it.each(routes)('%s: core\'s own 409 → 200 with its message byte-for-byte (main\'s answer)', async (_m, method, run) => {
    method.mockImplementation(async () => Promise.reject(new SynqedError(409, 'PIN already set')))
    const res = await run()
    expect(method).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'PIN already set' })
    expect(anyFailureLog()).toHaveLength(0)
  })
})
