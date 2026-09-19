// Auth gate for the thin shell (packet-01 boot gate, the renderable half).
// Three explicit states from the session-store, exactly the boot-gate
// contract: signed-in → the app; signed-out → login; recovering → depends on
// history. First paint is never blocked: 'recovering' renders immediately and
// the gate re-renders when boot/recovery settles.
//
// 'recovering' WITH a known session keeps the app MOUNTED: an offline resume
// times out into 'recovering' (and the spike proved getSession can hang there
// indefinitely) — replacing a signed-in user's work with a spinner would turn
// a network blip into a full-app lockout mid-shift. The DataPort keeps serving
// the last-known Bearer through the spell; only a cold boot (no session yet)
// shows the full-screen loading state.

import type { ReactNode } from 'react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  getSessionState,
  hasKnownSession,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
import { releaseSplashOnFirstPaint } from '@/lib/app-root/splash'
import { getDataPort } from '@/lib/ports/data-port'
import { DiscreetRecordingIndicator } from '@/components/recording/DiscreetRecordingIndicator'
import { ProcessingIndicator } from '@/components/recording/ProcessingIndicator'
import { UnassignedStoreScreen } from '@/components/layout/UnassignedStoreScreen'
import {
  recheckStoreUnassigned,
  subscribeStoreUnassigned,
  unassignedUserId,
} from './chrome/store-unassigned'
import { LoginScreen } from './screens/LoginScreen'
import { ScreenLoading } from './screens/ScreenBoundary'
import { mark, MARKS } from './probe/marks'

// G-1 fold (Greptile, 2026-09-16) — one light facade call proves the server no
// longer refuses this user. `/screens/chrome` is fine for this: cheap, and
// already fetched on every signed-in session, so it never adds a new endpoint
// to the shell's surface.
async function probeStoreAssignment(): Promise<boolean> {
  const res = await getDataPort().apiFetch('/api/app/v1/screens/chrome')
  return res.ok
}

// Automatic foreground recheck: a manager can assign the store while the app
// is backgrounded, and re-opening it is the moment to find out — throttled so
// a flurry of tab-switches doesn't hammer the facade.
const RECHECK_THROTTLE_MS = 10_000

export function AuthGate({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeSessionState, getSessionState)
  // ⚖ Liam 2026-09-16 — the phone's twin of the web's (app)/layout gate. The
  // facade refuses every endpoint for a staff member with no store assigned;
  // the first such refusal is recorded by the one fetch funnel, and this is
  // where it becomes the honest screen rather than a generic error on whatever
  // tab happened to load. Same component as the web, so the copy is identical
  // by construction and cannot drift.
  //
  // Keyed by user id: a salon iPad is shared, and the next person to sign in
  // must not inherit the last person's empty screen.
  const unassignedUser = useSyncExternalStore(subscribeStoreUnassigned, unassignedUserId)
  // Cold boot only: 'recovering' before ANY session has been seen this
  // page-load. An offline resume (recovering WITH a known session) is not
  // booting — the app stays mounted, per the header contract.
  const booting = state.status === 'recovering' && !hasKnownSession()

  // Native-splash release lives HERE, not in the entry: the entry released on
  // the very first painted frame, which on every cold boot is this gate's
  // full-screen loading state — a visible 読み込み中 flash between splash and
  // content. Hold the splash until the first COMMIT of a resolved state
  // (login, the app, or an offline resume) instead. CookieVC's native +8s
  // failsafe still backstops a boot that never settles, and the entry's
  // firstPixel mark keeps measuring the real first paint (under the splash) —
  // splashReleased marks the user-visible reveal.
  // Single-fire guard: a splash exists once per launch, so the release (and
  // its reveal mark) must fire exactly once — including under StrictMode's
  // dev-only double effect invocation (the ref survives the simulated
  // remount) and any later booting flips.
  const released = useRef(false)
  useEffect(() => {
    if (booting || released.current) return
    released.current = true
    mark(MARKS.splashReleased)
    releaseSplashOnFirstPaint()
  }, [booting])

  // After the session is settled, so a signed-out shell still gets the login
  // screen rather than an empty state it cannot act on.
  const isUnassignedForCurrentUser =
    !!unassignedUser && state.status === 'signed-in' && unassignedUser === state.session.user.id

  // G-1 fold (Greptile, 2026-09-16) — the automatic half of the recheck: while
  // the honest screen is showing, re-probe whenever the app comes back to the
  // foreground (a manager assigns the store, staffer switches back to the
  // app). Throttled so rapid tab-switching can't hammer the facade, and only
  // attached while there is anything to recheck.
  useEffect(() => {
    if (!isUnassignedForCurrentUser) return
    let lastRecheck = 0
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastRecheck < RECHECK_THROTTLE_MS) return
      lastRecheck = now
      void recheckStoreUnassigned(unassignedUser, probeStoreAssignment)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [isUnassignedForCurrentUser, unassignedUser])

  if (state.status === 'signed-out') return <LoginScreen />
  if (booting) return <ScreenLoading />
  if (isUnassignedForCurrentUser) {
    return (
      <UnassignedStoreScreen
        onRecheck={() => recheckStoreUnassigned(unassignedUser, probeStoreAssignment)}
      />
    )
  }
  // The web mounts these at the authed (app) layout root; this gate is the
  // thin tree's equivalent (packet-09 F-8). ProcessingIndicator is not just
  // the progress chip — its effect EXECUTES the background auto-save, so
  // without this mount a booked-customer take with an outcome hangs in
  // 'autosaving' forever. Both float (position:fixed) over every route and
  // stay mounted through an offline-resume spell, exactly like the web.
  return (
    <>
      {children}
      <DiscreetRecordingIndicator />
      <ProcessingIndicator />
    </>
  )
}
