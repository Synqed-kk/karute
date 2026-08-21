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
// Business-wide, used strictly as a .get(id) lookup for the name fill. Mocked
// because the real module value-imports the ESM-only SDK.
const getCachedCustomerList = jest.fn(async () => [] as Array<{ id: string; name: string }>)
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: () => getCachedCustomerList(),
}))

import { listRecordingsInbox } from '@/actions/recordings-inbox'

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => {})
  getCurrentUserStaffId.mockImplementation(async () => 'auth-user-1')
  readRecordingsInbox.mockImplementation(async () => [])
  getCachedCustomerList.mockImplementation(async () => [])
})

// ⚖ Liam 2026-08-17. These rows are STAFF-scoped, the record page's customer
// array is STORE-scoped, so the name must be resolved here — on the server,
// where the whole business is visible — or a staffer's own recording of an
// out-of-store customer renders 不明. Business-wide list as a `.get(id)`
// lookup only: the names these rows reference ship, the roster never does.
describe('listRecordingsInbox — server-side customer name fill', () => {
  const session = (customerId: string | null) => ({
    recordingSessionId: `sess-${customerId ?? 'none'}`,
    customerId,
    createdAt: '2026-08-25T04:00:00.000Z',
    durationSeconds: 60,
    karuteRecordId: 'karute-1',
    jobStatus: null,
    jobProbeFailed: false,
    jobLastError: null,
  })

  it('fills the name for a customer the caller’s scoped array could not resolve', async () => {
    readRecordingsInbox.mockImplementation(async () => [session('cust-other-branch')])
    getCachedCustomerList.mockImplementation(async () => [
      { id: 'cust-other-branch', name: '代官山 太郎' },
    ])
    const [row] = (await listRecordingsInbox()) as Array<{ customerName?: string | null }>
    expect(row.customerName).toBe('代官山 太郎')
  })

  it('an unknown id keeps customerName absent — never a wrong or invented name', async () => {
    readRecordingsInbox.mockImplementation(async () => [session('cust-gone')])
    getCachedCustomerList.mockImplementation(async () => [{ id: 'cust-1', name: '佐藤 美咲' }])
    const [row] = (await listRecordingsInbox()) as Array<{ customerName?: string | null }>
    expect(row.customerName).toBeUndefined()
  })

  it('a failed list read degrades to today’s behaviour, not a failed inbox', async () => {
    readRecordingsInbox.mockImplementation(async () => [session('cust-1')])
    getCachedCustomerList.mockRejectedValue(new Error('core down'))
    const [row] = (await listRecordingsInbox()) as Array<{ customerName?: string | null }>
    expect(row.customerName).toBeUndefined()
  })

  it('no row carries a customer id → the list is never read at all', async () => {
    readRecordingsInbox.mockImplementation(async () => [session(null)])
    await listRecordingsInbox()
    expect(getCachedCustomerList).not.toHaveBeenCalled()
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
