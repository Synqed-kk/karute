// Background screen-DTO prefetch on app open (perf packet 34, PR-H). #589's
// dtoCache (ScreenBoundary.tsx) only speeds up REVISITS — the first tap of
// any tab this session always pays a full facade RTT and shows 読み込み中.
// While staff look at the first screen after sign-in, this silently
// pre-loads the OTHER screens' DTOs in the background (mirrors brief-warm.ts's
// singleton/stagger/one-shot idioms and ScreenBoundary's generation fence),
// so every first tap this session paints instantly instead of shimmering.
//
// Recording safety: the ONLY false→true transitions of `armed` below are
// the first signed-in settle after boot and the first signed-in settle
// after a sign-out→login — neither can coincide with an active recording
// (the recorder only starts from a mounted RecordScreen, and sign-out tears
// any take down), so there is no runtime coupling to check.
//
// brief-warm stays the appointments screen's job: the appointments prefetch
// below deliberately does NOT call warmBriefsForToday on its DTO settle —
// prefetching N brief warms from a background DTO would double the AI-warm
// fan-out Liam already approved as-is.

import { getDataPort } from '@/lib/ports/data-port'
import { RecordScreenDTO } from '@/lib/app-api/record-screen-dto'
import { AppointmentsScreenDTO } from '@/lib/app-api/appointments-screen-dto'
import { CustomersScreenDTO } from '@/lib/app-api/customers-screen-dto'
import { SessionsScreenDTO } from '@/lib/app-api/sessions-screen-dto'
import { DashboardScreenDTO } from '@/lib/app-api/dashboard-screen-dto'
import {
  currentGeneration,
  getSessionState,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
import { subscribeRefresh } from '../ports/nav.vite'
import { cacheDto, dtoCache } from '../screens/ScreenBoundary'

const FIRST_DELAY_MS = 1_000
const STAGGER_MS = 1_500

type Target = { path: string; parse: (raw: unknown) => unknown }

// Feel-impact order (packet table) — the mounted screen's own mount-effect
// fetch always wins first paint (ScreenBoundary fetches on mount regardless
// of cache state), so this order only decides which OTHER screen warms
// soonest. Paths are byte-pinned in tests against each screen's own literal.
const TARGETS: Target[] = [
  {
    path: '/api/app/v1/screens/record?locale=ja',
    parse: (raw) => RecordScreenDTO.parse(raw),
  },
  {
    path: '/api/app/v1/screens/appointments?locale=ja',
    parse: (raw) => AppointmentsScreenDTO.parse(raw),
  },
  {
    path: '/api/app/v1/screens/customers',
    parse: (raw) => CustomersScreenDTO.parse(raw),
  },
  {
    path: '/api/app/v1/screens/sessions',
    parse: (raw) => SessionsScreenDTO.parse(raw),
  },
  {
    path: '/api/app/v1/screens/dashboard',
    parse: (raw) => DashboardScreenDTO.parse(raw),
  },
]

// Exported for the packet's byte-pin tests — same rationale ScreenBoundary's
// dtoCache export gives: pin each cache-key path directly against the
// literal the owning screen builds, so a drift is a red test, not a silent
// zero-benefit prefetch.
export const PREFETCH_PATHS: readonly string[] = TARGETS.map((t) => t.path)

// Accepted (fleet round, not fixed): the 5 prefetched entries land as the
// session's OLDEST dtoCache keys, so they're first in line for eviction at
// ScreenBoundary's 50-entry FIFO cap if that ever gets approached —
// pre-existing cap posture, not a new risk this module adds.

// One-shot per CONTIGUOUS signed-in period — NOT keyed to the generation
// (fleet-round P1 fix): session-store's setSessionState bumps the
// generation on EVERY authoritative transition, including a routine
// app-resume settle and a cold-boot double-settle echo (boot recover +
// GoTrue INITIAL_SESSION both landing on the same user) — a generation-keyed
// one-shot re-armed the WHOLE batch on either of those, up to several times
// per boot, and could do so while a recording is active (falsifying the
// recording-safety note above). `armed` tracks only "has this signed-in
// period already scheduled its batch" — a resume/echo notify (still
// signed-in, armed already true) is a no-op by construction; only a
// signed-out clears it, so the next genuine sign-in re-arms exactly once.
let armed = false
let pendingTimers: number[] = []

// Wipe fence (Greptile #604 P1, same class as brief-cache's F3 fences): a
// post-mutation emitRefresh clears dtoCache but does NOT advance the auth
// generation, so the generation fence alone lets a prefetch that STARTED
// pre-mutation settle after the wipe and re-populate the cleared entry with
// pre-mutation data — the next mount would paint stale content until its own
// revalidate swaps. Bump an epoch on every refresh wipe; a settle whose
// captured epoch is stale discards. Timers not yet fired are unaffected —
// they fetch AFTER the wipe, so their data is post-mutation fresh.
let wipeEpoch = 0
subscribeRefresh(() => {
  wipeEpoch++
})

function schedule(): void {
  let i = 0
  for (const { path, parse } of TARGETS) {
    // Skip at schedule time: already visited (or already prefetched — armed
    // guarantees schedule() itself only ever runs once per signed-in period).
    if (dtoCache.has(path)) continue
    const delay = FIRST_DELAY_MS + i * STAGGER_MS
    i++
    const timer = window.setTimeout(() => {
      pendingTimers = pendingTimers.filter((t) => t !== timer)
      // Skip at fire time too: a user who navigated there mid-stagger
      // already has a fresher fetch in the cache — never clobber it.
      if (dtoCache.has(path)) return
      // Captured at fetch START, mirroring ScreenBoundary/brief-cache's
      // straggler fence — a sign-out mid-flight must not let this settle
      // write into the replacement session's cache (generation), and a
      // post-mutation cache wipe mid-flight must not be re-populated with
      // pre-mutation data (wipeEpoch — see the fence note above).
      const myGen = currentGeneration()
      const myEpoch = wipeEpoch
      getDataPort()
        .apiFetch(path)
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (body === null) return
          const dto = parse(body)
          if (
            currentGeneration() === myGen &&
            wipeEpoch === myEpoch &&
            !dtoCache.has(path)
          )
            cacheDto(path, dto)
        })
        // Fail-open, no retry: a non-OK response, a network rejection, a
        // JSON parse failure, and a zod schema-parse failure all land here
        // silently — the real tap's own fetch surfaces any genuine error.
        .catch(() => {})
    }, delay)
    pendingTimers.push(timer)
  }
}

// Record warm for upcoming bookings (perf packet 35, PR-H2). The batch above
// only warms a BARE 録音 tab visit (no appointmentId) — the far more common
// path, booking-tap on 予約 → 録音, requests a DIFFERENT cache key
// (appointmentId included, ground-truth-verified against every real caller:
// BookingActionSheetWrapper.tsx / TodoCard.tsx) that the batch never touches.
// This warms THAT key for the next couple of upcoming bookings while staff
// are still looking at 予約. Lives here (not its own file) for the same
// reason brief-warm.ts gives for staying separate FROM this file: it reuses
// this module's wipeEpoch/pendingTimers/generation-fence/cacheDto plumbing
// rather than duplicating it.
//
// RecordScreen.tsx builds its fetch URL as appointmentId→customerId→locale,
// each only if present — the booking-tap flow never sends customerId, so
// warming it here would populate a key the real tap never requests.
export function recordWarmPath(appointmentId: string): string {
  return `/api/app/v1/screens/record?appointmentId=${encodeURIComponent(appointmentId)}&locale=ja`
}

const RECORD_WARM_CAP = 2
// appointmentId -> timer pending. Same idiom as brief-warm.ts's `scheduled`
// set: closes the window between a timer being SET (synchronous) and its
// fetch actually landing in dtoCache (a delay later) — without it, a second
// settle inside that window would schedule a duplicate timer for the same id.
let recordWarmScheduled = new Set<string>()

/** Fire-and-forget: warm the 録音 screen's DTO for the next few upcoming
 *  bookings. The caller passes ids already sorted soonest-first — "the next
 *  N" is the caller's concept (this module has no booking-time knowledge).
 *  Deterministic by construction: this call's input is sliced to the first
 *  RECORD_WARM_CAP ids FIRST, then skips are applied to that slice — not
 *  "keep pulling ids until CAP get scheduled". Simpler, and the cost (an
 *  already-cached id in the first CAP occasionally yields a smaller-than-CAP
 *  batch) is cheap: that id needed no warm anyway. */
export function warmRecordForBookings(appointmentIds: string[]): void {
  let k = 0
  for (const id of appointmentIds.slice(0, RECORD_WARM_CAP)) {
    const path = recordWarmPath(id)
    // Skip at schedule time: already scheduled by an earlier settle this
    // signed-in period, or already cached (a real 録音 visit, or this same
    // warm on a prior settle, got there first).
    if (recordWarmScheduled.has(id) || dtoCache.has(path)) continue
    const delay = FIRST_DELAY_MS + k * STAGGER_MS
    k++
    recordWarmScheduled.add(id)
    const timer = window.setTimeout(() => {
      pendingTimers = pendingTimers.filter((t) => t !== timer)
      // Delete FIRST, before the fetch leg (brief-warm.ts's idiom): a warm
      // that fails below must let a LATER settle retry the same id, not be
      // permanently stuck believing it's still scheduled.
      recordWarmScheduled.delete(id)
      // Skip at fire time too: a real 録音 visit mid-stagger already has a
      // fresher fetch in the cache — never clobber it.
      if (dtoCache.has(path)) return
      // Same straggler fences as schedule()'s timer body above: captured at
      // fetch START so a cross-generation or post-wipe settle can't write.
      const myGen = currentGeneration()
      const myEpoch = wipeEpoch
      getDataPort()
        .apiFetch(path)
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (body === null) return
          const dto = RecordScreenDTO.parse(body)
          if (
            currentGeneration() === myGen &&
            wipeEpoch === myEpoch &&
            !dtoCache.has(path)
          )
            cacheDto(path, dto)
        })
        // Fail-open, no retry, no cache.delete: identical contract to
        // schedule()'s timer above — the failure branch here never writes
        // and never deletes anything; the real 録音 tap's own fetch surfaces
        // any genuine error.
        .catch(() => {})
    }, delay)
    pendingTimers.push(timer)
  }
}

subscribeSessionState(() => {
  const state = getSessionState()
  if (state.status === 'signed-in') {
    if (!armed) {
      armed = true
      schedule()
    }
  } else if (state.status === 'signed-out') {
    // Shared-device hygiene (brief-warm.ts's reset idiom): a different staff
    // member's sign-in must re-arm from a clean slate, and no stale timer
    // from the outgoing session may fire into the new one.
    pendingTimers.forEach((t) => window.clearTimeout(t))
    pendingTimers = []
    armed = false
    recordWarmScheduled = new Set()
  }
})
