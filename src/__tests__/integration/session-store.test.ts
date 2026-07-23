/**
 * Session-store checks (packet-01 integration — the seam the AuthGate and the
 * DataPort's Bearer read). Pins the three rules the thin wiring relies on:
 *   - getAccessToken() is non-null ONLY when signed-in, and tracks the session
 *     it was given (token rotation = a new signed-in state)
 *   - subscribers fire per transition; unsubscribe stops them
 *   - the pre-boot default is 'recovering' (renderable, never a login flash)
 */
import type { Session } from '@supabase/supabase-js'
import {
  applyTokenRotation,
  currentGeneration,
  getAccessToken,
  getSessionState,
  hasKnownSession,
  seedKnownSession,
  setSessionState,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'

const session = (token: string) => ({ access_token: token }) as Session
// With a user id, for the identity-based rotation rule (packet 15 P1).
const sessionU = (token: string, uid: string) =>
  ({ access_token: token, user: { id: uid } }) as Session

describe('session-store', () => {
  afterEach(() => {
    // module singleton: explicit sign-out clears lastSession, then restore the
    // pre-boot default for other tests
    setSessionState({ status: 'signed-out' })
    setSessionState({ status: 'recovering' })
  })

  it('defaults to recovering with no token and no known session', () => {
    expect(getSessionState()).toEqual({ status: 'recovering' })
    expect(getAccessToken()).toBeNull()
    expect(hasKnownSession()).toBe(false)
  })

  it('recovering AFTER signed-in keeps the last-known bearer (offline resume)', () => {
    setSessionState({ status: 'signed-in', session: session('tok-live') })
    setSessionState({ status: 'recovering' })
    expect(getAccessToken()).toBe('tok-live')
    expect(hasKnownSession()).toBe(true)

    // only an explicit sign-out drops it — the boot-gate invariant
    setSessionState({ status: 'signed-out' })
    expect(getAccessToken()).toBeNull()
    expect(hasKnownSession()).toBe(false)
    setSessionState({ status: 'recovering' })
    expect(getAccessToken()).toBeNull()
  })

  it('exposes the bearer only while signed-in and follows rotation', () => {
    setSessionState({ status: 'signed-in', session: session('tok-1') })
    expect(getAccessToken()).toBe('tok-1')

    setSessionState({ status: 'signed-in', session: session('tok-2') })
    expect(getAccessToken()).toBe('tok-2')

    setSessionState({ status: 'signed-out' })
    expect(getAccessToken()).toBeNull()
  })

  describe('applyTokenRotation — identity-based within-epoch mirror (packet 15 P1)', () => {
    it('mirrors a rotation for the CURRENT signed-in uid, without advancing the generation', () => {
      setSessionState({ status: 'signed-in', session: sessionU('tok-1', 'A') })
      const gen = currentGeneration()
      applyTokenRotation(sessionU('tok-2', 'A'))
      expect(getAccessToken()).toBe('tok-2')
      // a rotation is within the epoch — the generation must NOT advance
      expect(currentGeneration()).toBe(gen)
    })

    it('mirrors a rotation while RECOVERING with a matching last-known uid (heals to signed-in)', () => {
      setSessionState({ status: 'signed-in', session: sessionU('tok-1', 'A') })
      setSessionState({ status: 'recovering' })
      applyTokenRotation(sessionU('tok-2', 'A'))
      expect(getAccessToken()).toBe('tok-2')
      expect(getSessionState().status).toBe('signed-in')
    })

    it('DROPS a rotation when the store is signed out (no resurrection)', () => {
      setSessionState({ status: 'signed-out' })
      applyTokenRotation(sessionU('tok-late', 'A'))
      expect(getAccessToken()).toBeNull()
      expect(getSessionState().status).toBe('signed-out')
    })

    it('DROPS a rotation for a DIFFERENT uid than the current session (cross-user)', () => {
      setSessionState({ status: 'signed-in', session: sessionU('tok-B', 'B') })
      applyTokenRotation(sessionU('tok-A', 'A'))
      expect(getAccessToken()).toBe('tok-B') // B's token untouched
    })
  })

  describe('seedKnownSession — pre-boot synchronous seed (packet 25 PR-B)', () => {
    it('no-clobber: store already signed-in → no-op', () => {
      setSessionState({ status: 'signed-in', session: sessionU('tok-live', 'A') })
      seedKnownSession(sessionU('tok-seed', 'B'))
      expect(getAccessToken()).toBe('tok-live')
    })

    it('no-clobber: lastSession already set (recovering w/ known session) → no-op', () => {
      setSessionState({ status: 'signed-in', session: sessionU('tok-live', 'A') })
      setSessionState({ status: 'recovering' })
      seedKnownSession(sessionU('tok-seed', 'B'))
      expect(getAccessToken()).toBe('tok-live')
    })

    it('no-clobber: store already signed-out → no-op', () => {
      setSessionState({ status: 'signed-out' })
      seedKnownSession(sessionU('tok-seed', 'A'))
      expect(hasKnownSession()).toBe(false)
      expect(getSessionState()).toEqual({ status: 'signed-out' })
    })

    it('generation fence: seed contributes 0; a following authoritative write still advances by exactly 1', () => {
      const gen = currentGeneration()
      seedKnownSession(sessionU('tok-seed', 'A'))
      expect(currentGeneration()).toBe(gen)
      setSessionState({ status: 'signed-in', session: sessionU('tok-seed', 'A') })
      expect(currentGeneration()).toBe(gen + 1)
    })
  })

  it('notifies subscribers per transition and honors unsubscribe', () => {
    const seen: string[] = []
    const unsubscribe = subscribeSessionState(() => {
      seen.push(getSessionState().status)
    })

    setSessionState({ status: 'signed-in', session: session('tok') })
    setSessionState({ status: 'signed-out' })
    expect(seen).toEqual(['signed-in', 'signed-out'])

    unsubscribe()
    setSessionState({ status: 'recovering' })
    expect(seen).toEqual(['signed-in', 'signed-out'])
  })
})
