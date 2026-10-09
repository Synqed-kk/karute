/**
 * PR-K commit 3 — THE LAYER-OFF PROOF (PACKET-S64-PRK commit 3).
 *
 * `RECORDING_SWITCHES.finalizeProbe` OFF must be exactly what it was before
 * PR-K: the ORIGINAL pre-K bucket shapes (the mint: `info`,
 * `createSignedUploadUrl`, `upload`; finalize: `info` alone) answer every call,
 * a method PR-K could newly reach (`list`, `download`, …) is recorded as a
 * STRAY and must stay at zero, and a build-32 body carrying `partial` under OFF
 * makes the same storage calls and gets the same answer as a build-31 body.
 *
 * ON, the cost PR-K claims (none) is MEASURED: the staged door with `partial`
 * still makes exactly info + one sign + one create-only upload — the mark
 * merely moved to the staged key — and finalize's partial refusal still makes
 * info + one sign + one upload.
 */

const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))

const mockSwitches = { finalizeProbe: false }
jest.mock('@/lib/recording/recording-switches', () => ({
  RECORDING_SWITCHES: {
    bindUnboundUploads: false,
    captureWarningNotice: true,
    get finalizeProbe() {
      return mockSwitches.finalizeProbe
    },
  },
}))

/** Every storage call, in order, as `[method, key]`; a method outside the
 *  door's original shape is a stray. */
const mockCalls: Array<[string, string]> = []
const mockStray: string[] = []
const mockShape: { methods: readonly string[] } = { methods: [] }
const mockHeld = new Map<string, number>()
const mockMarks = new Set<string>()
const mockMethod = (name: string) => async (key: string, ..._rest: unknown[]) => {
  mockCalls.push([name, key])
  switch (name) {
    case 'info':
      return mockHeld.has(key)
        ? { data: { size: mockHeld.get(key) }, error: null }
        : { data: null, error: { message: 'Object not found', status: 404, statusCode: '404' } }
    case 'createSignedUploadUrl':
      return { data: { path: key, signedUrl: `https://proj.supabase.co/upload/${key}`, token: 't' }, error: null }
    case 'createSignedUrl':
      return { data: { signedUrl: `https://proj.supabase.co/sign/${key}` }, error: null }
    case 'upload':
      if (mockMarks.has(key)) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
      mockMarks.add(key)
      return { data: { path: key }, error: null }
    default:
      return { data: null, error: { message: 'unexpected' } }
  }
}
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () =>
        new Proxy(
          {},
          {
            get(_t, prop: string) {
              if (!mockShape.methods.includes(prop)) mockStray.push(prop)
              return mockMethod(prop)
            },
          },
        ),
    },
  }),
}))

import { mintTakeUploadUrl, type MintTakeActor } from '@/lib/recording/mint-take-url'
import { finalizeTakeWithClient, type FinalizeTakeActor } from '@/lib/recording/finalize-take'
import { composeMarkKey, composeStagedKey } from '@/lib/recording/key-grammar'
import { HEADERLESS_HEAD, rangedHeadFetch } from './helpers/container-head-fetch'

const BIZ = 'biz-1'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const FOREIGN = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const KEY = `app_${BIZ}_${TAKE}.webm`
const MINT_ORIGINAL = ['info', 'createSignedUploadUrl', 'upload'] as const
const FINALIZE_ORIGINAL = ['info'] as const

let pointer: string | null = KEY
const row = () => ({
  id: SESSION,
  business_id: BIZ,
  staff_id: 'staff-1',
  customer_id: 'cust-1',
  status: 'UPLOADING',
  audio_storage_path: pointer,
  duration_seconds: null,
  store_id: null,
})
const synqed = {
  recordings: { get: jest.fn(async () => row()), update: jest.fn(async (id: string) => ({ ...row(), id })) },
} as never
const mintActor = (): MintTakeActor => ({
  staffId: 'staff-1',
  businessId: BIZ,
  holdsOwnerKeys: false,
  allowedStoreIds: null,
  bindIdentity: async () => null,
  source: 'facade',
})
const finActor: FinalizeTakeActor = { staffId: 'staff-1', businessId: BIZ, holdsOwnerKeys: false, allowedStoreIds: null, source: 'facade' }
const mint = (body: Record<string, unknown>) => mintTakeUploadUrl(synqed, mintActor(), body)
const FINALIZE_BODY = { takeId: TAKE, mimeType: 'audio/webm', durationSeconds: 42.7, byteLength: 1024, recordingSessionId: SESSION }
const finalize = (extra: Record<string, unknown> = {}) =>
  finalizeTakeWithClient(synqed, finActor, { ...FINALIZE_BODY, ...extra } as never)
const fetchMock = jest.fn()
const originalFetch = global.fetch

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  mockSwitches.finalizeProbe = false
  mockCalls.length = 0
  mockStray.length = 0
  mockHeld.clear()
  mockMarks.clear()
  pointer = KEY
  fetchMock.mockImplementation(rangedHeadFetch(206, HEADERLESS_HEAD))
  global.fetch = fetchMock as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = originalFetch
})

describe('layer-off — the staged door under OFF, the ORIGINAL pre-K mint bucket', () => {
  beforeEach(() => {
    mockShape.methods = MINT_ORIGINAL
  })

  it.each([
    ['row pointer, own hint', KEY, { stagedFor: SESSION, stagedTake: TAKE, mimeType: 'audio/webm' }, false],
    ['no pointer, FOREIGN hint', null, { stagedFor: SESSION, stagedTake: FOREIGN, mimeType: 'audio/mp4' }, false],
    ['row pointer, existing object', KEY, { stagedFor: SESSION, stagedTake: TAKE, mimeType: 'audio/webm' }, true],
  ])('%s: partial changes nothing — the same answer, the same storage calls, zero upload, zero stray', async (_l, p, body, exists) => {
    pointer = p
    if (exists) mockHeld.set(composeStagedKey(BIZ, SESSION, 'audio/webm', TAKE)!.key, 900)
    const plain = await mint(body)
    const plainCalls = [...mockCalls]
    mockCalls.length = 0
    const withPartial = await mint({ ...body, partial: true })
    expect(JSON.stringify(withPartial)).toBe(JSON.stringify(plain))
    expect(mockCalls).toEqual(plainCalls)
    expect(plainCalls.map(([m]) => m)).toEqual(exists ? ['info'] : ['info', 'createSignedUploadUrl'])
    expect(mockCalls.filter(([m]) => m === 'upload')).toEqual([])
    expect(mockStray).toEqual([])
  })
})

describe('layer-off — finalize under OFF, the ORIGINAL pre-K bucket (`info` only, no fetch)', () => {
  it('a headerless take with partial:true: the build-31 answer, ONE storage call, no sign, no fetch, no mark', async () => {
    mockShape.methods = FINALIZE_ORIGINAL
    mockHeld.set(KEY, 1024)
    await expect(finalize({ partial: true })).resolves.toEqual({ ok: true, recordingSessionId: SESSION })
    expect(mockCalls).toEqual([['info', KEY]])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockStray).toEqual([])
  })
})

describe('layer-on — the cost, measured: the same number of storage calls as before PR-K', () => {
  beforeEach(() => {
    mockSwitches.finalizeProbe = true
  })

  it('staged door + partial: info, one sign, ONE create-only upload — on the STAGED key; zero stray', async () => {
    mockShape.methods = MINT_ORIGINAL
    const copy = composeStagedKey(BIZ, SESSION, 'audio/webm', TAKE)!.key
    await mint({ stagedFor: SESSION, stagedTake: TAKE, mimeType: 'audio/webm', partial: true })
    expect(mockCalls).toEqual([
      ['info', copy],
      ['createSignedUploadUrl', copy],
      ['upload', composeMarkKey(BIZ, copy, 'partial')!.key],
    ])
    expect(mockStray).toEqual([])
  })

  it('finalize, a headerless take + partial: info, one sign, ONE refused upload + ONE partial upload (fix round 1)', async () => {
    mockShape.methods = ['info', 'createSignedUrl', 'upload']
    mockHeld.set(KEY, 1024)
    await expect(finalize({ partial: true })).resolves.toEqual({ error: 'unreadable_object' })
    expect(mockCalls).toEqual([
      ['info', KEY],
      ['createSignedUrl', KEY],
      ['upload', composeMarkKey(BIZ, KEY, 'refused')!.key],
      // Changed in fix round 1, Greptile #1099 thread 3 (PRRT_kwDOSCB5RM6nQm0W): a partial:true body also gets the create-only partial mark (ON state only).
      ['upload', composeMarkKey(BIZ, KEY, 'partial')!.key],
    ])
    expect(mockStray).toEqual([])
  })
})
