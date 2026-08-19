// The /sessions (record-home) post-fetch assembly — previously inlined in
// `src/app/[locale]/(app)/sessions/page.tsx`, moved (packet 08 §Build 1(i)) so
// the web page AND the facade screen GET (§Build 2) derive the identical
// view-model. Identity-agnostic: every read is an INJECTED dep — the web page
// passes the cookie helpers, the facade route passes the business-scoped
// WithClient variants. NO AI brief call here (Decision 1 gives the brief its own
// streamed slot / endpoint); this returns the mechanical brief + the brief
// INPUTS the caller uses to fire it.
//
// ERROR POSTURE (§Build 2): the wave-2 reads (target customer, consent, karute
// history, packs) keep the page's graceful null/[] — the packet NAMES them as
// page-parity grace reads on BOTH worlds; lifecycle failure → segment/rhythm
// null (fail-closed coaching). The two EXPLICIT-target resolvers carry the
// caller's own not-found posture (facade: throw not_found; web: graceful null),
// so a cross-tenant explicit id surfaces per the caller's contract.

import { assignStaffColors } from '@/lib/staff-colors'
import { isReturningCustomer } from '@/lib/customers/status-signals'
import type { CustomerWithStaff } from '@/lib/customers/queries'
import {
  classifyVisitSegment,
  computeVisitRhythm,
  type VisitSegment,
  type VisitRhythm,
} from '@/lib/visits/segment'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import type { PackWithUsage, CustomerLifecycle } from '@/lib/packs/types'
import { pickRedemptionTarget } from '@/lib/packs/resolve'
import { memoContent } from '@/lib/sync/qr-notes'
import type { OrgSettings, PackPreset } from '@/actions/org-settings'
import type { AppointmentRow } from '@/actions/appointments'
import type { KaruteRecord, KaruteEntry } from '@synqed-kk/client'
import { effectiveSummary } from '@/lib/karute/effective-summary'
import type { RecordTargetBooking } from '@/components/karute/redesign/record/RecordingTargetCard'
import type { RecentRecording } from '@/components/karute/redesign/record/RecentRecordingsCard'
import type { PreSessionBrief } from '@/components/karute/redesign/record/PreSessionBriefCard'
import type { RecordPageNextAppointment } from '@/components/karute/redesign/record/RecordPageView'
import type { RecordCustomerFact } from '@/components/karute/redesign/record/RecordCustomerPickerDialog'
import type { CachedCustomerOption } from '@/lib/customers/cached'
// Type-only: list-enrich pulls next/cache + SynqedClient, and this module is
// imported by suites that mock neither. The enrichment MAP comes back from the
// caller's loadPickerFacts loader (same shape buildAppointmentsScreen takes) —
// this module decides WHETHER to ask for it, never how to fetch it.
import type { CustomerEnrichment } from '@/lib/customers/list-enrich'

// The consent row shape this assembly reads (granted_at → the consent pill).
type ConsentRow = { granted_at?: string | null } | null
// Lifecycle result shape (fail-closed on !ok).
type LifecycleResult =
  | { ok: true; lifecycle: CustomerLifecycle | null }
  | { ok: false }

/** Every read the assembly needs, injected so web (cookie) and facade (Bearer)
 *  share ONE derivation. The two `resolveExplicit*` fns carry the caller's
 *  not-found posture; the rest are page-parity graceful (null / []). */
export interface RecordScreenDeps {
  /** The non-today explicit-appointmentId lookup (page's getAppointmentById
   *  fallback). Facade: throws not_found on a missing/cross-tenant id; web:
   *  graceful null. */
  resolveExplicitAppointment: (id: string) => Promise<AppointmentRow | null>
  /** The explicit walk-in customer (?customerId with no booking today). Facade:
   *  throws not_found; web: graceful null (.catch). */
  resolveWalkInCustomer: (id: string) => Promise<CustomerWithStaff | null>
  /** Wave-2 target customer read — page-parity graceful (.catch → null). */
  getTargetCustomer: (id: string) => Promise<CustomerWithStaff | null>
  /** Wave-2 consent read → the consent value — page-parity graceful (→ null). */
  getConsent: (id: string) => Promise<ConsentRow>
  /** Wave-2 karute history (best-effort [] on failure). */
  getKaruteRecords: (id: string, limit: number) => Promise<KaruteRecord[]>
  /** Wave-2 pack ledger (best-effort [] on failure). */
  listPacks: (id: string) => Promise<PackWithUsage[]>
  /** Wave-2 lifecycle read — fail-closed ({ ok:false }) on failure. */
  getLifecycle: (id: string) => Promise<LifecycleResult>
}

export interface RecordScreenBrief {
  customerId: string
  customerName: string
  visitCount: number
  records: KaruteRecord[]
  reservationMemo: string | null
}

export interface RecordScreenResult {
  nextAppointment: RecordPageNextAppointment | null
  nearbyBookings: RecordTargetBooking[]
  brief: PreSessionBrief | null
  recentRecordings: RecentRecording[]
  consentDate: string | null
  visitSegment: VisitSegment | null
  visitRhythm: VisitRhythm | null
  targetHasTicketPack: boolean
  targetPack: { id: string; remaining: number; size: number } | null
  previousPack: { size: number; unitPrice: number } | null
  packPresets: PackPreset[]
  staffCanCustomizePacks: boolean
  ticketsEnabled: boolean
  noiseSuppression: boolean
  currentStaffName: string | null
  /** Per-customer display facts for the 録音 customer-picker dialog (karute #,
   *  新規, 回数券 残n/m, 前回 date+menu, 担当). Derived from the SAME bulk reads
   *  the 予約 agenda uses (enrichment + pack usage), so a number shown here can
   *  never disagree with the reservation page. Empty-valued fields are omitted
   *  rather than nulled — the array ships on every screen read. */
  customerFacts: RecordCustomerFact[]
  /** Inputs the caller uses to fire the AI pre-session brief (web streams it,
   *  the facade has a dedicated endpoint). null when there's no target. */
  briefInputs: RecordScreenBrief | null
}

/** 前回 date for the picker rows — 「8月2日」/「Aug 2」, with the year restored
 *  when the visit was in a prior year (formatCompactDate's honesty rule, in the
 *  approved mock's month spelling). */
function visitDateLabel(iso: string | null, locale: string, now: Date): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const jstYear = (x: Date) =>
    x.toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric' })
  const sameYear = jstYear(d) === jstYear(now)
  return d.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    month: locale === 'ja' ? 'long' : 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
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

export async function buildRecordScreen(input: {
  locale: string
  now: Date
  requestedAppointmentId?: string
  requestedCustomerId?: string
  activeStaffId: string | null
  staffList: { id: string; full_name?: string | null }[]
  customers: CachedCustomerOption[]
  todayAppts: AppointmentRow[]
  orgSettings: OrgSettings | null
  /** reservation.status label resolver (getTranslations) — kept a plain fn so
   *  the module stays loadable by both builds + jest. */
  statusLabel: (key: 'in_session' | 'completed' | 'booked') => string
  /** The picker rows' bulk per-customer reads: enrichment (前回 date+menu, 担当,
   *  karute count) and 回数券 usage — the SAME cached aggregates the 顧客 list +
   *  予約 agenda read, so a number shown in the picker can't disagree with them.
   *
   *  LAZY on purpose (B-6): both are whole-tenant and listAllPackUsage is
   *  uncached, while only the NO-TARGET screen can open the picker. This is
   *  invoked at the customerFacts site and nowhere else, so the bound screen —
   *  the hottest one — never fires them at all. The loader must run its two
   *  reads in PARALLEL; each is best-effort (an absent loader or a missing map
   *  costs the rows detail, never correctness). */
  loadPickerFacts?: () => Promise<{
    enrichment?: ReadonlyMap<string, CustomerEnrichment>
    packUsage?: ReadonlyMap<string, { remaining: number; size: number }>
  }>
  deps: RecordScreenDeps
}): Promise<RecordScreenResult> {
  const {
    locale,
    now,
    requestedAppointmentId,
    requestedCustomerId,
    activeStaffId,
    staffList,
    customers,
    todayAppts,
    orgSettings,
    statusLabel,
    loadPickerFacts,
    deps,
  } = input

  const staffNameById = new Map(staffList.map((s) => [s.id, s.full_name ?? 'Unknown']))
  // DISTINCT staff colors over the FULL roster — same map on every surface,
  // no per-id hash collisions.
  const staffColors = assignStaffColors(staffList.map((s) => s.id))

  // Sequential karute number per customer — same deterministic helper + list
  // the 顧客 page + 予約 agenda use, so #00007 matches every other surface.
  const karuteNumberByClientId = assignSequentialKaruteNumbers(customers)

  let nextAppointment: RecordPageNextAppointment | null = null
  let nearbyBookings: RecordTargetBooking[] = []

  // Today's bookings from synqed-core, ordered by start time.
  const list: AppointmentRow[] = [...todayAppts].sort((a, b) =>
    a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0,
  )

  // Default-target priority — the ACTIVE STAFF's OWN bookings only
  // (in-session > upcoming > any unlinked). NEVER any salon booking: the
  // 8/19 field report + Liam's ruling — the centre record button must not
  // auto-bind another stylist's customer. No own booking → no implicit
  // target at all (the screen's empty state then asks explicitly). The
  // EXPLICIT entries (?appointmentId / ?customerId) are untouched below —
  // deliberately opening someone's booking still binds it.
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
    return rows.find(isInSession) ?? rows.find(isUpcoming) ?? rows.find(isUnlinked)
  }

  // No staff identity (a caller with no staff_profile row) → nothing to scope
  // BY, so the PICKER's ordering keeps the day's list as-is (below). The
  // implicit pick does NOT use it — see `unlinked`.
  const myRows = activeStaffId
    ? list.filter((a) => a.staff_profile_id === activeStaffId)
    : list

  // A booking tapped on 予約 → THAT booking is the target. Resolve by id:
  // today's set first (no extra fetch), else fetch directly so a booking from
  // ANOTHER day still loads the right customer (integrity: tapped リエム → リエム).
  const requestedRow: AppointmentRow | undefined = requestedAppointmentId
    ? (list.find((a) => a.id === requestedAppointmentId) ??
        (await deps.resolveExplicitAppointment(requestedAppointmentId)) ??
        undefined)
    : undefined

  // 録音 from a customer card (?customerId): prefer that customer's own unlinked
  // booking today; else record them as a walk-in (the else-if below).
  const customerRow = requestedCustomerId
    ? list.find((a) => a.client_id === requestedCustomerId && !a.karute_record_id)
    : undefined
  // When a customer is explicitly chosen, never fall through to an unrelated
  // default booking — it's that customer's booking or a walk-in, nothing else.
  // An implicit pick also REQUIRES a staff identity (A-2, 8/19): without one
  // `myRows` degrades to the whole salon's day (ghost-owner bootstrap /
  // half-joined invite are documented prod states), which would re-open the
  // very cross-staff auto-bind this change closes. No identity → no target;
  // the screen then asks. Explicit entries above are untouched.
  const unlinked =
    requestedRow ??
    customerRow ??
    (requestedCustomerId || !activeStaffId ? undefined : findFirst(myRows))

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
      karuteNumber: karuteNumberByClientId.get(unlinked.client_id) ?? null,
      startTime: unlinked.start_time,
      durationMinutes: unlinked.duration_minutes,
      title: unlinked.title ?? null,
      notes: unlinked.notes ?? null,
      statusKey,
      staffName: unlinked.staff_profile_id
        ? (staffNameById.get(unlinked.staff_profile_id) ?? '—')
        : '—',
      bookedUnderOtherStaff:
        !!activeStaffId &&
        !!unlinked.staff_profile_id &&
        unlinked.staff_profile_id !== activeStaffId,
    }
  } else if (requestedCustomerId) {
    // Walk-in: a customer chosen from the 顧客 card with no booking today.
    const walkIn = await deps.resolveWalkInCustomer(requestedCustomerId)
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
        statusKey: 'walk-in',
        staffName: activeStaffId ? (staffNameById.get(activeStaffId) ?? '—') : '—',
      }
    }
  }

  // Picker rows = ALL of today's bookings (active-staff first, then the rest).
  // NO cap (a .slice(0,12) silently dropped the day's later bookings).
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
      // The join key the picker dialog uses to hang a row's 回数券/新規 chips off
      // customerFacts (and to mark a searched customer as booked TODAY).
      customerId: a.client_id,
      initials: deriveFamilyInitials(customerName),
      staffId: a.staff_profile_id,
      staffColorKey: a.staff_profile_id
        ? (staffColors.get(a.staff_profile_id)?.key ?? null)
        : null,
      karute: karuteNumberByClientId.get(a.client_id) ?? null,
      service: a.title ?? '—',
      staff: a.staff_profile_id
        ? (staffNameById.get(a.staff_profile_id) ?? '—')
        : '—',
      statusKey,
      statusLabel: inSessionNow
        ? statusLabel('in_session')
        : isDone
          ? statusLabel('completed')
          : statusLabel('booked'),
    }
  })

  // Picker facts — ONE row per customer, so both dialog lists (today's bookings
  // and the search results) read the same derived values. 新規 goes through the
  // shared isReturningCustomer chopstick (never a local rule), the numbers come
  // from the injected bulk maps, and every empty field is OMITTED so a customer
  // with no history costs ~30 bytes on the wire instead of a row of nulls.
  //
  // Built ONLY when the screen resolves to NO target, and the bulk reads behind
  // it are fired ONLY here (B-6): the picker's render gate is
  // `showCustomerPicker && showNoTargetActions` (RecordPageView), and
  // showNoTargetActions requires nextAppointment === null — so with a booking on
  // screen the dialog cannot be mounted, and this array plus its two
  // whole-tenant reads would be work nobody can ever read. The gate is on the
  // STATE, not on any one entry point: whatever opens the dialog, it can only
  // be open while the target is null (a target binding under an open dialog
  // unmounts it — B-8). If a future edit lets the picker open in the BOUND
  // state, move this call rather than deleting it — the dialog itself degrades
  // to lean rows rather than breaking.
  let customerFacts: RecordCustomerFact[] = []
  if (!nextAppointment) {
    const bulk = await loadPickerFacts?.()
    const enrichment = bulk?.enrichment
    const packUsage = bulk?.packUsage
    customerFacts = customers.map((c) => {
      const e = enrichment?.get(c.id)
      const usage = packUsage?.get(c.id) ?? null
      const fact: RecordCustomerFact = { id: c.id }
      const karuteNumber = karuteNumberByClientId.get(c.id)
      if (karuteNumber) fact.karuteNumber = karuteNumber
      const returning = isReturningCustomer({
        joinDateIso: null,
        lastVisitIso: e?.lastVisitIso ?? null,
        isExistingCustomer: c.isExistingCustomer,
        visitCount: c.visitCount,
        karuteCount: e?.totalKarute,
        pastAppointmentCount: e?.pastAppointmentCount,
        hasTicketPack: c.hasTicketPack || usage !== null,
      })
      if (!returning) fact.isNew = true
      if ((e?.totalKarute ?? 0) > 0) fact.hasKarute = true
      if (usage && usage.size > 0) {
        fact.pack = { remaining: usage.remaining, size: usage.size }
      }
      const lastVisit = visitDateLabel(e?.lastVisitIso ?? null, locale, now)
      if (lastVisit) fact.lastVisitDate = lastVisit
      if (e?.lastVisitService) fact.lastVisitService = e.lastVisitService
      if (e?.bookingStaffId) {
        const name = staffNameById.get(e.bookingStaffId)
        if (name) fact.staffName = name
        const colorKey = staffColors.get(e.bookingStaffId)?.key
        if (colorKey) fact.staffColorKey = colorKey
      }
      return fact
    })
  }

  // Wave 2 — everything keyed off the recording TARGET's customer.
  const targetCustomerId = nextAppointment?.customerId ?? null
  const ticketsEnabled = orgSettings?.ticket_packs_enabled ?? true
  const [customerKarute, targetCustomer, consentOnFile, targetPacks, lifecycleRead]: [
    KaruteRecord[],
    CustomerWithStaff | null,
    ConsentRow,
    PackWithUsage[],
    LifecycleResult,
  ] = targetCustomerId
    ? await Promise.all([
        deps.getKaruteRecords(targetCustomerId, 10),
        deps.getTargetCustomer(targetCustomerId),
        deps.getConsent(targetCustomerId),
        ticketsEnabled
          ? deps.listPacks(targetCustomerId)
          : Promise.resolve([] as PackWithUsage[]),
        deps.getLifecycle(targetCustomerId),
      ])
    : [[], null, null, [], { ok: true as const, lifecycle: null }]
  const targetLifecycle = lifecycleRead.ok ? lifecycleRead.lifecycle : null
  const lifecycleUnknown = !lifecycleRead.ok

  const targetCustomerName = nextAppointment?.customerName ?? 'Unknown'
  const targetKaruteNumber = nextAppointment?.customerId
    ? (karuteNumberByClientId.get(nextAppointment.customerId) ?? null)
    : null

  const targetVisitCount = targetCustomer?.visit_count ?? 0

  const recentRecordings: RecentRecording[] = customerKarute.slice(0, 5).map((r) => {
    const dt = new Date(r.created_at)
    return {
      id: r.id,
      customerName: targetCustomerName,
      initials: deriveFamilyInitials(targetCustomerName),
      karuteNumber: targetKaruteNumber,
      // Real fields from the record (same honest-'—' convention as the
      // カルテ list): the booked menu + recording minutes are written at
      // save since the 7/29 service fill; older records render the dash.
      service: r.service || '—',
      date: dt.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      startTime: hhmm(dt),
      durationLabel: r.duration_minutes ? `${r.duration_minutes}分` : '—',
      karuteLinked: !!effectiveSummary(r),
      entryCount: (r.entries?.length || r.entry_count) ?? 0,
      karuteId: r.id,
    }
  })

  // Consent on file (pretty date) — for the consent pill.
  let consentDate: string | null = null
  if (consentOnFile?.granted_at) {
    consentDate = new Date(consentOnFile.granted_at).toLocaleDateString(
      locale === 'ja' ? 'ja-JP' : 'en-US',
      { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' },
    )
  }

  let brief: PreSessionBrief | null = null
  let briefInputs: RecordScreenBrief | null = null
  let targetPack: { id: string; remaining: number; size: number } | null = null
  let previousPack: { size: number; unitPrice: number } | null = null
  let visitSegment: VisitSegment | null = null
  let visitRhythm: VisitRhythm | null = null
  let targetHasTicketPack = false
  if (nextAppointment?.customerId) {
    const cc = customers.find((c) => c.id === nextAppointment!.customerId)
    const targetHasActivePack = targetPacks.some(
      (p) => p.status === 'active' && p.kind === 'pack',
    )
    // FIFO: finish the old ticket first (pickRedemptionTarget — §7 rule).
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
      lifecycleStatus: targetLifecycle?.status,
    }
    // Fail closed on an errored lifecycle read (suppress coaching).
    visitSegment = lifecycleUnknown ? null : classifyVisitSegment(visitSignals, now)
    const isTerminalLifecycle =
      targetLifecycle?.status === 'graduated' || targetLifecycle?.status === 'lost'
    visitRhythm =
      isTerminalLifecycle || lifecycleUnknown ? null : computeVisitRhythm(visitSignals, now)
    // The memo staff see (and the AI analyzes): the appointment note's HUMAN
    // content when present, else the customer's QuickReserve intake memo.
    const briefMemo =
      memoContent(nextAppointment.notes) ?? memoContent(targetCustomer?.notes)
    brief = buildPreSessionBriefFor(
      customerKarute,
      briefMemo,
      now,
      locale,
      targetReturning,
    )
    briefInputs = {
      customerId: nextAppointment.customerId,
      customerName: targetCustomerName,
      visitCount: targetVisitCount,
      records: customerKarute,
      reservationMemo: briefMemo,
    }
  }

  return {
    nextAppointment,
    nearbyBookings,
    brief,
    recentRecordings,
    consentDate,
    visitSegment,
    visitRhythm,
    targetHasTicketPack,
    targetPack,
    previousPack,
    packPresets: orgSettings?.pack_presets ?? [],
    staffCanCustomizePacks: orgSettings?.staff_can_customize_packs ?? true,
    ticketsEnabled,
    noiseSuppression: orgSettings?.noise_suppression !== false,
    currentStaffName: activeStaffId ? (staffNameById.get(activeStaffId) ?? null) : null,
    customerFacts,
    briefInputs,
  }
}

// ─────────────────────────────────────────────────────────────
// Pre-session brief derivation — mechanical version (moved verbatim from the
// sessions page). Returning customer → recap brief with concerns/product/focus
// extracted from entries by category; brand-new → first-visit framing.
// ─────────────────────────────────────────────────────────────
export function buildPreSessionBriefFor(
  records: KaruteRecord[],
  reservationMemo: string | null,
  now: Date,
  locale: string,
  isReturning: boolean,
): PreSessionBrief | null {
  const last = records.length > 0 ? records[0] : null

  // FIRST-VISIT FRAMING — no prior karute AND not a known returning customer.
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
  // Fleet S4: core reads entries by sort_order asc, and a regen APPENDS its
  // fresh AI batch after human rows (addEntry = max+1) — so mixed-authorship
  // order needs pinning for the picks below (hooks/concerns/lastProduct/
  // recommendedFocus) to be deterministic. Rank HUMAN rows first: the human
  // layer is the authoritative record (EDIT-LAYER-DESIGN §1/§3 — corrections
  // pin on top; a staff edit/hand-add made at review must win the next
  // session's pick over an AI sibling). Staleness across sessions is
  // impossible — entries live on one record and `last` is the newest one.
  // The sort is stable, so WITHIN each rank core order is preserved — for
  // the AI batch that is the extractor's importance-first (safety-first)
  // ordering the leading slices rely on. No recency key: a timestamp
  // tiebreak would reverse importance within a batch (rows are written
  // seconds apart, most important first).
  const entries = [...(last.entries ?? [])].sort((a, b) => {
    // Same author-absent fallback as the regen guard (regenerate-karute.ts):
    // author is NOT NULL by core contract, but a legacy row without one must
    // rank by is_manual, not default into the human-first zone.
    const rank = (e: KaruteEntry) =>
      e.author != null ? (e.author === 'AI' ? 1 : 0) : e.is_manual === true ? 0 : 1
    return rank(a) - rank(b)
  })

  const hooks = entries
    .filter((e) => e.category === 'PREFERENCE' || e.category === 'LIFESTYLE')
    .slice(0, 3)
    .map((e) => ({ title: e.content, body: null as string | null }))

  const concerns = entries
    .filter((e) => e.category === 'SYMPTOM' || e.category === 'TREATMENT')
    .sort((a, b) =>
      a.category === b.category ? 0 : a.category === 'SYMPTOM' ? -1 : 1,
    )
    .slice(0, 3)
    .map((e) => e.content)

  const productEntry = entries.find((e) => e.category === 'PRODUCT')
  const lastProduct = productEntry
    ? { name: productEntry.content, reaction: null as string | null }
    : null

  const nextEntry = entries.find((e) => e.category === 'NEXT_VISIT')
  const recommendedFocus =
    nextEntry?.content ?? (effectiveSummary(last)?.split(/\r?\n/)[0]?.trim() || null)

  const lastDt = new Date(last.created_at)
  const lastVisitDate = lastDt.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
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
