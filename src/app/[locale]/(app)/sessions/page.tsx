import { getTranslations } from 'next-intl/server'
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { assignStaffColors } from '@/lib/staff-colors'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getCustomer } from '@/lib/customers/queries'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import { getCustomerConsent } from '@/actions/customers'
import {
  getAppointmentsByDate,
  getAppointmentById,
  type AppointmentRow,
} from '@/actions/appointments'
import { getCustomerKaruteRecords } from '@/actions/karute'
import { getAiPreSessionBrief } from '@/lib/karute/ai-brief'
import type { KaruteRecord } from '@synqed-kk/client'
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
  searchParams: Promise<{ appointmentId?: string; customerId?: string }>
}) {
  const { locale } = await params
  // Set when the user tapped a specific booking on 予約 (→ 新規カルテ / 録音):
  // that booking becomes the recording target instead of the next-booking guess.
  // `appointmentId` — a booking tapped on 予約. `customerId` — the 録音 button on
  // a customer card (record THAT customer, booking or walk-in).
  const { appointmentId: requestedAppointmentId, customerId: requestedCustomerId } =
    await searchParams

  const activeStaffId = await getCurrentUserStaffId()
  const staffList = await getStaffList()
  const staffNameById = new Map(staffList.map((s) => [s.id, s.full_name ?? 'Unknown']))
  // DISTINCT staff colors over the FULL roster — same map on every surface,
  // no per-id hash collisions. Feeds the recording-picker avatar via
  // staffColorKey on each booking below.
  const staffColors = assignStaffColors(staffList.map((s) => s.id))
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

  const [customers, todayAppts] = await Promise.all([
    getCachedCustomerList(),
    getAppointmentsByDate(todayStr),
  ])

  // Sequential karute number per customer — same deterministic helper + same
  // cached list (now carrying created_at) the 顧客 page + 予約 agenda use, so
  // #00007 matches every other surface.
  const karuteNumberByClientId = assignSequentialKaruteNumbers(customers)

  // Next unlinked appointment for this staff (used as recording target)
  let nextAppointment: {
    id: string
    customerName: string
    customerId: string
    karuteNumber: string | null
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
  // 録音 from the customer card (?customerId): prefer that customer's own
  // unlinked booking today; else record them as a walk-in (the else-if below).
  const customerRow = requestedCustomerId
    ? list.find((a) => a.client_id === requestedCustomerId && !a.karute_record_id)
    : undefined
  // When a customer is explicitly chosen, never fall through to an unrelated
  // default booking — it's that customer's booking or a walk-in, nothing else.
  const unlinked =
    requestedRow ??
    customerRow ??
    (requestedCustomerId ? undefined : (findFirst(myRows) ?? findFirst(list)))

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
      karuteNumber: karuteNumberByClientId.get(unlinked.client_id) ?? null,
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
  } else if (requestedCustomerId) {
    // Walk-in: a customer was chosen from the 顧客 card but has no booking today.
    // Record directly against them — no appointment link (appointment_id is null
    // at save; RecordPageView coerces the empty id to undefined). The brief,
    // consent, and karute history all key off customerId, so they resolve fine.
    const walkIn = await getCustomer(requestedCustomerId).catch(() => null)
    if (walkIn) {
      nextAppointment = {
        id: '', // no booking → '' → save writes appointment_id null
        customerName: walkIn.name,
        customerId: walkIn.id,
        karuteNumber: karuteNumberByClientId.get(walkIn.id) ?? null,
        startTime: now.toISOString(),
        durationMinutes: 60,
        title: null,
        notes: null,
        statusKey: 'in-session',
        staffName: activeStaffId
          ? (staffNameById.get(activeStaffId) ?? '—')
          : '—',
      }
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
      staffId: a.staff_profile_id,
      // Distinct color key from the roster map — picker avatar resolves it
      // via getStaffColorByKey, matching the 予約 agenda / customer list.
      staffColorKey: a.staff_profile_id
        ? (staffColors.get(a.staff_profile_id)?.key ?? null)
        : null,
      karute: karuteNumberByClientId.get(a.client_id) ?? null,
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

  // THIS customer's karute history from synqed-core (the Supabase mirror is
  // empty post-migration). Fetched once + reused below for the first-visit
  // brief. Scoped to the recording TARGET so the "recent recordings" card shows
  // the selected customer's own sessions, not a salon-wide list.
  // Fetch up to 10 so the pre-session brief can read the customer's full arc
  // (trajectory across sessions); the "recent recordings" card below slices 5.
  const customerKarute: KaruteRecord[] = nextAppointment?.customerId
    ? await getCustomerKaruteRecords(nextAppointment.customerId, 10)
    : []

  const targetCustomerName = nextAppointment?.customerName ?? 'Unknown'
  const targetKaruteNumber = nextAppointment?.customerId
    ? (karuteNumberByClientId.get(nextAppointment.customerId) ?? null)
    : null

  // The target customer's visit_count (from QuickReserve) — so a returning
  // customer with a package (e.g. 50回券) but 0 synqed karute is NOT flagged 新規.
  const targetCustomer = nextAppointment?.customerId
    ? await getCustomer(nextAppointment.customerId).catch(() => null)
    : null
  const targetVisitCount = targetCustomer?.visit_count ?? 0

  const recentRecordings: RecentRecording[] = customerKarute.slice(0, 5).map((r) => {
    const dt = new Date(r.created_at)
    return {
      id: r.id,
      customerName: targetCustomerName,
      initials: deriveFamilyInitials(targetCustomerName),
      karuteNumber: targetKaruteNumber,
      // Service / duration '—' until synqed exposes those fields on the record.
      service: '—',
      date: dt.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      startTime: hhmm(dt),
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
  // AI pre-session brief — reads the booking memo + past karute + the business-
  // type persona and synthesises the staff-skimmable brief (memo analysis 兆候/
  // 期待/トーン/注意点 + concerns + hooks + focus), business-type-aware. Falls back
  // to the mechanical derivation if the AI call fails or has nothing to work with
  // — never blocks the page. Both paths get targetVisitCount so a returning
  // customer with no synqed karute isn't flagged 新規.
  let brief: PreSessionBrief | null = null
  if (nextAppointment?.customerId) {
    brief =
      (await getAiPreSessionBrief({
        customerId: nextAppointment.customerId,
        customerName: targetCustomerName,
        visitCount: targetVisitCount,
        records: customerKarute,
        reservationMemo: nextAppointment.notes,
        locale,
        now,
      })) ??
      buildPreSessionBriefFor(
        customerKarute,
        nextAppointment.notes,
        now,
        locale,
        targetVisitCount,
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
function buildPreSessionBriefFor(
  records: KaruteRecord[],
  reservationMemo: string | null,
  now: Date,
  locale: string,
  // QuickReserve visit_count. A returning customer (e.g. a 50回券 holder) can
  // have prior visits but 0 synqed karute yet — they must NOT be flagged 新規.
  priorVisitCount = 0,
): PreSessionBrief | null {
  // `records` is the customer's synqed karute history, newest first.
  const last = records.length > 0 ? records[0] : null

  // NO PRIOR KARUTE — but only TRULY first-visit if there are also no prior
  // visits anywhere (visit_count). Returning-but-unrecorded customers fall here
  // too: not 新規, no recap to show, just the booking memo (+ AI memo analysis).
  if (!last) {
    return {
      isFirstTimeVisit: priorVisitCount <= 0,
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
  const entries = last.entries ?? []

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
  const recommendedFocus = nextEntry?.content ?? last.ai_summary ?? null

  // Format the last visit date + relative "X日前".
  const lastDt = new Date(last.created_at)
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
