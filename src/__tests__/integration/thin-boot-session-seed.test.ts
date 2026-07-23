/**
 * @jest-environment jsdom
 *
 * bootMobileAuth's synchronous known-session seed (perf packet 25 PR-B): a
 * persisted session read directly off window.localStorage — before boot()
 * settles — populates lastSession so AuthGate's recovering-with-known-session
 * contract mounts the app instantly on cold boot instead of waiting on the
 * network. Separate jsdom-environment file from thin-auth-session-rotation
 * (node env, no `window`): the seed reads REAL localStorage synchronously, so
 * these tests need a real DOM global.
 *
 * Also covers fix round 1 (Fable adjudication of the 3-lens blind fleet on
 * 96005500): F1 fences both boot-settle paths to apply ONLY while the store
 * is still 'recovering' (session resurrection / cross-user Bearer guard); F3
 * only fires the settle-refresh when the settled token actually differs from
 * the seeded one; F4 retries the emit until a screen has actually
 * subscribed; F5 strengthens the seed's shape guard; F6 pins the newly-
 * reachable pre-boot rotation path.
 *
 * SAFEGUARD (classifier-sensitive auth seam): fixture token strings only —
 * never a real or decoded token value.
 */
import type { Session } from '@supabase/supabase-js'
import type { BootState } from '@/lib/auth/mobile/boot-gate'
import {
  applyTokenRotation,
  currentGeneration,
  getAccessToken,
  getSessionState,
  hasKnownSession,
  setSessionState,
} from '@/lib/auth/mobile/session-store'
import { subscribeRefresh } from '../../../thin/ports/nav.vite'

jest.mock('@/lib/karute/logout-wipe', () => ({
  wipeSessionVault: jest.fn(async () => {}),
}))

jest.mock('@/lib/auth/mobile/config', () => ({
  loadAuthClientConfig: jest.fn(() => ({ url: 'https://x.supabase.co', anonKey: 'anon' })),
}))

jest.mock('../../../thin/env', () => ({
  getThinEnv: () => ({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' }),
}))

// Real SESSION_STORAGE_KEY preserved (requireActual) — only createMobileAuth
// itself is stubbed, so bootMobileAuth's `SESSION_STORAGE_KEY` import stays
// the true constant and never drifts from a duplicated literal here.
// `boot` is CONTROLLABLE (fix F1 needs both the fast-resolve promise AND the
// late-settle `onSettled` callback under test control) — every settle in
// these tests goes through the REAL settleBoot/armSettleRefresh wiring
// inside bootMobileAuth, just with the timing driven by hand.
type Settle = (state: BootState<Session>) => void
let bootOnSettled: Settle | undefined
let bootResolve: Settle | undefined
let bootPromise: Promise<BootState<Session>>

function armBootPromise(): void {
  bootPromise = new Promise((resolve) => {
    bootResolve = resolve
  })
}

jest.mock('@/lib/auth/mobile/client-session', () => ({
  ...jest.requireActual('@/lib/auth/mobile/client-session'),
  createMobileAuth: jest.fn(() => ({
    auth: { onAuthStateChange: jest.fn(), startAutoRefresh: jest.fn(async () => {}) },
    boot: jest.fn((onSettled?: Settle) => {
      bootOnSettled = onSettled
      return bootPromise
    }),
    bindLifecycle: jest.fn(),
    signOut: jest.fn(),
  })),
}))

import { SESSION_STORAGE_KEY } from '@/lib/auth/mobile/client-session'
import { bootMobileAuth } from '../../../thin/auth/session'

const stored = (token: string, uid: string) =>
  JSON.stringify({
    access_token: token,
    user: { id: uid },
    refresh_token: 'rt',
    expires_at: 9999999999,
  })
const liveSession = (token: string, uid: string): Session =>
  ({ access_token: token, user: { id: uid } }) as Session
// Drains a real (non-fake) then-chain — the same idiom thin-screen-refresh
// uses to flush a promise's reactions before asserting on the result.
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

beforeEach(() => {
  armBootPromise()
})

afterEach(() => {
  window.localStorage.removeItem(SESSION_STORAGE_KEY)
  // Two-step on purpose (see thin-bottom-nav.test.tsx): only an explicit
  // signed-out clears the store's lastSession. This ALSO flushes any
  // dangling armSettleRefresh subscription from the test just run (any
  // non-recovering write unsubscribes it), so no listener leaks test-to-test.
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('bootMobileAuth — synchronous known-session seed (packet 25 PR-B)', () => {
  it('T1 seed happy path: valid persisted session seeds before boot() settles', () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, stored('tok-seed', 'staff-A'))
    const gen = currentGeneration()

    bootMobileAuth()

    expect(hasKnownSession()).toBe(true)
    expect(getAccessToken()).toBe('tok-seed')
    expect(getSessionState()).toEqual({ status: 'recovering' })
    expect(currentGeneration()).toBe(gen)
  })

  it.each([
    ['absent key', null],
    ['malformed JSON', '{not-json'],
    [
      'missing access_token',
      JSON.stringify({ user: { id: 'staff-A' }, refresh_token: 'rt', expires_at: 999 }),
    ],
    [
      'missing user.id',
      JSON.stringify({ access_token: 'tok', refresh_token: 'rt', expires_at: 999 }),
    ],
    // F5: strengthened to auth-js's own shape check (presence only).
    [
      'missing refresh_token/expires_at (F5)',
      JSON.stringify({ access_token: 'tok', user: { id: 'staff-A' } }),
    ],
  ])('T2 guard — %s: no seed, no throw', (_label, raw) => {
    if (raw === null) window.localStorage.removeItem(SESSION_STORAGE_KEY)
    else window.localStorage.setItem(SESSION_STORAGE_KEY, raw as string)

    expect(() => bootMobileAuth()).not.toThrow()
    expect(hasKnownSession()).toBe(false)
  })

  describe('T5 / F3 settle-refresh (mandatory second-order pin, narrowed to an actual token change)', () => {
    it('seeded boot settling signed-in with a DIFFERENT token fires emitRefresh exactly once (a second write does not re-fire)', () => {
      window.localStorage.setItem(SESSION_STORAGE_KEY, stored('tok-seed', 'staff-A'))
      const onRefresh = jest.fn()
      const unsubscribe = subscribeRefresh(onRefresh)

      bootMobileAuth()
      setSessionState({ status: 'signed-in', session: liveSession('tok-fresh', 'staff-A') })
      expect(onRefresh).toHaveBeenCalledTimes(1)

      setSessionState({ status: 'signed-in', session: liveSession('tok-fresh-2', 'staff-A') })
      expect(onRefresh).toHaveBeenCalledTimes(1)

      unsubscribe()
    })

    it('F3: seeded boot settling signed-in with the SAME (unchanged) token does NOT fire emitRefresh', () => {
      window.localStorage.setItem(SESSION_STORAGE_KEY, stored('tok-seed', 'staff-A'))
      const onRefresh = jest.fn()
      const unsubscribe = subscribeRefresh(onRefresh)

      bootMobileAuth()
      // Every fetch on this token already succeeded — nothing to heal.
      setSessionState({ status: 'signed-in', session: liveSession('tok-seed', 'staff-A') })
      expect(onRefresh).not.toHaveBeenCalled()

      unsubscribe()
    })

    it('seeded boot settling signed-out never fires emitRefresh', () => {
      window.localStorage.setItem(SESSION_STORAGE_KEY, stored('tok-seed', 'staff-A'))
      const onRefresh = jest.fn()
      const unsubscribe = subscribeRefresh(onRefresh)

      bootMobileAuth()
      setSessionState({ status: 'signed-out' })
      expect(onRefresh).not.toHaveBeenCalled()

      unsubscribe()
    })

    it('unseeded cold boot never subscribes: a later signed-in settle does not fire emitRefresh', () => {
      // no localStorage key — the seed never fires.
      const onRefresh = jest.fn()
      const unsubscribe = subscribeRefresh(onRefresh)

      bootMobileAuth()
      setSessionState({ status: 'signed-in', session: liveSession('tok', 'staff-A') })
      expect(onRefresh).not.toHaveBeenCalled()

      unsubscribe()
    })

    it('late-settle order: a recovering notification (timeout fall-through) keeps the listener armed for the later signed-in settle', () => {
      window.localStorage.setItem(SESSION_STORAGE_KEY, stored('tok-seed', 'staff-A'))
      const onRefresh = jest.fn()
      const unsubscribe = subscribeRefresh(onRefresh)

      bootMobileAuth()
      // boot()'s fast path resolving 'recovering' (timeout won the race).
      setSessionState({ status: 'recovering' })
      expect(onRefresh).not.toHaveBeenCalled()

      // The late settle (onSettled) then reports the eventual signed-in with
      // a healed (different) token.
      setSessionState({ status: 'signed-in', session: liveSession('tok-late', 'staff-A') })
      expect(onRefresh).toHaveBeenCalledTimes(1)

      unsubscribe()
    })
  })

  describe('F4: the armed emit must not fire into zero listeners', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })
    afterEach(() => {
      jest.useRealTimers()
    })

    it('settle before any subscriber; a listener added afterward still receives the retried emit', () => {
      window.localStorage.setItem(SESSION_STORAGE_KEY, stored('tok-seed', 'staff-A'))
      bootMobileAuth()
      // Settles with a DIFFERENT token, before ANY screen has mounted/subscribed.
      setSessionState({ status: 'signed-in', session: liveSession('tok-fresh', 'staff-A') })

      const onRefresh = jest.fn()
      const unsubscribe = subscribeRefresh(onRefresh)
      expect(onRefresh).not.toHaveBeenCalled()

      jest.advanceTimersByTime(50)
      expect(onRefresh).toHaveBeenCalledTimes(1)

      unsubscribe()
    })

    it('gives up silently after ~2s if no listener ever arrives — a LATER listener does not retroactively receive it', () => {
      window.localStorage.setItem(SESSION_STORAGE_KEY, stored('tok-seed', 'staff-A'))
      bootMobileAuth()
      expect(() => {
        setSessionState({ status: 'signed-in', session: liveSession('tok-fresh', 'staff-A') })
        jest.advanceTimersByTime(50 * 41) // past REFRESH_RETRY_MAX (40 tries)
      }).not.toThrow()

      // The retry loop has already abandoned the emit — a listener that
      // subscribes NOW must never receive it.
      const onRefresh = jest.fn()
      const unsubscribe = subscribeRefresh(onRefresh)
      jest.advanceTimersByTime(1000)
      expect(onRefresh).not.toHaveBeenCalled()
      unsubscribe()
    })
  })

  describe('F6: pre-boot rotation (newly reachable — a rotation settling before any authoritative write)', () => {
    it('the armed one-shot fires when applyTokenRotation heals a DIFFERENT token pre-boot', () => {
      window.localStorage.setItem(SESSION_STORAGE_KEY, stored('tok-seed', 'staff-A'))
      const onRefresh = jest.fn()
      const unsubscribe = subscribeRefresh(onRefresh)

      bootMobileAuth()
      applyTokenRotation(liveSession('tok-rotated', 'staff-A'))
      expect(getSessionState().status).toBe('signed-in')
      expect(onRefresh).toHaveBeenCalledTimes(1)

      unsubscribe()
    })
  })

  describe('F1 (P1): a boot settle applies ONLY while the store is still recovering', () => {
    it('recovering → settle signed-in applies (normal fast-resolve path)', async () => {
      bootMobileAuth()
      bootResolve!({ status: 'signed-in', session: liveSession('tok-a', 'staff-A') })
      await flush()
      expect(getSessionState()).toEqual({
        status: 'signed-in',
        session: liveSession('tok-a', 'staff-A'),
      })
    })

    it('timeout fall-through: the recovering write applies, then the LATE settle signed-in applies', async () => {
      bootMobileAuth()
      bootResolve!({ status: 'recovering' })
      await flush()
      expect(getSessionState()).toEqual({ status: 'recovering' })

      // bootSessionGate's onSettled — recovery resolving AFTER the timeout
      // already fell through.
      bootOnSettled!({ status: 'signed-in', session: liveSession('tok-late', 'staff-A') })
      expect(getSessionState()).toEqual({
        status: 'signed-in',
        session: liveSession('tok-late', 'staff-A'),
      })
    })

    it('sign-out during the late-settle window DROPS the boot write — store stays signed-out', async () => {
      bootMobileAuth()
      bootResolve!({ status: 'recovering' })
      await flush()

      // An explicit sign-out (Profile button, or a server-driven SIGNED_OUT)
      // lands while the OLD boot recovery is still in flight.
      setSessionState({ status: 'signed-out' })
      bootOnSettled!({ status: 'signed-in', session: liveSession('tok-stale', 'staff-A') })

      expect(getSessionState()).toEqual({ status: 'signed-out' })
    })

    it('a second user signing in during the window DROPS the stale boot write for the outgoing user', async () => {
      bootMobileAuth()
      bootResolve!({ status: 'recovering' })
      await flush()

      // A second staff member signs in (LoginScreen's belt-and-braces write)
      // on this shared device while the FIRST user's boot recovery still
      // hasn't resolved.
      setSessionState({ status: 'signed-in', session: liveSession('tok-B', 'staff-B') })
      // The outgoing user's recovery finally resolves, late.
      bootOnSettled!({ status: 'signed-in', session: liveSession('tok-A-stale', 'staff-A') })

      expect(getSessionState()).toEqual({
        status: 'signed-in',
        session: liveSession('tok-B', 'staff-B'),
      })
    })

    it('a recovering-status late settle (still unresolved) also applies — not just signed-in/out', async () => {
      bootMobileAuth()
      bootResolve!({ status: 'recovering' })
      await flush()
      // A second, still-inconclusive late report (e.g. another transient
      // reject) — the guard is about STATUS, not about which BootState variant.
      bootOnSettled!({ status: 'recovering' })
      expect(getSessionState()).toEqual({ status: 'recovering' })
    })
  })
})
