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
 * SAFEGUARD (classifier-sensitive auth seam): fixture token strings only —
 * never a real or decoded token value.
 */
import type { Session } from '@supabase/supabase-js'
import {
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
// the true constant and never drifts from a duplicated literal here. boot()
// never resolves in these tests: every settle is simulated by calling the
// REAL setSessionState directly (the single choke point every settle path —
// fast resolve, onSettled, onAuthStateChange — funnels through in production).
jest.mock('@/lib/auth/mobile/client-session', () => ({
  ...jest.requireActual('@/lib/auth/mobile/client-session'),
  createMobileAuth: jest.fn(() => ({
    auth: { onAuthStateChange: jest.fn(), startAutoRefresh: jest.fn(async () => {}) },
    boot: jest.fn(() => new Promise(() => {})),
    bindLifecycle: jest.fn(),
    signOut: jest.fn(),
  })),
}))

import { SESSION_STORAGE_KEY } from '@/lib/auth/mobile/client-session'
import { bootMobileAuth } from '../../../thin/auth/session'

const stored = (token: string, uid: string) => JSON.stringify({ access_token: token, user: { id: uid } })
const liveSession = (token: string, uid: string) =>
  ({ access_token: token, user: { id: uid } }) as Session

afterEach(() => {
  window.localStorage.removeItem(SESSION_STORAGE_KEY)
  // Two-step on purpose (see thin-bottom-nav.test.tsx): only an explicit
  // signed-out clears the store's lastSession.
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
    ['missing access_token', JSON.stringify({ user: { id: 'staff-A' } })],
    ['missing user.id', JSON.stringify({ access_token: 'tok' })],
  ])('T2 guard — %s: no seed, no throw', (_label, raw) => {
    if (raw === null) window.localStorage.removeItem(SESSION_STORAGE_KEY)
    else window.localStorage.setItem(SESSION_STORAGE_KEY, raw as string)

    expect(() => bootMobileAuth()).not.toThrow()
    expect(hasKnownSession()).toBe(false)
  })

  describe('T5 settle-refresh (mandatory second-order pin)', () => {
    it('seeded boot settling signed-in fires emitRefresh exactly once (a second write does not re-fire)', () => {
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

      // The late settle (onSettled) then reports the eventual signed-in.
      setSessionState({ status: 'signed-in', session: liveSession('tok-late', 'staff-A') })
      expect(onRefresh).toHaveBeenCalledTimes(1)

      unsubscribe()
    })
  })
})
