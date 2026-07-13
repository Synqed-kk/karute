/**
 * Regression lock for src/proxy.ts — the WEB cookie-auth path (PLAN §5
 * auth-transport, packet-01 guardrail 4). Phase 2 must NOT change proxy
 * behavior; this test pins it so a future edit that breaks web auth fails loud.
 *
 * Locks three invariants:
 *   1. the matcher EXCLUDES /api (facade routes get no cookie refresh / no proxy)
 *   2. a normal page request refreshes the Supabase session (getClaims called)
 *   3. an intl redirect short-circuits BEFORE any Supabase work
 */
import { NextRequest, NextResponse } from 'next/server'

const mockIntl = jest.fn()
const mockGetClaims = jest.fn()

jest.mock('next-intl/middleware', () => ({
  __esModule: true,
  // createMiddleware(routing) at module-load returns this fn; it only calls
  // mockIntl at request time, by when the test has set the return value.
  default: () => (req: unknown) => mockIntl(req),
}))

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getClaims: (...a: unknown[]) => mockGetClaims(...a) } }),
}))

// proxy.ts imports ./i18n/routing (→ next-intl/routing, ESM). The intl
// middleware itself is mocked above, so routing's value is irrelevant here —
// stub it to keep real next-intl out of the CJS test loader.
jest.mock('@/i18n/routing', () => ({ routing: {} }))

import { proxy, config } from '@/proxy'

beforeEach(() => {
  jest.clearAllMocks()
  mockGetClaims.mockResolvedValue({ claims: { sub: 'u1' } })
})

describe('proxy.config.matcher', () => {
  it('is the exact known pattern (regression lock)', () => {
    expect(config.matcher).toBe(
      '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
    )
  })

  it('EXCLUDES /api (facade path) but MATCHES app pages', () => {
    const re = new RegExp(`^${config.matcher}$`)
    expect(re.test('/api/app/v1/staff')).toBe(false)
    expect(re.test('/api/ai/summarize')).toBe(false)
    expect(re.test('/en/dashboard')).toBe(true)
    expect(re.test('/ja/karute')).toBe(true)
  })
})

describe('proxy() behavior', () => {
  it('normal page → refreshes session via getClaims, returns a response', async () => {
    mockIntl.mockReturnValue(NextResponse.next())
    const res = await proxy(new NextRequest(new URL('https://karute.app/en/dashboard')))
    expect(mockGetClaims).toHaveBeenCalledTimes(1)
    expect(res).toBeInstanceOf(NextResponse)
  })

  it('intl redirect (status !== 200) short-circuits — no Supabase call', async () => {
    const redirect = NextResponse.redirect(new URL('https://karute.app/ja/dashboard'))
    mockIntl.mockReturnValue(redirect)
    const res = await proxy(new NextRequest(new URL('https://karute.app/dashboard')))
    expect(res).toBe(redirect)
    expect(mockGetClaims).not.toHaveBeenCalled()
  })
})
