import type { AppointmentRow } from '@/actions/appointments'
import type { StaffMember } from '@/lib/staff'
import { getStaffColor, type StaffColorKey } from '@/lib/staff-colors'

// ---------------------------------------------------------------------------
// Adapter: AppointmentRow -> ReservationView for the reservation UI.
//
// Display-status mapping (5 states):
//   COMPLETED, CANCELLED          -> 'completed'  (inactive — greyed out)
//   IN_PROGRESS or now ∈ [s, e]   -> 'in_session' (explicit signal beats time)
//   end < now                     -> 'completed'
//   source !== MANUAL             -> 'pending'    (externally synced, not yet
//                                                  confirmed by staff)
//   isFirstTimeCustomer === true  -> 'new'        (first-ever appointment for
//                                                  this customer at this salon)
//   else                          -> 'booked'
//
// "Pending" and "new" are derived signals — no extra columns required:
// • pending: every Appointment carries a `source` enum from synqed-core, so
//   QUICKRESERVE/SALON_BOARD/etc. surface as pending until staff acts on them.
// • new: derived from past-appointment count (NOT karute count). A customer
//   who's been in 5 times without us recording karute is still NOT new —
//   they exist in the customer list. Previously this used karute count which
//   meant every existing customer showed as 新規 until we recorded their first
//   karute. Liam hit this — the live Vercel preview rendered all bookings as
//   新規 even for customers already in his list.
//
// Precedence: terminal > in-session > time-completed > pending > new > booked.
// A first-time customer whose booking also came from QuickReserve renders as
// "pending" because confirming the appointment is the more urgent action.
// ---------------------------------------------------------------------------

export type DisplayStatus =
  | 'booked'
  | 'in_session'
  | 'completed'
  | 'new'
  | 'pending'

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
  // Future SCHEDULED bookings get a finer-grained label.
  if (row.source !== 'MANUAL') return 'pending'
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
    const isFirstTimeCustomer = isFirstTimeByClient.get(r.client_id) ?? false
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
    }
  })
}
