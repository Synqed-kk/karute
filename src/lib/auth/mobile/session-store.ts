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

// Monotonic authoritative-write counter (packet 14 P1-b generation fence).
// Every authoritative transition — boot result, explicit login, sign-out flip —
// opens a new generation via setSessionState. The background-resume coordinator
// snapshots the generation at resume start and drops its re-enable if a
// sign-out/sign-in intervened during recovery, instead of clobbering the store
// back to the outgoing user (the shared-iPad cross-user leak / resurrection).
// The onAuthStateChange rotation mirror does NOT use this fence — a token
// rotation is guarded SEMANTICALLY, by current-user identity (applyTokenRotation
// below), immune to authoritative-write churn (packet 15 P1).
let generation = 0

export function getSessionState(): SessionState {
  return current
}

/** The current authoritative-write generation. Background writers snapshot this
 *  while their session is still current and pass it to setSessionStateIfCurrent. */
export function currentGeneration(): number {
  return generation
}

function apply(state: SessionState): void {
  current = state
  if (state.status === 'signed-in') lastSession = state.session
  else if (state.status === 'signed-out') lastSession = null
  listeners.forEach((l) => l())
}

/** Authoritative session transition (boot result, explicit login, sign-out
 *  flip). Opens a NEW generation, so any in-flight speculative write tagged with
 *  an older generation is fenced out by setSessionStateIfCurrent. */
export function setSessionState(state: SessionState): void {
  generation++
  apply(state)
}

/** Speculative session write from a background source that snapshotted `gen`
 *  while its session was still current (autorefresh TOKEN_REFRESHED,
 *  background-resume). Dropped if a newer generation has opened since — a stale
 *  refresh, or a resume that raced a sign-out/sign-in, must not resurrect the
 *  outgoing session (packet 14 P1-b). Does NOT open a new generation: a token
 *  rotation is within the same epoch. */
export function setSessionStateIfCurrent(state: SessionState, gen: number): void {
  if (gen !== generation) return
  apply(state)
}

/** Mirror a within-epoch token rotation (onAuthStateChange TOKEN_REFRESHED /
 *  USER_UPDATED) IFF the store still holds the SAME user's session — signed-in,
 *  or 'recovering' with a matching last-known uid (getCurrentSession is
 *  live-or-last-known, null once signed out). A signed-out store or a uid
 *  mismatch DROPS the write, so a stale in-flight refresh can neither resurrect
 *  a signed-out session nor cross-apply one user's token under another on a
 *  shared device (packet 15 P1). Encodes that invariant by IDENTITY, so it is
 *  immune to the authoritative-write generation churn that the old epoch-fence
 *  desynced against. Does NOT open a new generation — a rotation stays within
 *  the current epoch. */
export function applyTokenRotation(session: Session): void {
  const currentUid = getCurrentSession()?.user?.id
  if (currentUid !== undefined && currentUid === session.user?.id) {
    apply({ status: 'signed-in', session })
  }
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
 *  in. Synchronous on purpose — kept fresh by the onAuthStateChange rotation
 *  mirror (applyTokenRotation applies a same-user TOKEN_REFRESHED in place).
 *  During 'recovering' the LAST-KNOWN token is
 *  served: dropping it would strip auth off in-flight work on every offline
 *  resume; if it is truly stale the facade 401s and screens degrade
 *  per-request with retry, which recovery then heals. */
export function getAccessToken(): string | null {
  if (current.status === 'signed-in') return current.session.access_token
  if (current.status === 'recovering') return lastSession?.access_token ?? null
  return null
}
