import { createClient } from '@/lib/supabase/server'
import { getActiveStaffId } from '@/lib/staff'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getCustomerConsent } from '@/actions/customers'
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
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
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
  const supabase = await createClient()

  const [customers, activeStaffId] = await Promise.all([
    getCachedCustomerList(),
    getActiveStaffId(),
  ])

  // Next unlinked appointment for this staff (used as recording target)
  let nextAppointment: {
    id: string
    customerName: string
    customerId: string
    startTime: string
    durationMinutes: number
    title: string | null
    notes: string | null
  } | null = null

  // Nearby bookings (today, around the target time) — fed into the target card switcher
  let nearbyBookings: RecordTargetBooking[] = []

  if (activeStaffId) {
    const now = new Date()
    const windowStart = new Date(now.getTime() - 12 * 60 * 60 * 1000)
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: appointments } = await (supabase as any)
      .from('appointments')
      .select('id, start_time, duration_minutes, client_id, title, notes, status, customers:client_id ( name )')
      .eq('staff_profile_id', activeStaffId)
      .gte('start_time', windowStart.toISOString())
      .lte('start_time', windowEnd.toISOString())
      .order('start_time', { ascending: true })
      .limit(10)

    type ApptRow = {
      id: string
      start_time: string
      duration_minutes: number
      client_id: string
      title: string | null
      notes: string | null
      status: string | null
      customers: { name: string } | null
      karute_record_id?: string | null
    }
    const list = (appointments ?? []) as ApptRow[]

    const unlinked = list.find((a) => !a.karute_record_id)
    if (unlinked) {
      nextAppointment = {
        id: unlinked.id,
        customerName: unlinked.customers?.name ?? 'Unknown',
        customerId: unlinked.client_id,
        startTime: unlinked.start_time,
        durationMinutes: unlinked.duration_minutes,
        title: unlinked.title ?? null,
        notes: unlinked.notes ?? null,
      }
    }

    nearbyBookings = list.slice(0, 6).map((a) => {
      const start = new Date(a.start_time)
      const end = new Date(start.getTime() + a.duration_minutes * 60_000)
      const isCurrent = nextAppointment && a.id === nextAppointment.id
      const statusKey: RecordTargetBooking['statusKey'] = isCurrent
        ? 'in-session'
        : a.status === 'COMPLETED'
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
        staff: '—',
        statusKey,
        statusLabel: isCurrent ? 'In session' : a.status === 'COMPLETED' ? 'Done' : 'Booked',
      }
    })
  }

  // Recent karute_records (act as the "recent recordings" list)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recentRows } = await (supabase as any)
    .from('karute_records')
    .select(
      `id, session_date, created_at, summary, transcript, customers:client_id ( name ), entries ( id )`,
    )
    .order('session_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(5)

  type RecentRow = {
    id: string
    session_date: string | null
    created_at: string
    summary: string | null
    transcript: string | null
    customers: { name: string } | null
    entries: Array<{ id: string }> | null
  }

  const recentRecordings: RecentRecording[] = ((recentRows ?? []) as RecentRow[]).map((r) => {
    const dt = new Date(r.session_date ?? r.created_at)
    const customerName = r.customers?.name ?? 'Unknown'
    const entryCount = Array.isArray(r.entries) ? r.entries.length : 0
    return {
      id: r.id,
      customerName,
      initials: deriveInitials(customerName),
      karuteNumber: deriveKaruteNumber(r.id),
      service: 'Session',
      date: dt.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      startTime: hhmm(dt),
      durationLabel: durationLabel(0), // duration is not stored on karute_records; placeholder
      karuteLinked: !!r.summary,
      entryCount,
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
          { year: 'numeric', month: 'short', day: 'numeric' },
        )
      }
    } catch {
      // ignore — pill simply doesn't render
    }
  }

  return (
    <RecordPageView
      customers={customers}
      locale={locale}
      nextAppointment={nextAppointment}
      nearbyBookings={nearbyBookings}
      brief={null}
      recentRecordings={recentRecordings}
      consentDate={consentDate}
    />
  )
}
