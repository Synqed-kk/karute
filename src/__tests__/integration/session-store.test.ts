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
  setSessionState,
  setSessionStateIfCurrent,
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

  it('generation fence: a stale speculative write is dropped, a fresh one is accepted (packet 14 P1-b)', () => {
    // Epoch A signs in, then signs out, then B signs in — each authoritative
    // write opens a new generation.
    setSessionState({ status: 'signed-in', session: session('tok-A') })
    const genA = currentGeneration()
    setSessionState({ status: 'signed-out' }) // A signs out (generation bumps)
    setSessionState({ status: 'signed-in', session: session('tok-B') }) // B signs in (bumps)

    // A stale autorefresh/resume write tagged with A's OLD generation must NOT
    // clobber the store back to A (the shared-iPad cross-user leak).
    setSessionStateIfCurrent({ status: 'signed-in', session: session('tok-A') }, genA)
    expect(getAccessToken()).toBe('tok-B')

    // A within-epoch write for the CURRENT generation (B's own token rotation)
    // is still accepted.
    setSessionStateIfCurrent(
      { status: 'signed-in', session: session('tok-B2') },
      currentGeneration(),
    )
    expect(getAccessToken()).toBe('tok-B2')
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
