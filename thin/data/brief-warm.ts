// Pre-session-brief cache warmer (perf packet 28). The 録音 screen's
// per-customer brief generates live (gpt-4o) on first view — a multi-second
// skeleton. The facade already caches it 24h keyed on records + the booking
// memo (src/lib/karute/ai-brief.ts, getCachedAI('presession_brief')); this
// module fires the SAME read RecordScreen.tsx makes (locale + appointmentId
// included — otherwise it warms a cache key the real read never hits) early,
// while staff are still on 予約, so the cache is already warm by the time
// 録音 opens. Fire-and-forget: nothing renders from this, and a failed warm
// just means the normal on-open generation happens as it does today.
//
// Staggered (per batch: first at 3s, then one every 4s within that same
// batch) rather than immediate so the warm traffic never competes with the
// appointments screen's own fetch for bandwidth on first paint.

import { getDataPort } from '@/lib/ports/data-port'
import { getSessionState, subscribeSessionState } from '@/lib/auth/mobile/session-store'

const FIRST_DELAY_MS = 3_000
const STAGGER_MS = 4_000
// Give up after this many failed attempts per booking — the real page-open
// takes it from there instead of retrying forever.
const MAX_ATTEMPTS = 2

export type BriefWarmTarget = { customerId: string; appointmentId: string }

// Module-level, deliberately outlives every screen mount (mirrors
// thin/chrome/chrome-store.ts's singleton idiom) — the warm keeps running in
// the background after staff navigate off 予約. Keyed by appointmentId (not
// customerId): a customer can have two bookings today with different memos,
// each caching under its own key.
let warmed = new Set<string>()
let attempts = new Map<string, number>()
let pendingTimers: number[] = []
// Bumped on every sign-out reset (same idiom as chrome-store.ts's epoch): a
// fetch that was in flight when the user signed out must not write into the
// REPLACEMENT session's freshly-populated warmed/attempts — deleting a
// same-named appointmentId there would force a redundant paid re-warm while
// the new session's own timer for it is still pending.
let epoch = 0

/** Fire-and-forget: warm the pre-session-brief cache for today's active
 *  bookings. Bookings already warmed (or already scheduled) are skipped, so
 *  calling this again on every DTO settle is free. */
export function warmBriefsForToday(bookings: BriefWarmTarget[]): void {
  for (const { customerId, appointmentId } of bookings) {
    if (warmed.has(appointmentId)) continue
    warmed.add(appointmentId)
    const delay = FIRST_DELAY_MS + pendingTimers.length * STAGGER_MS
    const timer = window.setTimeout(() => {
      pendingTimers = pendingTimers.filter((t) => t !== timer)
      // Captured at FIRE time (not schedule time) — mirrors chrome-store.ts's
      // capture-before-async pattern, right here since the async leg starts now.
      const myEpoch = epoch
      // Safe unguarded: this write happens synchronously, before the fetch
      // (the async boundary) starts — no sign-out can land between "timer
      // fires" and "this line runs", so it can never straddle an epoch bump
      // the way the release() paths below (post-await) can.
      const attempt = (attempts.get(appointmentId) ?? 0) + 1
      attempts.set(appointmentId, attempt)
      const release = () => {
        if (epoch !== myEpoch) return // superseded by a sign-out reset
        // Below the ceiling: remove so a later trigger (or the staff member
        // actually opening the page) can retry. At the ceiling: leave it
        // warmed — stop trying, the real page-open takes over.
        if (attempt < MAX_ATTEMPTS) warmed.delete(appointmentId)
      }
      void getDataPort()
        .apiFetch(
          `/api/app/v1/customers/${encodeURIComponent(customerId)}/ai/pre-session-brief?locale=ja&appointmentId=${encodeURIComponent(appointmentId)}`,
        )
        // Non-OK (500/503, an auth-blip 401) means no brief actually got
        // generated. Body deliberately unread either way.
        .then((res) => {
          if (!res.ok) release()
        })
        .catch(release)
    }, delay)
    pendingTimers.push(timer)
  }
}

// Shared-device hygiene (mirrors chrome-store.ts / ScreenBoundary's dtoCache
// wipe on sign-out): different staff on the same iPad warm different scopes,
// and without a reset the Set would grow for the whole page lifetime.
subscribeSessionState(() => {
  if (getSessionState().status === 'signed-out') {
    epoch++ // invalidate any in-flight release (see the epoch note above)
    pendingTimers.forEach((t) => window.clearTimeout(t))
    pendingTimers = []
    warmed = new Set()
    attempts = new Map()
  }
})
