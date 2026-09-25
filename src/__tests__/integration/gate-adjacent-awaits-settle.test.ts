/**
 * The bare awaits NEXT TO the permission gates settle (Round 3 leg 7c,
 * 2026-09-26, D-S29-1).
 *
 * B — customers.ts createCustomer / createQuickCustomer / updateCustomer asked
 * the gate inside a try (leg 7b) but awaited getSynqedClient() BARE right below
 * it. getBusinessId() beneath it throws a typed AppApiError (upstream_unavailable,
 * 502 class · internal, 500 class · membership_inactive), so the action REJECTED:
 * Next.js strips that to a digest, the consumer's blanket catch printed its own
 * toast, and the server never logged the typed [customers] line. Now one try
 * holds the gate, the denial answer and the client build: a typed outage/defect
 * answers the ja failure line (the helper logs it), anything else the file's own
 * translated generic; the denial is byte-for-byte today's.
 *
 * C — recording-upload.ts mintRecordingReadUrl threw on everything. It now
 * SETTLES exactly like its sibling mintRecordingUploadUrl: { url } |
 * { error: 'forbidden' | 'upstream' } — a denied capability and a foreign key
 * are terminal ('forbidden'), a gate throw and a storage failure are
 * infrastructure ('upstream'). coreFailureLine is NOT used there (its line has
 * no consumer at this door). The web port reads the settled shape like the
 * upload mint's: 'error' in read → throw 'could not mint a read URL'.
 *
 * Every row drives the REAL gate (lessons 83/87): can() → getMyCapabilities()
 * against the seam of gate-throw-through-settles.test.ts. getSynqedClient is
 * mocked so B can make it reject per probe; C's getBusinessId and
 * isOwnRecordingKey are the real ones. Denials and ja lines are literals or read
 * from the dictionary, never computed from the code under test.
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
// The REAL ja dictionary behind getTranslations, so a pin compares the exact
// line staff will read (and a wrong namespace/key answers undefined).
jest.mock('next-intl/server', () => {
  const ja = jest.requireActual<Record<string, Record<string, unknown>>>('../../../messages/ja.json')
  return {
    getTranslations: jest.fn(async (ns: string) => (key: string) => ja[ns]?.[key]),
    getLocale: jest.fn(async () => 'ja'),
  }
})
jest.mock('@/lib/audit', () => ({ audit: jest.fn(), auditDurable: jest.fn(async () => true) }))
jest.mock('@/lib/audit-store-lock', () => ({ ensureRecordStoreInScopeAudited: jest.fn() }))
jest.mock('@/lib/audit-web', () => ({
  auditWeb: jest.fn(async () => {}),
  resolveWebActorId: jest.fn(async () => 'actor-1'),
  resolveWebBusinessId: jest.fn(async () => 'biz-1'),
  resolveWebAuditContext: jest.fn(async () => ({ actorId: 'actor-1', businessId: 'biz-1' })),
}))
jest.mock('@/lib/synqed/staff-pager', () => ({ listAllCoreStaff: jest.fn(async () => []) }))
// The roster chain lazily imports the ESM-only SDK; jest cannot load it, so a
// stub client stands in (probe (b) makes its construction throw).
const mockSdk = { constructError: null as Error | null }
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    staff = {}
    constructor() {
      if (mockSdk.constructError) throw mockSdk.constructError
    }
  },
}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))
// getBusinessId made OBSERVABLE, not replaced: a pass-through jest.fn around the
// REAL export, so C(c) can prove the fence never ran. The gate stays real —
// staff.ts's own roster chain calls its getBusinessId through the module's
// internal binding, never through this export, so it is not counted here.
jest.mock('@/lib/staff', () => {
  const actual = jest.requireActual<typeof import('@/lib/staff')>('@/lib/staff')
  return { ...actual, getBusinessId: jest.fn(() => actual.getBusinessId()) }
})

// ── the sources the real roster chain reads + the storage the read door signs with ──
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: { id: 'actor-1' } } }),
    },
  }),
}))
const ROSTER_ROW = {
  id: 'actor-1', full_name: 'Owner', created_at: '2026-01-01T00:00:00Z', display_role: 'owner', position: null,
  email: null, phone: null, avatar_url: null, pin_hash: null, customer_id: 'biz-1', is_management: false,
}
const ROSTER_OK = { data: [ROSTER_ROW], error: null }
const MEMBER_OK = { data: { customer_id: 'biz-1', full_name: 'Owner' }, error: null }
const CAPS_OK = { data: { display_role: 'owner', permission_role: 'owner', permissions: null }, error: null }
let rosterRead: { data: unknown; error: unknown } = ROSTER_OK
let membershipRead: { data: unknown; error: unknown } = MEMBER_OK
let capsRead: { data: unknown; error: unknown } = CAPS_OK
const mockStorage = {
  createSignedUrl: jest.fn(
    async (): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> => ({
      data: null,
      error: null,
    }),
  ),
}
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'ilike', 'not', 'in']) chain[m] = () => chain
    chain.single = async () => membershipRead // businessIdForUser
    chain.order = async () => rosterRead // staffListCore's profiles read
    chain.maybeSingle = async () => capsRead // capabilitiesForUser: the caller's own row
    return {
      from: () => chain,
      storage: { from: () => ({ createSignedUrl: mockStorage.createSignedUrl }) },
    }
  },
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppApiError } from '@/lib/app-api/errors'
import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId } from '@/lib/staff'
import { listAllCoreStaff } from '@/lib/synqed/staff-pager'
import { composeTakeKey } from '@/lib/recording/key-grammar'
import { createCustomer, createQuickCustomer, updateCustomer } from '@/actions/customers'
import { mintRecordingReadUrl } from '@/actions/recording-upload'
import { webRecordingPort } from '@/lib/ports/recording-port'

const JA = JSON.parse(readFileSync(join(process.cwd(), 'messages', 'ja.json'), 'utf8'))
/** THE FAILURE LINE, read from the dictionary — never retyped. */
const FAILURE_LINE: string = JA.common.somethingWentWrong
const NO_PERMISSION_JA = 'この操作を行う権限がありません。'
const SOMETHING_WENT_WRONG_JA = 'エラーが発生しました。'
const HELPER_LABEL = 'typed synqed-core failure'

const UUID = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const OWN = composeTakeKey('biz-1', UUID, 'audio/webm')!.key
const FOREIGN = composeTakeKey('biz-2', UUID, 'audio/webm')!.key
const SIGNED = `https://proj.supabase.co/storage/v1/object/sign/recordings/${OWN}?token=r`

const clientMock = getSynqedClient as unknown as jest.Mock
const coreRoster = listAllCoreStaff as unknown as jest.Mock
const fakeClient = {
  customers: {
    checkDuplicate: jest.fn(async () => ({ exists: false })),
    create: jest.fn(async (i: { name: string }) => ({ id: 'cust-new', name: i.name })),
    update: jest.fn(async () => ({})),
  },
}

const ENV_KEYS = ['SYNQED_CORE_URL', 'SYNQED_CORE_API_KEY'] as const
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}
beforeAll(() => {
  // The synqed-core half of the roster read (probe (b)) runs only with core env present.
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.SYNQED_CORE_URL = 'http://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-key'
})
afterAll(() => {
  // Assigning undefined to process.env stores the STRING 'undefined' — delete instead.
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

let consoleError: jest.SpyInstance
let consoleWarn: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  rosterRead = ROSTER_OK
  membershipRead = MEMBER_OK
  capsRead = CAPS_OK
  mockSdk.constructError = null
  coreRoster.mockImplementation(async () => [])
  clientMock.mockImplementation(async () => fakeClient)
  mockStorage.createSignedUrl.mockImplementation(async () => ({ data: { signedUrl: SIGNED }, error: null }))
})
afterEach(() => {
  consoleError.mockRestore()
  consoleWarn.mockRestore()
})

/** Gate probes through the REAL gate (the 7b seam). */
function armGate(probe: 'a' | 'b' | 'c') {
  if (probe === 'a') capsRead = { data: null, error: { code: 'PGRST000', message: 'connection refused' } }
  if (probe === 'b') mockSdk.constructError = new Error('bad client config')
  if (probe === 'c') rosterRead = { data: [], error: null }
}
const helperLines = () => consoleError.mock.calls.filter((c) => String(c[0]).includes(HELPER_LABEL))
const siteLines = () => consoleError.mock.calls.filter((c) => c[0] === '[customers]')

// ── B ──────────────────────────────────────────────────────────────────────
const B_SITES = [
  {
    fn: 'createCustomer',
    call: () => createCustomer({ name: '山田 花子' } as Parameters<typeof createCustomer>[0]),
    ok: { success: true, id: 'cust-new' },
  },
  { fn: 'createQuickCustomer', call: () => createQuickCustomer('山田'), ok: { success: true, id: 'cust-new', name: '山田' } },
  { fn: 'updateCustomer', call: () => updateCustomer('cust-1', { notes: 'memo' }), ok: { success: true, id: 'cust-1' } },
] as const

describe('the literals', () => {
  it('THE FAILURE LINE (read from ja) and the ja literals are the dictionary\'s own', () => {
    expect(FAILURE_LINE).toBe(SOMETHING_WENT_WRONG_JA)
    expect(JA.common.noPermission).toBe(NO_PERMISSION_JA)
  })
  it('the own key is a take of biz-1 and the foreign one is not', () => {
    expect(OWN.startsWith('app_biz-1_')).toBe(true)
    expect(FOREIGN.startsWith('app_biz-2_')).toBe(true)
  })
})

describe.each(B_SITES)('B $fn — the bare getSynqedClient() beside the gate settles', (site) => {
  it.each([
    ['a', 'upstream_unavailable'],
    ['b', 'internal'],
  ] as const)('(%s) getSynqedClient rejects AppApiError %s → the failure line, one helper line', async (_p, code) => {
    clientMock.mockRejectedValue(new AppApiError(code, 'Business membership lookup failed'))
    await expect(site.call()).resolves.toStrictEqual({ success: false, error: FAILURE_LINE })
    const lines = helperLines()
    expect(lines).toHaveLength(1)
    expect(String(lines[0][0])).toContain(`[customers] ${HELPER_LABEL} (${code})`)
  })

  it('(c) gate FALSE → today\'s denial byte-for-byte; no client build, the helper logs nothing', async () => {
    armGate('c')
    await expect(site.call()).resolves.toStrictEqual({ success: false, error: NO_PERMISSION_JA })
    expect(clientMock).not.toHaveBeenCalled()
    expect(helperLines()).toHaveLength(0)
  })

  it('(d) getSynqedClient rejects membership_inactive → the file\'s own translated generic', async () => {
    clientMock.mockRejectedValue(new AppApiError('membership_inactive', 'No active business membership for this user'))
    await expect(site.call()).resolves.toStrictEqual({ success: false, error: SOMETHING_WENT_WRONG_JA })
    expect(helperLines()).toHaveLength(0)
    expect(siteLines()).toHaveLength(1)
  })

  it('(e) getSynqedClient rejects a plain Error → the same generic, the helper logs nothing', async () => {
    clientMock.mockRejectedValue(new Error('boom'))
    await expect(site.call()).resolves.toStrictEqual({ success: false, error: SOMETHING_WENT_WRONG_JA })
    expect(helperLines()).toHaveLength(0)
    expect(siteLines()).toHaveLength(1)
  })

  it('(f) happy path unchanged — the writer\'s own result', async () => {
    await expect(site.call()).resolves.toStrictEqual(site.ok)
    expect(clientMock).toHaveBeenCalledTimes(1)
    expect(helperLines()).toHaveLength(0)
    expect(siteLines()).toHaveLength(0)
  })
})

// ── C ──────────────────────────────────────────────────────────────────────
const warnedFailed = () => consoleWarn.mock.calls.filter((c) => c[0] === '[mintRecordingReadUrl] failed:')

describe('C mintRecordingReadUrl — settles like mintRecordingUploadUrl (D-S29-1)', () => {
  it.each(['a', 'b'] as const)('(%s) typed gate throw → { error: \'upstream\' }, warned, no helper line', async (probe) => {
    armGate(probe)
    await expect(mintRecordingReadUrl(OWN)).resolves.toStrictEqual({ error: 'upstream' })
    expect(warnedFailed()).toHaveLength(1)
    // The probe really was the typed gate throw (not some other failure).
    expect(warnedFailed()[0][1]).toMatchObject({
      name: 'AppApiError',
      code: probe === 'a' ? 'upstream_unavailable' : 'internal',
    })
    expect(mockStorage.createSignedUrl).not.toHaveBeenCalled()
    expect(helperLines()).toHaveLength(0)
  })

  it('(c) gate FALSE → { error: \'forbidden\' }, storage never called', async () => {
    armGate('c')
    await expect(mintRecordingReadUrl(OWN)).resolves.toStrictEqual({ error: 'forbidden' })
    expect(mockStorage.createSignedUrl).not.toHaveBeenCalled()
    // The gate answers BEFORE the fence: the fence's first act (who is the caller's business?) never ran.
    expect(getBusinessId).not.toHaveBeenCalled()
  })

  it('(g) gate TRUE, a foreign key → { error: \'forbidden\' } (terminal), storage never called', async () => {
    await expect(mintRecordingReadUrl(FOREIGN)).resolves.toStrictEqual({ error: 'forbidden' })
    expect(mockStorage.createSignedUrl).not.toHaveBeenCalled()
  })

  it('(h) gate TRUE, own key, storage answers an error → { error: \'upstream\' }', async () => {
    mockStorage.createSignedUrl.mockImplementation(async () => ({ data: null, error: { message: 'storage down' } }))
    await expect(mintRecordingReadUrl(OWN)).resolves.toStrictEqual({ error: 'upstream' })
    expect(mockStorage.createSignedUrl).toHaveBeenCalledWith(OWN, 3600)
  })

  it('(i) gate TRUE, own key, storage signs → { url }', async () => {
    await expect(mintRecordingReadUrl(OWN)).resolves.toStrictEqual({ url: SIGNED })
    expect(mockStorage.createSignedUrl).toHaveBeenCalledWith(OWN, 3600)
  })

  it('shape pin (tsc): the settled union is not a bare { url } without narrowing', () => {
    const settled = null as unknown as Awaited<ReturnType<typeof mintRecordingReadUrl>>
    // @ts-expect-error — D-S29-1: { error } is an arm; a caller must narrow with `'error' in …`
    const bare: { url: string } = settled
    expect(bare).toBeNull()
  })
})

// ── the port reads the settled shape (the REAL chain, no action mock) ─────────
describe('port prepareTranscription — reads the settled read door', () => {
  const blob = () => new Blob([new Uint8Array(8)], { type: 'audio/webm' })

  it('gate FALSE → rejects with the port\'s own "could not mint a read URL"', async () => {
    armGate('c')
    await expect(webRecordingPort.prepareTranscription(blob(), OWN, undefined)).rejects.toThrow(
      new Error('could not mint a read URL'),
    )
    expect(mockStorage.createSignedUrl).not.toHaveBeenCalled()
  })

  it('(i) own key, storage signs → { body: { audioUrl } }', async () => {
    await expect(webRecordingPort.prepareTranscription(blob(), OWN, undefined)).resolves.toStrictEqual({
      body: { audioUrl: SIGNED },
      path: OWN,
      recordingSessionId: null,
    })
  })
})
