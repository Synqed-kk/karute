// Pre-session-brief cache warmer (perf packet 28). The 録音 screen's
// per-customer brief generates live (gpt-4o) on first view — a multi-second
// skeleton. The facade already caches it 24h keyed on records
// (src/lib/karute/ai-brief.ts, getCachedAI('presession_brief')); this module
// just fires that SAME read early, while staff are still on 予約, so the
// cache is already warm by the time 録音 opens. Fire-and-forget: nothing
// renders from this, and a failed warm just means the normal on-open
// generation happens as it does today.
//
// Staggered rather than immediate so the warm traffic never competes with
// the appointments screen's own fetch for bandwidth on first paint.

import { getDataPort } from '@/lib/ports/data-port'
import { getSessionState, subscribeSessionState } from '@/lib/auth/mobile/session-store'

const FIRST_DELAY_MS = 3_000
const STAGGER_MS = 4_000

// Module-level, deliberately outlives every screen mount (mirrors
// thin/chrome/chrome-store.ts's singleton idiom) — the warm keeps running in
// the background after staff navigate off 予約.
let warmed = new Set<string>()
let pendingTimers: number[] = []

/** Fire-and-forget: warm the pre-session-brief cache for today's active
 *  bookings. Ids already warmed (or already scheduled) are skipped, so
 *  calling this again on every DTO settle is free. */
export function warmBriefsForToday(customerIds: string[]): void {
  for (const id of customerIds) {
    if (warmed.has(id)) continue
    warmed.add(id)
    const delay = FIRST_DELAY_MS + pendingTimers.length * STAGGER_MS
    const timer = window.setTimeout(() => {
      pendingTimers = pendingTimers.filter((t) => t !== timer)
      void getDataPort()
        .apiFetch(`/api/app/v1/customers/${id}/ai/pre-session-brief`)
        .then((res) => {
          // Non-OK (500/503, an auth-blip 401) means no brief actually got
          // generated — remove so a later trigger (or the staff member
          // actually opening the page) can retry. Body deliberately unread.
          if (!res.ok) warmed.delete(id)
        })
        .catch(() => {
          // Network failure — same retry contract as a non-OK response.
          warmed.delete(id)
        })
    }, delay)
    pendingTimers.push(timer)
  }
}

// Shared-device hygiene (mirrors chrome-store.ts / ScreenBoundary's dtoCache
// wipe on sign-out): different staff on the same iPad warm different scopes,
// and without a reset the Set would grow for the whole page lifetime.
subscribeSessionState(() => {
  if (getSessionState().status === 'signed-out') {
    pendingTimers.forEach((t) => window.clearTimeout(t))
    pendingTimers = []
    warmed = new Set()
  }
})
