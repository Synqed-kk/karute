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
// Last session seen this page-load, surviving transitions into 'recovering'.
// The boot gate's invariant is "only an explicit null session is a logout" —
// so a timed-out/offline recovery must NOT drop the Bearer or tear the app
// down; the facade stays the validity oracle (worst case: per-screen 401 +
// retry until recovery settles). Cleared only on signed-out.
let lastSession: Session | null = null
const listeners = new Set<Listener>()

export function getSessionState(): SessionState {
  return current
}

export function setSessionState(state: SessionState): void {
  current = state
  if (state.status === 'signed-in') lastSession = state.session
  else if (state.status === 'signed-out') lastSession = null
  listeners.forEach((l) => l())
}

/** A session has been seen this page-load and not explicitly signed out.
 *  The AuthGate uses this to keep the app MOUNTED through a 'recovering'
 *  spell (offline resume) instead of replacing signed-in work with a
 *  full-screen loading state. */
export function hasKnownSession(): boolean {
  return lastSession !== null
}

/** The session itself, under the same rules as getAccessToken(): live when
 *  signed-in, last-known through 'recovering', null when signed out. The
 *  supabase-client drop-in serves draft/take owner gates from THIS — a sync
 *  read that can never inherit GoTrueClient's offline refresh hang. */
export function getCurrentSession(): Session | null {
  if (current.status === 'signed-in') return current.session
  if (current.status === 'recovering') return lastSession
  return null
}

/** useSyncExternalStore-compatible: returns the unsubscribe. */
export function subscribeSessionState(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Current Bearer for the DataPort, or null when signed out / never signed
 *  in. Synchronous on purpose — kept fresh by onAuthStateChange
 *  (TOKEN_REFRESHED included). During 'recovering' the LAST-KNOWN token is
 *  served: dropping it would strip auth off in-flight work on every offline
 *  resume; if it is truly stale the facade 401s and screens degrade
 *  per-request with retry, which recovery then heals. */
export function getAccessToken(): string | null {
  if (current.status === 'signed-in') return current.session.access_token
  if (current.status === 'recovering') return lastSession?.access_token ?? null
  return null
}
