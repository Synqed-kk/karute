/**
 * Middleware refreshes the Supabase session on every matched request and guards
 * (app) routes: an unauthenticated request to an app route is bounced to the
 * locale login page; login / signup / join / auth / marketing root stay public;
 * an authenticated request passes through untouched.
 */
jest.mock('@supabase/ssr', () => {
  const getUser = jest.fn()
  return {
    __getUser: getUser,
    createServerClient: jest.fn(() => ({ auth: { getUser } })),
  }
})

import { middleware } from '@/middleware'
import { NextRequest } from 'next/server'
import * as ssr from '@supabase/ssr'

const getUser = (ssr as unknown as { __getUser: jest.Mock }).__getUser

function reqFor(path: string) {
  return new NextRequest(new URL(`http://localhost:3000${path}`))
}

beforeEach(() => {
  jest.clearAllMocks()
})

function asUnauth() {
  getUser.mockResolvedValue({ data: { user: null }, error: null })
}
function asAuthed() {
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
}

describe('middleware — session guard', () => {
  it('redirects an unauthenticated app-route request to /{locale}/login', async () => {
    asUnauth()
    const res = await middleware(reqFor('/ja/dashboard'))
    expect(res.headers.get('location')).toMatch(/\/ja\/login$/)
  })

  it('lets an unauthenticated request to the login page pass', async () => {
    asUnauth()
    const res = await middleware(reqFor('/ja/login'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('lets an unauthenticated request to the auth callback pass', async () => {
    asUnauth()
    const res = await middleware(reqFor('/ja/auth/callback?code=abc'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('lets an authenticated request to an app route pass', async () => {
    asAuthed()
    const res = await middleware(reqFor('/ja/dashboard'))
    expect(res.headers.get('location')).toBeNull()
  })
})
