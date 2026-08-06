// Customer-profile screen assembly — the post-wave derivation MOVED VERBATIM out
// of app/[locale]/(app)/customers/[id]/page.tsx (packet 06) so the web page and
// the facade screen endpoint share ONE source of truth for how the profile
// view-model is built (memory backfill + passport, first/last-visit
// reconciliation, status resolver, visitPace, consent derivation, photos/sessions
// projections, the CustomerProfileData construction). Pure over explicit inputs:
// callers own their own 12-read fan-out (cookie-scoped on the web page,
// Bearer/business-scoped in the facade route).
//
// The memory-backfill block (empty store + transcripts → LLM backfill, 1-day AI
// cache) rides along AS-IS: it is a page side-effect the endpoint must carry so
// imported customers don't see an empty memory card only on the app. Same 1-day
// cache ⇒ identical behavior + cost to the web page.

import { computeAge, jpGender, isBirthdayMonth } from '@/lib/customers/demographics'
import { isConsentCurrent } from '@/lib/consent'
import { backfillMemoryFromTranscripts } from '@/lib/karute/memory-ingest'
import { buildCustomerMemory } from '@/lib/karute/memory-adapter'
import { resolvePassportFields } from '@/lib/karute/business-ai-tokens'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { mergeKaruteRows, type KaruteListRow } from '@/lib/karute/synqed-records'
import { MEMORY_CATEGORIES, type MemoryItem } from '@/lib/karute/memory-types'
import type { CustomerMemory } from '@/components/karute/spike-lifted/memory/types'
import type { CustomerProfileData } from '@/components/customers/redesign/types'
import {
  effectiveLastVisitIso,
  effectiveFirstVisitIso,
  formatJoinDate,
  formatCompactDate,
  type CustomerEnrichment,
} from '@/lib/customers/list-enrich'
import {
  customerVisitCount,
  isReturningCustomer,
  resolveCustomerStatus,
} from '@/lib/customers/status-signals'
import { computeVisitPace } from '@/lib/visits/pace'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import type { CustomerSessionEntry } from '@/components/customers/redesign/profile/SessionsTabContent'
import type { CustomerPhoto } from '@/components/customers/redesign/profile/PhotosTabContent'
import type { getCustomerLifecycleChecked } from '@/lib/packs/store'
import type { listAllCustomers } from '@/lib/customers/list-all'
import type { CustomerWithStaff } from '@/lib/customers/queries'
import type { StaffMember } from '@/lib/staff'
import type { CustomerPassport } from '@/lib/karute/ai-passport'
import type { PackWithUsage, CustomerLifecycle } from '@/lib/packs/types'

function prettyDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: locale === 'ja' ? 'long' : 'short',
    day: 'numeric',
  })
}

function weekdayLabel(dt: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    weekday: 'short',
  }).format(dt)
}

/** Everything CustomerProfileView consumes — the moved builder's output. */
export interface CustomerProfileScreen {
  customer: CustomerProfileData
  sessions: CustomerSessionEntry[]
  photos: CustomerPhoto[]
  customerMemory: CustomerMemory
  packs: PackWithUsage[]
  lifecycle: CustomerLifecycle | null
  hasNextBooking: boolean
  ticketsEnabled: boolean
  consentGranted: boolean
  consentGrantedAtLabel: string | null
  /** Tenant staff roster for the 指名スタッフ picker (CustomerEditDialog →
   *  CustomerForm). {id,name} shape, so both the web page and the thin edit
   *  dialog seed the picker straight from this screen build — no client-side
   *  server-action read either platform has to make. */
  assignableStaff: { id: string; name: string }[]
}

export interface BuildCustomerProfileScreenArgs {
  customer: CustomerWithStaff
  id: string
  businessId: string
  locale: string
  contact: { phone: string | null; email: string | null }
  staffList: StaffMember[]
  photosResult: {
    photos: Array<{
      id: string
      signed_url: string | null
      category: string
      caption: string | null
    }>
  }
  allCustomersList: Awaited<ReturnType<typeof listAllCustomers>>
  synqedKaruteRows: KaruteListRow[]
  /** synqed-core staff roster for the id-space translation below — null when
   *  the fetch failed (graceful: names degrade exactly as before). */
  synqedStaff: { staff: Array<{ id: string; user_id?: string | null }> } | null
  enrichment: Map<string, CustomerEnrichment>
  consentResult: {
    consent: { granted_at?: string | null; policy_version?: string | null } | null
  }
  memoryItemsRead: MemoryItem[]
  aiPassport: CustomerPassport | null
  orgSettingsForPassport: { business_type?: string; ticket_packs_enabled?: boolean } | null
  lifecycleRead: Awaited<ReturnType<typeof getCustomerLifecycleChecked>>
  packs: PackWithUsage[]
}

export async function buildCustomerProfileScreen(
  args: BuildCustomerProfileScreenArgs,
): Promise<CustomerProfileScreen> {
  const {
    customer,
    id,
    businessId,
    locale,
    contact,
    staffList,
    synqedStaff,
    photosResult,
    allCustomersList,
    synqedKaruteRows,
    enrichment,
    consentResult,
    memoryItemsRead,
    aiPassport,
    orgSettingsForPassport,
    lifecycleRead,
    packs,
  } = args

  type KaruteRow = {
    id: string
    session_date: string | null
    created_at: string
    summary: string | null
    staff_profile_id: string | null
    entries: Array<{ count: number }> | null
    service?: string | null
    duration_minutes?: number | null
  }
  // mergeKaruteRows still gives the sort + cap; no Supabase side to union now.
  const karuteRecords = mergeKaruteRows<KaruteRow>([], synqedKaruteRows)
  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )
  // Karute rows carry core's staff_id verbatim across MIXED writer id spaces
  // (recording pipeline = synqed staff id, interactive saves = profile id —
  // Liam field report 7/24, 担当 "Unknown"). Same boundary translation as
  // appointments (by-date.ts): synqed id → profile id; profile ids pass
  // through unchanged.
  const profileByStaffId = new Map(
    (synqedStaff?.staff ?? [])
      .filter((s): s is typeof s & { user_id: string } => s.user_id != null)
      .map((s) => [s.id, s.user_id]),
  )

  // ─── Customer memory (お客様メモリー card) ───────────────────────────────
  // Store read happens in the wave above; if empty, bootstrap ONCE from this
  // customer's past transcripts (the same backfill the pre-session brief
  // uses). The result is cached (1d) so it never re-runs the OpenAI call per
  // page view — and once the customer_memory_items table is migrated, the
  // store itself short-circuits the backfill (items.length > 0). Best-effort:
  // empty card if the table is absent.
  let memoryItems = memoryItemsRead
  // Trigger on REAL memory only (same rule as ai-brief.ts): the table also
  // holds 'passport' rows, and a staff-filled passport with zero memory items
  // must still bootstrap — a passport row alone suppressed it forever.
  const hasRealMemory = memoryItemsRead.some((m) =>
    (MEMORY_CATEGORIES as string[]).includes(m.category),
  )
  if (!hasRealMemory) {
    // synqedKaruteRows (not the merged KaruteRow) carry the transcript field.
    // Newest-first BEFORE slicing — backfill's contract (its over-cap keep and
    // oldest→newest chunk walk both assume it; core's list order is not
    // guaranteed). Same sort as the 再学習 action (actions/memory.ts).
    const rowsNewestFirst = [...synqedKaruteRows].sort((a, b) =>
      (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    )
    const transcripts = rowsNewestFirst
      .map((r) => ({
        text: r.transcript ?? '',
        date: r.session_date ?? r.created_at ?? null,
      }))
      .filter((t) => t.text.trim())
    if (transcripts.length > 0) {
      const cacheKey = { c: id, t: rowsNewestFirst.map((r) => r.id) }
      const cached = (await getCachedAI('memory-backfill', cacheKey)) as
        | MemoryItem[]
        | null
      if (cached) {
        memoryItems = cached
      } else {
        memoryItems = await backfillMemoryFromTranscripts({
          customerId: id,
          businessId,
          transcripts,
          locale,
          // This await sits INSIDE the server render: bound it to the newest
          // 2 chunks (10 sessions ≈ 2 sequential LLM calls). The full history
          // walk belongs to the explicit 再学習 action, not a page load.
          maxChunks: 2,
        })
        await setCachedAI('memory-backfill', cacheKey, memoryItems, 1)
      }
    }
  }
  // Passport field labels come from the business tokens; staff-override rows
  // merge in buildCustomerMemory.
  const passportFieldDefs = resolvePassportFields(
    orgSettingsForPassport?.business_type,
    locale,
  )
  // 初回来店 is mechanical truth — earliest recorded session, else the
  // customer's registration date. Never asked of the AI.
  const firstVisitAt =
    synqedKaruteRows
      .map((r) => r.session_date ?? r.created_at)
      .filter((d): d is string => !!d)
      .sort()[0] ??
    customer.created_at ??
    null
  const customerMemory = buildCustomerMemory(memoryItems, id, {
    fieldDefs: passportFieldDefs,
    ai: aiPassport,
    firstVisitAt: firstVisitAt ? firstVisitAt.slice(0, 10) : null,
  })

  // 回数券 + lifecycle (卒業/離客/口コミ) were read in the wave above; the
  // same toggle the pack fetch was gated on still drives the JSX below.
  const ticketsEnabled = orgSettingsForPassport?.ticket_packs_enabled ?? true
  const lifecycle = lifecycleRead.ok ? lifecycleRead.lifecycle : null
  // Real ledger signal: any active counted pack → 回数券 holder, regardless of
  // whether the QR flag has synced. Joins the status resolver + the 回数券あり
  // chip so a manually-registered pack reads consistently everywhere.
  const hasActivePack = packs.some((p) => p.status === 'active' && p.kind === 'pack')

  // SAME last-visit rule as the list (effectiveLastVisitIso): enrichment
  // (karute + past appointments, incl. imported visits) beats the customer
  // field, beats karute-only. The header read customer.last_visit_at alone —
  // which core never persists — so imported customers showed 前回 — up top
  // while their own pack card below was correct.
  const lastVisitIso = effectiveLastVisitIso(
    enrichment.get(id)?.lastVisitIso ??
      karuteRecords[0]?.session_date ??
      karuteRecords[0]?.created_at ??
      null,
    customer.last_visit_at,
  )
  // Returning signal = the MAX of QR visit_count AND the actual karute history.
  // A customer can have many recorded sessions but visit_count 0 (hand-added, or
  // QR never synced the count) — ぴあそん has 11 karute but visit_count 0, so
  // passing visit_count alone wrongly flagged her 新規. The list page already
  // uses the karute count; this aligns the profile with it.
  // SINGLE SOURCE: identical signals + resolver as the list/recording/agenda, so
  // this customer's badge is the same on every page (the chopstick — computed
  // once, shown everywhere).
  const statusSignals = {
    joinDateIso: customer.created_at,
    lastVisitIso,
    isExistingCustomer: customer.is_existing_customer,
    visitCount: customer.visit_count,
    karuteCount: karuteRecords.length,
    pastAppointmentCount: enrichment.get(id)?.pastAppointmentCount,
    hasTicketPack: (customer.has_ticket_pack ?? false) || hasActivePack,
  }
  const status = resolveCustomerStatus({
    ...statusSignals,
    // Same booking signal as the list — a booked customer is never a chase
    // target on ANY surface (chopstick).
    hasUpcomingBooking: !!enrichment.get(id)?.nextAppointmentIso,
    // Same lifecycle signal as the list — a 卒業 customer must read slate 卒業
    // HERE too, never red 休眠 (the lifecycle fetch above already has it).
    lifecycleStatus: lifecycle?.status,
  })

  // 来店ペース — cadence computed from the RECONCILED dated visit series (the
  // field fix: first AND last go through the appointment/karute reconciliation,
  // not the raw QR scalars that are NULL for most customers). Advice and the
  // numbers come from this one source, so they rise/fall together.
  const enr = enrichment.get(id)
  const visitPace = computeVisitPace({
    firstVisitIso: effectiveFirstVisitIso(enr?.firstVisitIso, customer.first_visit_at),
    lastVisitIso,
    datedVisitCount: enr?.datedVisitCount ?? 0,
    totalVisits: customerVisitCount(statusSignals),
    isReturning: isReturningCustomer(statusSignals),
    // Fail closed on an errored read — never coach a possibly-released customer.
    isTerminal:
      !lifecycleRead.ok || lifecycle?.status === 'graduated' || lifecycle?.status === 'lost',
  })
  const visitPaceLastVisitDate = formatCompactDate(lastVisitIso, locale, new Date(), {
    withWeekday: true,
  })

  // "Currently granted" — same isConsentCurrent check the recording gate uses
  // (a stale-policy-version consent doesn't count), so the Privacy tab's
  // revoke row and the record-page consent pill never disagree.
  const consentGranted = isConsentCurrent(consentResult.consent)
  const consentGrantedAtLabel = consentResult.consent?.granted_at
    ? prettyDate(consentResult.consent.granted_at, locale)
    : null

  const photos: CustomerPhoto[] = (photosResult.photos ?? []).map((p) => ({
    id: p.id,
    signedUrl: p.signed_url,
    category: p.category,
    caption: p.caption,
  }))

  const sessions: CustomerSessionEntry[] = karuteRecords.map((r, i) => {
    const dt = new Date(r.session_date ?? r.created_at)
    const entryCount = Array.isArray(r.entries) ? (r.entries[0]?.count ?? 0) : 0
    return {
      id: r.id,
      karuteId: r.id,
      date: prettyDate(r.session_date ?? r.created_at, locale),
      weekday: weekdayLabel(dt, locale),
      // Real fields from synqed-core (2026-06-11 migration); '—' / 0
      // remain the honest "unset" displays for records that predate
      // the columns (renderer gates duration display on > 0).
      service: r.service || '—',
      duration: r.duration_minutes ?? 0,
      summary: r.summary ?? '—',
      staffName: r.staff_profile_id
        ? (staffNameById.get(
            profileByStaffId.get(r.staff_profile_id) ?? r.staff_profile_id,
          ) ?? 'Unknown')
        : 'Unknown',
      entryCount,
      aiSummarized: Boolean(r.summary),
      memoryAdded: null,
      isLatest: i === 0,
    }
  })

  const preferredStaffId: string | null = customer.assigned_staff_id ?? null
  const bookingStaffId: string | null = enrichment.get(id)?.bookingStaffId ?? null

  const profile: CustomerProfileData = {
    id: customer.id,
    name: customer.name,
    initials: deriveFamilyInitials(customer.name),
    karuteNumber:
      assignSequentialKaruteNumbers(allCustomersList.customers).get(
        customer.id,
      ) ??
      // Soft-deleted customers drop out of the list the sequential map is
      // built from — fall back to their real chart number, not '#00000'.
      (customer.karute_number
        ? `#${String(customer.karute_number).padStart(5, '0')}`
        : '#00000'),
    deletedAt: customer.deleted_at,
    age: computeAge(customer.date_of_birth),
    gender: jpGender(customer.gender),
    dateOfBirth: customer.date_of_birth,
    genderCode: customer.gender,
    joinDate: formatJoinDate(customer.created_at, locale),
    totalKarute: karuteRecords.length,
    // SAME 来店 count as the list (customerVisitCount — the max of every
    // visit evidence incl. imported past appointments), so the header and the
    // list can never disagree.
    visitCount: customerVisitCount(statusSignals),
    phone: contact.phone ?? customer.phone,
    email: contact.email ?? customer.email,
    bookingMemo: customer.notes ?? null,
    occupation: customer.occupation,
    memberNumber: customer.member_number,
    hasTicketPack: (customer.has_ticket_pack ?? false) || hasActivePack,
    isBirthdayMonth: isBirthdayMonth(customer.date_of_birth),
    lastVisitDate: lastVisitIso ? formatJoinDate(lastVisitIso, locale) : null,
    preferredStaffId,
    preferredStaffName: preferredStaffId
      ? (staffNameById.get(preferredStaffId) ?? null)
      : null,
    bookingStaffName: bookingStaffId
      ? (staffNameById.get(bookingStaffId) ?? null)
      : null,
    status,
    visitPace,
    visitPaceLastVisitDate,
    visitPaceLastService: enr?.lastVisitService ?? null,
    memoryCount: customerMemory.items.length,
    sessionCount: karuteRecords.length,
    photoCount: photos.length,
    noShowCount: enr?.noShowCount ?? 0,
  }

  return {
    customer: profile,
    sessions,
    photos,
    customerMemory,
    packs,
    lifecycle,
    hasNextBooking: !!enrichment.get(id)?.nextAppointmentIso,
    ticketsEnabled,
    consentGranted,
    consentGrantedAtLabel,
    assignableStaff: staffList.map((s) => ({ id: s.id, name: s.full_name ?? 'Unknown' })),
  }
}
