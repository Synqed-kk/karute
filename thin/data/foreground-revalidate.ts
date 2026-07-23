// Foreground revalidate (perf packet 29, Liam design directive 7/23). The
// dominant real pattern is app-stays-alive: staff foreground the app dozens
// of times per shift, and until this the MOUNTED screen never refetched on
// foreground — only remounts (tab switches) and mutations (emitRefresh) did.
// So the visible page showed stale bookings after every pocket/app-switch
// gap. This binds document visibilitychange to a quiet re-fetch of the
// mounted screen — swap-not-flash, WITHOUT clearing the dtoCache, behind
// ScreenBoundary's per-path STALE_MS threshold so rapid app-hopping costs
// nothing.
//
// Brief-warm re-fire: ZERO code needed here. AppointmentsScreen's warm effect
// is keyed on [dto] — a revalidate settle produces a new dto → effect
// re-runs → warmBriefsForToday re-fires → brief-warm's own Set dedupes.
//
// Known race, accepted: session.ts's onActive (auth-js) also fires on this
// same visibilitychange event — a revalidate fetch can race a token rotation
// and 401 (kept dto, ScreenBoundary's existing grace/keep-dto branches); if
// the token rotated, armSettleRefresh's emitRefresh clears + refetches
// everything anyway. Existing machinery; one visible result.

// Static import of global-recorder is fine today (single bundle, no lazy
// routes yet) — a future PR-D (lazy routes) must account for this
// entry-chain import.
import { globalRecorder } from '@/lib/global-recorder'
import { ensureChromeLoaded } from '../chrome/chrome-store'
import { emitRevalidate } from '../ports/nav.vite'

export function bindForegroundRevalidate(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    // Liam pin: NEVER disturb an active recording. Any non-idle take
    // ('recording' | 'paused' | 'recorded'-unsaved) skips the WHOLE
    // foreground path — simplest provable contract; the next foreground
    // after the take resolves revalidates (stamp is stale by then).
    if (globalRecorder.state !== 'idle') return
    // Wave-1.5 P2 fold-in: a chrome fetch failure left nav/bell/switcher
    // dead for the whole session (chrome-store re-arms only on
    // session.status CHANGE). ensureChromeLoaded self-gates (no-op on
    // loading/ready) — this is the error/idle re-arm.
    ensureChromeLoaded()
    emitRevalidate()
  })
  // Deliberately NO session-status gate on the emitter above: signed-out
  // means no screens are mounted (AuthGate), so the emit hits zero
  // subscribers; a recovering-window refetch that 401s lands in
  // ScreenBoundary's existing grace/keep-dto branches and the auth
  // coordinator's own foreground refresh (session.ts onActive) heals it.
}
