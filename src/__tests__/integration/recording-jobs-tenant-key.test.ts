/**
 * enqueueRecordingJob's tenant fence (src/actions/recording-jobs.ts). audioPath
 * is a client-supplied storage key the worker later reads AND deletes with a
 * service-role client (no RLS), so this gate is the cookie-path twin of the
 * facade route's. It used to be a bare `startsWith` on the tenant prefix; this
 * pins the positive grammar and the action's OWN refusal contract — the
 * `{ error }` arm, never a throw.
 */
const requireCapability = jest.fn(async (_c: string) => {})
const capabilities = { current: new Set<string>(['records.write']) }
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (c: string) => requireCapability(c),
  getMyCapabilities: async () => capabilities.current,
}))
const getBusinessId = jest.fn(async () => 'biz-1')
jest.mock('@/lib/staff', () => ({
  getBusinessId: () => getBusinessId(),
  getCurrentUserStaffId: async () => 'profile-staff-1',
}))
// The job's staff id is a CARD id; the tenant-key cases keep the identity map,
// the S46 card-vs-login case below swaps in a different card.
const resolveSynqedStaffId = jest.fn(async (id: string) => id)
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: (id: string) => resolveSynqedStaffId(id),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: async () => ({ storeId: 'store-1' }),
  // PR-B's act scope: what the OWNER'S HAND may reach, resolved only when the
  // pair is held. A staffer assigned to one store — so a colleague's row
  // stamped with another store is out of reach, which the pin below asserts.
  viewerScopeForActs: async () => ['store-1'],
}))
const objectExists = jest.fn(async (_key: string): Promise<boolean | 'unknown'> => true)
jest.mock('@/lib/recording/mint-take-url', () => ({
  objectExists: (key: string) => objectExists(key),
}))
const enqueue = jest.fn(async (_a: unknown) => ({ id: 'job-1', status: 'QUEUED' }))
type Row = {
  id: string
  business_id: string
  staff_id: string
  audio_storage_path: string | null
  duration_seconds: number | null
  status: string
  /** Stamped since ③ (PR-B); absent on every row minted before it. */
  store_id?: string | null
}
const current = { row: null as Row | null }
const recordingsGet = jest.fn(async (_id: string) => current.row)
const listDiscards = jest.fn(async (): Promise<{ events: Array<{ id: string }> }> => ({ events: [] }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: async () => ({
    recordingJobs: { enqueue },
    recordings: { get: recordingsGet },
    recordingDiscards: { list: listDiscards },
  }),
}))

import { enqueueRecordingJob, enqueueRecordingJobFromSession } from '@/actions/recording-jobs'
import {
  conformingKey,
  refusedKeys,
  IMPOSTOR_KEY,
} from './helpers/recording-key-fixtures'

const OWN = conformingKey('biz-1')
/** A core row id — S46: the enqueue door reads the row the session names. */
const ROW = '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f'
const body = (audioPath: string) => ({
  recordingSessionId: ROW,
  customerId: 'cust-1',
  audioPath,
})

beforeEach(() => {
  jest.clearAllMocks()
  // kickWorker is a no-op without it — keeps the fire-and-forget fetch out of the run.
  delete process.env.CRON_SECRET
  requireCapability.mockImplementation(async () => {})
  resolveSynqedStaffId.mockImplementation(async (id: string) => id)
  getBusinessId.mockImplementation(async () => 'biz-1')
  enqueue.mockImplementation(async () => ({ id: 'job-1', status: 'QUEUED' }))
  capabilities.current = new Set(['records.write'])
  objectExists.mockResolvedValue(true)
  listDiscards.mockResolvedValue({ events: [] })
  current.row = {
    id: 'sess-1',
    business_id: 'biz-1',
    staff_id: 'profile-staff-1',
    audio_storage_path: OWN,
    duration_seconds: 1380,
    status: 'UPLOADING',
  }
})

describe('enqueueRecordingJob — the tenant key grammar', () => {
  it('queues a key minted for this caller’s own business', async () => {
    await expect(enqueueRecordingJob(body(OWN))).resolves.toEqual({
      ok: true,
      jobId: 'job-1',
      status: 'QUEUED',
    })
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ audio_path: OWN }),
      }),
    )
  })

  it.each(refusedKeys('biz-1'))(
    'refuses %s — nothing is queued for the worker to read or delete',
    async (_label, path) => {
      await expect(enqueueRecordingJob(body(path))).resolves.toEqual({
        error: 'recording not found in this business',
      })
      expect(enqueue).not.toHaveBeenCalled()
    },
  )

  it('refuses a string-shaped non-string before it calls a method on it', async () => {
    await expect(enqueueRecordingJob(body(IMPOSTOR_KEY))).resolves.toEqual({
      error: 'recording not found in this business',
    })
    expect(enqueue).not.toHaveBeenCalled()
  })
})

// ── S46 closure 2: the session must HOLD the key and be the caller's ─────────
describe('enqueueRecordingJob — the row names its recorder (S46)', () => {
  const REFUSED = { error: 'recording not found in this business' }

  it("own recording: the row holds this key and is the caller's → queued", async () => {
    await expect(enqueueRecordingJob(body(OWN))).resolves.toMatchObject({ ok: true })
    expect(recordingsGet).toHaveBeenCalledWith(ROW)
  })

  it("another person's recording in the same store → refused, nothing queued", async () => {
    current.row = { ...current.row!, staff_id: 'profile-colleague', store_id: 'store-1' }
    await expect(enqueueRecordingJob(body(OWN))).resolves.toEqual(REFUSED)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("…unless the caller holds the owner's hand within reach (the rescue keeps working)", async () => {
    capabilities.current = new Set(['records.write', 'business.manage', 'recordings.viewAll'])
    current.row = { ...current.row!, staff_id: 'profile-colleague', store_id: 'store-1' }
    await expect(enqueueRecordingJob(body(OWN))).resolves.toMatchObject({ ok: true })
  })

  it("…and the owner's hand stops at the store line: a colleague's row in another store is refused", async () => {
    capabilities.current = new Set(['records.write', 'business.manage', 'recordings.viewAll'])
    current.row = { ...current.row!, staff_id: 'profile-colleague', store_id: 'store-9' }
    await expect(enqueueRecordingJob(body(OWN))).resolves.toEqual(REFUSED)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("naming one's OWN session beside a colleague's key is refused: the row must hold THIS key", async () => {
    current.row = { ...current.row!, audio_storage_path: 'app_biz-1_ffffffff-ffff-4fff-8fff-ffffffffffff.webm' }
    await expect(enqueueRecordingJob(body(OWN))).resolves.toEqual(REFUSED)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('a session core does not know (404), or a non-uuid id, is refused — the job would name it', async () => {
    recordingsGet.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }))
    await expect(enqueueRecordingJob(body(OWN))).resolves.toEqual(REFUSED)
    await expect(enqueueRecordingJob({ ...body(OWN), recordingSessionId: 'sess-1' })).resolves.toEqual(REFUSED)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("a row read that FAILS is never a yes: the retryable error, nothing queued", async () => {
    recordingsGet.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 503 }))
    await expect(enqueueRecordingJob(body(OWN))).resolves.toEqual({ error: 'Failed to enqueue the recording job.' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('card id ≠ login id: the honest recorder passes (compared in the login space), the job keeps the CARD id', async () => {
    resolveSynqedStaffId.mockImplementation(async () => 'card-7')
    await expect(enqueueRecordingJob(body(OWN))).resolves.toMatchObject({ ok: true })
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ staff_id: 'card-7' }) }),
    )
  })
})


/**
 * …and its slice-③ sibling, which has NO key to fence because it takes none:
 * the audio is already on the server, so the path is derived from the row. The
 * shared body's rules are pinned in recording-enqueue-from-session.test.ts;
 * what only THIS arm can prove is that the cookie session supplies the
 * attribution, the store scope and the owner's-hand answer.
 */
describe('enqueueRecordingJobFromSession — the cookie arm', () => {
  const input = { recordingSessionId: 'sess-1', customerId: 'cust-1' }

  it('queues the job with the ROW’s path and the cookie’s staff + store', async () => {
    await expect(enqueueRecordingJobFromSession(input)).resolves.toEqual({
      ok: true,
      jobId: 'job-1',
      status: 'QUEUED',
    })
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        recording_session_id: 'sess-1',
        payload: expect.objectContaining({
          audio_path: OWN,
          staff_id: 'profile-staff-1',
          store_id: 'store-1',
        }),
      }),
    )
  })

  it('the argument cannot name an object — an audioPath in it is simply not read', async () => {
    await enqueueRecordingJobFromSession({
      ...input,
      audioPath: `app_other-biz_x.webm`,
    } as typeof input)
    expect(objectExists).toHaveBeenCalledWith(OWN)
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ audio_path: OWN }) }),
    )
  })

  it('a colleague’s session needs the owner’s hand — without it, forbidden', async () => {
    current.row = { ...current.row!, staff_id: 'someone-else' }
    await expect(enqueueRecordingJobFromSession(input)).resolves.toEqual({ error: 'forbidden' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('…and WITH it (business.manage + recordings.viewAll), it goes through', async () => {
    current.row = { ...current.row!, staff_id: 'someone-else' }
    capabilities.current = new Set(['records.write', 'business.manage', 'recordings.viewAll'])
    await expect(enqueueRecordingJobFromSession(input)).resolves.toMatchObject({ ok: true })
  })

  it('…but only as far as she can SEE: a colleague’s row stamped in another store is refused', async () => {
    // The rebase's whole point. The cookie arm resolves the reach with
    // viewerScopeForActs (one store above), so a row PR-B stamped elsewhere is
    // out of the owner's hand — and typing `allowedStoreIds: null` at this
    // caller to silence the compiler would have made this pass.
    current.row = { ...current.row!, staff_id: 'someone-else', store_id: 'store-9' }
    capabilities.current = new Set(['records.write', 'business.manage', 'recordings.viewAll'])
    await expect(enqueueRecordingJobFromSession(input)).resolves.toEqual({ error: 'forbidden' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('a denied capability throws inside and answers upstream, never a queued job', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(enqueueRecordingJobFromSession(input)).resolves.toEqual({ error: 'upstream' })
    expect(enqueue).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('an empty session or customer id is refused before any read', async () => {
    await expect(
      enqueueRecordingJobFromSession({ recordingSessionId: '', customerId: 'cust-1' }),
    ).resolves.toEqual({ error: 'not_found' })
    expect(recordingsGet).not.toHaveBeenCalled()
  })
})
