/**
 * ⚖ R53 P5a — the Business sign-out route: same-origin POST only (the card-color route's
 * guard, mirrored), signOut once, no admission read, 500 on failure, never cached.
 * GET and every other method are unexported → Next's route runtime answers 405.
 */
const mockSignOut = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(async () => ({ auth: { signOut: mockSignOut } })) }))
jest.mock('@/business/lib/grants', () => ({ businessIdForUser: jest.fn(), hasBusinessAdminGrant: jest.fn(), isManagementMember: jest.fn() }))

import * as route from '@/app/api/business/sign-out/route'
import * as cardColor from '@/app/api/business/card-color/route'
import { businessIdForUser } from '@/business/lib/grants'

const HOST = 'localhost:3000'
const req = (headers: Record<string, string>, method = 'POST') =>
  new Request(`http://${HOST}/api/business/sign-out`, { method, headers: { host: HOST, ...headers } })

beforeEach(() => mockSignOut.mockReset())

describe('R53 P5a — POST /api/business/sign-out', () => {
  it('exports POST only (GET → 405 by the route runtime)', () => {
    expect(Object.keys(route).sort()).toEqual(['POST'])
  })

  it('same-origin POST → signOut once → 200 {ok:true}, no-store, no admission read', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    const res = await route.POST(req({ origin: `http://${HOST}` }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(businessIdForUser).not.toHaveBeenCalled()
  })

  it('Sec-Fetch-Site same-origin without an Origin passes', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    expect((await route.POST(req({ 'sec-fetch-site': 'same-origin' }))).status).toBe(200)
  })

  it.each([
    [{ origin: 'https://evil.example' }],
    [{ origin: `https://${HOST}` }],
    [{ 'sec-fetch-site': 'cross-site' }],
    [{}],
  ])('cross-origin %p → refused exactly as card-color refuses, signOut never called', async (headers) => {
    const res = await route.POST(req(headers))
    const card = await cardColor.PUT(new Request(`http://${HOST}/api/business/card-color`, { method: 'PUT', headers: { host: HOST, ...headers } }))
    expect(res.status).toBe(card.status)
    expect(await res.json()).toEqual(await card.json())
    expect(res.status).toBe(403)
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('signOut returns an error → 500 {ok:false}', async () => {
    mockSignOut.mockResolvedValue({ error: new Error('auth down') })
    const res = await route.POST(req({ origin: `http://${HOST}` }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('signOut throws → 500 {ok:false}', async () => {
    mockSignOut.mockRejectedValue(new Error('network'))
    const res = await route.POST(req({ origin: `http://${HOST}` }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false })
  })
})
