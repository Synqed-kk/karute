/**
 * ⚖ Liam 2026-09-30 — admission half of build-s4 PACKET-BUILD-SIGNIN-RETURN
 * §2.2: a plain missing session is null with no record; any other auth error
 * or a throw is null (the bare 404, as today) plus ONE server-side record.
 */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('@/business/lib/grants', () => ({
  businessIdForUser: jest.fn(),
  hasBusinessAdminGrant: jest.fn(),
  isManagementMember: jest.fn(),
}))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { requireBusinessAdmission } from '@/business/lib/admission'
import { createClient } from '@/lib/supabase/server'
import * as grants from '@/business/lib/grants'

/** The SDK's own shapes (auth-js 2.99.1 src/lib/errors.ts): name + status. */
const sdkError = (name: string, status: number, message = name) =>
  Object.assign(new Error(message), { name, status, __isAuthError: true })
const MISSING = sdkError('AuthSessionMissingError', 400, 'Auth session missing!')

const savedEnv = process.env.VERCEL_ENV
afterEach(() => {
  if (savedEnv === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = savedEnv
})

describe('admission — a denial that is not "no session" leaves one record', () => {
  const supabase = createClient as jest.Mock
  const g = grants as jest.Mocked<typeof grants>
  let err: jest.SpyInstance
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.VERCEL_ENV
    err = jest.spyOn(console, 'error').mockImplementation(() => {})
    g.businessIdForUser.mockResolvedValue('biz-1')
    g.hasBusinessAdminGrant.mockResolvedValue({ granted: true, grantedBy: 'u1' })
    g.isManagementMember.mockResolvedValue(false)
  })
  afterEach(() => err.mockRestore())
  const auth = (user: unknown, error: unknown) =>
    supabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user }, error }) } })
  const records = () => err.mock.calls.filter((c) => c[0] === '[business-admission]')

  it.each([
    ['no user, no error', null],
    ['AuthSessionMissingError', MISSING],
  ])('missing (%s) → the 404 and NO record', async (_l, e) => {
    auth(null, e)
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(records()).toHaveLength(0)
  })

  it.each([
    ['AuthApiError 401', sdkError('AuthApiError', 401, 'invalid JWT')],
    ['AuthRetryableFetchError 503', sdkError('AuthRetryableFetchError', 503, 'upstream down')],
    ['AuthApiError 429', sdkError('AuthApiError', 429, 'rate limited')],
  ])('auth error (%s) → the 404 plus exactly one record with a ref', async (_l, e) => {
    auth(null, e)
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
    const r = records()
    expect(r).toHaveLength(1)
    expect(r[0][1]).toEqual({
      reason: 'auth-error',
      ref: expect.stringMatching(/^[0-9a-f]{8}$/),
      status: (e as { status: number }).status,
      message: (e as Error).message,
    })
  })

  it.each([
    ['the auth client', () => supabase.mockRejectedValue(new Error('auth backend down'))],
    ['the grant read', () => (auth({ id: 'u1', email: null }, null), g.hasBusinessAdminGrant.mockRejectedValue(new Error('grant read blew up')))],
    ['the tenant read', () => (auth({ id: 'u1', email: null }, null), g.businessIdForUser.mockRejectedValue(new Error('tenant read blew up')))],
  ])('a throw in %s → the 404 plus one record (reason threw, the message)', async (_l, arrange) => {
    arrange()
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
    const r = records()
    expect(r).toHaveLength(1)
    expect(r[0][1]).toMatchObject({ reason: 'threw', ref: expect.stringMatching(/^[0-9a-f]{8}$/) })
    expect(String(r[0][1].message)).toMatch(/blew up|backend down/)
  })

  it('admitted → the same shape as before, no record', async () => {
    auth({ id: 'u1', email: 'o@x.jp' }, null)
    await expect(requireBusinessAdmission()).resolves.toEqual({ userId: 'u1', email: 'o@x.jp', businessId: 'biz-1' })
    expect(records()).toHaveLength(0)
  })

  it('production denies before any read: no auth call, no record', async () => {
    process.env.VERCEL_ENV = 'production'
    await expect(requireBusinessAdmission()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(supabase).not.toHaveBeenCalled()
    expect(records()).toHaveLength(0)
  })
})
