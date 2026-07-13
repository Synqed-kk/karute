// Boot session gate — the LOUD-failure requirement (PLAN §4, packet-01 point 2).
//
// The auth spike proved that an offline boot with an expired token makes
// supabase-js's getSession() HANG in a silent retry loop — no event, no
// resolution. So first paint must NEVER `await getSession()` unbounded. This
// gate races recovery against a short timeout and falls through to a VISIBLE
// `recovering` state the scaffold renders (never a blank splash / zombie).
//
// Three explicit states the app can render: signed-in | signed-out | recovering.

export type BootState<S> =
  | { status: 'signed-in'; session: S }
  | { status: 'signed-out' }
  | { status: 'recovering' }

/**
 * Race session recovery against `timeoutMs`.
 *
 *  - recover() resolves a session  → signed-in
 *  - recover() resolves null       → signed-out
 *  - timeout wins first            → recovering (returned immediately; recovery
 *                                    KEEPS running in the background)
 *  - recover() rejects (transient) → NOT flipped to signed-out — a network error
 *                                    must never look like a real logout; stays
 *                                    recovering. Only an explicit null is a
 *                                    logout.
 *
 * When recovery settles AFTER a timeout fall-through, `onSettled` fires with the
 * eventual signed-in/out so the scaffold can update the UI. It never fires for a
 * hang (getSession that never resolves) or a transient reject.
 */
export function bootSessionGate<S>(
  recover: () => Promise<S | null>,
  timeoutMs: number,
  onSettled?: (state: BootState<S>) => void,
): Promise<BootState<S>> {
  return new Promise<BootState<S>>((resolve) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ status: 'recovering' })
      // recovery promise is intentionally left running below; onSettled reports
      // its eventual result to the already-painted UI.
    }, timeoutMs)

    recover().then(
      (session) => {
        const state: BootState<S> = session
          ? { status: 'signed-in', session }
          : { status: 'signed-out' }
        if (settled) {
          onSettled?.(state)
          return
        }
        settled = true
        clearTimeout(timer)
        resolve(state)
      },
      () => {
        // Transient failure (offline / GoTrue unreachable). Do NOT resolve
        // signed-out. If we already fell through to recovering, stay there — the
        // scaffold shows a reconnecting banner; a later cold retry recovers.
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve({ status: 'recovering' })
        }
      },
    )
  })
}
