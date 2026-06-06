import { notFound } from 'next/navigation'

import { getCustomer } from '@/lib/customers/queries'
import { computeAge, jpGender, isBirthdayMonth } from '@/lib/customers/demographics'
import { getCustomerContact } from '@/lib/customers/customer-detail-cached'
import { getStaffList, getBusinessId } from '@/lib/staff'
import { createServiceClient } from '@/lib/supabase/service'
import { getSynqedClient } from '@/lib/synqed/client'
import { listSynqedKaruteRows, mergeKaruteRows } from '@/lib/karute/synqed-records'
import { listCustomerPhotos } from '@/actions/customers'
import { CustomerProfileView } from '@/components/customers/redesign/profile/CustomerProfileView'
import type { CustomerProfileData } from '@/components/customers/redesign/types'
import {
  resolveCustomerStatus,
  enrichCustomers,
  formatJoinDate,
} from '@/lib/customers/list-enrich'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import type { CustomerSessionEntry } from '@/components/customers/redesign/profile/SessionsTabContent'
import type { CustomerPhoto } from '@/components/customers/redesign/profile/PhotosTabContent'

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
  // karute_records for the customer, and photos.
  const businessId = await getBusinessId()
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = service as any

  // Also fetch the full tenant customer list so we can compute the
  // sequential karute number for this customer in the same way the
  // list page does (sort by created_at, assign 1-based index). The
  // numbers stay consistent across both views until Anthony adds the
  // real `customers.karute_number` column.
  const synqed = await getSynqedClient()

  const [contact, staffList, karuteRes, photosResult, allCustomersList, synqedKaruteRows, enrichment] =
    await Promise.all([
      getCustomerContact(id),
      getStaffList(),
      sb
        .from('karute_records')
        .select(
          'id, session_date, created_at, summary, staff_profile_id, customer_id, client_id, entries(count)',
        )
        .eq('customer_id', businessId)
        .eq('client_id', id)
        .order('session_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      listCustomerPhotos(id).catch(() => ({
        photos: [] as Array<{
          id: string
          signed_url: string | null
          category: string
          caption: string | null
        }>,
      })),
      synqed.customers.list({
        page: 1,
        page_size: 500,
        sort_by: 'created_at',
        sort_order: 'asc',
      }),
      // synqed-core is the authoritative karute store; the Supabase query above
      // is effectively empty. Union both so this customer's synqed-written
      // sessions appear in their history.
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
  }
  const karuteRecords = mergeKaruteRows<KaruteRow>(
    (karuteRes.data ?? []) as KaruteRow[],
    synqedKaruteRows,
  )
  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )

  const lastVisitIso =
    karuteRecords[0]?.session_date ?? karuteRecords[0]?.created_at ?? null
  // Returning signal = the MAX of QR visit_count AND the actual karute history.
  // A customer can have many recorded sessions but visit_count 0 (hand-added, or
  // QR never synced the count) — ぴあそん has 11 karute but visit_count 0, so
  // passing visit_count alone wrongly flagged her 新規. The list page already
  // uses the karute count; this aligns the profile with it.
  // SINGLE SOURCE: identical signals + resolver as the list/recording/agenda, so
  // this customer's badge is the same on every page (the chopstick — computed
  // once, shown everywhere).
  const status = resolveCustomerStatus({
    joinDateIso: customer.created_at,
    lastVisitIso,
    isExistingCustomer: customer.is_existing_customer,
    visitCount: customer.visit_count,
    karuteCount: karuteRecords.length,
    pastAppointmentCount: enrichment.get(id)?.pastAppointmentCount,
    hasTicketPack: customer.has_ticket_pack,
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
      // Service '—' + duration 0 instead of literal 'Session' /
      // 60 — same '施術' bug fixed on the main karute list. The
      // session-row renderer should gate the duration display on
      // `duration > 0` so the line hides instead of rendering "0 min".
      // ANTHONY: when karute_records gains `service` + `duration_minutes`
      // columns, pass the real values.
      service: '—',
      duration: 0,
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
    // Lifetime visit count from external sync (QuickReserve visits_number_cache);
    // 0 for in-app-only customers. The identity card shows the larger of this
    // and the karute count so returning customers don't read as "0 visits".
    visitCount: customer.visit_count,
    phone: contact.phone ?? customer.phone,
    email: contact.email ?? customer.email,
    bookingMemo: customer.notes ?? null,
    occupation: customer.occupation,
    memberNumber: customer.member_number,
    hasTicketPack: customer.has_ticket_pack,
    isBirthdayMonth: isBirthdayMonth(customer.date_of_birth),
    lastVisitDate: customer.last_visit_at
      ? formatJoinDate(customer.last_visit_at, locale)
      : null,
    preferredStaffId,
    preferredStaffName: preferredStaffId
      ? (staffNameById.get(preferredStaffId) ?? null)
      : null,
    bookingStaffName: bookingStaffId
      ? (staffNameById.get(bookingStaffId) ?? null)
      : null,
    nextVisitPredicted: status === 'dormant' ? 'Re-engage' : '—',
    status,
    memoryCount: 0, // Customer Memory backend not built yet
    sessionCount: karuteRecords.length,
    photoCount: photos.length,
  }

  return (
    <CustomerProfileView
      customer={profile}
      sessions={sessions}
      photos={photos}
    />
  )
}
