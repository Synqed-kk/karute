/**
 * The proxy (Next 16 middleware convention) refreshes the Supabase session on
 * every matched request and guards (app) routes: an unauthenticated request to
 * an app route is bounced to the locale login page; login / signup / join /
 * auth / marketing root stay public; an authenticated request passes through
 * untouched.
 */
// next-intl/middleware is ESM-only (jest can't transform it) and its locale
// routing is not what's under test — stub it as a pass-through.
jest.mock('next-intl/middleware', () => ({
  __esModule: true,
  default: () => () => {
    const { NextResponse } = jest.requireActual('next/server')
    return NextResponse.next()
  },
}))
jest.mock('@/i18n/routing', () => ({ routing: {} }))

jest.mock('@supabase/ssr', () => {
  const getClaims = jest.fn()
  return {
    __getClaims: getClaims,
    createServerClient: jest.fn(() => ({ auth: { getClaims } })),
  }
})

import { proxy } from '@/proxy'
import { NextRequest } from 'next/server'
import * as ssr from '@supabase/ssr'

const getClaims = (ssr as unknown as { __getClaims: jest.Mock }).__getClaims

function reqFor(path: string) {
  return new NextRequest(new URL(`http://localhost:3000${path}`))
}

beforeEach(() => {
  jest.clearAllMocks()
})

function asUnauth() {
  getClaims.mockResolvedValue({ data: null, error: null })
}
function asAuthed() {
  getClaims.mockResolvedValue({
    data: { claims: { sub: 'u1' } },
    error: null,
  })
}

describe('proxy — session guard', () => {
  it('redirects an unauthenticated app-route request to /{locale}/login', async () => {
    asUnauth()
    const res = await proxy(reqFor('/ja/dashboard'))
    expect(res.headers.get('location')).toMatch(/\/ja\/login$/)
  })

  it('lets an unauthenticated request to the login page pass', async () => {
    asUnauth()
    const res = await proxy(reqFor('/ja/login'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('lets an unauthenticated request to the auth callback pass', async () => {
    asUnauth()
    const res = await proxy(reqFor('/ja/auth/callback?code=abc'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('lets an authenticated request to an app route pass', async () => {
    asAuthed()
    const res = await proxy(reqFor('/ja/dashboard'))
    expect(res.headers.get('location')).toBeNull()
  })
})
