/**
 * enqueueRecordingJob's tenant fence (src/actions/recording-jobs.ts). audioPath
 * is a client-supplied storage key the worker later reads AND deletes with a
 * service-role client (no RLS), so this gate is the cookie-path twin of the
 * facade route's. It used to be a bare `startsWith` on the tenant prefix; this
 * pins the positive grammar and the action's OWN refusal contract — the
 * `{ error }` arm, never a throw.
 */
const requireCapability = jest.fn(async (_c: string) => {})
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (c: string) => requireCapability(c),
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
const enqueue = jest.fn(async (_a: unknown) => ({ id: 'job-1', status: 'QUEUED' }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: async () => ({ recordingJobs: { enqueue } }),
}))

import { enqueueRecordingJob } from '@/actions/recording-jobs'
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
