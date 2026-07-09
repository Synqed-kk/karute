import { getTranslations } from 'next-intl/server'
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { assignStaffColors } from '@/lib/staff-colors'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { isReturningCustomer } from '@/lib/customers/list-enrich'
import { getCustomer, type CustomerWithStaff } from '@/lib/customers/queries'
import {
  classifyVisitSegment,
  computeVisitRhythm,
  type VisitSegment,
  type VisitRhythm,
} from '@/lib/visits/segment'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import { getCustomerConsent } from '@/actions/customers'
import { listCustomerPacks, getCustomerLifecycle } from '@/lib/packs/store'
import type { CustomerLifecycle } from '@/lib/packs/types'
import type { PackWithUsage } from '@/lib/packs/types'
import { pickRedemptionTarget } from '@/lib/packs/resolve'
import { memoContent } from '@/lib/sync/qr-notes'
import { getOrgSettings } from '@/actions/org-settings'
import {
  getAppointmentsByDate,
  getAppointmentById,
  type AppointmentRow,
} from '@/actions/appointments'
import { getCustomerKaruteRecords } from '@/actions/karute'
import { getAiPreSessionBrief, type PreSessionBriefResult } from '@/lib/karute/ai-brief'
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

  // Wave 1 — every read that needs nothing but the request itself, fired
  // together instead of one-after-another. These previously ran single-file
  // (staff id → staff list → translations → [customers, bookings]), and
  // orgSettings was awaited dead-last behind the AI brief even though it
  // depends on nothing — so on a cold load the page made ~half a dozen
  // back-to-back round-trips before it could even resolve the recording
  // target. They share no inputs, so they parallelise cleanly; orgSettings is
  // hoisted up from the end of the function (it only feeds the pack-preset
  // panel in the return).
  const [activeStaffId, staffList, tStatus, customers, todayAppts, orgSettings] =
    await Promise.all([
      getCurrentUserStaffId(),
      getStaffList(),
      getTranslations('reservation.status'),
      getCachedCustomerList(),
      getAppointmentsByDate(todayStr),
      getOrgSettings(),
    ])
  const staffNameById = new Map(staffList.map((s) => [s.id, s.full_name ?? 'Unknown']))
  // DISTINCT staff colors over the FULL roster — same map on every surface,
  // no per-id hash collisions. Feeds the recording-picker avatar via
  // staffColorKey on each booking below.
  const staffColors = assignStaffColors(staffList.map((s) => s.id))

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
    statusKey?: 'in-session' | 'booked' | 'done' | 'walk-in'
    staffName: string
    bookedUnderOtherStaff?: boolean
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
      // The selected customer is booked under THIS staff. Flag it only when the
      // signed-in staff is known AND differs, so the record page shows the
      // 別のスタッフの予約 heads-up — the karte still saves under the recorder.
      // (Guard on activeStaffId so an unknown signer isn't mislabelled "other".)
      bookedUnderOtherStaff:
        !!activeStaffId &&
        !!unlinked.staff_profile_id &&
        unlinked.staff_profile_id !== activeStaffId,
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
        // Walk-in: NO booking today. Not 施術中 (that's a booking status) — a
        // distinct 当日 (walk-in) state so the 録音対象 badge is honest about there
        // being no reservation.
        statusKey: 'walk-in',
        staffName: activeStaffId
          ? (staffNameById.get(activeStaffId) ?? '—')
          : '—',
      }
    }
  }

  // Picker rows = ALL of today's bookings (active-staff first, then the rest).
  // NO cap. A hard `.slice(0, 12)` here silently dropped the day's later bookings
  // — an 18:00 vanished while 10:00–17:30 showed (exactly 12) — which kept being
  // misdiagnosed + "fixed" as a scroll bug. The sheet's max-h + overflow-y-auto
  // (SelectBookingSheet) handles long days; the fetch is already bounded
  // (getAppointmentsByDate page_size 200).
  const orderedForPicker = [
    ...myRows,
    ...list.filter((a) => !myRows.some((m) => m.id === a.id)),
  ]

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

  // Wave 2 — everything keyed off the recording TARGET's customer, fired
  // together. These four reads (karute history, the customer record, consent,
  // 回数券 ledger) share only the customerId, so before this they ran needlessly
  // single-file (karute → customer → consent → packs = four serial round-trips
  // ahead of the AI brief). The AI brief still runs AFTER, since it reads the
  // karute history + visit count produced here.
  // Karute history is fetched up to 10 so the pre-session brief can read the
  // customer's full arc (trajectory across sessions); the "recent recordings"
  // card below slices 5. Error posture is unchanged from before the
  // parallelisation: getCustomer + getCustomerConsent keep their own
  // .catch(() => null); getCustomerKaruteRecords + listCustomerPacks swallow
  // errors internally and return [], so the Promise.all can't reject and a
  // hiccup never blanks the page.
  const targetCustomerId = nextAppointment?.customerId ?? null
  // 回数券 off (org setting, wave 1) → skip the pack read; targetPack stays
  // null and the whole burn/outcome flow below never engages.
  const ticketsEnabled = orgSettings?.ticket_packs_enabled ?? true
  const [customerKarute, targetCustomer, consentOnFile, targetPacks, targetLifecycle]: [
    KaruteRecord[],
    CustomerWithStaff | null,
    Awaited<ReturnType<typeof getCustomerConsent>>['consent'],
    PackWithUsage[],
    CustomerLifecycle | null,
  ] = targetCustomerId
    ? await Promise.all([
        getCustomerKaruteRecords(targetCustomerId, 10),
        getCustomer(targetCustomerId).catch(() => null),
        getCustomerConsent(targetCustomerId)
          .then((r) => r.consent)
          .catch(() => null),
        ticketsEnabled
          ? listCustomerPacks(targetCustomerId)
          : Promise.resolve([] as PackWithUsage[]),
        // Lifecycle (卒業/離客) — same signal the customer profile threads into
        // classifyVisitSegment (customers/[id]/page.tsx). A terminal lifecycle
        // decision outranks cadence: without it the closing-tactic strip would
        // coach staff to close a customer the salon already released.
        getCustomerLifecycle(targetCustomerId),
      ])
    : [[], null, null, [], null]

  const targetCustomerName = nextAppointment?.customerName ?? 'Unknown'
  const targetKaruteNumber = nextAppointment?.customerId
    ? (karuteNumberByClientId.get(nextAppointment.customerId) ?? null)
    : null

  // The target customer's visit_count (from QuickReserve, fetched in wave 2) —
  // so a returning customer with a package (e.g. 50回券) but 0 synqed karute is
  // NOT flagged 新規.
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
      // entry_count is synqed-core's DENORMALIZED list-endpoint count — it is NOT
      // updated when entries are added/removed (e.g. after AIで再生成), so it goes
      // stale: a re-extracted session showed 0件 while it actually had 4 real
      // entries. getCustomerKaruteRecords fetches the MOST-RECENT record in full,
      // so prefer its real entries.length; fall back to entry_count for the
      // lighter list rows (which omit per-entry detail).
      // ANTHONY: synqed-core should recompute entry_count on entry add/remove (or
      // compute it live in the list endpoint) so EVERY row is accurate, not just
      // the most recent.
      entryCount: (r.entries?.length || r.entry_count) ?? 0,
      karuteId: r.id,
    }
  })

  // Consent on file (pretty date) — for the consent pill. consentOnFile comes
  // from wave 2 (already null on a fetch failure, so the pill simply hides).
  let consentDate: string | null = null
  if (consentOnFile?.granted_at) {
    consentDate = new Date(consentOnFile.granted_at).toLocaleDateString(
      locale === 'ja' ? 'ja-JP' : 'en-US',
      { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' },
    )
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
  // AI brief, streamed to the client and unwrapped with use() inside the brief
  // card's Suspense boundary — so the page paints on the mechanical brief
  // instantly instead of blocking on the gpt-4o call. .catch keeps a model/
  // timeout failure from rejecting the streamed prop (it resolves to null and
  // the card stays on the mechanical brief). Defaults to a resolved-null for the
  // no-target path so the prop is always defined.
  let aiBriefPromise: Promise<PreSessionBriefResult | null> = Promise.resolve(null)
  // The target's active 回数券 — drives the one-tap 消化 row in the post-session
  // outcome dialog (design #1). null when no pack / no sessions left.
  let targetPack: { id: string; remaining: number; size: number } | null = null
  // The picker prefill — the customer's most recent pack (any status; the
  // store returns purchased_at DESC, so [0] is newest).
  let previousPack: { size: number; unitPrice: number } | null = null
  // Visit-frequency segment + rhythm bar geometry for the closing-tactic strip
  // + rhythm panel below the recording target. Same classifyVisitSegment /
  // computeVisitRhythm helpers CustomerIdentityCard + VisitPaceCard use on the
  // customer profile (single source — never redoes the "how should staff close
  // this" math), driven off targetCustomer (already fetched in wave 2) — no new
  // fetch. Null when there's no recording target.
  let visitSegment: VisitSegment | null = null
  let visitRhythm: VisitRhythm | null = null
  let targetHasTicketPack = false
  if (nextAppointment?.customerId) {
    // SINGLE-SOURCE returning signal (visit_count / 回数券 / is_existing) from the
    // cached list — same fields the 顧客 list + profile use, so the recording
    // target's 新規 flag matches the customer's badge everywhere.
    const cc = customers.find((c) => c.id === nextAppointment.customerId)
    // Real ticket_packs ledger for the target (fetched in wave 2; graceful
    // empty pre-migration) — a manually-registered pack holder is returning
    // here too, matching the list/profile/agenda exactly.
    const targetHasActivePack = targetPacks.some(
      (p) => p.status === 'active' && p.kind === 'pack',
    )
    // FIFO: finish the old ticket first (pickRedemptionTarget — §7 rule).
    // listCustomerPacks returns newest-first, so .find() picked the NEWEST
    // and stranded the old pack's 残1 after a 残2-prompt repurchase.
    const activePack = pickRedemptionTarget(targetPacks)
    targetPack = activePack
      ? { id: activePack.id, remaining: activePack.remaining, size: activePack.pack_size }
      : null
    const newest = targetPacks[0]
    previousPack = newest
      ? { size: newest.pack_size, unitPrice: newest.unit_price }
      : null
    const targetReturning = isReturningCustomer({
      joinDateIso: null,
      lastVisitIso: null,
      isExistingCustomer: cc?.isExistingCustomer,
      visitCount: cc?.visitCount,
      hasTicketPack: (cc?.hasTicketPack ?? false) || targetHasActivePack,
      karuteCount: customerKarute.length,
    })
    targetHasTicketPack = (cc?.hasTicketPack ?? false) || targetHasActivePack
    const visitSignals = {
      joinDateIso: targetCustomer?.created_at ?? null,
      lastVisitIso: targetCustomer?.last_visit_at ?? null,
      firstVisitIso: targetCustomer?.first_visit_at ?? null,
      isExistingCustomer: targetCustomer?.is_existing_customer,
      visitCount: targetCustomer?.visit_count,
      karuteCount: customerKarute.length,
      hasTicketPack: targetHasTicketPack,
      // Terminal lifecycle (卒業/離客) nulls the segment — same gate the
      // profile applies; never coach staff to close a released customer.
      lifecycleStatus: targetLifecycle?.status,
    }
    visitSegment = classifyVisitSegment(visitSignals, now)
    // Terminal lifecycle also suppresses the rhythm PANEL, not just the
    // tactic segment — mirrors the profile, where computeVisitPace takes
    // isTerminal and the pace card never renders for 卒業/離客
    // (customers/[id]/page.tsx). classifyVisitSegment nulls itself; rhythm
    // is a plain geometry helper with no lifecycle input, so gate it here.
    const isTerminalLifecycle =
      targetLifecycle?.status === 'graduated' || targetLifecycle?.status === 'lost'
    visitRhythm = isTerminalLifecycle ? null : computeVisitRhythm(visitSignals, now)
    // Mechanical brief — pure + instant. Drives the FIRST paint and every
    // cross-cutting 新規 flag (the recording-target badge + the post-session
    // dialog), so those are correct on frame one and never flip.
    // The memo staff see (and the AI analyzes): the appointment note's HUMAN
    // content when it has any — the QR back-reference tag alone is plumbing —
    // otherwise the customer's QuickReserve intake memo (customer.notes, the
    // staff-typed 問診 the profile page shows). targetCustomer is already
    // fetched above; no extra call.
    const briefMemo =
      memoContent(nextAppointment.notes) ?? memoContent(targetCustomer?.notes)
    brief = buildPreSessionBriefFor(
      customerKarute,
      briefMemo,
      now,
      locale,
      targetReturning,
    )
    // AI brief (richer, business-type-aware) — fired WITHOUT await. gpt-4o writes
    // the memo analysis 兆候/期待/トーン/注意点 underneath while the page is already
    // interactive; the brief card upgrades in place when it resolves. Resolves to
    // null on no-signal/failure → the card simply stays on the mechanical brief.
    aiBriefPromise = getAiPreSessionBrief({
      customerId: nextAppointment.customerId,
      customerName: targetCustomerName,
      visitCount: targetVisitCount,
      records: customerKarute,
      reservationMemo: briefMemo,
      locale,
      now,
    }).catch(() => null)
  }

  return (
    <RecordPageView
      customers={customers}
      locale={locale}
      nextAppointment={nextAppointment}
      nearbyBookings={nearbyBookings}
      brief={brief}
      aiBriefPromise={aiBriefPromise}
      recentRecordings={recentRecordings}
      consentDate={consentDate}
      visitSegment={visitSegment}
      visitRhythm={visitRhythm}
      targetHasTicketPack={targetHasTicketPack}
      targetPack={targetPack}
      packPresets={orgSettings?.pack_presets ?? []}
      staffCanCustomizePacks={orgSettings?.staff_can_customize_packs ?? true}
      previousPack={previousPack}
      ticketsEnabled={ticketsEnabled}
      noiseSuppression={orgSettings?.noise_suppression !== false}
      currentStaffName={
        activeStaffId ? (staffNameById.get(activeStaffId) ?? null) : null
      }
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
  // A known returning customer (QR visit_count / 回数券 / is_existing) is NOT a
  // first visit even with no recording yet — the SAME single signal every surface
  // uses (isReturningCustomer).
  isReturning: boolean,
): PreSessionBrief | null {
  // `records` is the customer's synqed karute history, newest first. FIRST visit
  // = NO prior record AND not a known returning customer — a QR regular with no
  // recording yet is returning, not 新規.
  const last = records.length > 0 ? records[0] : null

  // FIRST-VISIT FRAMING — no prior karute AND not returning. Card renders the
  // "初めてのお客様" header + optional reservation memo block.
  if (!last) {
    return {
      isFirstTimeVisit: !isReturning,
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
  // Safety-critical facts extract as SYMPTOM and are ordered first by the
  // prompt; sort symptom-before-treatment so the 3-slot cap can't push a
  // contraindication out in favor of treatment notes.
  const concerns = entries
    .filter((e) => e.category === 'SYMPTOM' || e.category === 'TREATMENT')
    .sort((a, b) =>
      a.category === b.category ? 0 : a.category === 'SYMPTOM' ? -1 : 1,
    )
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
  // Fallback: only the summary's FIRST line — v3.1 summaries run 10+ labeled
  // lines, and dumping the whole block into the focus slot drowns the card.
  const recommendedFocus =
    nextEntry?.content ?? (last.ai_summary?.split(/\r?\n/)[0]?.trim() || null)

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
