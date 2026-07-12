// Background-resume single-flight (PLAN §11 R3 #16, packet-01 point 3).
//
// The auth spike only COLD-launched with a pre-expired token — it never resumed
// an already-mounted WKWebView after a long background. On App.appStateChange →
// isActive the shell must recover the session ONCE, before re-enabling
// identity/store/query/mutations. Multiple rapid foreground events (or a resume
// racing a user action) must NOT fan out N concurrent refreshes.

import { bootSessionGate, type BootState } from './boot-gate'

/** Coalesce concurrent calls into a single in-flight promise. */
export function createSingleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null
  return () => {
    if (inflight) return inflight
    inflight = fn().finally(() => {
      inflight = null
    })
    return inflight
  }
}

export interface ResumeCoordinator {
  /** Bind to App.appStateChange→isActive. Safe to call concurrently. */
  onAppActive(): Promise<void>
}

/**
 * On foreground: quiesce the data planes, run ONE BOUNDED session recovery, then
 * re-enable — in that order. `onQuiesce` runs once per resume BEFORE recovery.
 *
 * Recovery is single-flighted (five foregrounds in a row → one recovery) AND
 * bounded by the SAME gate boot uses. This matters: the spike proved that an
 * offline resume with an expired token makes getSession() HANG (it does not
 * reject), so an unbounded `await` here would leave the app quiesced forever
 * with no signal — the exact silent-breakage this slice must prevent. On timeout
 * the gate emits a visible `recovering` state; the single-flighted recovery
 * keeps running and reports its eventual signed-in/out via the SAME `onResumed`
 * (so the UI progresses recovering → signed-in/out). A transient reject also
 * yields `recovering`, never a false signed-out.
 */
export function createResumeCoordinator<S>(args: {
  recover: () => Promise<S | null>
  onQuiesce?: () => void
  onResumed: (state: BootState<S>) => void
  /** Bound before falling through to `recovering`. Default 4000ms (matches boot). */
  timeoutMs?: number
}): ResumeCoordinator {
  const recoverOnce = createSingleFlight(args.recover)
  const timeoutMs = args.timeoutMs ?? 4000

  return {
    async onAppActive() {
      args.onQuiesce?.()
      // onResumed is the single sink: bootSessionGate reports a post-timeout
      // eventual through it, and we emit the immediate/returned state through it
      // too — never both for the same settle.
      const state = await bootSessionGate<S>(recoverOnce, timeoutMs, args.onResumed)
      args.onResumed(state)
    },
  }
}
