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
// SCOPED TO THE SIGNED-IN STAFF — unlike sessions/page.tsx
// which falls back to ANY salon booking (cover-a-colleague /
// walk-in handoff), the bottom-nav label is YOUR-next-customer.
// If staff need to record someone else's booking they pick from
// the 別の予約を選択 dropdown on the record page itself.
//
// ANTHONY: the appointments query here uses `staff_profile_id`
// + `client_id` (matches the existing sessions/page.tsx pattern).
// If you renamed those columns as part of the karute_records
// schema-drift fix, update this file too — it's a single SELECT.

import { createClient } from '@/lib/supabase/server'
import { getActiveStaffId } from '@/lib/active-staff'

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

/** Returns the next-customer info for the signed-in staff, or
 *  null if there's nothing in the window or no staff identity. */
export async function getNextCustomer(): Promise<NextCustomerInfo | null> {
  const staffId = await getActiveStaffId().catch(() => null)
  if (!staffId) return null

  const supabase = await createClient()
  const now = new Date()
  // ±window: -4h covers a booking that's running long (started a
  // few hours ago but not yet attached to a karute), +12h covers
  // the rest of the working day for the upcoming pick.
  const windowStart = new Date(now.getTime() - 4 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 12 * 60 * 60 * 1000)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('appointments')
    .select(
      'id, start_time, duration_minutes, client_id, staff_profile_id, karute_record_id, customers:client_id ( name )',
    )
    .eq('staff_profile_id', staffId)
    .gte('start_time', windowStart.toISOString())
    .lte('start_time', windowEnd.toISOString())
    .order('start_time', { ascending: true })
    .limit(20)

  type ApptRow = {
    id: string
    start_time: string
    duration_minutes: number
    client_id: string
    staff_profile_id: string | null
    karute_record_id?: string | null
    customers: { name: string } | null
  }

  const list = (data ?? []) as ApptRow[]
  const nowMs = now.getTime()

  // 1. In-session — started, not ended, no karute.
  const inSession = list.find((a) => {
    if (a.karute_record_id) return false
    const startMs = new Date(a.start_time).getTime()
    const endMs = startMs + a.duration_minutes * 60_000
    return startMs <= nowMs && nowMs < endMs
  })
  if (inSession) {
    const startMs = new Date(inSession.start_time).getTime()
    return {
      customerId: inSession.client_id,
      customerName: inSession.customers?.name ?? 'Unknown',
      startTime: inSession.start_time,
      reason: 'in-session',
      minutesFromNow: Math.round((startMs - nowMs) / 60_000),
    }
  }

  // 2. Nearest upcoming — first row after now, still unrecorded.
  const upcoming = list.find((a) => {
    if (a.karute_record_id) return false
    const startMs = new Date(a.start_time).getTime()
    return startMs > nowMs
  })
  if (upcoming) {
    const startMs = new Date(upcoming.start_time).getTime()
    return {
      customerId: upcoming.client_id,
      customerName: upcoming.customers?.name ?? 'Unknown',
      startTime: upcoming.start_time,
      reason: 'upcoming',
      minutesFromNow: Math.round((startMs - nowMs) / 60_000),
    }
  }

  return null
}
