/**
 * Confirm-link callback: exchange the ?code for a session, bootstrap the
 * business server-side (idempotent, service-role), then land the user on
 * /{locale}/sessions. Any failure redirects to /{locale}/login?error=confirm.
 */
jest.mock('@/lib/supabase/server', () => {
  const exchangeCodeForSession = jest.fn()
  return {
    __exchange: exchangeCodeForSession,
    createClient: jest.fn(async () => ({ auth: { exchangeCodeForSession } })),
  }
})

jest.mock('@/actions/bootstrap', () => ({
  bootstrapBusinessForNewUser: jest.fn(),
}))

import { GET } from '@/app/[locale]/auth/callback/route'
import { bootstrapBusinessForNewUser } from '@/actions/bootstrap'
import * as serverMod from '@/lib/supabase/server'

const exchangeCodeForSession = (serverMod as unknown as { __exchange: jest.Mock })
  .__exchange
const mockBootstrap = bootstrapBusinessForNewUser as unknown as jest.Mock

function req(query: string) {
  return new Request(`http://localhost:3000/ja/auth/callback${query}`)
}
const params = Promise.resolve({ locale: 'ja' })

beforeEach(() => {
  jest.clearAllMocks()
  exchangeCodeForSession.mockResolvedValue({
    data: {
      user: {
        id: 'u1',
        email: 'jane@salon.jp',
        user_metadata: { salon_name: 'My Salon' },
      },
    },
    error: null,
  })
  mockBootstrap.mockResolvedValue({ ok: true, businessId: 'biz-1' })
})

describe('auth callback route', () => {
  it('exchanges the code, bootstraps, and redirects to sessions', async () => {
    const res = await GET(req('?code=abc'), { params })
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc')
    expect(mockBootstrap).toHaveBeenCalledWith('My Salon', 'u1')
    expect(res.headers.get('location')).toMatch(/\/ja\/sessions$/)
  })

  it('redirects to login?error=confirm when no code is present', async () => {
    const res = await GET(req(''), { params })
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toMatch(/\/ja\/login\?error=confirm$/)
  })

  it('redirects to login?error=confirm when the exchange fails', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: 'bad code' },
    })
    const res = await GET(req('?code=bad'), { params })
    expect(mockBootstrap).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toMatch(/\/ja\/login\?error=confirm$/)
  })

  it('redirects to login?error=confirm when bootstrap fails', async () => {
    mockBootstrap.mockResolvedValue({ ok: false, error: 'boom' })
    const res = await GET(req('?code=abc'), { params })
    expect(res.headers.get('location')).toMatch(/\/ja\/login\?error=confirm$/)
  })
})
