import { getCachedCustomerList } from '@/lib/customers/cached'
import { getStaffList } from '@/lib/staff'
import { getActiveStaffId } from '@/lib/active-staff'
import { getCustomerConsent } from '@/actions/customers'
import { getAppointmentsByDate } from '@/actions/appointments'
import { getSynqedClient } from '@/lib/synqed/client'
import { jstStartOfToday, ymdInJst } from '@/lib/date/jst'
import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'
import type { RecordTargetBooking } from '@/components/karute/redesign/record/RecordingTargetCard'
import type { RecentRecording } from '@/components/karute/redesign/record/RecentRecordingsCard'

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function hhmm(d: Date): string {
  // Always render in JST — Vercel server is UTC, so .getHours() would
  // otherwise show UTC hours on the recording-target pill.
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
}
function deriveKaruteNumber(id: string): string {
  const hex = id.replace(/-/g, '').slice(0, 5).toUpperCase()
  return `#${hex}`
}

function durationLabel(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m} min ${pad2(s)} sec`
}

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  const today = jstStartOfToday()
  const todayStr = ymdInJst(today)

  // Fan out all independent reads in parallel
  const [customers, staffList, todays, karuteRes, activeStaffId] = await Promise.all([
    getCachedCustomerList(),
    getStaffList(),
    getAppointmentsByDate(todayStr),
    getSynqedClient().then((c) => c.karuteRecords.list({ page_size: 5 })),
    getActiveStaffId(),
  ])

  const nameById = new Map(staffList.map((s) => [s.id, s.full_name ?? '—']))
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]))

  // Active booking: happening right now, not cancelled, not already linked to a karute
  const now = Date.now()
  const activeBookings = todays.filter((a) => {
    const start = new Date(a.start_time).getTime()
    const end = start + a.duration_minutes * 60_000
    return now >= start && now <= end && a.synqed_status !== 'CANCELLED' && !a.karute_record_id
  })

  const activeBooking = activeBookings[0] ?? null

  const nextAppointment: {
    id: string
    customerName: string
    customerId: string
    startTime: string
    durationMinutes: number
    title: string | null
    notes: string | null
    staffId: string
    staffName: string
  } | null = activeBooking
    ? {
        id: activeBooking.id,
        customerName: activeBooking.customers?.name ?? 'Unknown',
        customerId: activeBooking.client_id,
        startTime: activeBooking.start_time,
        durationMinutes: activeBooking.duration_minutes,
        title: activeBooking.title ?? null,
        notes: activeBooking.notes ?? null,
        staffId: activeBooking.staff_profile_id,
        staffName: nameById.get(activeBooking.staff_profile_id) ?? '—',
      }
    : null

  // Build nearby bookings from today's full list
  const nearbyBookings: RecordTargetBooking[] = todays.slice(0, 6).map((a) => {
    const start = new Date(a.start_time)
    const end = new Date(start.getTime() + a.duration_minutes * 60_000)
    const isActive = nextAppointment && a.id === nextAppointment.id
    const isDone = !!a.karute_record_id && !isActive
    const statusKey: RecordTargetBooking['statusKey'] = isActive
      ? 'in-session'
      : isDone
        ? 'done'
        : 'booked'
    const customerName = a.customers?.name ?? 'Unknown'
    return {
      id: a.id,
      start: hhmm(start),
      end: hhmm(end),
      customer: customerName,
      initials: deriveInitials(customerName),
      karute: null,
      service: a.title ?? 'Session',
      staff: nameById.get(a.staff_profile_id) ?? '—',
      statusKey,
      statusLabel: isActive ? 'In session' : isDone ? 'Done' : 'Booked',
    }
  })

  // Build recent recordings from synqed karute_records
  const recentRecordings: RecentRecording[] = karuteRes.karute_records.map((r) => {
    const dt = new Date(r.created_at)
    const customerName = r.customer_id ? (customerNameById.get(r.customer_id) ?? 'Unknown') : 'Unknown'
    return {
      id: r.id,
      customerName,
      initials: deriveInitials(customerName),
      karuteNumber: deriveKaruteNumber(r.id),
      service: 'Session',
      date: dt.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      startTime: hhmm(dt),
      durationLabel: durationLabel(0), // duration is not stored on karute_records; placeholder
      karuteLinked: !!r.ai_summary,
      entryCount: r.entry_count ?? 0,
      karuteId: r.id,
    }
  })

  // Consent on file (pretty date) — for the consent pill
  let consentDate: string | null = null
  if (nextAppointment?.customerId) {
    try {
      const { consent } = await getCustomerConsent(nextAppointment.customerId)
      if (consent?.granted_at) {
        consentDate = new Date(consent.granted_at).toLocaleDateString(
          locale === 'ja' ? 'ja-JP' : 'en-US',
          { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' },
        )
      }
    } catch {
      // ignore — pill simply doesn't render
    }
  }

  const staffRoster = staffList.map((s) => ({ id: s.id, name: s.full_name ?? '—' }))
  const bookingTargets = todays.map((a) => ({
    id: a.id,
    customerId: a.client_id,
    customerName: a.customers?.name ?? 'Unknown',
    staffId: a.staff_profile_id,
    staffName: nameById.get(a.staff_profile_id) ?? '—',
  }))

  return (
    <RecordPageView
      customers={customers}
      locale={locale}
      nextAppointment={nextAppointment}
      nearbyBookings={nearbyBookings}
      brief={null}
      recentRecordings={recentRecordings}
      consentDate={consentDate}
      staffRoster={staffRoster}
      bookingTargets={bookingTargets}
      defaultStaffId={activeStaffId}
    />
  )
}
