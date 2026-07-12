// Background-resume single-flight (PLAN §11 R3 #16, packet-01 point 3).
//
// The auth spike only COLD-launched with a pre-expired token — it never resumed
// an already-mounted WKWebView after a long background. On App.appStateChange →
// isActive the shell must recover the session ONCE, before re-enabling
// identity/store/query/mutations. Multiple rapid foreground events (or a resume
// racing a user action) must NOT fan out N concurrent refreshes.

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
 * On foreground: quiesce the data planes, single-flight ONE session recovery,
 * then re-enable — in that order. `onQuiesce` runs once per resume BEFORE
 * recovery; `onResumed` runs AFTER recovery settles with the outcome. Because
 * recovery is single-flighted, five foreground events in a row trigger exactly
 * one recovery.
 */
export function createResumeCoordinator<S>(args: {
  recover: () => Promise<S | null>
  onQuiesce?: () => void
  onResumed: (state: { status: 'signed-in'; session: S } | { status: 'signed-out' }) => void
  onError?: (err: unknown) => void
}): ResumeCoordinator {
  const recoverOnce = createSingleFlight(args.recover)

  return {
    async onAppActive() {
      args.onQuiesce?.()
      try {
        const session = await recoverOnce()
        args.onResumed(
          session ? { status: 'signed-in', session } : { status: 'signed-out' },
        )
      } catch (err) {
        // Transient (offline) — leave the planes quiesced; do NOT force a
        // signed-out. The next foreground / cold launch recovers.
        args.onError?.(err)
      }
    },
  }
}
