// ─────────────────────────────────────────────────────────────
// Next-customer lookup — feeds the bottom-nav mic button label
// ─────────────────────────────────────────────────────────────
// Returns the customer the signed-in staff member should record
// next, so the bottom-nav center button can surface their name
// instead of the generic 「予約を選択」 placeholder.
//
// Priority (mirrors the spike's `useActiveRecordingTarget`):
//   1. In-session — booking started AND not ended AND no karute
//      attached. This is the "you're recording NOW" case.
//   2. Nearest upcoming — first booking after now, still
//      unrecorded.
//   3. null — staff has nothing to record. Bottom-nav falls back
//      to the spike's 「予約を選択」 empty-state copy.
//
// SCOPED TO THE SIGNED-IN STAFF — unlike sessions/page.tsx which
// falls back to ANY salon booking. If staff need to record someone
// else's booking they pick from 別の予約を選択 on the record page.
//
// DATA SOURCE: today's bookings come from synqed-core (the live
// appointments store) via getAppointmentsByDate, which already
// translates synqed staff_id → Supabase profile id so the staff
// scoping matches getCurrentUserStaffId(). This previously read the
// legacy Supabase `appointments` table — but manual bookings now
// write to synqed-core, so that table is empty and the label was
// stuck on 「予約を選択」. Today-scoped (JST): a salon's "next
// customer" is within the working day; cross-midnight bookings are
// out of scope by design.

import { getCurrentUserStaffId } from '@/lib/staff'
import type { AppointmentRow } from '@/actions/appointments'

export interface NextCustomerInfo {
  customerId: string
  customerName: string
  /** ISO timestamp of the booking start. */
  startTime: string
  /** Drives the bottom-nav hint copy + (later) icon swap. */
  reason: 'in-session' | 'upcoming'
  /** Signed minutes from now to booking start.
   *  Positive = upcoming, negative = already started. */
  minutesFromNow: number
}

/** YYYY-MM-DD for "today" in Asia/Tokyo (karute is JST-only). */
function jstTodayString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Returns the next-customer info for the signed-in staff, or
 *  null if there's nothing to record or no staff identity. */
export async function getNextCustomer(): Promise<NextCustomerInfo | null> {
  const staffId = await getCurrentUserStaffId().catch(() => null)
  if (!staffId) return null

  // Lazy import keeps the synqed-core ESM client out of any caller/test
  // that never reaches this path.
  const { getAppointmentsByDate } = await import('@/actions/appointments')
  const appts = await getAppointmentsByDate(jstTodayString()).catch(
    () => [] as AppointmentRow[],
  )

  const mine = appts.filter((a) => a.staff_profile_id === staffId)
  const nowMs = Date.now()

  const toInfo = (
    a: AppointmentRow,
    reason: NextCustomerInfo['reason'],
  ): NextCustomerInfo => ({
    customerId: a.client_id,
    customerName: a.customers?.name ?? 'Unknown',
    startTime: a.start_time,
    reason,
    minutesFromNow: Math.round(
      (new Date(a.start_time).getTime() - nowMs) / 60_000,
    ),
  })

  // 1. In-session — started, not ended, no karute attached.
  const inSession = mine.find((a) => {
    if (a.karute_record_id) return false
    const startMs = new Date(a.start_time).getTime()
    const endMs = startMs + a.duration_minutes * 60_000
    return startMs <= nowMs && nowMs < endMs
  })
  if (inSession) return toInfo(inSession, 'in-session')

  // 2. Nearest upcoming — earliest start after now, still unrecorded.
  const upcoming = mine
    .filter(
      (a) => !a.karute_record_id && new Date(a.start_time).getTime() > nowMs,
    )
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    )[0]
  if (upcoming) return toInfo(upcoming, 'upcoming')

  return null
}
