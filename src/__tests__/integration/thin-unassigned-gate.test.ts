/**
 * THE PHONE'S HALF OF THE UNASSIGNED GATE (⚖ Liam 2026-09-16, fold round 2 / F3).
 *
 * Before this, `thin/` was untouched by the whole change: `store_unassigned`
 * appeared nowhere in the shell, so a phone — including one baked from the
 * gate's own tip — showed its generic error instead of 「担当店舗が未設定です」,
 * and the recording port classified a permanent refusal as RETRYABLE.
 *
 * Two pieces, both pinned here: the one fetch funnel every facade call passes
 * through learns the verdict, and the recording port treats the code as
 * terminal.
 */

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'

const session = { current: { user: { id: 'u1' } } as { user: { id: string } } | null }
jest.mock('@/lib/auth/mobile/session-store', () => ({
  getAccessToken: () => 'tok',
  getCurrentSession: () => session.current,
}))
jest.mock('../../../thin/chrome/store-pref', () => ({
  getThinActiveStore: () => null,
  clearThinActiveStore: jest.fn(),
}))
// The recording port reaches the network through this seam — stubbed so the
// port's own 403 CLASSIFIER is the thing under test, not a fetch.
const apiFetch = jest.fn()
jest.mock('@/lib/ports/data-port', () => ({ getDataPort: () => ({ apiFetch }) }))

import { facadeApiFetch } from '../../../thin/ports/facade-fetch'
import { viteRecordingPort } from '../../../thin/ports/recording.vite'
import {
  markStoreUnassigned,
  resetStoreUnassigned,
  subscribeStoreUnassigned,
  unassignedUserId,
} from '../../../thin/chrome/store-unassigned'

const toUrl = (p: string) => `https://s${p}`
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  resetStoreUnassigned()
  session.current = { user: { id: 'u1' } }
})

describe('the shell learns the verdict from any refused call', () => {
  it('a 403 store_unassigned on ANY endpoint marks the signed-in user', async () => {
    global.fetch = jest.fn(async () =>
      json(403, { error: { code: 'store_unassigned', message: 'no store' } }),
    ) as unknown as typeof fetch
    await facadeApiFetch(toUrl, '/api/app/v1/screens/dashboard')
    expect(unassignedUserId()).toBe('u1')
  })

  it('no other refusal marks it — a store_forbidden is a different fact', async () => {
    global.fetch = jest.fn(async () =>
      json(403, { error: { code: 'store_forbidden', message: 'x' } }),
    ) as unknown as typeof fetch
    await facadeApiFetch(toUrl, '/api/app/v1/screens/dashboard')
    expect(unassignedUserId()).toBeNull()
  })

  it('a 200 never marks it', async () => {
    global.fetch = jest.fn(async () => json(200, { ok: true })) as unknown as typeof fetch
    await facadeApiFetch(toUrl, '/api/app/v1/screens/dashboard')
    expect(unassignedUserId()).toBeNull()
  })

  it('the response itself is returned UNTOUCHED — the gate reads, never rewrites', async () => {
    global.fetch = jest.fn(async () =>
      json(403, { error: { code: 'store_unassigned', message: 'no store' } }),
    ) as unknown as typeof fetch
    const res = await facadeApiFetch(toUrl, '/api/app/v1/screens/dashboard')
    expect(res.status).toBe(403)
    // The body was cloned, so the caller's own read still works.
    expect((await res.json()).error.code).toBe('store_unassigned')
  })

  it('it is keyed by USER — a shared iPad never strands the next person', () => {
    markStoreUnassigned('u1')
    expect(unassignedUserId()).toBe('u1')
    // The gate compares this against the CURRENT session id, so signing in as
    // somebody else simply stops matching. Nothing to clear, nothing to leak.
    expect(unassignedUserId()).not.toBe('u2')
  })

  it('subscribers are notified once, so the shell re-renders into the screen', () => {
    const seen = jest.fn()
    const off = subscribeStoreUnassigned(seen)
    markStoreUnassigned('u1')
    markStoreUnassigned('u1') // same user again — no second notification
    off()
    markStoreUnassigned('u2') // unsubscribed
    expect(seen).toHaveBeenCalledTimes(1)
  })
})

describe('the recording port treats it as PERMANENT', () => {
  // The port enumerates its terminal 403s by name; anything unnamed falls
  // through to `upstream`, which is the RETRYABLE arm. `store_unassigned`
  // cannot be retried into success — only a manager editing the roster changes
  // it — so it belongs with the other three. Driven through the real
  // classifier, one refusal at a time.
  const refuse = (code: string) =>
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { code, message: 'x' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    )
  const enqueue = async () =>
    viteRecordingPort.enqueueJobFromSession({ recordingSessionId: 'rs-1' } as never)

  it('answers `forbidden` — the TERMINAL arm — for store_unassigned', async () => {
    refuse('store_unassigned')
    expect(await enqueue()).toEqual({ error: 'forbidden' })
  })

  it('…the same as the three codes it already named', async () => {
    for (const code of ['forbidden', 'store_forbidden', 'tenant_forbidden']) {
      refuse(code)
      expect(await enqueue()).toEqual({ error: 'forbidden' })
    }
  })

  it('MUTANT — an UNNAMED 403 code still falls through to the retryable arm', async () => {
    // This is what store_unassigned used to do: `upstream`, which the caller
    // retries. The test exists so the difference between the two arms is
    // visible rather than asserted about.
    refuse('some_code_nobody_named')
    expect(await enqueue()).toEqual({ error: 'upstream' })
  })
})
