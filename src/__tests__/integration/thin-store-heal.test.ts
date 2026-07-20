/**
 * @jest-environment jsdom
 *
 * Stranded-pin self-heal (Gap B½ follow-up). A pinned store the clamp rejects
 * (store deleted/swapped, role restricted later) 403s EVERY facade call —
 * chrome included, so the switcher is gone and the pin survives sign-out by
 * design: without the heal there is no in-app recovery. Pins: a clamp
 * store_forbidden (reason: 'store_header') whose lens came from the caller's
 * own pref clears that user's pin and retries ONCE unlensed · a
 * resource-ownership store_forbidden (no marker) NEVER heals · a caller-set
 * store-id header is never healed · other 403 codes and unlensed requests
 * pass through · the compare-and-clear guard keeps a slow 403 from evicting
 * a fresh re-pin · the ownership gate holds at decision time (session switch
 * during the body read) · the retry rides the CURRENT Bearer.
 */
import type { Session } from '@supabase/supabase-js'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { facadeApiFetch } from '../../../thin/ports/facade-fetch'
import {
  getThinActiveStore,
  setThinActiveStore,
} from '../../../thin/chrome/store-pref'
// The heal's fire-and-forget chrome nudge (fleet round 2, P1) — mocked at the
// module seam so these tests assert the CALL, not the chrome pipeline (that
// pipeline is pinned in thin-chrome.test.tsx).
import { resyncChromeAfterHeal } from '../../../thin/chrome/chrome-store'

jest.mock('../../../thin/chrome/chrome-store', () => ({
  resyncChromeAfterHeal: jest.fn(),
}))

/** The nudge rides a dynamic import — flush a macrotask before asserting. */
const flushDynamicImport = () => new Promise((r) => setTimeout(r, 0))

const toUrl = (p: string) => `https://facade.test${p}`

const forbidden = (code: string, reason?: string) =>
  ({
    status: 403,
    clone: () => ({
      json: async () => ({ error: { code, ...(reason ? { reason } : {}) } }),
    }),
  }) as unknown as Response

const ok = { status: 200, ok: true } as unknown as Response

const originalFetch = global.fetch
const headersOf = (call: unknown[]) =>
  (call[1] as { headers: Headers }).headers

beforeEach(() => {
  window.localStorage.clear()
  jest.mocked(resyncChromeAfterHeal).mockClear()
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
      .mockResolvedValueOnce(forbidden('store_forbidden', 'store_header'))
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
      .mockResolvedValue(forbidden('store_forbidden', 'store_header'))
    global.fetch = fetchSpy as unknown as typeof fetch
    const res = await facadeApiFetch(toUrl, '/api/app/v1/screens/chrome', {
      headers: { 'store-id': 's-other' },
    })
    expect(res.status).toBe(403)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(getThinActiveStore()).toBe('s-mine')
  })

  it("a resource-ownership store_forbidden (no store_header marker) never heals — the pin is fine, the resource isn't", async () => {
    setThinActiveStore('s-mine')
    const fetchSpy = jest
      .fn<Promise<Response>, unknown[]>()
      // The unmarked class: karute-route resource ownership AND the clamp's
      // fail-closed transient lookup error both ship code-only bodies.
      .mockResolvedValue(forbidden('store_forbidden'))
    global.fetch = fetchSpy as unknown as typeof fetch
    const res = await facadeApiFetch(toUrl, '/api/app/v1/karute', {
      method: 'POST',
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
      .mockResolvedValue(forbidden('store_forbidden', 'store_header'))
    global.fetch = fetchSpy as unknown as typeof fetch
    await facadeApiFetch(toUrl, '/api/app/v1/screens/customers')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("a 403 landing after ITS user signed out is never healed — no retry with a dead session's Bearer", async () => {
    setThinActiveStore('s-store')
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
    setSessionState({ status: 'signed-out' })
    resolveFirst(forbidden('store_forbidden', 'store_header'))
    const res = await inflight
    expect(res.status).toBe(403)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("a 403 landing after ANOTHER user signed in never clears that user's matching pin", async () => {
    setThinActiveStore('s-store') // u1's pin
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
    // Shared device: u1 signs out, u2 signs in and pins the SAME store id.
    setSessionState({ status: 'signed-out' })
    setSessionState({
      status: 'signed-in',
      session: { access_token: 'tok2', user: { id: 'u2' } } as Session,
    })
    setThinActiveStore('s-store')
    resolveFirst(forbidden('store_forbidden', 'store_header'))
    await inflight
    expect(getThinActiveStore()).toBe('s-store') // u2's pin intact
    expect(fetchSpy).toHaveBeenCalledTimes(1) // and no retry with u1's Bearer
  })

  it('a session switch during the 403 body read still blocks the heal — the gate holds at decision time', async () => {
    setThinActiveStore('s-store') // u1's pin
    let resolveJson: (v: unknown) => void = () => {}
    const deferred403 = {
      status: 403,
      clone: () => ({
        json: () =>
          new Promise((r) => {
            resolveJson = r
          }),
      }),
    } as unknown as Response
    const fetchSpy = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(deferred403)
      .mockResolvedValue(ok)
    global.fetch = fetchSpy as unknown as typeof fetch
    const inflight = facadeApiFetch(toUrl, '/api/app/v1/screens/customers')
    await Promise.resolve() // let the heal reach the json() suspension
    // u1 → u2 switch INSIDE the body-read window; u2 pins the SAME store id.
    setSessionState({ status: 'signed-out' })
    setSessionState({
      status: 'signed-in',
      session: { access_token: 'tok2', user: { id: 'u2' } } as Session,
    })
    setThinActiveStore('s-store')
    resolveJson({ error: { code: 'store_forbidden', reason: 'store_header' } })
    await inflight
    expect(getThinActiveStore()).toBe('s-store') // u2's pin intact
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('the retry rides the CURRENT Bearer after a mid-flight token rotation', async () => {
    setThinActiveStore('s-dead')
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
    // TOKEN_REFRESHED while fetch #1 is in flight — same user, rotated token.
    setSessionState({
      status: 'signed-in',
      session: { access_token: 'tok-rotated', user: { id: 'u1' } } as Session,
    })
    resolveFirst(forbidden('store_forbidden', 'store_header'))
    await inflight
    expect(getThinActiveStore()).toBeNull() // heal still fired (same user)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(headersOf(fetchSpy.mock.calls[0]).get('Authorization')).toBe(
      'Bearer tok',
    )
    expect(headersOf(fetchSpy.mock.calls[1]).get('Authorization')).toBe(
      'Bearer tok-rotated',
    )
  })

  it('a caller-set Authorization header is never overwritten on the retry', async () => {
    setThinActiveStore('s-dead')
    const fetchSpy = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(forbidden('store_forbidden', 'store_header'))
      .mockResolvedValueOnce(ok)
    global.fetch = fetchSpy as unknown as typeof fetch
    await facadeApiFetch(toUrl, '/api/app/v1/screens/customers', {
      headers: { Authorization: 'Bearer caller-owned' },
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(headersOf(fetchSpy.mock.calls[1]).get('Authorization')).toBe(
      'Bearer caller-owned',
    )
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
    resolveFirst(forbidden('store_forbidden', 'store_header'))
    await inflight
    expect(getThinActiveStore()).toBe('s-new')
  })

  it('the retry RIDES a fresh pin established while the 403 was in flight — never strips it (fleet round 2)', async () => {
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
    // A concurrent heal's re-seed (or a switcher tap) lands a fresh valid
    // pin while this response is still in flight.
    setThinActiveStore('s-new')
    resolveFirst(forbidden('store_forbidden', 'store_header'))
    await inflight
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    // The retried response must be scoped to the CURRENT lens, not unlensed —
    // the compare-and-clear protects storage; this protects the response.
    expect(headersOf(fetchSpy.mock.calls[1]).get('store-id')).toBe('s-new')
    expect(getThinActiveStore()).toBe('s-new')
  })

  it('a successful heal nudges the chrome resync exactly once', async () => {
    setThinActiveStore('s-dead')
    const fetchSpy = jest
      .fn<Promise<Response>, unknown[]>()
      .mockResolvedValueOnce(forbidden('store_forbidden', 'store_header'))
      .mockResolvedValueOnce(ok)
    global.fetch = fetchSpy as unknown as typeof fetch
    await facadeApiFetch(toUrl, '/api/app/v1/screens/customers')
    await flushDynamicImport()
    expect(resyncChromeAfterHeal).toHaveBeenCalledTimes(1)
  })

  it('a refused heal never nudges the chrome resync', async () => {
    setThinActiveStore('s-mine')
    const fetchSpy = jest
      .fn<Promise<Response>, unknown[]>()
      // Unmarked store_forbidden — the never-heal class.
      .mockResolvedValue(forbidden('store_forbidden'))
    global.fetch = fetchSpy as unknown as typeof fetch
    await facadeApiFetch(toUrl, '/api/app/v1/karute', { method: 'POST' })
    await flushDynamicImport()
    expect(resyncChromeAfterHeal).not.toHaveBeenCalled()
  })
})
