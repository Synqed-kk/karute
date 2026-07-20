/**
 * @jest-environment jsdom
 *
 * Stranded-pin self-heal (Gap B½ follow-up). A pinned store the clamp rejects
 * (store deleted/swapped, role restricted later) 403s EVERY facade call —
 * chrome included, so the switcher is gone and the pin survives sign-out by
 * design: without the heal there is no in-app recovery. Pins: a
 * store_forbidden response whose lens came from the caller's own pref clears
 * that user's pin and retries ONCE unlensed · a caller-set store-id header is
 * never healed · other 403 codes and unlensed requests pass through · the
 * compare-and-clear guard keeps a slow 403 from evicting a fresh re-pin.
 */
import type { Session } from '@supabase/supabase-js'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { facadeApiFetch } from '../../../thin/ports/facade-fetch'
import {
  getThinActiveStore,
  setThinActiveStore,
} from '../../../thin/chrome/store-pref'

const toUrl = (p: string) => `https://facade.test${p}`

const forbidden = (code: string) =>
  ({
    status: 403,
    clone: () => ({ json: async () => ({ error: { code } }) }),
  }) as unknown as Response

const ok = { status: 200, ok: true } as unknown as Response

const originalFetch = global.fetch
const headersOf = (call: unknown[]) =>
  (call[1] as { headers: Headers }).headers

beforeEach(() => {
  window.localStorage.clear()
  setSessionState({
    status: 'signed-in',
    session: { access_token: 'tok', user: { id: 'u1' } } as Session,
  })
})

afterEach(() => {
  global.fetch = originalFetch
  // Two-step on purpose (see thin-splash-gate.test.tsx).
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('facadeApiFetch stranded-pin self-heal', () => {
  it('store_forbidden on an own-pref lens clears the pin and retries once unlensed', async () => {
    setThinActiveStore('s-dead')
    const fetchSpy = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(forbidden('store_forbidden'))
      .mockResolvedValueOnce(ok)
    global.fetch = fetchSpy as unknown as typeof fetch
    const res = await facadeApiFetch(toUrl, '/api/app/v1/screens/chrome')
    expect(res).toBe(ok)
    expect(getThinActiveStore()).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(headersOf(fetchSpy.mock.calls[0]).get('store-id')).toBe('s-dead')
    expect(headersOf(fetchSpy.mock.calls[1]).get('store-id')).toBeNull()
    // The retry keeps its identity — same Bearer, unlensed only.
    expect(headersOf(fetchSpy.mock.calls[1]).get('Authorization')).toBe(
      'Bearer tok',
    )
  })

  it('a caller-set store-id header is never healed — pref untouched, no retry', async () => {
    setThinActiveStore('s-mine')
    const fetchSpy = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValue(forbidden('store_forbidden'))
    global.fetch = fetchSpy as unknown as typeof fetch
    const res = await facadeApiFetch(toUrl, '/api/app/v1/screens/chrome', {
      headers: { 'store-id': 's-other' },
    })
    expect(res.status).toBe(403)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(getThinActiveStore()).toBe('s-mine')
  })

  it('a 403 that is not store_forbidden passes through untouched', async () => {
    setThinActiveStore('s-mine')
    const fetchSpy = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValue(forbidden('tenant_forbidden'))
    global.fetch = fetchSpy as unknown as typeof fetch
    const res = await facadeApiFetch(toUrl, '/api/app/v1/screens/customers')
    expect(res.status).toBe(403)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(getThinActiveStore()).toBe('s-mine')
  })

  it('an unlensed request is never retried — nothing to heal', async () => {
    const fetchSpy = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValue(forbidden('store_forbidden'))
    global.fetch = fetchSpy as unknown as typeof fetch
    await facadeApiFetch(toUrl, '/api/app/v1/screens/customers')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('a slow store_forbidden landing after a re-pin does not evict the fresh lens', async () => {
    setThinActiveStore('s-old')
    let resolveFirst: (r: Response) => void = () => {}
    const fetchSpy = jest
      .fn<Promise<Response>, unknown[]>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            resolveFirst = r
          }),
      )
      .mockResolvedValue(ok)
    global.fetch = fetchSpy as unknown as typeof fetch
    const inflight = facadeApiFetch(toUrl, '/api/app/v1/screens/customers')
    setThinActiveStore('s-new') // switcher tap / chrome re-seed while in flight
    resolveFirst(forbidden('store_forbidden'))
    await inflight
    expect(getThinActiveStore()).toBe('s-new')
  })
})
