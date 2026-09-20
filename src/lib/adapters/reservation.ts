import type { Appointment } from '@synqed-kk/client'
import type { MonthGridCell, WeekDayCardData, MonthDensityBucket } from '@synqed-kk/ui'
import { partsInJst, ymdInJst } from '@/lib/date/jst'
import type { WeekStart } from '@/lib/date/week-start'
import { isCountedBooking } from '@/lib/appointments/by-date'
import { BOOKING_SWITCHES } from '@/lib/appointments/booking-switches'
import type { DayHoursFact } from '@/lib/operating-hours'
import type { MonthCellDTOType } from '@/lib/app-api/appointments-screen-dto'
import {
  capacityForDay,
  type Band,
  type BookedSpan,
  type CapacityFact,
  type HoursSource,
  type LaneKind,
  type NoCapacityReason,
} from '@/lib/capacity/capacity'

// ---------------------------------------------------------------------------
// Adapter: synqed-core Appointment[] -> WeekDayCardData[] / MonthGridCell[]
// Pure functions; caller owns date math and business hours lookup.
//
// All bucketing + display is JST-anchored. Runtime-local methods (getDate(),
// getHours()) drift on the Vercel UTC server — a 23:30 JST booking on
// 2026-05-19 has UTC date 2026-05-19 14:30, but is bucketed as the next day
// in JST. Going through JST helpers keeps server and client in sync.
// ---------------------------------------------------------------------------

const VISIBLE_BOOKING_LIMIT = 4

function isoDay(d: Date): string {
  return ymdInJst(d)
}

function sameYMD(a: Date, b: Date): boolean {
  return ymdInJst(a) === ymdInJst(b)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function durationMinutes(a: Appointment): number {
  if (a.duration_minutes != null) return a.duration_minutes
  const start = new Date(a.starts_at).getTime()
  const end = new Date(a.ends_at).getTime()
  return Math.max(0, Math.round((end - start) / 60000))
}

/** One week row: the package's WeekDayCardData plus the 予約 numbers' own
 *  facts. Structurally assignable to WeekDayCardData[], so the npm WeekDayCard
 *  keeps rendering these rows verbatim until the app-local seven-row component
 *  replaces it. */
/** The capacity FACTS one row carries, straight from src/lib/capacity — the
 *  one place the model is computed. Additive: nothing renders them yet (the
 *  wiring round does), but the week row, the month cell and both doors already
 *  agree about them. */
export type CapacityRowFields = {
  /** lanes × the day's declared minutes, or null when no honest capacity
   *  exists for this store-day. `capacityReason` says which. */
  capacityMinutes: number | null
  /** The lane count actually used (the roster, floored by whoever really
   *  worked). 0 where it isn't known yet. */
  lanes: number
  laneKind: LaneKind
  hoursSource: HoursSource | null
  /** Integer 0–100; 100 only alongside `full` (E23). Null with no capacity. */
  occupancyPct: number | null
  /** 満 — the day is sold out. Never a clamp, never a withdrawal. */
  full: boolean
  band: Band | null
  /** 空き in minutes — only on a day the STORE itself declared (E21), so an
   *  org-blob day carries the band and 稼働 but promises no minutes. */
  freeMinutes: number | null
  /** Why there is no capacity; null when there is one.
   *
   *  ⚖ R1-8 — 'unknown' is the ADAPTER's own ninth value, never the module's:
   *  it means "this door never resolved a store, so nothing was computed".
   *  The module stamps a real reason on every withdrawal, so the pairing
   *  `capacityMinutes == null ⇔ capacityReason != null` now holds on EVERY
   *  path, including the date-jump door's capacity-less months and a bundle
   *  skew. A cell that reads the reason can therefore trust it: a null reason
   *  means a real capacity, never "nobody looked". */
  capacityReason: NoCapacityReason | 'unknown' | null
}

export type WeekDayRowData = WeekDayCardData &
  CapacityRowFields & {
    /** The row's JST calendar day, YYYY-MM-DD — the id every 予約 surface keys
     *  and navigates by (?date= takes this spelling). */
    dateIso: string
    /** May 稼働/空き claim a number for this day at all? Now exactly
     *  `capacityMinutes != null` — the module owns the rule, and this stays as
     *  the name every surface already reads. False → the cell shows 未設定 or
     *  takes the next metric, and availableMinutes is the old week-average
     *  arithmetic, not a capacity. */
    capacityDefensible: boolean
    /** A human really set this day's hours (store weekly_hours, a closed date,
     *  or a saved org-blob day) — i.e. `hoursSource !== 'default'`. */
    hoursSaved: boolean
    /** 定休日 or 臨時休業. */
    closed: boolean
    cancelledCount: number
    noShowDayCount: number
    /** PKT-2 owns the producer; 0 here so the wire shape lands one release early. */
    returningCount: number
    /** ⚖ R1-2 — is `newCustomerCount` a number we actually KNOW? False when the
     *  history read behind the 新規 rule did not happen, in which case the
     *  count is 0 and no surface may print it: the 新規 slot takes the next
     *  metric and the week summary drops its 新規 stat. Optional, and absent
     *  reads as KNOWN, matching the wire's `.default(true)` — an older baked
     *  bundle keeps today's behaviour rather than blanking the cell. */
    newCountKnown?: boolean
  }

/** One month cell: the package's MonthGridCell plus the one fact the 月 page's
 *  own grid needs and the package has no slot for. Structurally assignable to
 *  MonthGridCell[], so the pop-down panel keeps seeding itself from the page's
 *  cells unchanged (it renders through the package grid, which ignores the
 *  extra key). */
export type MonthCell = MonthGridCell & {
  /** 定休日 or 臨時休業 — the SAME fact the week row carries, read from the
   *  SAME hoursFacts map, so a day cannot be 休 on one surface and open on
   *  the other. */
  closed: boolean
  /** ⚖ PKT-2b — people whose first visit falls on this day, the month
   *  line's own rule (metric-menu.ts `monthNewCount`, Σ over `inMonth`
   *  cells). Optional and absent reads as KNOWN with 0, the same
   *  bundle-skew convention `WeekDayRowData.newCountKnown` already carries —
   *  a cell nobody ever merged this onto (the pop-down's own placeholder
   *  read) renders no 新規 slot anyway (its grid has none), so it costs
   *  nothing there. Both real doors (screen.ts, the thin screen) always set
   *  it alongside `newCountKnown`. */
  newCount?: number
  /** False = the history read behind 新規 did not happen for this window;
   *  `monthNewCount` withholds the WHOLE month rather than summing partial
   *  data in with real counts. The week row's own flag (reservation.ts
   *  `WeekDayRowData.newCountKnown`), one door apart. */
  newCountKnown?: boolean
}

/** A counted booking as the two numbers the overlap check needs. */
type BookingSpan = { start: number; end: number }

/** Everything the capacity model needs that is not in the booking rows: the
 *  store's lane kind, its booking roster, the day's resolved hours. The CALLER
 *  resolves all of it — the module itself knows nothing of stores, business
 *  types or switches, and this adapter reads the switch on its behalf. */
export interface CapacityInputs {
  /** That day's resolved hours, keyed by JST YYYY-MM-DD (resolveWindowHours).
   *  A missing key = hours unresolved for that day, so no capacity. */
  hoursFacts?: ReadonlyMap<string, DayHoursFact>
  /** 'none' = a class-bound store (one row is many people) — the count table,
   *  never a percentage, at any layer. Defaults to 'staff'. */
  laneKind?: LaneKind
  /** The store's booking-roster headcount. null (the default) = the lens
   *  failed or there is no store, so the day gets NO capacity — the divisor
   *  fails CLOSED where the picker fails open (C1 §5 / C3 E28). */
  rosterHeadcount?: number | null
  /** The salon's solo_mode capability — only consulted while
   *  BOOKING_SWITCHES.multiStaffCapacity is OFF. */
  soloMode?: boolean
  /** The store row could not be read (a transient failure — never "no store
   *  id to read"). No fact is set for ANY day in this call, so every row and
   *  cell falls through the SAME no-store path an unresolved door already
   *  uses (`capacityRowFields(undefined)` → `'unknown'`), rather than let the
   *  caller's org-wide fallback type decide a lane kind for a store we could
   *  not actually check (⚖ G2, Greptile round 1 #934). */
  storeRowDegraded?: boolean
}

const MS_PER_DAY = 86_400_000

/** Absolute instant of JST midnight opening the given YYYY-MM-DD. */
function jstDayStartMs(ymd: string): number {
  return new Date(`${ymd}T00:00:00+09:00`).getTime()
}

/** One counted row's interval as CORE enforces it: ends_at, EXTENDED by
 *  occupied_until where core snapshotted the cleanup (C1 §7 / E35). NEVER
 *  duration_minutes — core stores that as an independent nullable column and
 *  never validates it against the interval (E30).
 *
 *  ⚖ R1-2 — the extension is a MAX, never a replacement. `occupied_until`
 *  carries no contract of its own in the SDK (a bare `string | null`), so a
 *  snapshot written before the booking was moved, or lengthened, can sit
 *  BEFORE `ends_at`. Trusting it blindly shortened the row — and when it sat
 *  before `starts_at` the interval ran backwards and the row was dropped
 *  entirely, so a day with four hours booked reported 13 % occupied and seven
 *  hours free, with the concurrency guard unable to see the row at all. It is
 *  the same unvalidated-column trust E30 rejected for duration_minutes; a
 *  cleanup can only ever add minutes to a booking, so the arithmetic says so.
 *
 *  ⚖ G1 (Greptile #934) — `occupied_until` is unvalidated in BOTH directions:
 *  a value that fails to parse (`Date.parse` → NaN) is no extension at all,
 *  never a NaN that poisons the Math.max and drops the whole row from the
 *  span validation below. */
function spanOf(a: Appointment): BookedSpan {
  const endMs = Date.parse(a.ends_at)
  const cleanupMs = a.occupied_until == null ? NaN : Date.parse(a.occupied_until)
  return {
    startMs: Date.parse(a.starts_at),
    endMs: Number.isFinite(cleanupMs) ? Math.max(endMs, cleanupMs) : endMs,
    staffId: a.staff_id ?? null,
  }
}

/** The day's lane count for the module, per the switch.
 *
 *  ON: the store's booking roster, any store — the model this packet installs.
 *  OFF: the solo store's single declared lane and nothing else, which is
 *  exactly the gate that shipped before this packet (soloMode AND at most one
 *  booked staffer); every other store gets null and falls to the count table. */
function rosterLanesFor(inputs: CapacityInputs, bookedStaffOnDay: number): number | null {
  if (BOOKING_SWITCHES.multiStaffCapacity) return inputs.rosterHeadcount ?? null
  return inputs.soloMode === true && bookedStaffOnDay <= 1 ? 1 : null
}

/**
 * The capacity fact for each of `dayKeys`, computed in ONE place from ONE
 * index, so a week row and a month cell for the same day can never disagree.
 *
 * Two indexes off a single pass, because they answer two different questions:
 *   - by INTERSECTION, for the module's spans: a 23:00–01:00 booking occupies
 *     minutes of both days (C1's window-edge leak — the fetch also starts one
 *     day early so the previous night is even visible).
 *   - by START DAY, for the booked-staff gate the OFF branch reproduces, which
 *     is the app's bucketing rule on every other surface.
 */
function capacityFactsFor(
  appointments: Appointment[],
  dayKeys: readonly string[],
  inputs: CapacityInputs,
): Map<string, CapacityFact> {
  const wanted = new Set(dayKeys)
  const spansByDay = new Map<string, BookedSpan[]>()
  const staffByStartDay = new Map<string, Set<string>>()

  for (const a of appointments) {
    if (!isCountedBooking(a)) continue

    const startKey = isoDay(new Date(a.starts_at))
    if (wanted.has(startKey)) {
      const staff = staffByStartDay.get(startKey) ?? new Set<string>()
      if (a.staff_id != null) staff.add(a.staff_id)
      staffByStartDay.set(startKey, staff)
    }

    const span = spanOf(a)
    // A non-finite or backwards interval is not a real one — the module drops
    // it anyway, and walking its days here would spin.
    if (!Number.isFinite(span.startMs) || !Number.isFinite(span.endMs)) continue
    if (span.endMs <= span.startMs) continue
    // Walk the JST days the interval touches. JST has no DST, so a day is
    // exactly 86,400,000 ms and the step is exact. The guard bounds a corrupt
    // far-future end instant; a real booking touches one day, rarely two.
    let dayStartMs = jstDayStartMs(isoDay(new Date(span.startMs)))
    for (let guard = 0; guard < 400 && dayStartMs < span.endMs; guard++) {
      const key = isoDay(new Date(dayStartMs))
      if (wanted.has(key)) {
        const arr = spansByDay.get(key)
        if (arr) arr.push(span)
        else spansByDay.set(key, [span])
      }
      dayStartMs += MS_PER_DAY
    }
  }

  const facts = new Map<string, CapacityFact>()
  for (const key of dayKeys) {
    // ⚖ G2 — degraded: no entry at all, so the caller reading this key falls
    // through to the same no-store path an out-of-window month already hits
    // (capacityRowFields(undefined)), withholding capacity instead of
    // computing one off the org-wide fallback type.
    if (inputs.storeRowDegraded) continue
    const dayStartMs = jstDayStartMs(key)
    const hoursFact = inputs.hoursFacts?.get(key)
    facts.set(
      key,
      capacityForDay({
        laneKind: inputs.laneKind ?? 'staff',
        rosterLanes: rosterLanesFor(inputs, staffByStartDay.get(key)?.size ?? 0),
        hours: hoursFact
          ? {
              openMs: dayStartMs + hoursFact.openMinute * 60_000,
              closeMs: dayStartMs + hoursFact.closeMinute * 60_000,
              source: hoursFact.source,
              closed: hoursFact.closed,
            }
          : null,
        dayStartMs,
        dayEndMs: dayStartMs + MS_PER_DAY,
        spans: spansByDay.get(key) ?? [],
      }),
    )
  }
  return facts
}

/** The capacity facts for every IN-MONTH day, keyed by JST YYYY-MM-DD.
 *
 *  Separate from appointmentsToMonthCells (whose signature the date-jump panel
 *  depends on) but fed by the SAME index and the same counted-row predicate,
 *  so the dot and the percentage on one cell can never describe different
 *  days. The out-of-month padding cells get nothing — they render no numbers. */
export function appointmentsToMonthFacts(
  appointments: Appointment[],
  monthStart: Date,
  monthEnd: Date,
  inputs: CapacityInputs = {},
): Map<string, CapacityFact> {
  const keys: string[] = []
  const cursor = new Date(monthStart)
  while (cursor <= monthEnd) {
    keys.push(isoDay(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return capacityFactsFor(appointments, keys, inputs)
}

/** The wire/row shape of one capacity fact. One spelling, so the week row, the
 *  month cell and the date-jump panel's capacity-less months all say the same
 *  thing in the same words. */
export function capacityRowFields(fact: CapacityFact | undefined): CapacityRowFields {
  if (!fact) {
    // ⚖ R1-8 — the "this door never looked" row, and it says so.
    //
    // It used to return `capacityReason: null` beside `capacityMinutes: null`,
    // which everywhere else in the model means "there IS a capacity" — so a
    // day from the date-jump door read as "no capacity, no reason", and the
    // 未設定 cell that reads the reason had nothing to tell it apart from a
    // real one. And `laneKind: 'none'` was a positive claim: it reads as "this
    // store runs classes, no percentage is honest here", when the truth is
    // that this door never resolved a store at all. 'staff' is the adapter's
    // own neutral default (`inputs.laneKind ?? 'staff'`) and nothing acts on
    // it while capacityMinutes is null.
    return {
      capacityMinutes: null,
      lanes: 0,
      laneKind: 'staff',
      hoursSource: null,
      occupancyPct: null,
      full: false,
      band: null,
      freeMinutes: null,
      capacityReason: 'unknown',
    }
  }
  return {
    capacityMinutes: fact.capacityMinutes,
    lanes: fact.lanes,
    laneKind: fact.laneKind,
    hoursSource: fact.hoursSource,
    occupancyPct: fact.occupancyPct,
    full: fact.full,
    band: fact.band,
    freeMinutes: fact.availableMinutes,
    capacityReason: fact.reason,
  }
}

/** Per-JST-day counts of a terminal partition. */
function countByDay(rows: Appointment[] | undefined): Map<string, number> {
  const counts = new Map<string, number>()
  for (const a of rows ?? []) {
    const key = isoDay(new Date(a.starts_at))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function appointmentsToWeekData(
  appointments: Appointment[],
  weekStart: Date,
  weekEnd: Date,
  businessHoursMinutes: number,
  today: Date,
  locale: string,
  /** ⚖ PKT-2 — the 新規 number per JST day, from `newCountByDay`
   *  (src/lib/appointments/first-visit.ts). A day absent from the map has no
   *  新規. Never re-derived here.
   *
   *  ⚖ R1-2 — `known` rides WITH the counts, in one argument, so no caller can
   *  hand over a number without saying whether it is one. False = the history
   *  read that decides 新規 did not happen, and the row carries 0 with
   *  `newCountKnown: false` so every surface withholds the cell instead of
   *  printing a maximal guess. */
  newCounts: { byDay: ReadonlyMap<string, number>; known: boolean } = {
    byDay: new Map(),
    known: true,
  },
  /** The window's CANCELLED / NO_SHOW bookings (fetchAppointmentWindow's own
   *  partitions). Absent = the counts render 0, today's behaviour. */
  terminal?: { cancelled: Appointment[]; noShow: Appointment[] },
  /** That day's resolved hours, keyed by JST YYYY-MM-DD (resolveWindowHours).
   *  Absent = no day is defensible, so nothing claims a capacity. */
  hoursFacts?: ReadonlyMap<string, DayHoursFact>,
  /** The salon's solo_mode capability — only consulted while
   *  BOOKING_SWITCHES.multiStaffCapacity is OFF. */
  soloMode?: boolean,
  /** The store's lane kind and booking roster. Absent = no roster known, so
   *  no day claims a capacity (fail closed). */
  capacity: Omit<CapacityInputs, 'hoursFacts' | 'soloMode'> = {},
): WeekDayRowData[] {
  // Localized short weekday (日/月… in ja, Sun/Mon… in en). The package's
  // WeekDayCard renders this verbatim, so it has to be localized at the source.
  const weekdayFmt = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'Asia/Tokyo',
  })
  // Bucket appointments by ISO day.
  const buckets = new Map<string, Appointment[]>()
  for (const a of appointments) {
    const key = isoDay(new Date(a.starts_at))
    const arr = buckets.get(key)
    if (arr) arr.push(a)
    else buckets.set(key, [a])
  }

  const cancelledByDay = countByDay(terminal?.cancelled)
  const noShowByDay = countByDay(terminal?.noShow)

  // Every day of the range up front, so the capacity facts are built ONCE off
  // one index rather than per row (and so the month adapter can share it).
  const dates: Date[] = []
  {
    const walk = new Date(weekStart)
    while (walk <= weekEnd) {
      dates.push(new Date(walk))
      walk.setDate(walk.getDate() + 1)
    }
  }
  const dayKeys = dates.map(isoDay)
  // ⚖ Capacity is not a day-bucket question. A 23:30–00:30 booking and a
  // 00:00–01:00 booking under the same staffer genuinely collide, but they
  // bucket to different JST days by START, so a per-bucket check never
  // compares them. capacityFactsFor indexes by INTERSECTION for exactly that
  // reason. Counting and bookedMinutes stay start-day bucketed — that is the
  // app's rule on every other surface.
  const capacityFacts = capacityFactsFor(appointments, dayKeys, {
    ...capacity,
    hoursFacts,
    soloMode,
  })

  const days: WeekDayRowData[] = []
  for (let i = 0; i < dates.length; i++) {
    const cursor = dates[i]
    const key = dayKeys[i]
    // The caller already hands over COUNTED rows; re-applying the one predicate
    // here is the guard that keeps a second 件 definition from ever appearing
    // (a legacy caller passing a raw range gets the same truth).
    const dayAppts = (buckets.get(key) ?? [])
      .filter(isCountedBooking)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))

    const bookedMinutes = dayAppts.reduce((sum, a) => sum + durationMinutes(a), 0)
    // Capacity = open hours × the staff who actually worked that day (≥1), so
    // utilization is salon-wide and can't read >100% the way a single-chair
    // denominator did (a 6-staff day was showing "117% utilized"). Approximation:
    // a working staffer is treated as open the full business hours — refine when
    // per-staff schedules exist.
    const staffOnDay = new Set(dayAppts.map((a) => a.staff_id)).size

    const visible = dayAppts.slice(0, VISIBLE_BOOKING_LIMIT).map((a) => ({
      id: a.id,
      startTime: formatTime(a.starts_at),
      shortName: a.title ?? '—',
    }))

    // ⚖ ONE capacity, computed in ONE place. The five-conjunct block that
    // stood here is gone: solo_mode, the one-staffer gate, the overlap check,
    // the saved-hours check and the over-capacity check all live inside
    // src/lib/capacity now, where the month cell and Business read them too.
    // A second formula kept alive here is how two surfaces start disagreeing.
    const fact = hoursFacts?.get(key)
    const capacityFact = capacityFacts.get(key)
    const capacityDefensible = capacityFact?.capacityMinutes != null

    const cp = partsInJst(cursor)
    days.push({
      dateNumber: cp.day,
      monthNumber: cp.month,
      weekdayLabel: weekdayFmt.format(cursor),
      isToday: sameYMD(cursor, today),
      count: dayAppts.length,
      bookedMinutes,
      // Two-faced on purpose until the app-local row lands: the day's CAPACITY
      // when there is one, else today's exact fallback arithmetic so the npm
      // WeekDayCard renders byte-identically. This key means the DENOMINATOR
      // (the metric menu divides by it and subtracts booked minutes from it),
      // never the free time — the free minutes ride `freeMinutes` below, which
      // is why the new field needed its own name (C1 §9).
      // On a solo store with one lane, `capacityMinutes` IS the day's saved
      // minutes, so this is the same number it has always been; on a
      // multi-staff store it is roster × hours, which is the point of the
      // packet.
      // ⚠ The FALLBACK arm below is unchanged byte for byte; its INPUT SET is
      // not. `dayAppts` is now the COUNTED rows, so a staffer who only holds a
      // BLOCK (「オーナー業務」) or a cancelled row that day no longer counts as
      // working and the denominator can come out LOWER than it did on main
      // (one booking + one other staffer's BLOCK: 1200 → 600). Declared, and
      // the truer number — a bed hold is not a second chair (L4-2).
      availableMinutes:
        capacityFact?.capacityMinutes ?? businessHoursMinutes * Math.max(1, staffOnDay),
      dateIso: key,
      capacityDefensible,
      ...capacityRowFields(capacityFact),
      hoursSaved: fact?.saved ?? false,
      closed: fact?.closed ?? false,
      cancelledCount: cancelledByDay.get(key) ?? 0,
      noShowDayCount: noShowByDay.get(key) ?? 0,
      returningCount: 0,
      newCustomerCount: newCounts.known ? (newCounts.byDay.get(key) ?? 0) : 0,
      newCountKnown: newCounts.known,
      remindersPending: 0,
      consentPending: 0,
      // synqed appointments have no "unconfirmed/pending" status
      // (SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED) — the old code mislabeled
      // CANCELLED as unconfirmed. Zero until a real pending state exists.
      unconfirmed: 0,
      visibleBookings: visible,
      hiddenCount: Math.max(0, dayAppts.length - VISIBLE_BOOKING_LIMIT),
    })

  }
  return days
}

function densityFor(count: number): MonthDensityBucket {
  if (count === 0) return 'empty'
  if (count <= 2) return 'light'
  if (count <= 5) return 'medium'
  return 'busy'
}

/** ⚖ R1-3 — ONE month-cell wire mapping, and both doors call it.
 *
 *  The facade GET and the web server action each built this object by hand,
 *  and the web one hardcoded `newCount: 0` on the SAME wire type the phone was
 *  filling honestly. Nothing renders the month's 新規 yet, so today that costs
 *  nothing; the day it is rendered, one of the two doors prints a lie. A
 *  divergence you can only fix by remembering both call sites is a divergence
 *  waiting to come back, so there is one call site now.
 *
 *  `newCounts` absent = this door read no history at all, which is NOT the same
 *  as "nobody was new" — the cells then carry 0 with `newCountKnown: false`. */
export function monthCellsToDTO(
  cells: readonly MonthCell[],
  opts: {
    newCounts?: { byDay: ReadonlyMap<string, number>; known: boolean }
    facts?: ReadonlyMap<string, CapacityFact> | null
  } = {},
): MonthCellDTOType[] {
  const known = opts.newCounts?.known ?? false
  return cells.map((c) => ({
    id: c.id,
    dateIso: c.date.toISOString(),
    inMonth: c.inMonth,
    isToday: c.isToday,
    count: c.count,
    density: c.density,
    // In-month cells only: a padding cell carries no day of its own to be
    // anybody's first visit on.
    newCount: (known && c.inMonth && opts.newCounts?.byDay.get(c.id)) || 0,
    newCountKnown: known,
    // MERGE 2026-09-17 (#951) — `closed` (main's A2 fact) rides straight off
    // the MonthCell the caller already built; the shared mapper's own callers
    // both compute it from the same hoursFacts read, so it is never a second,
    // less-informed answer.
    closed: c.closed,
    // The cell's own capacity fact, keyed by the same id the cell carries. A
    // padding cell has none and takes the no-capacity defaults — it renders no
    // numbers either way.
    ...capacityRowFields(opts.facts?.get(c.id)),
  }))
}

export function appointmentsToMonthCells(
  appointments: Appointment[],
  monthStart: Date,
  monthEnd: Date,
  today: Date,
  /** That day's resolved hours, keyed by JST YYYY-MM-DD — the same map the
   *  week adapter above reads its own `closed` from (resolveWindowHours).
   *  Absent = no cell is closed, today's behaviour. */
  hoursFacts: ReadonlyMap<string, DayHoursFact> | undefined,
  weekStart: WeekStart,
): MonthCell[] {
  const buckets = new Map<string, number>()
  // Same guard as the week adapter above: ONE 件 definition, so a month cell
  // and its week row can never disagree about the same day.
  for (const a of appointments) {
    if (!isCountedBooking(a)) continue
    const key = isoDay(new Date(a.starts_at))
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  // Align the grid with the locale-derived week start (JS Sunday = 0).
  // Pull weekday in JST so the leading-padding count is correct when the
  // server is UTC and monthStart is a JST midnight UTC instant.
  const monthStartParts = partsInJst(monthStart)
  const leading = (monthStartParts.weekday - weekStart + 7) % 7
  const gridStart = new Date(monthStart)
  gridStart.setDate(gridStart.getDate() - leading)

  const monthEndParts = partsInJst(monthEnd)
  const endIndex = (monthEndParts.weekday - weekStart + 7) % 7
  const trailing = 6 - endIndex
  const gridEnd = new Date(monthEnd)
  gridEnd.setDate(gridEnd.getDate() + trailing)

  const cells: MonthCell[] = []
  const cursor = new Date(gridStart)
  while (cursor <= gridEnd) {
    const key = isoDay(cursor)
    const count = buckets.get(key) ?? 0
    const cp = partsInJst(cursor)
    const inMonth =
      cp.month === monthStartParts.month && cp.year === monthStartParts.year
    cells.push({
      id: key,
      date: new Date(cursor),
      inMonth,
      isToday: sameYMD(cursor, today),
      count: inMonth ? count : 0,
      density: inMonth ? densityFor(count) : 'empty',
      // R2-5 (LENS-1 #5) — out-of-month cells ARE tappable (onPickOtherMonthDay
      // → navigateTo('month', …) moves the page to their real month), so
      // "inert" is stale. The reason `closed` is forced false here still
      // holds: this window's `hoursFacts` was never fetched for a day outside
      // the month it read, so that day's closed state is not a fact this
      // read can answer — never claim it either way.
      closed: inMonth ? (hoursFacts?.get(key)?.closed ?? false) : false,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return cells
}
