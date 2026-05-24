import { getLocale, getTranslations } from 'next-intl/server'
import {
  getCurrentUserStaffId,
  getStaffList,
  getBusinessId,
} from '@/lib/staff'
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
import { startTiming } from '@/lib/perf/timing'

/**
 * カルテ tab — customer-centric karute list.
 *
 * Mirrors the design-spike's mental model: each customer has one
 * "karute folder" that accumulates over time. So the karute tab is
 * a list of CUSTOMERS (not session records), even when a customer
 * has no recordings yet — they appear with the AI surfaces in
 * "対応予定" state.
 *
 * Implementation: fetches the same customer data as the 顧客 tab,
 * renders the same CustomersListView with `karuteContext={true}` so
 * each row also displays the AI-status chip footer (体調予測 / 推奨
 * / 要約 / 録音, all 対応予定 until Anthony wires them).
 *
 * ANTHONY: the PREVIOUS implementation of this page rendered a
 * chronological list of karute_records (session-centric view). That
 * component (KaruteListView at src/components/karute/KaruteListView
 * + the karuteRecordsToRichRows adapter) is still in the tree —
 * left intact so you can decide whether to:
 *   (a) keep this customer-centric view as the canonical /karute
 *       (matches spike + Liam's product spec), and reinstate the
 *       session-stream view as a separate sub-route like
 *       /karute/sessions or /karute/feed, OR
 *   (b) restore the session-stream as default and move the
 *       customer-centric view here to /karute/customers
 * Either choice is reversible — only this single page.tsx changes.
 */
export default async function KaruteListPage() {
  const t = startTiming('karute (customer-centric)')
  const synqed = await getSynqedClient()

  const [list, staffList, activeStaffId, businessId, locale, lvT] = await Promise.all([
    t.phase('customers.list', () =>
      synqed.customers.list({
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

  const karuteNumberById = assignSequentialKaruteNumbers(list.customers)

  const rows: CustomerListRow[] = list.customers.map((c) => {
    const enriched = enrichment.get(c.id)
    const lastVisitIso = enriched?.lastVisitIso ?? null
    const status = deriveStatus(c.created_at, lastVisitIso)
    const last = formatLastVisit(lastVisitIso, locale, lastVisitStrings)
    const totalKarute = enriched?.totalKarute ?? 0
    return {
      id: c.id,
      name: c.name,
      initials: deriveFamilyInitials(c.name),
      karuteNumber: karuteNumberById.get(c.id) ?? '#00000',
      age: null,
      gender: null,
      joinDate: formatJoinDate(c.created_at, locale),
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

  const staffForFilter = staffList.map((s) => {
    const name = s.full_name ?? 'Unknown'
    return { id: s.id, name, initials: deriveFamilyInitials(name) }
  })

  return (
    <CustomersListView
      rows={rows}
      totalRegistered={list.total}
      query=""
      selfStaffId={activeStaffId}
      staffList={staffForFilter}
      karuteContext
    />
  )
}
