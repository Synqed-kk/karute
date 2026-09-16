// 予約 — the NEIGHBOURS, fetched before anybody asks for them.
//
// THE FACT THIS EXISTS FOR (MEASURE-CALENDAR-SPEED-2026-09-16): rendering the
// calendar is not the cost. One screens GET is, and it is 590–725 ms on the
// live server and 800–900 ms warm on staging. A date the phone has never
// visited always waits a whole round trip, so a swipe, a ‹ / › tap and a
// 日/週/月 switch each stall for most of a second on a page that is otherwise
// instant on a revisit.
//
// So, once a 予約 view has LANDED, this queues the same GET for the places the
// finger can go next, one per animation frame, straight into the screen cache
// the boundary already paints from (ScreenBoundary's `dtoCache`), in the order
// a staff member reaches them:
//
//   1. this view, one unit BACK      ← a left swipe / ‹
//   2. this view, one unit FORWARD   ← a right swipe / ›
//   3. the other two views, same date ← the 日/週/月 segment
//   4. (on 日/週) this month's 月 read ← the pop-down calendar, opened filled
//
// It NEVER changes what the boundary does with its own fetch: the mount effect
// still revalidates on every visit, there is no TTL, and a warmed entry only
// ever buys an instant paint. A miss is exactly today's behaviour.
//
// The path is built by `appointmentsScreenPath` and nowhere else — the path IS
// the cache key, so a second spelling of it would warm a cache no screen ever
// reads (the trap screen-prefetch.ts names in its own TARGETS comment).

import { getDataPort } from '@/lib/ports/data-port'
import { globalRecorder } from '@/lib/global-recorder'
import { AppointmentsScreenDTO } from '@/lib/app-api/appointments-screen-dto'
import { monthKeyInJst } from '@/lib/appointments/date-jump'
import { shiftAppointmentsDate } from '@/lib/appointments/date-step'
import { ymdInJst } from '@/lib/date/jst'
import type { DayWeekMonthView } from '@synqed-kk/ui'
import { subscribeRefresh } from '../ports/nav.vite'
import { cacheDto, dtoCache, dtoSessionEpoch } from '../screens/ScreenBoundary'
import { rememberMonthNumbers } from './calendar-numbers-store'

/**
 * THE ONE SPELLING of a 予約 screen read's URL — and therefore of its cache
 * key. `AppointmentsScreen` builds its own path with this, the warms below use
 * it, and the pop-down calendar's month door uses it too, so a month warmed
 * here is a month the panel actually finds.
 *
 * Key order is part of the key: date, view, staff, locale, and an absent
 * param is absent rather than empty (a bare `/appointments` URL reads as
 * `?locale=ja`, which is what the boundary caches it under).
 */
export function appointmentsScreenPath(params: {
  date?: string | null
  view?: string | null
  staff?: string | null
  locale: string
}): string {
  const qs = new URLSearchParams()
  for (const key of ['date', 'view', 'staff'] as const) {
    const value = params[key]
    if (value) qs.set(key, value)
  }
  qs.set('locale', params.locale)
  return `/api/app/v1/screens/appointments?${qs.toString()}`
}

export interface NeighbourInput {
  view: DayWeekMonthView
  /** The day the page is on. */
  selectedDate: Date
  /** JST today — the ± step lands on it when the target IS the current month,
   *  exactly as the page's own arrows do. */
  today: Date
  /** The 担当 scope the page is under. It rides on every warm for this view,
   *  because it rides on the read the page itself will make. */
  staff: string | null
  locale: string
}

/** The queue, in the order a finger reaches them. */
export function neighbourPaths(input: NeighbourInput): string[] {
  const { view, selectedDate, today, staff, locale } = input
  const at = (v: DayWeekMonthView, date: Date, withStaff: string | null = staff) =>
    appointmentsScreenPath({ date: ymdInJst(date), view: v, staff: withStaff, locale })

  const paths = [
    at(view, shiftAppointmentsDate(selectedDate, view, -1, today)),
    at(view, shiftAppointmentsDate(selectedDate, view, 1, today)),
    // The segment's other two doors, same date — a 日/週/月 tap is then a cache
    // hit and the page changes in one frame instead of half a second.
    ...(['day', 'week', 'month'] as const).filter((v) => v !== view).map((v) => at(v, selectedDate)),
  ]
  if (view !== 'month') {
    // The pop-down calendar's own month. NO staff param — the 月 counts are
    // store-wide (lib/appointments/screen.ts filters only reservationViews),
    // and sending one would quietly shrink them. Same rule, same spelling, as
    // the panel's month door itself.
    paths.push(
      appointmentsScreenPath({
        date: `${monthKeyInJst(selectedDate)}-01`,
        view: 'month',
        staff: null,
        locale,
      }),
    )
  }
  return paths
}

// A post-mutation `emitRefresh` clears dtoCache but is NOT a sign-out, so the
// sign-out epoch alone lets a warm that STARTED pre-mutation settle after the
// wipe and repopulate the cleared entry with pre-mutation data. Same fence,
// same reason, as screen-prefetch.ts's own `wipeEpoch`.
let wipeEpoch = 0
subscribeRefresh(() => {
  wipeEpoch++
})

/** Bumped by every new land. A step from an older generation is a step toward
 *  a view the staff member has already left — it simply stops. */
let generation = 0
let queued: number | null = null
/** Paths with a request actually outstanding — a second warm for the same path
 *  is impossible while the first is in the air. */
const inFlight = new Set<string>()

/** Exported for the packet's tests, same rationale as dtoCache's own export. */
export function neighbourInFlight(): ReadonlySet<string> {
  return inFlight
}

function warmOne(path: string): void {
  if (inFlight.has(path) || dtoCache.has(path)) return
  // A take in progress owns the device. Mirrors screen-prefetch.ts's fire-time
  // half of the same guard — background reads never compete with a recording.
  if (globalRecorder.state !== 'idle') return
  inFlight.add(path)
  const mySessionEpoch = dtoSessionEpoch()
  const myWipeEpoch = wipeEpoch
  getDataPort()
    .apiFetch(path)
    .then((res) => (res.ok ? res.json() : null))
    .then((body: unknown) => {
      if (body === null) return
      const dto = AppointmentsScreenDTO.parse(body)
      if (
        dtoSessionEpoch() === mySessionEpoch &&
        wipeEpoch === myWipeEpoch &&
        !dtoCache.has(path)
      ) {
        cacheDto(path, dto)
        // A warmed month is the one the pop-down opens on NEXT launch too —
        // numbers only, the store refuses anything else.
        rememberMonthNumbers(path, dto.monthData ?? null)
      }
    })
    // Fail-open, no retry: a non-OK response, a rejection, a bad body and a
    // schema failure all land here silently. The real tap's own fetch is what
    // surfaces a genuine error — a warm must never put an error on screen.
    .catch(() => {})
    .finally(() => {
      inFlight.delete(path)
    })
}

/**
 * Queue this view's neighbours. Call it when a 予約 DTO has LANDED — never
 * before: the screen the staff member is looking at must have the network to
 * itself until it has painted.
 */
export function warmAppointmentNeighbours(input: NeighbourInput): void {
  if (typeof requestAnimationFrame !== 'function') return
  const paths = neighbourPaths(input)
  const mine = ++generation
  if (queued !== null) cancelAnimationFrame(queued)
  queued = null
  let i = 0
  // ONE PER FRAME, never a burst: the frames right after a land are the ones a
  // finger arrives in, and five fetches started in the same task is five
  // parse/settle callbacks landing in the same one later.
  const step = () => {
    queued = null
    if (mine !== generation) return
    while (i < paths.length && dtoCache.has(paths[i])) i++
    if (i >= paths.length) return
    warmOne(paths[i])
    i++
    queued = requestAnimationFrame(step)
  }
  queued = requestAnimationFrame(step)
}

/** Drop the queue — a view change, or a screen going away. */
export function cancelNeighbourWarm(): void {
  generation++
  if (queued !== null) cancelAnimationFrame(queued)
  queued = null
}
