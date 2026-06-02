import { createClient } from '@/lib/supabase/server'
import { getTranslations } from 'next-intl/server'
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getCustomerConsent } from '@/actions/customers'
import {
  getAppointmentsByDate,
  getAppointmentById,
  type AppointmentRow,
} from '@/actions/appointments'
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
// `deriveKaruteNumber` removed — the local hex-slice produced
// `#A1B2C`-style noise that didn't match the real `#00001`-style
// sequence rendered on the main karute list and customer profile
// (computed via `assignSequentialKaruteNumbers` over the customer
// list). Surfaces here pass `karuteNumber: null` so the row's
// existing conditional render hides the chip rather than showing
// a fake number. ANTHONY: once karute_records has a real
// `karute_number` column (or we add the customer list query +
// map lookup here like /karute/page.tsx already does), thread the
// real value through.


export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ appointmentId?: string }>
}) {
  const { locale } = await params
  // Set when the user tapped a specific booking on 予約 (→ 新規カルテ / 録音):
  // that booking becomes the recording target instead of the next-booking guess.
  const { appointmentId: requestedAppointmentId } = await searchParams
  const supabase = await createClient()

  const activeStaffId = await getCurrentUserStaffId()
  const staffList = await getStaffList()
  const staffNameById = new Map(staffList.map((s) => [s.id, s.full_name ?? 'Unknown']))
  const tStatus = await getTranslations('reservation.status')

  const now = new Date()

  // Bookings for the record target + picker come from synqed-core (the source
  // of truth), via getAppointmentsByDate — the SAME read the 予約 page uses.
  // This page previously read the legacy Supabase `appointments` table, which
  // is empty post-migration, so the recording target (録音対象) was always
  // empty. Recording targets are TODAY's bookings ONLY — a session is recorded
  // at visit time, so tomorrow's bookings don't belong in the 別の予約 picker
  // (Liam: it was showing the next day). The picker shows today's whole set
  // (active staff first) so staff can still record a colleague's booking.
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const todayStr = jstNow.toISOString().split('T')[0]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [customers, todayAppts, recentRows] = await Promise.all([
    getCachedCustomerList(),
    getAppointmentsByDate(todayStr),
    // Recent recordings card still reads Supabase karute_records — empty
    // post-migration until this page's karute reads are migrated too, so the
    // card simply renders nothing for now (tracked as follow-up).
    sb
      .from('karute_records')
      .select(
        `id, session_date, created_at, summary, transcript, customers:client_id ( name ), entries ( count )`,
      )
      .order('session_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(5)
      .then((res: { data: unknown }) => res),
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
    statusKey?: 'in-session' | 'booked' | 'done'
    staffName: string
  } | null = null

  // Nearby bookings (today, around the target time) — fed into the target card switcher
  let nearbyBookings: RecordTargetBooking[] = []

  // Today's bookings from synqed-core, ordered by start time.
  const list: AppointmentRow[] = [...todayAppts].sort((a, b) =>
    a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0,
  )

  // Default-target priority — prefer the ACTIVE STAFF's bookings first
  // (in-session > upcoming > any unlinked), but if they have nothing
  // in the window, fall back to ANY booking in the salon. Matches the
  // spike's posture: staff can record bookings even when not the
  // assigned stylist (covering a colleague, walk-in handoff, etc.).
  const nowMs = now.getTime()
  const isInSession = (a: AppointmentRow) => {
    if (a.karute_record_id) return false
    const startMs = new Date(a.start_time).getTime()
    const endMs = startMs + a.duration_minutes * 60_000
    return startMs <= nowMs && nowMs < endMs
  }
  const isUpcoming = (a: AppointmentRow) =>
    !a.karute_record_id && new Date(a.start_time).getTime() > nowMs
  const isUnlinked = (a: AppointmentRow) => !a.karute_record_id

  function findFirst(rows: AppointmentRow[]): AppointmentRow | undefined {
    return (
      rows.find(isInSession) ??
      rows.find(isUpcoming) ??
      rows.find(isUnlinked)
    )
  }

  const myRows = activeStaffId
    ? list.filter((a) => a.staff_profile_id === activeStaffId)
    : list

  // If the user tapped a booking on 予約 (→ 新規カルテ / 録音), THAT booking is the
  // recording target. Resolve it by id: today's set first (the common case — no
  // extra fetch), else fetch it directly so a booking tapped from ANOTHER day
  // still loads the right customer. Previously a non-today id fell through to the
  // default-target guess below and silently recorded a DIFFERENT customer's
  // session — a treatment-record integrity bug (tapped リエム, got 飯島).
  const requestedRow: AppointmentRow | undefined = requestedAppointmentId
    ? (list.find((a) => a.id === requestedAppointmentId) ??
        (await getAppointmentById(requestedAppointmentId)) ??
        undefined)
    : undefined

  // Fall back to any salon booking when the active staff has nothing queued —
  // the path that surfaces 佐竹なな-style bookings assigned to a colleague.
  const unlinked = requestedRow ?? findFirst(myRows) ?? findFirst(list)

  if (unlinked) {
    // Derive status server-side (in-session / booked / done) so the
    // client component stays pure for React Compiler — no Date.now()
    // calls during render.
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
      // Real staff name from the staff list lookup. Earlier the
      // recording-target card hardcoded staffName='—' even though
      // staff_profile_id was selected on the appointment query.
      staffName: unlinked.staff_profile_id
        ? (staffNameById.get(unlinked.staff_profile_id) ?? '—')
        : '—',
    }
  }

  // Picker rows = ALL today's bookings (active-staff first, then the
  // rest). Limit to keep the dropdown tractable — staff with 20+
  // bookings/day is rare and they'd scroll.
  const orderedForPicker = [
    ...myRows,
    ...list.filter((a) => !myRows.some((m) => m.id === a.id)),
  ].slice(0, 12)

  nearbyBookings = orderedForPicker.map((a) => {
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
      // a.title is the customer's free-text booking note — '—' when
      // null instead of an English literal 'Session' that other rows
      // would carry as if it were real data.
      service: a.title ?? '—',
      // Real staff lookup — staff_profile_id is selected in the query,
      // earlier version hardcoded '—' even though the data was in hand.
      staff: a.staff_profile_id
        ? (staffNameById.get(a.staff_profile_id) ?? '—')
        : '—',
      statusKey,
      // i18n via reservation.status — earlier version hardcoded the
      // English literals 'In session' / 'Done' / 'Booked' so EN locale
      // worked but JA showed English copy in the recording-target card.
      statusLabel: inSessionNow
        ? tStatus('in_session')
        : isDone
          ? tStatus('completed')
          : tStatus('booked'),
    }
  })

  type RecentRow = {
    id: string
    session_date: string | null
    created_at: string
    summary: string | null
    transcript: string | null
    customers: { name: string } | null
    entries: Array<{ count: number }> | null
  }

  const recentRecordings: RecentRecording[] = (
    ((recentRows as { data: RecentRow[] | null })?.data ?? []) as RecentRow[]
  ).map((r) => {
    const dt = new Date(r.session_date ?? r.created_at)
    const customerName = r.customers?.name ?? 'Unknown'
    const entryCount = Array.isArray(r.entries) ? (r.entries[0]?.count ?? 0) : 0
    return {
      id: r.id,
      customerName,
      initials: deriveFamilyInitials(customerName),
      // karuteNumber dropped — see top-of-file comment. The card's
      // existing `karuteNumber && ...` conditional hides the chip
      // when null so the row reads cleanly instead of showing
      // `#A1B2C` hash noise.
      karuteNumber: null,
      // Service '—' instead of literal 'Session' until karute_records
      // has a real `service` column. Same '施術' bug fixed on the
      // main karute list.
      service: '—',
      date: dt.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      startTime: hhmm(dt),
      // Duration label '—' until karute_records has a `duration_minutes`
      // column. Earlier "0 min 00 sec" rendered on every row as if it
      // were real data.
      durationLabel: '—',
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
          { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' },
        )
      }
    } catch {
      // ignore — pill simply doesn't render
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Pre-session brief — derived from the customer's last karute
  // record + reservation memo. Today this is mechanical:
  //   • last karute record present → returning-visit framing
  //     (lastVisitDate, AI summary → concerns, entries of category
  //      'product' → lastProduct, 'next' → recommendedFocus)
  //   • no karute records → first-visit framing
  //     (isFirstTimeVisit=true, reservationMemo if appointment.notes)
  //
  // ANTHONY (function-branch wiring): replace this derivation with
  // a NIGHTLY AI-generated brief read from a new `pre_session_briefs`
  // table or jsonb column on `appointments`. Spec lives in spike's
  // PreSessionBriefCard.tsx header (search "AI_PROMPTS.md §15 — to be
  // added"). The shape returned here is the contract; the AI call
  // produces the same shape with richer text (talking-point hooks
  // generated from CustomerMemory items, AI-summarized concerns,
  // AI-recommended focus). Cache for 24h keyed by (customer_id,
  // appointment_id).
  let brief: PreSessionBrief | null = null
  if (nextAppointment?.customerId) {
    brief = await buildPreSessionBriefFor(
      sb,
      nextAppointment.customerId,
      nextAppointment.notes,
      now,
      locale,
    )
  }

  return (
    <RecordPageView
      customers={customers}
      locale={locale}
      nextAppointment={nextAppointment}
      nearbyBookings={nearbyBookings}
      brief={brief}
      recentRecordings={recentRecordings}
      consentDate={consentDate}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// Pre-session brief derivation — mechanical version
//
// Today: pulls the customer's most recent karute record + its entries,
// and projects them into the PreSessionBrief shape the
// PreSessionBriefCard renders. Returning customer → recap brief with
// concerns/product/focus extracted from entries by category. Brand-
// new customer → first-visit framing with optional reservation memo.
//
// Tomorrow (function branch): replace this body with a single read
// from a `pre_session_briefs` table populated by the nightly AI job.
// The shape returned here is the contract — once the job lands, the
// card lights up with richer text without touching the page.
// ─────────────────────────────────────────────────────────────
// Supabase client is intentionally untyped (the rest of the file uses
// `sb as any` for the same reason — synqed-core's generated types
// don't cover karute_records yet). Disable two related lint rules
// just for this signature.
type SupabaseLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

async function buildPreSessionBriefFor(
  sb: SupabaseLike,
  customerId: string,
  reservationMemo: string | null,
  now: Date,
  locale: string,
): Promise<PreSessionBrief | null> {
  // Last karute record for this customer (the brief's primary source).
  const { data: lastRows } = await sb
    .from('karute_records')
    .select(
      'id, session_date, created_at, summary, entries ( id, category, content )',
    )
    .eq('client_id', customerId)
    .order('session_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)

  const last = Array.isArray(lastRows) && lastRows.length > 0 ? lastRows[0] : null

  // FIRST-VISIT FRAMING — no prior karute. Card renders the
  // "初めてのお客様" header + optional reservation memo block.
  if (!last) {
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

  // RETURNING-VISIT FRAMING — derive from the most recent karute.
  type EntryRow = { id: string; category: string; content: string }
  const entries: EntryRow[] = Array.isArray(last.entries) ? last.entries : []

  // Talking-point hooks = preference + lifestyle entries (the kinds
  // staff want to open with). Cap at 3 so the card stays scannable.
  // ANTHONY: real impl reads from customer_memory_items with
  // suggestTalkingPoint=true (per spike §11 memory extractor).
  const hooks = entries
    .filter((e) => e.category === 'PREFERENCE' || e.category === 'LIFESTYLE')
    .slice(0, 3)
    .map((e) => ({ title: e.content, body: null as string | null }))

  // Last concerns = symptom + treatment entries (clinical recap).
  const concerns = entries
    .filter((e) => e.category === 'SYMPTOM' || e.category === 'TREATMENT')
    .slice(0, 3)
    .map((e) => e.content)

  // Last product offered — most recent product-category entry.
  const productEntry = entries.find((e) => e.category === 'PRODUCT')
  const lastProduct = productEntry
    ? { name: productEntry.content, reaction: null as string | null }
    : null

  // Recommended focus = first next-visit entry (what the customer
  // said they wanted next time, or what staff flagged for follow-up).
  const nextEntry = entries.find((e) => e.category === 'NEXT_VISIT')
  const recommendedFocus = nextEntry?.content ?? last.summary ?? null

  // Format the last visit date + relative "X日前".
  const lastDt = new Date(last.session_date ?? last.created_at)
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
