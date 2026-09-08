/**
 * ⚖ THE TAKE MINT'S ALREADY-THERE ARM (hotfix 2026-09-05, root cause #3).
 *
 * A take whose whole-take PUT landed but whose finalize was lost could never be
 * finalized: every retry reached `{ kind: 'retry' }` (the row's own pointer
 * already named the key) and ALWAYS signed — and a non-upsert sign is a CREATE,
 * which storage refuses for a key it already holds. The refusal became a silent
 * `{ error: 'upstream' }` → facade 502 → the phone's launch drain re-asking
 * once a minute, for ever (production: 36 × 502 in 38 minutes for one take).
 *
 * No suite saw it because every storage fake signed unconditionally. That is
 * fixed at the fakes' home (helpers/storage-fakes.ts), which is what makes the
 * first case below RED against the pre-fix mint rather than quietly green.
 */
import { fakeCreateSignedUploadUrl, OBJECT_NOT_FOUND } from './helpers/storage-fakes'

const can = jest.fn(async (_c: string) => true)
const getMyCapabilities = jest.fn(async () => new Set<string>(['records.write']))
jest.mock('@/lib/auth/require-permission', () => ({
  can: (c: string) => can(c),
  requireCapability: async () => {},
  getMyCapabilities: () => getMyCapabilities(),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: async () => ({ storeId: 'store-9' }),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: async () => 'biz-1',
  getCurrentUserStaffId: async () => 'staff-1',
  getCurrentAccessToken: async () => 'web-cookie-token',
}))
/** The mint files ONE row, and only for a binding it actually WROTE. */
const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))

const UUID = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
/** What composeTakeKey composes for this tenant + take + container. */
const KEY = `app_biz-1_${UUID}.webm`
/** The size run 1b's stuck object actually carries on storage. */
const LANDED_SIZE = 682520

type Row = {
  id: string
  business_id: string
  staff_id: string
  status: string
  audio_storage_path: string | null
  duration_seconds: number | null
}
const row = (over: Partial<Row> = {}): Row => ({
  id: SESSION,
  business_id: 'biz-1',
  staff_id: 'staff-1',
  status: 'UPLOADING',
  audio_storage_path: KEY,
  duration_seconds: null,
  ...over,
})
const get = jest.fn(async (_id: string): Promise<Row> => row())
const update = jest.fn(async (id: string, _i: unknown): Promise<Row> => row({ id }))
const create = jest.fn(async (_i: unknown): Promise<Row> => row({ id: 'sess-new' }))
const fakeClient = { recordings: { get, create, update } }
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))

/** storage-js's single-object probe, and the bucket it reads. The two are wired
 *  to ONE `held` set here — a fake whose "does it exist" and "may I create it"
 *  answers can disagree is exactly the fake that hid this bug. */
const held = new Set<string>()
const info = jest.fn(async (key: string) =>
  held.has(key)
    ? { data: { size: LANDED_SIZE } as { size?: number } | null, error: null }
    : { data: null, error: { ...OBJECT_NOT_FOUND } },
)
const createSignedUploadUrl = jest.fn(
  fakeCreateSignedUploadUrl(held, (p) => `https://proj.supabase.co/upload/${p}?token=t`),
)
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: () => ({ createSignedUploadUrl, info }) } }),
}))

import { mintRecordingUploadUrl } from '@/actions/recording-upload'

const NAMED = { takeId: UUID, mimeType: 'audio/webm', recordingSessionId: SESSION }
/** Every JSON line this door logs, parsed — the alarm is an assertion, not noise. */
const warned: unknown[] = []

beforeEach(() => {
  jest.clearAllMocks()
  warned.length = 0
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    try {
      warned.push(JSON.parse(String(args[0])))
    } catch {
      warned.push(args[0])
    }
  })
  held.clear()
  get.mockImplementation(async () => row())
  update.mockImplementation(async (id: string) => row({ id }))
})

describe('the take mint answers "the object is already there"', () => {
  // (a) THE STUCK TAKE, as production had it: the row's pointer is this take's
  // own key and the object has been on storage since the PUT landed.
  it('a retry whose object LANDED gets the size, not a URL — and nothing is signed, written or audited', async () => {
    held.add(KEY)
    const res = await mintRecordingUploadUrl(NAMED)

    expect(res).toEqual({
      path: KEY,
      contentType: 'audio/webm',
      recordingSessionId: SESSION,
      existingSize: LANDED_SIZE,
    })
    // Nothing reachable from this answer can WRITE — the point of the arm.
    expect('url' in res).toBe(false)
    expect('token' in res).toBe(false)
    // The whole bug: this call used to sign, and storage refused it.
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
    // A retry writes nothing at commit (the pointer is already this key), so
    // the exit loses no core write — and there is nothing to audit.
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(auditFn).not.toHaveBeenCalled()
  })

  // (b) THE OTHER RETRY — same row, same pointer, but the PUT never landed. It
  // must still sign, or a take whose upload failed could never be uploaded.
  it('a retry whose object never landed still signs, exactly as before', async () => {
    const res = await mintRecordingUploadUrl(NAMED)
    expect(res).toMatchObject({
      path: KEY,
      url: `https://proj.supabase.co/upload/${KEY}?token=t`,
      token: 'tok-1',
      contentType: 'audio/webm',
      recordingSessionId: SESSION,
    })
    expect(createSignedUploadUrl).toHaveBeenCalledWith(KEY)
  })

  // (b, second half) THE TRUTHINESS PIN. `objectSize` answers an OBJECT, and
  // `{ exists: false }` is TRUTHY — so the refusal has to read the FIELD. Read
  // as the answer, this legacy unbound row (the only shape the mint still
  // writes) would be refused with `exists` and could never be bound at all.
  it('a legacy unbound row whose object is missing still binds and signs', async () => {
    get.mockImplementation(async () => row({ audio_storage_path: null, status: 'RECORDING' }))
    const res = await mintRecordingUploadUrl(NAMED)
    expect(res).toMatchObject({ path: KEY, url: expect.any(String) })
    expect(update).toHaveBeenCalledWith(SESSION, {
      audio_storage_path: KEY,
      status: 'UPLOADING',
    })
    expect(auditFn).toHaveBeenCalled()
  })

  // …and the refusal it stands for is unchanged: an object nobody's row claimed.
  it('an object at a key no row of the caller’s reserved is still `exists`', async () => {
    get.mockImplementation(async () => row({ audio_storage_path: null, status: 'RECORDING' }))
    held.add(KEY)
    await expect(mintRecordingUploadUrl(NAMED)).resolves.toEqual({ error: 'exists' })
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  // (c) THE RACE THE PROBE CANNOT SEE, and the alarm that was missing. The
  // object lands between the probe and the sign (a second tab, another device),
  // so the mint signs over a key the bucket now holds and storage refuses it.
  // Still `upstream` — retryable and correct, because the next attempt's probe
  // WILL see the object and take the arm above. What is new is that it says so
  // in the logs: a silent 'upstream' is what hid this bug for a day.
  it('a sign storage refuses is `upstream` — and it is no longer silent', async () => {
    info.mockImplementationOnce(async () => ({ data: null, error: { ...OBJECT_NOT_FOUND } }))
    held.add(KEY)
    await expect(mintRecordingUploadUrl(NAMED)).resolves.toEqual({ error: 'upstream' })
    expect(createSignedUploadUrl).toHaveBeenCalledWith(KEY)
    // ⚖ 8/17 doc law: status and flags only — never storage's raw message,
    // whose route errors embed the business id and the take id.
    expect(warned).toContainEqual({
      evt: 'sign_upload_refused',
      where: 'take',
      status: 400,
      statusCode: '409',
      messageKind: 'other',
    })
    expect(JSON.stringify(warned)).not.toContain(UUID)
  })
})
