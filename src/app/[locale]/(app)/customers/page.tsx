import { getLocale, getTranslations } from 'next-intl/server'
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { CustomersListView } from '@/components/customers/redesign/list/CustomersListView'
import type { CustomerListRow } from '@/components/customers/redesign/types'
import {
  defaultAiPredict,
  deriveStatus,
  enrichCustomers,
  formatJoinDate,
  formatLastVisit,
  type LastVisitStrings,
} from '@/lib/customers/list-enrich'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import { getBusinessId } from '@/lib/staff'
import { startTiming } from '@/lib/perf/timing'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string }>
}) {
  const { query: rawQuery } = await searchParams
  const query = rawQuery ?? ''

  const t = startTiming(`customers q="${query}"`)
  const synqed = await getSynqedClient()

  // Locale + translated relative-time strings, pulled once at page level
  // and threaded into the (synchronous) formatters so JP users see
  // "前回 2026年5月24日 (本日)" instead of "Today" / "May 24, 2026".
  const [list, staffList, activeStaffId, businessId, locale, lvT] = await Promise.all([
    t.phase('customers.list', () =>
      synqed.customers.list({
        search: query.trim() || undefined,
        page: 1,
        page_size: 500,
        sort_by: 'updated_at',
        sort_order: 'desc',
      }),
    ),
    t.phase('staffList', () => getStaffList()),
    t.phase('activeStaffId', () => getCurrentUserStaffId()),
    t.phase('businessId', () => getBusinessId()),
    getLocale(),
    getTranslations('customers.list.lastVisit'),
  ])

  const lastVisitStrings: LastVisitStrings = {
    noVisits: lvT('noVisits'),
    today: lvT('today'),
    oneDayAgo: lvT('oneDayAgo'),
    daysAgo: (n) => lvT('daysAgo', { n }),
    monthsAgo: (n) => lvT('monthsAgo', { n }),
  }

  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )

  const customerIds = list.customers.map((c) => c.id)
  const enrichment = await t.phase('enrichCustomers', () =>
    enrichCustomers(businessId, customerIds),
  )
  t.end()

  // Sequential per-tenant karute numbers — sorted by created_at so the
  // oldest customer gets #00001, etc. Computed in-memory until Anthony
  // adds the real `customers.karute_number` column. Same helper used on
  // the profile page so a customer's number is consistent across views.
  const karuteNumberById = assignSequentialKaruteNumbers(list.customers)

  const rows: CustomerListRow[] = list.customers.map((c) => {
    const enriched = enrichment.get(c.id)
    const lastVisitIso = enriched?.lastVisitIso ?? null
    const status = deriveStatus(
      c.created_at,
      lastVisitIso,
      c.is_existing_customer,
      Math.max(enriched?.totalKarute ?? 0, enriched?.pastAppointmentCount ?? 0),
    )
    const last = formatLastVisit(lastVisitIso, locale, lastVisitStrings)
    const totalKarute = enriched?.totalKarute ?? 0
    return {
      id: c.id,
      name: c.name,
      initials: deriveFamilyInitials(c.name),
      karuteNumber: karuteNumberById.get(c.id) ?? '#00000',
      // Stubs — these fields don't exist on the customer record yet.
      age: null,
      gender: null,
      joinDate: formatJoinDate(c.created_at, locale),
      joinDateIso: c.created_at ?? null,
      visitsDone: Math.min(totalKarute, 5),
      visitsTotal: 5,
      lastVisitDate: last.date,
      lastVisitAgo: last.ago,
      lastVisitService: enriched?.lastVisitService ?? null,
      aiPredict: defaultAiPredict(status),
      status,
      preferredStaffId: c.assigned_staff_id ?? null,
      preferredStaffName: c.assigned_staff_id
        ? (staffNameById.get(c.assigned_staff_id) ?? null)
        : null,
      bookingStaffId: enriched?.bookingStaffId ?? null,
      bookingStaffName: enriched?.bookingStaffId
        ? (staffNameById.get(enriched.bookingStaffId) ?? null)
        : null,
      totalKarute,
      phone: c.phone,
      email: c.email,
    }
  })

  // Project the staff roster into the lightweight shape the filter pills
  // need (id + display name + initials). Initials reuse `deriveInitials`
  // so the same algorithm runs for both customer avatars and staff pills
  // — kanji names get a single-char initial, ASCII names get first+last.
  const staffForFilter = staffList.map((s) => {
    const name = s.full_name ?? 'Unknown'
    return { id: s.id, name, initials: deriveFamilyInitials(name) }
  })

  return (
    <CustomersListView
      rows={rows}
      totalRegistered={list.total}
      query={query}
      selfStaffId={activeStaffId}
      staffList={staffForFilter}
    />
  )
}
