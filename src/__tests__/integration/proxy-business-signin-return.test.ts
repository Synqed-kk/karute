/**
 * ⚖ Liam 2026-09-30 — a Business address that needs sign-in comes back to
 * Business (build-s4 PACKET-BUILD-SIGNIN-RETURN §3, proxy half; the admission
 * half lives in business/admission-record.test.ts — territory rules).
 *
 * The path he hit twice: a STALE cookie still yields claims, the proxy let the
 * request through, admission found no user and 404'd, the 404's only link went
 * to the front page, and the login there carried no `next`. Pinned: on a
 * PREVIEW Business path with claims, a session the SDK calls gone goes down the
 * SAME login?next redirect; an outage passes through; production /
 * non-Business / public paths never call getUser at all.
 */
import { NextRequest, NextResponse } from 'next/server'

const mockIntl = jest.fn()
const mockGetClaims = jest.fn()
const mockGetUser = jest.fn()

jest.mock('next-intl/middleware', () => ({
  __esModule: true,
  default: () => (req: unknown) => mockIntl(req),
}))
/** The cookie handlers the proxy hands to createServerClient, captured per call
 * so a fake SDK call can drive them exactly as @supabase/ssr does. */
type MockCookieWrite = { name: string; value: string; options?: Record<string, unknown> }
const mockCookies: {
  handlers?: {
    getAll: () => { name: string; value: string }[]
    setAll: (w: MockCookieWrite[]) => void
  }
} = {}
jest.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: NonNullable<typeof mockCookies.handlers> },
  ) => {
    mockCookies.handlers = opts.cookies
    return {
      auth: {
        getClaims: (...a: unknown[]) => mockGetClaims(...a),
        getUser: (...a: unknown[]) => mockGetUser(...a),
      },
    }
  },
}))
jest.mock('@/i18n/routing', () => ({ routing: {} }))

import { proxy, config } from '@/proxy'

const STORE = '8696b856-11ab-4879-9290-bef40b03ea66'
const TODAY = `https://karute.app/ja/business/today?store=${STORE}`
const EXPECTED_LOGIN = `https://karute.app/ja/login?next=%2Fja%2Fbusiness%2Ftoday%3Fstore%3D${STORE}`

/** The SDK's own shapes (auth-js 2.99.1 src/lib/errors.ts): name + status. */
const sdkError = (name: string, status: number, message = name) =>
  Object.assign(new Error(message), { name, status, __isAuthError: true })
const MISSING = sdkError('AuthSessionMissingError', 400, 'Auth session missing!')

const savedEnv = process.env.VERCEL_ENV
afterEach(() => {
  if (savedEnv === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = savedEnv
})

describe('proxy — a stale Business session comes back to Business', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIntl.mockReturnValue(NextResponse.next())
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: 'u1' } } }) // stale claims present
  })
  const run = (href: string) => proxy(new NextRequest(new URL(href)))

  it.each([
    ['AuthSessionMissingError', { data: { user: null }, error: MISSING }],
    ['AuthApiError 401', { data: { user: null }, error: sdkError('AuthApiError', 401) }],
    ['AuthApiError 403 (bad_jwt)', { data: { user: null }, error: sdkError('AuthApiError', 403) }],
    ['no user, no error', { data: { user: null }, error: null }],
  ])('preview + Business path + %s → 307 to login with the exact next', async (_l, got) => {
    process.env.VERCEL_ENV = 'preview'
    mockGetUser.mockResolvedValue(got)
    const res = await run(TODAY)
    expect(mockGetUser).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(EXPECTED_LOGIN)
  })

  it('the carried next drops _rsc on a store-switch RSC request, exactly as the signed-out branch does', async () => {
    process.env.VERCEL_ENV = 'preview'
    mockGetUser.mockResolvedValue({ data: { user: null }, error: MISSING })
    const res = await run(`${TODAY}&_rsc=abc12`)
    expect(res.headers.get('location')).toBe(EXPECTED_LOGIN)
  })

  it.each([
    ['AuthRetryableFetchError (network, status 0)', { data: { user: null }, error: sdkError('AuthRetryableFetchError', 0) }],
    ['AuthRetryableFetchError 503', { data: { user: null }, error: sdkError('AuthRetryableFetchError', 503) }],
    ['AuthApiError 500', { data: { user: null }, error: sdkError('AuthApiError', 500) }],
    ['AuthApiError 429 (rate limit)', { data: { user: null }, error: sdkError('AuthApiError', 429) }],
    ['AuthUnknownError', { data: { user: null }, error: sdkError('AuthUnknownError', 0) }],
  ])('preview + Business path + OUTAGE %s → passes through unchanged', async (_l, got) => {
    process.env.VERCEL_ENV = 'preview'
    mockGetUser.mockResolvedValue(got)
    const res = await run(TODAY)
    expect(mockGetUser).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('preview + Business path + getUser THROWS → passes through, never a proxy 500', async () => {
    process.env.VERCEL_ENV = 'preview'
    mockGetUser.mockRejectedValue(new TypeError('fetch failed'))
    const res = await run(TODAY)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('preview + Business path + a live user → passes through', async () => {
    process.env.VERCEL_ENV = 'preview'
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const res = await run(TODAY)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it.each([['production'], ['production2'], [undefined]])(
    'VERCEL_ENV=%s + Business path → getUser NOT called, response as today',
    async (env) => {
      if (env === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = env
      const passed = NextResponse.next()
      mockIntl.mockReturnValue(passed)
      const res = await run(TODAY)
      expect(mockGetUser).not.toHaveBeenCalled()
      expect(res).toBe(passed)
    },
  )

  it.each([
    ['a Karute app path', 'https://karute.app/ja/dashboard'],
    ['a path that merely starts with business', 'https://karute.app/ja/businesses'],
    ['the marketing root', 'https://karute.app/ja'],
    ['login', 'https://karute.app/ja/login?next=%2Fja%2Fbusiness%2Ftoday'],
    ['signup', 'https://karute.app/ja/signup'],
    ['join', 'https://karute.app/ja/join'],
    ['auth', 'https://karute.app/ja/auth/callback'],
    ['reset-password', 'https://karute.app/ja/reset-password'],
  ])('preview + %s → getUser NOT called, response as today', async (_l, href) => {
    process.env.VERCEL_ENV = 'preview'
    const passed = NextResponse.next()
    mockIntl.mockReturnValue(passed)
    const res = await run(href)
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(res).toBe(passed)
  })

  it('an /api path never reaches the proxy (matcher unchanged) and would make no getUser call', async () => {
    expect(new RegExp(`^${config.matcher}$`).test('/api/business/card-color')).toBe(false)
    process.env.VERCEL_ENV = 'preview'
    const passed = NextResponse.next()
    mockIntl.mockReturnValue(passed)
    const res = await run('https://karute.app/api/business/card-color')
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(res).toBe(passed)
  })

  it('signed out (no claims) is the same redirect as before and never asks getUser', async () => {
    process.env.VERCEL_ENV = 'preview'
    mockGetClaims.mockResolvedValue({ data: { claims: null } })
    const res = await run(TODAY)
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe(EXPECTED_LOGIN)
  })
})


/**
 * Cookie-aware (#1109 review thread). The stub above hands the proxy's real
 * handlers to the fake SDK; each fake getUser writes cookies through them the
 * way @supabase/ssr 0.9.0 does (cookies.js applyServerStorage: one setAll with
 * `{ name, value, options }`, removals as value '' + maxAge 0).
 */
describe('proxy — cookies through the getUser call (#1109 review thread)', () => {
  const AUTH = 'sb-test-auth-token'
  const DEFAULTS = { path: '/', sameSite: 'lax', httpOnly: false }
  const withCookie = (href: string) =>
    new NextRequest(new URL(href), { headers: { cookie: `${AUTH}=stale-session` } })
  const writeThenReturn = (writes: MockCookieWrite[], got: unknown) => async () => {
    mockCookies.handlers!.setAll(writes)
    return got
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockCookies.handlers = undefined
    mockIntl.mockReturnValue(NextResponse.next())
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: 'u1' } } })
    process.env.VERCEL_ENV = 'preview'
  })

  it('the handlers read the request cookies (getAll) the SDK sees', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    await proxy(withCookie(TODAY))
    expect(mockCookies.handlers!.getAll()).toEqual([{ name: AUTH, value: 'stale-session' }])
  })

  it('GONE session that clears the auth cookie → 307 to login; the redirect carries no session cookies (main\'s redirect branch, unchanged)', async () => {
    const req = withCookie(TODAY)
    mockGetUser.mockImplementation(
      writeThenReturn(
        [{ name: AUTH, value: '', options: { ...DEFAULTS, maxAge: 0 } }],
        { data: { user: null }, error: MISSING },
      ),
    )
    const res = await proxy(req)
    expect(mockGetUser).toHaveBeenCalledTimes(1)
    // the SDK's removal did go through the proxy's setAll (request side written)
    expect(req.cookies.get(AUTH)?.value).toBe('')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(EXPECTED_LOGIN)
    // a fresh NextResponse.redirect: nothing from the supabase response rides along
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.cookies.getAll()).toEqual([])
  })

  it('LIVE session with a token refresh → passes through carrying the refreshed auth cookie', async () => {
    const intl = NextResponse.next()
    mockIntl.mockReturnValue(intl)
    mockGetUser.mockImplementation(
      writeThenReturn(
        [{ name: AUTH, value: 'refreshed-session', options: { ...DEFAULTS, maxAge: 34560000 } }],
        { data: { user: { id: 'u1' } }, error: null },
      ),
    )
    const res = await proxy(withCookie(TODAY))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res).not.toBe(intl) // setAll rebuilt the pass-through response
    expect(res.cookies.get(AUTH)?.value).toBe('refreshed-session')
    expect(res.headers.get('set-cookie')).toContain(`${AUTH}=refreshed-session`)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=34560000')
  })

  it('OUTAGE with a cookie write attempted → passes through carrying the written cookie', async () => {
    mockGetUser.mockImplementation(
      writeThenReturn(
        [{ name: AUTH, value: '', options: { ...DEFAULTS, maxAge: 0 } }],
        { data: { user: null }, error: sdkError('AuthRetryableFetchError', 503) },
      ),
    )
    const res = await proxy(withCookie(TODAY))
    expect(mockGetUser).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.cookies.get(AUTH)?.value).toBe('')
    expect(res.headers.get('set-cookie')).toContain(`${AUTH}=;`)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})
