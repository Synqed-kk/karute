import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { CustomersListView } from '@/components/customers/redesign/list/CustomersListView'
import type { CustomerListRow } from '@/components/customers/redesign/types'
import {
  defaultAiPredict,
  deriveKaruteNumber,
  deriveStatus,
  enrichCustomers,
  formatJoinDate,
  formatLastVisit,
} from '@/lib/customers/list-enrich'
import { getBusinessId } from '@/lib/staff'
import { startTiming } from '@/lib/perf/timing'

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string }>
}) {
  const { query: rawQuery } = await searchParams
  const query = rawQuery ?? ''

  const t = startTiming(`customers q="${query}"`)
  const synqed = await getSynqedClient()

  // Fetch the full tenant customer list (capped at 500 — same as the cached
  // list elsewhere). For search/sort/pagination we'd switch to the original
  // server-side params, but the redesigned list filters in-memory.
  const [list, staffList, activeStaffId, businessId] = await Promise.all([
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
  ])

  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )

  const customerIds = list.customers.map((c) => c.id)
  const enrichment = await t.phase('enrichCustomers', () =>
    enrichCustomers(businessId, customerIds),
  )
  t.end()

  const rows: CustomerListRow[] = list.customers.map((c) => {
    const enriched = enrichment.get(c.id)
    const lastVisitIso = enriched?.lastVisitIso ?? null
    const status = deriveStatus(c.created_at, lastVisitIso)
    const last = formatLastVisit(lastVisitIso)
    const totalKarute = enriched?.totalKarute ?? 0
    return {
      id: c.id,
      name: c.name,
      initials: deriveInitials(c.name),
      karuteNumber: deriveKaruteNumber(c.id),
      // Stubs — these fields don't exist on the customer record yet.
      age: null,
      gender: null,
      joinDate: formatJoinDate(c.created_at),
      joinDateIso: c.created_at ?? null,
      visitsDone: Math.min(totalKarute, 5),
      visitsTotal: 5,
      lastVisitDate: last.date,
      lastVisitAgo: last.ago,
      aiPredict: defaultAiPredict(status),
      status,
      preferredStaffId: c.assigned_staff_id ?? null,
      preferredStaffName: c.assigned_staff_id
        ? (staffNameById.get(c.assigned_staff_id) ?? null)
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
    return { id: s.id, name, initials: deriveInitials(name) }
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
