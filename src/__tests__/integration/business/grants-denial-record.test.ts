/**
 * #1110 review P1 (S5 fix 2) — the grants.ts helpers deny on a FAILED read, so
 * a failed read used to be a silent 404. Every swallow point now leaves ONE
 * record through ./denial-record, with the SAME denial value as before. A
 * clean denial (no row, flag false) records nothing.
 */
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))

import { createServiceClient } from '@/lib/supabase/service'
import { businessIdForUser, hasBusinessAdminGrant, isManagementMember } from '@/business/lib/grants'

const service = createServiceClient as jest.Mock
function stub(result: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (): any => ({ select: chain, eq: chain, maybeSingle: async () => result })
  return { from: () => chain() }
}

let err: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  err = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => err.mockRestore())
const records = () => err.mock.calls.filter((c) => c[0] === '[business-admission]')

const READ_ERROR = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
const HEX8 = expect.stringMatching(/^[0-9a-f]{8}$/)

const HELPERS: Array<[string, () => Promise<unknown>, unknown, unknown]> = [
  // [where, call, the denial value, a clean-denial result]
  ['businessIdForUser', () => businessIdForUser('u1'), null, { data: null, error: null }],
  ['hasBusinessAdminGrant', () => hasBusinessAdminGrant('biz-1'), { granted: false, grantedBy: null }, { data: null, error: null }],
  ['isManagementMember', () => isManagementMember('u1'), false, { data: { is_management: false }, error: null }],
]

describe('grants.ts — a failed read denies AND leaves one record', () => {
  it.each(HELPERS)('%s: a read error → the same denial, one read-error record', async (where, call, denied) => {
    service.mockReturnValue(stub(READ_ERROR))
    await expect(call()).resolves.toEqual(denied)
    const r = records()
    expect(r).toHaveLength(1)
    expect(r[0][1]).toEqual({ reason: 'read-error', ref: HEX8, where, status: '42P01', message: 'relation does not exist' })
  })

  it.each(HELPERS)('%s: a thrown client → the same denial, one threw record', async (where, call, denied) => {
    service.mockImplementation(() => {
      throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
    })
    await expect(call()).resolves.toEqual(denied)
    const r = records()
    expect(r).toHaveLength(1)
    expect(r[0][1]).toEqual({ reason: 'threw', ref: HEX8, where, status: undefined, message: 'Missing SUPABASE_SERVICE_ROLE_KEY' })
  })

  it.each(HELPERS)('%s: a clean denial → the same denial, NO record', async (_where, call, denied, clean) => {
    service.mockReturnValue(stub(clean))
    await expect(call()).resolves.toEqual(denied)
    expect(records()).toHaveLength(0)
  })

  it('an error without a code falls back to its status', async () => {
    service.mockReturnValue(stub({ data: null, error: { status: 503, message: 'upstream down' } }))
    await expect(isManagementMember('u1')).resolves.toBe(false)
    expect(records()[0][1]).toMatchObject({ reason: 'read-error', where: 'isManagementMember', status: 503 })
  })
})
