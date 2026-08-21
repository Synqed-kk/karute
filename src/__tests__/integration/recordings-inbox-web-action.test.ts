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
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: () => getCurrentUserStaffId() }))
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
