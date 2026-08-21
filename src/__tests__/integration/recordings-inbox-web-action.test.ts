/**
 * 録音履歴 web action (Build F1, FX-7a) — the cookie arm's own contract,
 * unmocked. Three things only this file can prove: the capability gate runs
 * BEFORE any read, the signed-in staff id is what threads into the shared read,
 * and no staff identity means an empty list rather than the whole salon.
 */
const requireCapability = jest.fn(async (_c: string) => {})
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (c: string) => requireCapability(c),
}))
const getCurrentUserStaffId = jest.fn(async (): Promise<string | null> => 'auth-user-1')
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: () => getCurrentUserStaffId(),
  getBusinessId: async () => 'business-1',
}))
const fakeClient = { marker: 'the business-scoped client' }
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: async () => fakeClient }))
const readRecordingsInbox = jest.fn(async (_deps: unknown) => [] as unknown[])
jest.mock('@/lib/recordings/inbox-read', () => ({
  readRecordingsInbox: (deps: unknown) => readRecordingsInbox(deps),
}))

import { listRecordingsInbox } from '@/actions/recordings-inbox'

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => {})
  getCurrentUserStaffId.mockImplementation(async () => 'auth-user-1')
  readRecordingsInbox.mockImplementation(async () => [])
})

// ⚖ Liam 2026-08-17. The server-side customer name fill lives INSIDE the shared
// read (lib/recordings/inbox-read.ts) so the cookie and Bearer arms cannot
// disagree about a row's name; it is exercised for real in
// app-api-recordings-inbox.test.ts. What this arm still owes is the tenant key
// the fill runs on, and that it hands its consumers whatever the read returned.
describe('listRecordingsInbox — the shared read’s name fill', () => {
  it('threads businessId so the fill has a tenant to resolve against', async () => {
    await listRecordingsInbox()
    const deps = readRecordingsInbox.mock.calls[0][0] as { businessId: string }
    expect(deps.businessId).toBe('business-1')
  })

  it('hands back the read’s rows verbatim — filled names included', async () => {
    const filled = [
      {
        recordingSessionId: 'sess-out',
        customerId: 'cust-other-branch',
        customerName: '代官山 太郎',
        createdAt: '2026-08-25T04:00:00.000Z',
        durationSeconds: 60,
        karuteRecordId: 'karute-1',
        jobStatus: null,
        jobProbeFailed: false,
        jobLastError: null,
      },
    ]
    readRecordingsInbox.mockImplementation(async () => filled)
    await expect(listRecordingsInbox()).resolves.toEqual(filled)
  })
})

describe('listRecordingsInbox (web action)', () => {
  it('gates on records.write BEFORE any read', async () => {
    requireCapability.mockRejectedValue(new Error('forbidden'))
    await expect(listRecordingsInbox()).rejects.toThrow('forbidden')
    expect(requireCapability).toHaveBeenCalledWith('records.write')
    expect(readRecordingsInbox).not.toHaveBeenCalled()
  })

  it('threads the SIGNED-IN staff id into the shared read', async () => {
    await listRecordingsInbox()
    expect(readRecordingsInbox).toHaveBeenCalledTimes(1)
    const deps = readRecordingsInbox.mock.calls[0][0] as {
      staffId: string
      synqed: unknown
      now: Date
    }
    expect(deps.staffId).toBe('auth-user-1')
    expect(deps.synqed).toBe(fakeClient)
    expect(deps.now).toBeInstanceOf(Date)
  })

  it('no staff identity → [], and no read at all (never the whole salon)', async () => {
    getCurrentUserStaffId.mockResolvedValue(null)
    await expect(listRecordingsInbox()).resolves.toEqual([])
    expect(readRecordingsInbox).not.toHaveBeenCalled()
  })

  it('takes no arguments — there is no id for a caller to supply', () => {
    expect(listRecordingsInbox).toHaveLength(0)
  })
})
