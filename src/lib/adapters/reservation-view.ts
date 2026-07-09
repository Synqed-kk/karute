import type { AppointmentRow } from '@/actions/appointments'
import type { StaffMember } from '@/lib/staff'
import { assignStaffColors, type StaffColorKey } from '@/lib/staff-colors'
import { isTerminalStatus } from '@/lib/appointments/status'

// ---------------------------------------------------------------------------
// Adapter: AppointmentRow -> ReservationView for the reservation UI.
//
// Display-status mapping (4 states):
//   COMPLETED, CANCELLED          -> 'completed'  (inactive — greyed out)
//   IN_PROGRESS or now ∈ [s, e]   -> 'in_session' (explicit signal beats time)
//   end < now                     -> 'completed'
//   isFirstTimeCustomer === true  -> 'new'        (genuine first visit ONLY)
//   else                          -> 'booked'
//
// 'new' (新規) is STRICT — a true first-timer, NOT "no karute yet." The page
// derives isFirstTimeCustomer as: not a known QR customer AND no past appointment
// AND no karute. A 回数券 holder / returning QR customer is never 新規. (We removed
// the old 'pending' state: it just meant "synced from QuickReserve," meaningless
// to staff — a synced booking is simply a confirmed 予約済.)
//
// `needsRenewal` is a separate action FLAG (not a status): true when the course
// title marks a finished pack (e.g. "6回券終了") → prompt a renewal/re-sell.
//
// Precedence: terminal > in-session > time-completed > new > booked.
// ---------------------------------------------------------------------------

export type DisplayStatus =
  | 'booked'
  | 'in_session'
  | 'completed'
  | 'new'

export interface ReservationView {
  id: string
  staffId: string
  /** Display name of the assigned staff — populated from the staff list at
   *  adapter time so the mobile agenda row can render "担当 {name}" without
   *  re-looking it up. Empty string when the staff record is missing. */
  staffName: string
  startTimeHm: string
  durationMin: number
  customerName: string
  customerInitials: string
  /** Sequential salon karute number ("#00139") — the SAME value the 顧客 list +
   *  customer profile show, so the agenda row matches every other surface.
   *  null when the caller doesn't supply the number map. */
  karuteNumber: string | null
  service: string
  displayStatus: DisplayStatus
  /** Raw CANCELLED from synqed — displayStatus maps it to 'completed' for
   *  dimming, but a cancelled booking must stay distinguishable (strikethrough
   *  time): the slot is FREE, a finished session is not. */
  isCancelled: boolean
  /** Raw NO_SHOW from synqed (synqed-core #39) — a terminal booking like
   *  isCancelled, but must render as a DISTINCT 無断キャンセル tombstone
   *  (warning tint) instead of the grey キャンセル済み one. */
  isNoShow: boolean
  /** status_reason from core, for CANCELLED/NO_SHOW rows — the no-show
   *  sheet's restore mode shows it. null for active rows or when absent. */
  statusReason: string | null
  staffColorKey: StaffColorKey | 'neutral'
  /** ID of the customer, used to route follow-up actions (memory, new karute). */
  clientId: string
  /** Set when a karute_record already exists for this appointment. */
  karuteRecordId: string | null
  /** Derived from past-appointment count — drives "first-time" copy in the
   *  action sheet AND the 'new' displayStatus. True only when this is the
   *  customer's first-ever appointment at this salon. */
  isFirstTimeVisit: boolean
  /** Live 回数券 usage for this CUSTOMER (active counted packs, from the pack
   *  store) — the 残3/10 pill next to the course title. null when the customer
   *  holds no active pack or the caller didn't supply the map. Single source:
   *  the same bulk read the 顧客 list uses, so the numbers always agree. */
  pack: { remaining: number; size: number } | null
  /** Action flag (not a status): the booking's course marks a finished ticket
   *  pack (e.g. "6回券終了") → prompt a renewal/re-sell. Drives the 更新案内 chip. */
  needsRenewal: boolean
}

function hm(iso: string): string {
  // JST: the grid positions bookings by startTimeHm, so a UTC-rendered value
  // on the Vercel server would place an 11:30 JST booking at "02:30" — before
  // business hours, and clipped out of view entirely.
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '—'
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const first = seg.segment(trimmed)[Symbol.iterator]().next().value as
    | { segment?: string }
    | undefined
  return first?.segment ?? trimmed[0] ?? '—'
}

export interface DisplayStatusOptions {
  /** True only when this booking is the customer's first-ever appointment at
   *  this salon. Drives the 'new' (新規) status. NOT the same as "no karute
   *  recorded yet" — see header comment. */
  isFirstTimeCustomer?: boolean
}

export function computeDisplayStatus(
  row: AppointmentRow,
  now: Date,
  opts: DisplayStatusOptions = {},
): DisplayStatus {
  if (row.synqed_status === 'COMPLETED' || isTerminalStatus(row.synqed_status)) return 'completed'
  if (row.synqed_status === 'IN_PROGRESS') return 'in_session'
  const start = new Date(row.start_time).getTime()
  const end = start + row.duration_minutes * 60_000
  if (now.getTime() > end) return 'completed'
  if (now.getTime() >= start) return 'in_session'
  // Future bookings: 新規 only for genuine first-timers; everyone else is 予約済.
  // (We no longer mark synced-from-QR bookings 'pending' — that distinction is
  // meaningless to staff; a synced booking is just a confirmed 予約済.)
  if (opts.isFirstTimeCustomer === true) return 'new'
  return 'booked'
}

export function appointmentsToReservationViews(
  rows: AppointmentRow[],
  staffList: StaffMember[],
  now: Date,
  isFirstTimeByClient: Map<string, boolean> = new Map(),
  karuteNumberByClientId: ReadonlyMap<string, string> = new Map(),
  packUsageByClient: ReadonlyMap<
    string,
    { remaining: number; size: number }
  > = new Map(),
): ReservationView[] {
  const staffNameById = new Map<string, string>()
  for (const s of staffList) {
    if (s.full_name) staffNameById.set(s.id, s.full_name)
  }
  // Distinct color per staff over the FULL roster (sorted-index assignment, no
  // collisions). Computed once here so every reservation surface that reads
  // `staffColorKey` off the view agrees on the mapping.
  const staffColors = assignStaffColors(staffList.map((s) => s.id))
  return rows.map((r) => {
    const customerName = r.customers?.name ?? '—'
    // REAL pack data first (the ticket_packs ledger, same source as the 顧客
    // list/profile — chopstick), course-title string only as the fallback for
    // customers with no ledger entry yet (pre-migration / pre-import).
    const packUsage = packUsageByClient.get(r.client_id) ?? null
    // A 回数券 (multi-session ticket) holder is an established returning
    // customer — never 新規 — even when the QuickReserve existing-customer flag
    // or karute history hasn't synced. Ledger entry decides; title regex
    // ("10回券", "6回券終了") only covers un-imported customers.
    const holdsTicketPack = packUsage !== null || /回数?券/.test(r.title ?? '')
    const isFirstTimeCustomer =
      (isFirstTimeByClient.get(r.client_id) ?? false) && !holdsTicketPack
    return {
      id: r.id,
      staffId: r.staff_profile_id,
      staffName: staffNameById.get(r.staff_profile_id) ?? '',
      startTimeHm: hm(r.start_time),
      durationMin: r.duration_minutes,
      customerName,
      customerInitials: initialsOf(customerName),
      karuteNumber: karuteNumberByClientId.get(r.client_id) ?? null,
      // Empty string when no title set — the agenda row hides the service
      // line rather than printing a generic 'セッション' fallback that read
      // as misleading copy on Liam's preview (every row said "セッション").
      // The left time column already shows duration prominently.
      service: r.title ?? '',
      displayStatus: computeDisplayStatus(r, now, { isFirstTimeCustomer }),
      isCancelled: r.synqed_status === 'CANCELLED',
      isNoShow: r.synqed_status === 'NO_SHOW',
      statusReason: r.status_reason,
      staffColorKey: staffColors.get(r.staff_profile_id)?.key ?? 'neutral',
      clientId: r.client_id,
      karuteRecordId: r.karute_record_id,
      isFirstTimeVisit: isFirstTimeCustomer,
      // 更新案内 (renewal prompt): the LEDGER decides when it exists — remaining
      // 0 means the pack is genuinely used up. The QR title's "終了" marker is
      // only trusted for customers with no ledger entry (pre-import).
      needsRenewal: packUsage
        ? packUsage.remaining === 0
        : (r.title ?? '').includes('終了'),
      pack: packUsage,
    }
  })
}
