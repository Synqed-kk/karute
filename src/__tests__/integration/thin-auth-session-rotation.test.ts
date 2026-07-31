// thin/auth/session onAuthStateChange rotation mirror (packet 15 P1).
//
// The removed epoch-generation fence dropped every legitimate TOKEN_REFRESHED
// after login: the listener cached epochGen on the inline SIGNED_IN, then
// LoginScreen's belt-and-braces authoritative write bumped the store generation
// one PAST it, so every later rotation failed the gen check and the store kept
// serving the login-time token (facade Bearer went stale → 401s after ~60min on
// a continuously-foreground device). The identity-based applyTokenRotation
// mirrors a same-user rotation regardless of generation churn, and still drops a
// late refresh once the user has signed out.
//
// SAFEGUARD (classifier-sensitive auth seam): fixture token strings only —
// never a real or decoded token value.
import type { Session } from '@supabase/supabase-js'
import { getAccessToken, getSessionState, setSessionState } from '@/lib/auth/mobile/session-store'

jest.mock('@/lib/karute/logout-wipe', () => ({
  wipeSessionVault: jest.fn(async () => {}),
}))

jest.mock('@/lib/auth/mobile/config', () => ({
  loadAuthClientConfig: jest.fn(() => ({ url: 'https://x.supabase.co', anonKey: 'anon' })),
}))

jest.mock('../../../thin/env', () => ({
  getThinEnv: () => ({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' }),
}))

let authCb: ((event: string, session: unknown) => void) | undefined
const startAutoRefresh = jest.fn(async () => {})
jest.mock('@/lib/auth/mobile/client-session', () => ({
  createMobileAuth: jest.fn(() => ({
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authCb = cb
      },
      // SIGNED_IN re-arms the ticker (thin/auth/session.ts) — must exist here.
      startAutoRefresh: () => startAutoRefresh(),
    },
    boot: jest.fn(async () => ({ status: 'recovering' })),
    bindLifecycle: jest.fn(),
    signOut: jest.fn(),
  })),
}))

import { getMobileAuth } from '../../../thin/auth/session'

const s = (token: string, uid: string) =>
  ({ access_token: token, user: { id: uid } }) as unknown as Session

afterEach(() => {
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

beforeEach(() => {
  startAutoRefresh.mockClear()
})

describe('thin/auth/session — token-rotation mirror (packet 15 P1)', () => {
  it('mirrors a TOKEN_REFRESHED for the current user even after login bumps the generation', () => {
    getMobileAuth() // wires the onAuthStateChange listener via the mocked createMobileAuth
    expect(authCb).toBeDefined()

    // login-shaped sequence: auth-js notifies SIGNED_IN inline (listener writes),
    // then LoginScreen's belt-and-braces authoritative write bumps the store
    // generation one past the epoch the OLD fence had cached.
    authCb!('SIGNED_IN', s('tok-login', 'staff-A'))
    setSessionState({ status: 'signed-in', session: s('tok-login', 'staff-A') })

    // auth-js rotates the token for the SAME user (~55min in).
    authCb!('TOKEN_REFRESHED', s('tok-rotated', 'staff-A'))
    expect(getAccessToken()).toBe('tok-rotated')
  })

  it('does NOT mirror a late TOKEN_REFRESHED for the outgoing user after sign-out', () => {
    getMobileAuth()
    expect(authCb).toBeDefined()

    authCb!('SIGNED_IN', s('tok-login', 'staff-A'))
    setSessionState({ status: 'signed-in', session: s('tok-login', 'staff-A') })

    // sign-out flip (the button path demotes the store to signed-out).
    setSessionState({ status: 'signed-out' })

    // a stale in-flight refresh for the now-signed-out user lands late.
    authCb!('TOKEN_REFRESHED', s('tok-late', 'staff-A'))
    expect(getAccessToken()).toBeNull()
  })
})

describe('thin/auth/session — identity-guarded SIGNED_IN branch (packet 25 fix F2-2, P1)', () => {
  // GoTrue's constructor-launched _recoverAndRefresh can notify SIGNED_IN
  // with a session captured BEFORE a concurrent sign-out purge lands
  // (stopAutoRefresh only clears the ticker; in-flight chains survive) — an
  // unconditional write would resurrect the signed-out user's Bearer or
  // clobber a second user's fresh sign-in on a shared device. Real logins
  // never depend on this event: LoginScreen.tsx:39 writes the store
  // DIRECTLY from signInWithPassword's response.
  it('a stale SIGNED_IN arriving after sign-out is DROPPED — store stays signed-out', () => {
    getMobileAuth()
    authCb!('SIGNED_IN', s('tok-A', 'staff-A'))
    setSessionState({ status: 'signed-out' })

    authCb!('SIGNED_IN', s('tok-stale', 'staff-A'))
    expect(getSessionState().status).toBe('signed-out')
    expect(getAccessToken()).toBeNull()
  })

  it('a stale SIGNED_IN for the OUTGOING user after a second user signed in is DROPPED', () => {
    getMobileAuth()
    authCb!('SIGNED_IN', s('tok-A', 'staff-A'))
    // Staff B signs in on the shared device (LoginScreen's direct write).
    setSessionState({ status: 'signed-in', session: s('tok-B', 'staff-B') })

    // Staff A's stale SIGNED_IN (captured before A signed out) lands late.
    authCb!('SIGNED_IN', s('tok-A-stale', 'staff-A'))
    expect(getAccessToken()).toBe('tok-B')
  })

  it('INITIAL_SESSION while still recovering applies (normal cold-boot settle)', () => {
    getMobileAuth()
    authCb!('INITIAL_SESSION', s('tok-boot', 'staff-A'))
    expect(getSessionState()).toEqual({ status: 'signed-in', session: s('tok-boot', 'staff-A') })
  })

  it('a same-uid SIGNED_IN echo while already signed-in applies (session object refreshed)', () => {
    getMobileAuth()
    setSessionState({ status: 'signed-in', session: s('tok-1', 'staff-A') })
    authCb!('SIGNED_IN', s('tok-2', 'staff-A'))
    expect(getAccessToken()).toBe('tok-2')
  })

  it('an undefined-uid store session never identity-matches — undefined === undefined is not a match', () => {
    getMobileAuth()
    setSessionState({
      status: 'signed-in',
      session: { access_token: 'tok-anon' } as Session,
    })
    authCb!('SIGNED_IN', { access_token: 'tok-evil' } as Session)
    // Same rule as applyTokenRotation: uid must be PRESENT on both sides.
    expect(getAccessToken()).toBe('tok-anon')
  })

  it('startAutoRefresh still fires on a DROPPED SIGNED_IN (re-arm survives even when the write is dropped)', () => {
    getMobileAuth()
    setSessionState({ status: 'signed-out' })
    authCb!('SIGNED_IN', s('tok-stale', 'staff-A')) // dropped: store stays signed-out
    expect(getSessionState().status).toBe('signed-out')
    expect(startAutoRefresh).toHaveBeenCalledTimes(1)
  })
})
