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
// Static import is fine today (single bundle, no lazy routes yet) — same
// precedent/caveat foreground-revalidate.ts:21-24 carries for its own
// globalRecorder import; a future lazy-routes PR must account for this
// entry-chain import too.
import { globalRecorder } from '@/lib/global-recorder'
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
import { subscribeRefresh, subscribeRevalidate } from '../ports/nav.vite'
import { cacheDto, dtoCache } from '../screens/ScreenBoundary'

// Compressed vs brief-warm.ts's 3s/4s (Liam field feedback: staff tap
// 予約→録音 faster than that 3s/4s cadence covers). Approved tradeoff: the
// mounted screen's own mount fetch still wins first paint regardless of this
// module's timers, so the worst case of firing too early is one wasted
// request — brief-warm keeps the slower cadence because its target (a paid
// AI generation) isn't similarly latency-sensitive.
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

// Foreground re-warm (perf packet 36, PR-H3). On the #596 foreground event
// (subscribeRevalidate — a NARROWER sibling of subscribeRefresh above; see
// its own doc comment in nav.vite.tsx), re-run schedule() so any of the 5
// targets a post-mutation emitRefresh wiped (or that fell out of dtoCache's
// FIFO eviction cap) come back warm during all-day usage instead of staying
// cold until the next sign-out/sign-in. schedule() itself already no-ops on
// every already-cached path (dtoCache.has, right below), so this only ever
// warms what's genuinely MISSING — a warm-cache foreground costs nothing.
const FOREGROUND_REWARM_MIN_INTERVAL_MS = 30_000
// Starts at 0 (never gates the first foreground of a session); reset to 0 in
// the signed-out branch below — a fresh sign-in must not inherit the
// OUTGOING session's rate-limit stamp.
let lastForegroundRewarmAt = 0

subscribeRevalidate(() => {
  // Signed-out: AuthGate has unmounted every screen, so there is nothing to
  // warm ahead of — and scheduling here would just spin up 5 timers with no
  // cancellation until the NEXT authoritative transition rebinds them away.
  if (getSessionState().status !== 'signed-in') return
  // DEFENSE-IN-DEPTH, not redundant: the emitter (foreground-revalidate.ts)
  // already gates emitRevalidate() itself on this exact `!== 'idle'` check —
  // but that guard lives in a file this module doesn't own, and a future
  // second emitRevalidate caller must not silently inherit "safe to prefetch
  // during a recording" merely by never having read this file. Guarding on
  // `!== 'idle'` (not just recording/paused) matches the emitter's own
  // contract exactly — it also covers 'recorded'-unsaved, an unsaved take
  // this module's heaviest background fetch batch must not compete with.
  if (globalRecorder.state !== 'idle') return
  const now = Date.now()
  if (now - lastForegroundRewarmAt < FOREGROUND_REWARM_MIN_INTERVAL_MS) return
  // Stamped unconditionally, before knowing whether schedule() below finds
  // anything missing: the stamp is a rate limit on how often this module
  // does the work of checking, not a "did we actually warm something" flag —
  // a warm-cache foreground must still reset the clock, or a quiet session
  // (nothing ever missing) would re-check on every single foreground.
  lastForegroundRewarmAt = now
  schedule()
})

// Per-path pending-timer dedupe (perf packet 36, PR-H3): once schedule() can
// run more than once per signed-in period (the foreground subscriber above,
// on top of the sign-in one-shot), a foreground re-warm while the sign-in
// stagger's OWN timers are still pending would schedule a SECOND timer for
// the same path — dtoCache.has() alone is blind to it, since nothing is
// cached until a timer actually fires and settles. Mirrors
// recordWarmScheduled's idiom exactly (see its declaration comment below,
// this module's other Set-dedupe, for the fuller rationale this one shares):
// add at schedule time, delete at settle time — success, failure, or an
// early fire-time skip — via a Set reference CAPTURED at fire time, not read
// live. tabWarmScheduled gets REBOUND to a fresh Set on sign-out (unlike
// dtoCache, only ever mutated in place), so a stale settle from a
// pre-sign-out fetch must delete from the SAME Set instance it was scheduled
// against — currentGeneration() is the wrong delete guard for this, since it
// bumps on every authoritative write including a same-user resume echo,
// which would wrongly treat a mere resume as "delete via the old instance".
let tabWarmScheduled = new Set<string>()

function schedule(): void {
  let i = 0
  for (const { path, parse } of TARGETS) {
    // Skip at schedule time: already visited/cached, or already scheduled by
    // an earlier schedule() call this signed-in period whose timer hasn't
    // settled yet (see tabWarmScheduled's declaration comment above).
    if (dtoCache.has(path) || tabWarmScheduled.has(path)) continue
    const delay = FIRST_DELAY_MS + i * STAGGER_MS
    i++
    tabWarmScheduled.add(path)
    const timer = window.setTimeout(() => {
      pendingTimers = pendingTimers.filter((t) => t !== timer)
      // Captured here, not read live below — see tabWarmScheduled's
      // declaration comment above.
      const myScheduled = tabWarmScheduled
      // Skip at fire time too: a user who navigated there mid-stagger
      // already has a fresher fetch in the cache — never clobber it. Delete
      // now: the outcome is known, so a LATER schedule() call (e.g. after a
      // post-mutation wipe re-clears this same path) is free to re-warm it
      // instead of finding it falsely still-pending.
      if (dtoCache.has(path)) {
        myScheduled.delete(path)
        return
      }
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
        .finally(() => {
          // Settle-time delete — success or failure, the outcome is now
          // known, so a later schedule() call is free to retry/re-warm this
          // path (mirrors warmRecordForBookings' identical finally below).
          myScheduled.delete(path)
        })
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
// appointmentId -> in-flight, from schedule time until its outcome is KNOWN:
// a settle (success or failure) or an early skip at fire time. Diverges from
// the fire-time-delete wording this comment used to carry (blind-round fix):
// deleting as the timer callback's first statement left the window from
// "timer fires" to "fetch settles" with BOTH skip guards false (this Set
// empty for the id, dtoCache not yet written) — a second settle landing in
// that window (routine: a booking mutation's emitRefresh → appointments
// refetch → the settle effect re-running for the same still-top-2 id)
// scheduled a DUPLICATE timer + fetch. brief-warm.ts's `scheduled` set has
// this identical narrow window; what actually closes it there is brief-warm's
// SECOND set, `warmed`, which stays populated through the in-flight fetch —
// this module had only ported the first half of that idiom. Settle-time
// deletion (the timer body's `.finally()` below) is what closes it here; a
// failed warm still gets deleted there so a later settle can retry it.
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
  // Liam pin (foreground-revalidate.ts:31-35): never disturb an active
  // recording. This warm fires the app's heaviest DTO fetch, and 予約→録音
  // mid-take is a real path (record → hop back to 予約 → settle → warm at
  // 1s) — skip the WHOLE call; the next settle after the take resolves
  // (state back to 'idle') re-warms.
  if (globalRecorder.state !== 'idle') return
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
      // Captured here, not read live inside the `.finally()` below:
      // recordWarmScheduled itself gets REBOUND to a fresh Set on sign-out
      // (unlike dtoCache, which is only ever mutated in place) — a stale
      // settle from a pre-sign-out fetch must delete from the SAME Set
      // instance it was scheduled against, never from whatever Set happens
      // to be live by the time it settles. currentGeneration() is the wrong
      // proxy for that: it bumps on every authoritative session-store write,
      // including a same-user resume/cold-boot echo (see `armed`'s comment
      // above), while recordWarmScheduled only actually gets rebound on
      // sign-out — gating the delete on currentGeneration() would strand
      // `id` in this (still-live, unrebound) Set across a mere resume echo,
      // the exact generation-keyed trap `armed` was already fixed for.
      // Capturing the reference sidesteps that: on a same-session resume the
      // captured Set IS the live one (delete lands correctly); on a sign-out
      // the captured Set is the orphaned old one (delete is an inert no-op,
      // never touching the new session's Set).
      const myScheduled = recordWarmScheduled
      // Early skips resolve the id's outcome NOW — delete so a later settle
      // can re-warm it (a wiped cache / finished recording must not strand
      // the id).
      if (dtoCache.has(path)) {
        myScheduled.delete(id)
        return
      }
      // Fire-time half of the recorder guard: a recording that started
      // inside the 1-2.5s stagger window itself (schedule-time check above
      // already missed it).
      if (globalRecorder.state !== 'idle') {
        myScheduled.delete(id)
        return
      }
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
        // Fail-open, no retry: identical contract to schedule()'s timer
        // above — nothing here throws past this module.
        .catch(() => {})
        .finally(() => {
          // Settle-time delete is what closes the in-flight dedupe window a
          // fire-time delete left open (see the declaration comment above) —
          // success or failure, the outcome is now known, so a later settle
          // is free to retry/re-warm this id.
          myScheduled.delete(id)
        })
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
    tabWarmScheduled = new Set()
    // A fresh sign-in must not inherit the outgoing session's foreground
    // rate-limit stamp.
    lastForegroundRewarmAt = 0
  }
})
