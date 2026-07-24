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

import { getSessionState, subscribeSessionState } from '@/lib/auth/mobile/session-store'
import { briefUrl, cacheHas, fetchBrief, fetchedAtByUrl, revalidateBrief } from './brief-cache'

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
// A booking gets a `warmed` entry synchronously (at schedule time) but the
// brief-cache entry only exists once its TIMER FIRES (3s+ later) — in that
// window `warmed.has` is true and `cacheHas` is still false, so the
// warmed-but-uncached skip alone can't tell "already scheduled" from
// "worth another shot" and would schedule a SECOND timer for the same
// appointmentId. `scheduled` closes that window: added when a timer is set,
// deleted the instant it fires (before the async fetch leg starts).
let scheduled = new Set<string>()
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
    // Skip only when we're confident a re-warm is pointless: the client
    // cache holds the brief (cacheHas), OR the 2-attempt ceiling is spent.
    // Retry admission rides `warmed`, not cacheHas: since the null-negative-
    // cache fix a FAILED warm's entry stays cached (failure-marked), but
    // release() below deletes the id from `warmed` on failure under the
    // ceiling — so the next trigger still gets through this gate and the
    // timer body re-checks via revalidateBrief. An entry evicted by the
    // FIFO cap (cacheHas false with `warmed` still set) also re-warms here.
    if (scheduled.has(appointmentId)) continue // a timer is already pending for it
    const ceilingReached = (attempts.get(appointmentId) ?? 0) >= MAX_ATTEMPTS
    if (
      warmed.has(appointmentId) &&
      (cacheHas(briefUrl(customerId, appointmentId, 'ja')) || ceilingReached)
    )
      continue
    scheduled.add(appointmentId)
    warmed.add(appointmentId)
    const delay = FIRST_DELAY_MS + pendingTimers.length * STAGGER_MS
    const timer = window.setTimeout(() => {
      scheduled.delete(appointmentId)
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
      // Routes through the SAME client cache the screen reads (perf packet
      // 33) — the warm populates it so the first 録音 open paints the AI
      // card instantly. Since the null-negative-cache fix (Liam field bug
      // 7/25 #2), a FAILED settle stays in the cache (failure-marked,
      // fetchedAt=0) instead of being deleted — so a warm RETRY must route
      // through revalidateBrief (which replaces the stale entry in place),
      // not fetchBrief (which would just return the cached failure).
      // Success for release-purposes = the url ends up cached with a FRESH
      // stamp — true for real content AND for the server's honest
      // 200 {brief:null} (no point re-burning attempts on a customer the
      // server says has no brief; the old contract wastefully retried those).
      const url = briefUrl(customerId, appointmentId, 'ja')
      void (cacheHas(url) ? revalidateBrief(url) : fetchBrief(url)).then(() => {
        const succeeded = cacheHas(url) && (fetchedAtByUrl.get(url) ?? 0) > 0
        if (!succeeded) release()
      })
    }, delay)
    pendingTimers.push(timer)
  }
}

/** Exported for the packet's state-corruption tests — same rationale
 *  ScreenBoundary's dtoCache/fetchedAtByPath exports give: an apiFetch
 *  call-count spy can't tell a correctly-guarded release() from a
 *  silently-corrupted one when brief-cache's own url-keyed dedupe happens to
 *  absorb the difference. A FUNCTION, not direct re-exports — warmed/
 *  attempts/scheduled are REBOUND (new Set/Map) on every sign-out reset, so
 *  a captured reference would go stale the moment that reset fires. */
export function warmStateForTests(): {
  warmed: ReadonlySet<string>
  attempts: ReadonlyMap<string, number>
  scheduled: ReadonlySet<string>
} {
  return { warmed, attempts, scheduled }
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
    scheduled = new Set()
  }
})
