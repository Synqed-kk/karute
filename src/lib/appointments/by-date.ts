// Shared today's-bookings assembly (packet 08 §Build 2). The row-mapping the web
// `getAppointmentsByDate` inlined, factored onto an EXPLICIT business-scoped
// client + an injected customer-name source so the facade record-screen GET
// reproduces today's recording-target set without the cookie helpers. The web
// action delegates here (byte-identical output); it keeps owning the cookie
// store-scope + cached-name resolution and passes them in.

import { isTerminalStatus } from '@/lib/appointments/status'
import type { Appointment, SynqedClient } from '@synqed-kk/client'
import type { AppointmentRow } from '@/actions/appointments'

type ByDateClient = Pick<SynqedClient, 'appointments' | 'karuteRecords' | 'staff'>

/**
 * Fetch + map one JST calendar day's bookings to AppointmentRow[] on the given
 * client. `nameById` is the caller's customer-name source (web: the cached list;
 * facade: listAllCustomers). Terminal (CANCELLED/NO_SHOW) rows are dropped unless
 * `includeCancelled` — the recording-target picker must never auto-select one.
 *
 * BLOCK rows never come back: a capacity hold is not a visit (isCountedBooking's
 * first clause, one rule). A booking with NO staff_id still does not come back
 * either — this list draws lanes, and a lane needs a staffer. That is the one
 * place the day list and the 件 count deliberately differ, and it is pinned in
 * booking-count-parity.test.ts.
 */
export async function getAppointmentsByDateWithClient(
  synqed: ByDateClient,
  dateStr: string,
  opts: {
    storeId?: string
    nameById: Map<string, string>
    includeCancelled?: boolean
  },
): Promise<AppointmentRow[]> {
  const dayStartUTC = new Date(`${dateStr}T00:00:00+09:00`)
  const dayEndUTC = new Date(`${dateStr}T23:59:59.999+09:00`)
  const { storeId, nameById, includeCancelled } = opts

  // These three reads are independent. Keeping appointments in front of the
  // enrichment reads made every day view pay two network round trips even
  // though neither enrichment query depends on the booking list.
  const [list, karuteList, staffList] = await Promise.all([
    synqed.appointments.list({
      from: dayStartUTC.toISOString(),
      to: dayEndUTC.toISOString(),
      page_size: 200,
      store_id: storeId ?? undefined,
    }),
    synqed.karuteRecords.list({
      from: dayStartUTC.toISOString(),
      to: dayEndUTC.toISOString(),
      page_size: 200,
      store_id: storeId ?? undefined,
    }),
    synqed.staff.list({ page_size: 200 }),
  ])

  const karuteByAppointment = new Map<string, string>()
  for (const k of karuteList.karute_records) {
    if (k.appointment_id) karuteByAppointment.set(k.appointment_id, k.id)
  }
  const profileByStaffId = new Map(
    staffList.staff
      .filter((s): s is typeof s & { user_id: string } => s.user_id != null)
      .map((s) => [s.id, s.user_id]),
  )
  const nameByStaffId = new Map(staffList.staff.map((s) => [s.id, s.name]))

  return list.appointments
    .filter((a): a is typeof a & { staff_id: string; customer_id: string } =>
      // `kind` is the guard every day surface was missing. AppointmentRow has
      // no kind field, so a BLOCK hold (「オーナー業務」) that happens to carry a
      // customer rendered as an ordinary visit here — on the agenda, in the
      // recorder's booking picker and on the phone — and pushed
      // 「本日の予約 N件」 one above the week row's 件 for the same day (L4-3).
      // One guard in the function every day caller routes through.
      (a.kind ?? 'BOOKING') === 'BOOKING' &&
      a.staff_id != null && a.customer_id != null &&
      (includeCancelled ? true : !isTerminalStatus(a.status)))
    .map((a) => {
      const statusSetBy =
        (a as typeof a & { status_set_by?: string | null }).status_set_by ?? null
      return {
        id: a.id,
        staff_profile_id: profileByStaffId.get(a.staff_id) ?? a.staff_id,
        client_id: a.customer_id,
        start_time: a.starts_at,
        duration_minutes: a.duration_minutes ?? 0,
        title: a.title,
        notes: a.notes,
        karute_record_id: karuteByAppointment.get(a.id) ?? null,
        created_at: a.created_at,
        customers: nameById.has(a.customer_id)
          ? { name: nameById.get(a.customer_id)! }
          : null,
        synqed_status: a.status,
        source: a.source,
        status_reason:
          (a as typeof a & { status_reason?: string | null }).status_reason ?? null,
        status_set_by_name: statusSetBy ? nameByStaffId.get(statusSetBy) ?? null : null,
        status_set_at:
          (a as typeof a & { status_set_at?: string | null }).status_set_at ?? null,
      }
    })
}

/** How many pages the week/month window will read before it gives up. 6 × 500
 *  = 3000 bookings across a 45-day window — an order of magnitude past any
 *  real salon month. Past it the window reports `truncated` and drops every
 *  row: a LOW number on a booking screen is a worse lie than a failed read. */
export const MAX_RANGE_PAGES = 6
const RANGE_PAGE_SIZE = 500

/**
 * THE 予約 count predicate — one definition for month cells, week rows, the day
 * total, the month line and the week summary (spec §8). Nothing else re-spells
 * it; the adapter re-applies THIS function rather than repeating the rule.
 *
 *   kind        — a BLOCK row (「オーナー業務」, a bed hold) is capacity, not a
 *                 booking. An absent kind reads as BOOKING (pre-kind rows).
 *   customer_id — a booking with nobody in it is not a visit.
 *   status      — CANCELLED / NO_SHOW are tombstones (isTerminalStatus).
 *
 * Staff is deliberately OPTIONAL: an unassigned booking is still a booking.
 * (The day LIST separately requires a staff_id to draw a lane — a rendering
 * constraint, not a counting one.)
 */
export function isCountedBooking(a: Appointment): boolean {
  return (
    (a.kind ?? 'BOOKING') === 'BOOKING' &&
    a.customer_id != null &&
    !isTerminalStatus(a.status)
  )
}

/** One fetched window, already partitioned by the ONE predicate above.
 *  `truncated` = the window could not be read to exhaustion; every array is
 *  then EMPTY and no number derived from it may render. */
export type AppointmentWindow = {
  counted: Appointment[]
  cancelled: Appointment[]
  noShow: Appointment[]
  truncated: boolean
}

const EMPTY_WINDOW: AppointmentWindow = {
  counted: [],
  cancelled: [],
  noShow: [],
  truncated: false,
}

/** An empty window that is NOT a failure — what a caller passes when the staff
 *  filter names somebody the roster cannot place (zero rows is the honest
 *  answer there; an UNFILTERED window would be the whole salon's day). */
export function emptyAppointmentWindow(): AppointmentWindow {
  return { ...EMPTY_WINDOW, counted: [], cancelled: [], noShow: [] }
}

/**
 * The week/month/day window read: paged to exhaustion against core's `total`
 * (the auto-burn / audit-watch idiom, src/lib/audit-watch/run.ts:130-134) and
 * partitioned by `isCountedBooking`.
 *
 * The old single-page read silently capped at 500 rows, so a busy month simply
 * lost its tail and rendered a plausible-but-low count. This pages instead, and
 * when the cap is genuinely hit it reports `truncated` with EVERY array empty —
 * the caller renders the failed-read state, never a number.
 *
 * `staffId` is the CORE staff id (appointments.staff_id's id space), applied AT
 * THE FETCH so the 担当/自分 filter reaches the week and month numbers instead
 * of only the day list.
 */
export async function fetchAppointmentWindow(
  synqed: Pick<SynqedClient, 'appointments'>,
  fromIso: string,
  toIso: string,
  opts: { storeId?: string; staffId?: string | null } = {},
): Promise<AppointmentWindow> {
  const rows: Appointment[] = []
  let total = 0
  for (let page = 1; page <= MAX_RANGE_PAGES; page++) {
    const res = await synqed.appointments.list({
      from: fromIso,
      to: toIso,
      page,
      page_size: RANGE_PAGE_SIZE,
      store_id: opts.storeId ?? undefined,
      staff_id: opts.staffId ?? undefined,
    })
    total = res.total
    rows.push(...res.appointments)
    if (res.appointments.length === 0 || rows.length >= res.total) break
  }
  // Fewer rows than core says exist = we did not see the whole window, whether
  // the cap stopped us or the pages ran dry early. Either way the counts would
  // be low, so nothing survives.
  if (rows.length < total) return { ...EMPTY_WINDOW, truncated: true }

  const counted: Appointment[] = []
  const cancelled: Appointment[] = []
  const noShow: Appointment[] = []
  for (const a of rows) {
    if (isCountedBooking(a)) {
      counted.push(a)
      continue
    }
    // The terminal partitions are BOOKING rows WITH a customer — a cancelled
    // BLOCK is not a cancellation anybody wants counted. BLOCK rows land in no
    // array at all.
    if ((a.kind ?? 'BOOKING') !== 'BOOKING' || a.customer_id == null) continue
    if (a.status === 'CANCELLED') cancelled.push(a)
    else if (a.status === 'NO_SHOW') noShow.push(a)
  }
  return { counted, cancelled, noShow, truncated: false }
}

/**
 * Range fetch on the given client — the week/month overview's read, factored
 * out of the web `getAppointmentsInRange` action (design-parity P-B) so the
 * facade appointments-screen GET reproduces the same window without the
 * cookie helpers.
 *
 * Now a thin delegate to `fetchAppointmentWindow` above: it returns the
 * COUNTED rows, so BLOCK and customerless rows are dropped alongside the
 * terminal ones, and the window is paged rather than capped at 500. Kept (same
 * signature, same `Promise<Appointment[]>`) because the 予約 date-jump branch's
 * `getMonthCells` calls it and must keep compiling.
 */
export async function getAppointmentsInRangeWithClient(
  synqed: Pick<SynqedClient, 'appointments'>,
  fromIso: string,
  toIso: string,
  opts: { storeId?: string } = {},
): Promise<Appointment[]> {
  return (await fetchAppointmentWindow(synqed, fromIso, toIso, opts)).counted
}
