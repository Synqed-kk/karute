import { getTranslations } from 'next-intl/server'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getStaffList } from '@/lib/staff'
import { getActiveStaffId } from '@/lib/active-staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { getAppointmentsByDate } from '@/actions/appointments'
import { getCustomerConsent } from '@/actions/customers'
import { jstStartOfToday, ymdInJst } from '@/lib/date/jst'
import { deriveFamilyInitials } from '@/lib/customers/identity'
import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'
import type { RecordTargetBooking } from '@/components/karute/redesign/record/RecordingTargetCard'
import type { RecentRecording } from '@/components/karute/redesign/record/RecentRecordingsCard'
import type { PreSessionBrief } from '@/components/karute/redesign/record/PreSessionBriefCard'

function hhmm(d: Date): string {
  // Always render in JST — Vercel server is UTC, so .getHours() would
  // otherwise show UTC hours on the recording-target pill.
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  const today = jstStartOfToday()
  const todayStr = ymdInJst(today)

  // All reads via synqed-core (the source of truth). Today's bookings are NOT
  // filtered by staff — the picker shows the whole day so staff can record a
  // colleague's booking; the DEFAULT target still prefers the active staff's
  // bookings (see priority selection below). Recent karute via the same path
  // as the list + detail pages.
  const [activeStaffId, staffList, customers, todays, recentRes, tStatus] =
    await Promise.all([
      getActiveStaffId(),
      getStaffList(),
      getCachedCustomerList(),
      getAppointmentsByDate(todayStr),
      getSynqedClient().then((c) => c.karuteRecords.list({ page_size: 5 })),
      getTranslations('reservation.status'),
    ])

  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]))

  const now = new Date()
  const nowMs = now.getTime()

  type ApptRow = {
    id: string
    start_time: string
    duration_minutes: number
    client_id: string
    staff_profile_id: string | null
    title: string | null
    notes: string | null
    customers: { name: string } | null
    karute_record_id?: string | null
  }
  const list = (todays ?? []) as unknown as ApptRow[]

  // Default-target priority — prefer the ACTIVE STAFF's bookings first
  // (in-session > upcoming > any unlinked), falling back to ANY booking in
  // the salon so staff can record even when not the assigned stylist.
  const isInSession = (a: ApptRow) => {
    if (a.karute_record_id) return false
    const startMs = new Date(a.start_time).getTime()
    const endMs = startMs + a.duration_minutes * 60_000
    return startMs <= nowMs && nowMs < endMs
  }
  const isUpcoming = (a: ApptRow) =>
    !a.karute_record_id && new Date(a.start_time).getTime() > nowMs
  const isUnlinked = (a: ApptRow) => !a.karute_record_id

  function findFirst(rows: ApptRow[]): ApptRow | undefined {
    return rows.find(isInSession) ?? rows.find(isUpcoming) ?? rows.find(isUnlinked)
  }

  const myRows = activeStaffId
    ? list.filter((a) => a.staff_profile_id === activeStaffId)
    : list
  const unlinked = findFirst(myRows) ?? findFirst(list)

  let nextAppointment:
    | {
        id: string
        customerName: string
        customerId: string
        startTime: string
        durationMinutes: number
        title: string | null
        notes: string | null
        statusKey?: 'in-session' | 'booked' | 'done'
        staffId: string
        staffName: string
      }
    | null = null

  if (unlinked) {
    const startMs = new Date(unlinked.start_time).getTime()
    const endMs = startMs + unlinked.duration_minutes * 60_000
    const statusKey: 'in-session' | 'booked' | 'done' =
      startMs <= nowMs && nowMs < endMs
        ? 'in-session'
        : nowMs < startMs
          ? 'booked'
          : 'done'
    nextAppointment = {
      id: unlinked.id,
      customerName: unlinked.customers?.name ?? 'Unknown',
      customerId: unlinked.client_id,
      startTime: unlinked.start_time,
      durationMinutes: unlinked.duration_minutes,
      title: unlinked.title ?? null,
      notes: unlinked.notes ?? null,
      statusKey,
      staffId: unlinked.staff_profile_id ?? '',
      staffName: unlinked.staff_profile_id
        ? (staffNameById.get(unlinked.staff_profile_id) ?? '—')
        : '—',
    }
  }

  // Picker rows = ALL today's bookings (active-staff first, then the rest).
  const orderedForPicker = [
    ...myRows,
    ...list.filter((a) => !myRows.some((m) => m.id === a.id)),
  ].slice(0, 12)

  const nearbyBookings: RecordTargetBooking[] = orderedForPicker.map((a) => {
    const start = new Date(a.start_time)
    const end = new Date(start.getTime() + a.duration_minutes * 60_000)
    const isCurrent = nextAppointment && a.id === nextAppointment.id
    const isDone = !!a.karute_record_id && !isCurrent
    const inSessionNow = isInSession(a)
    const statusKey: RecordTargetBooking['statusKey'] = inSessionNow
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
      initials: deriveFamilyInitials(customerName),
      karute: null,
      service: a.title ?? '—',
      staff: a.staff_profile_id
        ? (staffNameById.get(a.staff_profile_id) ?? '—')
        : '—',
      statusKey,
      statusLabel: inSessionNow
        ? tStatus('in_session')
        : isDone
          ? tStatus('completed')
          : tStatus('booked'),
    }
  })

  const recentRecordings: RecentRecording[] = recentRes.karute_records.map((r) => {
    const dt = new Date(r.created_at)
    const customerName = r.customer_id
      ? (customerNameById.get(r.customer_id) ?? 'Unknown')
      : 'Unknown'
    return {
      id: r.id,
      customerName,
      initials: deriveFamilyInitials(customerName),
      karuteNumber: null,
      service: '—',
      date: dt.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      startTime: hhmm(dt),
      // Duration label '—' until karute_records has a `duration_minutes` column.
      durationLabel: '—',
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

  // Pre-session brief — derived from the customer's last karute record +
  // reservation memo. Reads through synqed-core (returning-visit recap from
  // entries by category; first-visit framing when no prior karute).
  let brief: PreSessionBrief | null = null
  if (nextAppointment?.customerId) {
    brief = await buildPreSessionBriefFor(
      nextAppointment.customerId,
      nextAppointment.notes,
      now,
      locale,
    )
  }

  const staffRoster = staffList.map((s) => ({ id: s.id, name: s.full_name ?? '—' }))
  const bookingTargets = list.map((a) => ({
    id: a.id,
    customerId: a.client_id,
    customerName: a.customers?.name ?? 'Unknown',
    staffId: a.staff_profile_id ?? '',
    staffName: a.staff_profile_id
      ? (staffNameById.get(a.staff_profile_id) ?? '—')
      : '—',
  }))

  return (
    <RecordPageView
      customers={customers}
      locale={locale}
      nextAppointment={nextAppointment}
      nearbyBookings={nearbyBookings}
      brief={brief}
      recentRecordings={recentRecordings}
      consentDate={consentDate}
      staffRoster={staffRoster}
      bookingTargets={bookingTargets}
      defaultStaffId={activeStaffId}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// Pre-session brief derivation — reads the customer's most recent karute
// record + entries from synqed-core and projects them into PreSessionBrief.
// ANTHONY (function branch): replace with a read from an AI-populated
// `pre_session_briefs` table; the shape returned here is the contract.
// ─────────────────────────────────────────────────────────────
async function buildPreSessionBriefFor(
  customerId: string,
  reservationMemo: string | null,
  now: Date,
  locale: string,
): Promise<PreSessionBrief | null> {
  const synqed = await getSynqedClient()
  const { karute_records } = await synqed.karuteRecords
    .list({ customer_id: customerId, page_size: 1 })
    .catch(() => ({ karute_records: [] }))
  const lastMeta = karute_records[0] ?? null

  // FIRST-VISIT FRAMING — no prior karute.
  if (!lastMeta) {
    return {
      isFirstTimeVisit: true,
      lastVisitDate: '',
      lastVisitAgo: '',
      hooks: [],
      concerns: [],
      lastProduct: null,
      recommendedFocus: null,
      reservationMemo: reservationMemo?.trim() ? reservationMemo : null,
    }
  }

  const last = await synqed.karuteRecords
    .get(lastMeta.id, { include_entries: true })
    .catch(() => null)
  const entries = (last?.entries ?? []).map((e) => ({
    id: e.id,
    category: e.category,
    content: e.content,
  }))

  // Talking-point hooks = preference + lifestyle entries (cap 3).
  const hooks = entries
    .filter((e) => e.category === 'PREFERENCE' || e.category === 'LIFESTYLE')
    .slice(0, 3)
    .map((e) => ({ title: e.content, body: null as string | null }))

  // Last concerns = symptom + treatment entries (clinical recap).
  const concerns = entries
    .filter((e) => e.category === 'SYMPTOM' || e.category === 'TREATMENT')
    .slice(0, 3)
    .map((e) => e.content)

  const productEntry = entries.find((e) => e.category === 'PRODUCT')
  const lastProduct = productEntry
    ? { name: productEntry.content, reaction: null as string | null }
    : null

  const nextEntry = entries.find((e) => e.category === 'NEXT_VISIT')
  const recommendedFocus = nextEntry?.content ?? lastMeta.ai_summary ?? null

  const lastDt = new Date(lastMeta.created_at)
  const lastVisitDate = lastDt.toLocaleDateString(
    locale === 'ja' ? 'ja-JP' : 'en-US',
    { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' },
  )
  const daysAgo = Math.max(
    0,
    Math.round((now.getTime() - lastDt.getTime()) / 86_400_000),
  )
  const lastVisitAgo = locale === 'ja' ? `${daysAgo}日前` : `${daysAgo}d ago`

  return {
    isFirstTimeVisit: false,
    lastVisitDate,
    lastVisitAgo,
    hooks,
    concerns,
    lastProduct,
    recommendedFocus,
    reservationMemo: reservationMemo?.trim() ? reservationMemo : null,
  }
}
