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
import { getAccessToken, setSessionState } from '@/lib/auth/mobile/session-store'

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
