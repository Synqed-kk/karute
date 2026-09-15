/**
 * 監査ログ round 2, PR C — subject 3: readRecordingsInbox's staffId widened to
 * `string | null`, null = the whole business (the audit-watch cron has no
 * single staffer to scope to). Pins ONLY the one thing that changed — whether
 * `staff_id` reaches the SDK call — mirroring recordings-inbox-name-fill.test.ts's
 * mock client shape.
 */
jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn() }))

jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: async () => [],
}))

import { readRecordingsInbox } from '@/lib/recordings/inbox-read'

const NOW = new Date('2026-09-11T04:00:00.000Z')

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the arg is inspected via listRecordings.mock.calls, not the body
const listRecordings = jest.fn(async (opts: unknown) => ({ recordings: [], total: 0 }))
const client = {
  recordings: { list: (opts: unknown) => listRecordings(opts) },
  karuteRecords: {
    list: jest.fn(async () => ({ karute_records: [], total: 0 })),
  },
  recordingJobs: { getByRecordingSession: jest.fn() },
  recordingDiscards: {
    list: jest.fn(async () => ({ events: [], total: 0, page: 1, page_size: 200 })),
  },
} as unknown as Parameters<typeof readRecordingsInbox>[0]['synqed']

beforeEach(() => {
  jest.clearAllMocks()
  listRecordings.mockImplementation(async () => ({ recordings: [], total: 0 }))
})

describe('readRecordingsInbox — staffId widened to string | null', () => {
  it('staffId: null omits staff_id from the recordings.list call — reads the whole business', async () => {
    await readRecordingsInbox({ synqed: client, staffId: null, businessId: 'biz-1', now: NOW })
    expect(listRecordings).toHaveBeenCalledTimes(1)
    const call = listRecordings.mock.calls[0][0] as Record<string, unknown>
    expect('staff_id' in call).toBe(false)
  })

  it('staffId: a string still scopes the read — existing callers unchanged', async () => {
    await readRecordingsInbox({ synqed: client, staffId: 'staff-1', businessId: 'biz-1', now: NOW })
    const call = listRecordings.mock.calls[0][0] as Record<string, unknown>
    expect(call.staff_id).toBe('staff-1')
  })

  it('staffId: "" is NOT null — scopes to the empty id, never widens to the whole business', async () => {
    await readRecordingsInbox({ synqed: client, staffId: '', businessId: 'biz-1', now: NOW })
    const call = listRecordings.mock.calls[0][0] as Record<string, unknown>
    expect(call.staff_id).toBe('')
  })
})
