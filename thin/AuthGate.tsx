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
import { DiscreetRecordingIndicator } from '@/components/recording/DiscreetRecordingIndicator'
import { ProcessingIndicator } from '@/components/recording/ProcessingIndicator'
import { LoginScreen } from './screens/LoginScreen'
import { ScreenLoading } from './screens/ScreenBoundary'
import { mark, MARKS } from './probe/marks'

export function AuthGate({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeSessionState, getSessionState)
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

  if (state.status === 'signed-out') return <LoginScreen />
  if (booting) return <ScreenLoading />
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
