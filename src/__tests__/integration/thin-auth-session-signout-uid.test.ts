/** @jest-environment jsdom */
// F3 fix (packet 12 fix batch): thin/auth/session.ts's SIGNED_OUT listener
// used to call setSessionState({status:'signed-out'}) (nulling the session)
// BEFORE wipeSessionVault() — so on the thin path, clearOwnTakes'
// currentUserId() (which reads FROM the session store) resolved null for
// every SERVER-driven sign-out (failed refresh, revoke, password reset),
// silently no-op'ing and leaving the leaving staff member's takes on the
// shared device. Pins the ordering fix: the outgoing uid is captured
// SYNCHRONOUSLY, from the session store, BEFORE the store flips — using the
// REAL session-store (not mocked away; the ordering IS the bug).
import type { Session } from '@supabase/supabase-js'
import { getCurrentSession, setSessionState } from '@/lib/auth/mobile/session-store'

const wipeSessionVault = jest.fn(async (..._a: unknown[]) => {})
jest.mock('@/lib/karute/logout-wipe', () => ({
  wipeSessionVault: (...a: unknown[]) => wipeSessionVault(...a),
}))

jest.mock('@/lib/auth/mobile/config', () => ({
  loadAuthClientConfig: jest.fn(() => ({ url: 'https://x.supabase.co', anonKey: 'anon' })),
}))

jest.mock('../../../thin/env', () => ({
  getThinEnv: () => ({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' }),
}))

let signedOutCb: ((event: string, session: unknown) => void) | undefined
jest.mock('@/lib/auth/mobile/client-session', () => ({
  createMobileAuth: jest.fn(() => ({
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        signedOutCb = cb
      },
    },
    boot: jest.fn(async () => ({ status: 'recovering' })),
    bindLifecycle: jest.fn(),
    signOut: jest.fn(),
  })),
}))

import { getMobileAuth } from '../../../thin/auth/session'

afterEach(() => {
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('thin/auth/session — SIGNED_OUT listener outgoing-uid capture (F3)', () => {
  it('a server-driven sign-out with a live session at event time wipes THAT uid, not null', () => {
    const session = { access_token: 't', user: { id: 'staff-A' } } as unknown as Session
    setSessionState({ status: 'signed-in', session })
    getMobileAuth() // wires the SIGNED_OUT listener via the mocked createMobileAuth
    expect(signedOutCb).toBeDefined()

    signedOutCb!('SIGNED_OUT', null)

    // The store DID flip synchronously (pre-existing contract, unchanged)...
    expect(getCurrentSession()).toBeNull()
    // ...yet the wipe still targets the uid that was live at event time, not
    // the now-null store.
    expect(wipeSessionVault).toHaveBeenCalledWith({ uid: 'staff-A' })
  })

  it('no session live at event time (already signed out) → wipes with uid undefined, same as before this fix', () => {
    setSessionState({ status: 'signed-out' })
    getMobileAuth()
    expect(signedOutCb).toBeDefined()

    signedOutCb!('SIGNED_OUT', null)

    expect(wipeSessionVault).toHaveBeenCalledWith({ uid: undefined })
  })
})
