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
//   visitCount === 0              -> 'new'        (first-time customer)
//   else                          -> 'booked'
//
// "Pending" and "new" are derived signals — no extra columns required:
// • pending: every Appointment carries a `source` enum from synqed-core, so
//   QUICKRESERVE/SALON_BOARD/etc. surface as pending until staff acts on them.
// • new: visit count is computed once per page from `karute_records` via
//   `enrichCustomers`, then passed in here keyed by client_id.
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
  /** Derived from visit count — drives "first-time" copy in the action sheet. */
  isFirstTimeVisit: boolean
}

function hm(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
  /** Past karute count for this client. 0 → first-time customer (=> 'new'). */
  visitCount?: number
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
  if (opts.visitCount === 0) return 'new'
  return 'booked'
}

export function appointmentsToReservationViews(
  rows: AppointmentRow[],
  _staffList: StaffMember[],
  now: Date,
  visitCountByClient: Map<string, number> = new Map(),
): ReservationView[] {
  return rows.map((r) => {
    const customerName = r.customers?.name ?? '—'
    const visitCount = visitCountByClient.get(r.client_id)
    return {
      id: r.id,
      staffId: r.staff_profile_id,
      startTimeHm: hm(r.start_time),
      durationMin: r.duration_minutes,
      customerName,
      customerInitials: initialsOf(customerName),
      service: r.title ?? 'セッション',
      displayStatus: computeDisplayStatus(r, now, { visitCount }),
      staffColorKey: getStaffColor(r.staff_profile_id).key,
      clientId: r.client_id,
      karuteRecordId: r.karute_record_id,
      isFirstTimeVisit: visitCount === 0,
    }
  })
}
