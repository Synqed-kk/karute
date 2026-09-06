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
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: async (id: string) => id,
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: async () => ({ storeId: 'store-1' }),
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
const body = (audioPath: string) => ({
  recordingSessionId: 'sess-1',
  customerId: 'cust-1',
  audioPath,
})

beforeEach(() => {
  jest.clearAllMocks()
  // kickWorker is a no-op without it — keeps the fire-and-forget fetch out of the run.
  delete process.env.CRON_SECRET
  requireCapability.mockImplementation(async () => {})
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
