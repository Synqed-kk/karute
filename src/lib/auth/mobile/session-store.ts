// Session-state store for the mobile bundle — the ONE place the current
// BootState (and therefore the current Bearer) lives (packet-01 integration).
//
// Pure module singleton, no supabase-js import beyond types: the thin binding
// (thin/auth/session.ts) writes it from the boot gate / resume coordinator /
// onAuthStateChange, and two kinds of readers consume it:
//   - React (AuthGate) via subscribe + getSnapshot (useSyncExternalStore),
//   - the DataPort via the SYNC getAccessToken() — a facade fetch must never
//     await getSession() on the hot path (the boot gate exists because that
//     call can hang offline; see boot-gate.ts).
//
// Pre-boot default is 'recovering': a renderable neutral state, never a flash
// of the login screen before the persisted session has been read.

import type { Session } from '@supabase/supabase-js'
import type { BootState } from './boot-gate'

export type SessionState = BootState<Session>

type Listener = () => void

let current: SessionState = { status: 'recovering' }
const listeners = new Set<Listener>()

export function getSessionState(): SessionState {
  return current
}

export function setSessionState(state: SessionState): void {
  current = state
  listeners.forEach((l) => l())
}

/** useSyncExternalStore-compatible: returns the unsubscribe. */
export function subscribeSessionState(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Current Bearer for the DataPort, or null when not signed in. Synchronous on
 *  purpose — kept fresh by onAuthStateChange (TOKEN_REFRESHED included). */
export function getAccessToken(): string | null {
  return current.status === 'signed-in' ? current.session.access_token : null
}
