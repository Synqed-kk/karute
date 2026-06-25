import { notFound } from 'next/navigation'

import { getCustomer } from '@/lib/customers/queries'
import { computeAge, jpGender, isBirthdayMonth } from '@/lib/customers/demographics'
import { getCustomerContact } from '@/lib/customers/customer-detail-cached'
import { getStaffList, getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { listSynqedKaruteRows, mergeKaruteRows } from '@/lib/karute/synqed-records'
import { listAllCustomers } from '@/lib/customers/list-all'
import { listCustomerPhotos } from '@/actions/customers'
import { getCustomerMemory } from '@/lib/karute/customer-memory'
import { backfillMemoryFromTranscripts } from '@/lib/karute/memory-ingest'
import { buildCustomerMemory } from '@/lib/karute/memory-adapter'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import type { MemoryItem } from '@/lib/karute/memory-types'
import { CustomerProfileView } from '@/components/customers/redesign/profile/CustomerProfileView'
import type { CustomerProfileData } from '@/components/customers/redesign/types'
import {
  customerVisitCount,
  effectiveLastVisitIso,
  effectiveFirstVisitIso,
  isReturningCustomer,
  resolveCustomerStatus,
  enrichCustomers,
  formatJoinDate,
  formatCompactDate,
} from '@/lib/customers/list-enrich'
import { computeVisitPace } from '@/lib/visits/pace'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import type { CustomerSessionEntry } from '@/components/customers/redesign/profile/SessionsTabContent'
import type { CustomerPhoto } from '@/components/customers/redesign/profile/PhotosTabContent'
import { getCustomerLifecycle, listCustomerPacks } from '@/lib/packs/store'

interface CustomerProfilePageProps {
  params: Promise<{ id: string; locale: string }>
}

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

export default async function CustomerProfilePage({
  params,
}: CustomerProfilePageProps) {
  const { id, locale } = await params
  const customer = await getCustomer(id).catch(() => null)
  if (!customer) notFound()

  // Fetch supporting data in parallel: contact (cached), staff list (cached),
  // karute sessions (from synqed-core), and photos.
  const businessId = await getBusinessId()

  // Also fetch the full tenant customer list for the karute-number
  // helper (it prefers the persisted customers.karute_number and only
  // derives sequentially for rows without one), keeping this view
  // consistent with the list page.
  const synqed = await getSynqedClient()

  const [contact, staffList, photosResult, allCustomersList, synqedKaruteRows, enrichment] =
    await Promise.all([
      getCustomerContact(id),
      getStaffList(),
      listCustomerPhotos(id).catch(() => ({
        photos: [] as Array<{
          id: string
          signed_url: string | null
          category: string
          caption: string | null
        }>,
      })),
      // Page to completion so an overflow customer (#500+) still resolves its
      // karute number + name here instead of falling back to #00000.
      listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
      // synqed-core is the sole karute store (the Supabase karute_records table
      // is empty and being dropped).
      listSynqedKaruteRows(synqed, { customerId: id }),
      // 担当 fallback: the booking's staff when this customer has no 指名
      // (assigned_staff_id) — QR-synced customers never do. Same source as the
      // list page so the profile's 担当 matches the card.
      enrichCustomers(businessId, [id]),
    ])

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

  // ─── Customer memory (お客様メモリー card) ───────────────────────────────
  // Read the persistent store; if empty, bootstrap ONCE from this customer's
  // past transcripts (the same backfill the pre-session brief uses). The result
  // is cached (1d) so it never re-runs the OpenAI call per page view — and once
  // the customer_memory_items table is migrated, the store itself short-circuits
  // the backfill (items.length > 0). Best-effort: empty card if the table is
  // absent.
  let memoryItems = await getCustomerMemory(id)
  if (memoryItems.length === 0) {
    // synqedKaruteRows (not the merged KaruteRow) carry the transcript field.
    const transcripts = synqedKaruteRows
      .map((r) => r.transcript ?? '')
      .filter((t) => t.trim())
    if (transcripts.length > 0) {
      const cacheKey = { c: id, t: synqedKaruteRows.map((r) => r.id) }
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
        })
        await setCachedAI('memory-backfill', cacheKey, memoryItems, 1)
      }
    }
  }
  const customerMemory = buildCustomerMemory(memoryItems, id)

  // 回数券 + lifecycle (卒業/離客/口コミ) — best-effort: empty card / no chips
  // until the ticket_packs migration is applied (store degrades gracefully).
  const [packs, lifecycle] = await Promise.all([
    listCustomerPacks(id),
    getCustomerLifecycle(id),
  ])
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
    isTerminal: lifecycle?.status === 'graduated' || lifecycle?.status === 'lost',
  })
  const visitPaceLastVisitDate = formatCompactDate(lastVisitIso, locale, new Date(), {
    withWeekday: true,
  })

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
        ? (staffNameById.get(r.staff_profile_id) ?? 'Unknown')
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
      ) ?? '#00000',
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
    memoryCount: memoryItems.length,
    sessionCount: karuteRecords.length,
    photoCount: photos.length,
  }

  return (
    <CustomerProfileView
      customer={profile}
      sessions={sessions}
      photos={photos}
      customerMemory={customerMemory}
      packs={packs}
      lifecycle={lifecycle}
      hasNextBooking={!!enrichment.get(id)?.nextAppointmentIso}
    />
  )
}
