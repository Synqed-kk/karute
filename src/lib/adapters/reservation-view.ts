import type { AppointmentRow } from '@/actions/appointments'
import type { StaffMember } from '@/lib/staff'
import { getStaffColor, type StaffColorKey } from '@/lib/staff-colors'

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
  service: string
  displayStatus: DisplayStatus
  staffColorKey: StaffColorKey
  /** ID of the customer, used to route follow-up actions (memory, new karute). */
  clientId: string
  /** Set when a karute_record already exists for this appointment. */
  karuteRecordId: string | null
  /** Derived from past-appointment count — drives "first-time" copy in the
   *  action sheet AND the 'new' displayStatus. True only when this is the
   *  customer's first-ever appointment at this salon. */
  isFirstTimeVisit: boolean
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
  if (row.synqed_status === 'COMPLETED' || row.synqed_status === 'CANCELLED') return 'completed'
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
): ReservationView[] {
  const staffNameById = new Map<string, string>()
  for (const s of staffList) {
    if (s.full_name) staffNameById.set(s.id, s.full_name)
  }
  return rows.map((r) => {
    const customerName = r.customers?.name ?? '—'
    // A 回数券 (multi-session ticket) booking means an established returning
    // customer — never 新規 — even when the QuickReserve existing-customer flag
    // or karute history hasn't synced. The course title carries it reliably
    // ("10回券", "6回券", "6回券終了"). Without this, every ticket regular on the
    // agenda wrongly read 新規 because their past visits aren't in synqed yet.
    const holdsTicketPack = /回数?券/.test(r.title ?? '')
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
      // Empty string when no title set — the agenda row hides the service
      // line rather than printing a generic 'セッション' fallback that read
      // as misleading copy on Liam's preview (every row said "セッション").
      // The left time column already shows duration prominently.
      service: r.title ?? '',
      displayStatus: computeDisplayStatus(r, now, { isFirstTimeCustomer }),
      staffColorKey: getStaffColor(r.staff_profile_id).key,
      clientId: r.client_id,
      karuteRecordId: r.karute_record_id,
      isFirstTimeVisit: isFirstTimeCustomer,
      // Finished-pack signal from the QR course title (e.g. "6回券終了") → 更新案内.
      needsRenewal: (r.title ?? '').includes('終了'),
    }
  })
}
