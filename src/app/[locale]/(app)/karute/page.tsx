import { getStaffList } from '@/lib/staff'
import { getActiveStaffId } from '@/lib/active-staff'
import { getSynqedClient } from '@/lib/synqed/client'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import type {
  KaruteAiStatus,
  KaruteConversionStatus,
  KaruteListItem,
} from '@/components/karute/spike-lifted/list/types'

/**
 * カルテ tab — RECORD-CENTRIC list of karute sessions.
 *
 * Reads through synqed-core (the source of truth) — the same path the detail
 * page and the save flow use. One row per karute record, date-grouped, with AI
 * status badges; plus placeholder rows for customers with no records yet so
 * brand-new customers still appear.
 *
 * ANTHONY: karute_records lacks `service` (text) and `duration_minutes` (int).
 * The row renderer expects both; we send '—' + 0 until those columns land.
 */
export default async function KaruteRecordsListPage() {
  const synqed = await getSynqedClient()

  const [recordsRes, staffList, allCustomersList, currentStaffId] =
    await Promise.all([
      synqed.karuteRecords.list({ page_size: 200 }),
      getStaffList(),
      synqed.customers.list({
        page: 1,
        page_size: 500,
        sort_by: 'created_at',
        sort_order: 'asc',
      }),
      getActiveStaffId(),
    ])

  type RecordRow = {
    id: string
    session_date: string | null
    created_at: string
    summary: string | null
    transcript: string | null
    staff_profile_id: string | null
    client_id: string
    entries: Array<{ count: number }> | null
  }

  // synqed-core is the source of truth; remap to the row shape this view uses
  // (customer_id→client_id person, staff_id→staff_profile_id, ai_summary→summary).
  const records: RecordRow[] = recordsRes.karute_records.map((r) => ({
    id: r.id,
    session_date: r.created_at,
    created_at: r.created_at,
    summary: r.ai_summary,
    transcript: r.transcript,
    staff_profile_id: r.staff_id,
    client_id: r.customer_id ?? '',
    entries: [{ count: r.entry_count ?? 0 }],
  }))

  // Build lookup maps
  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )
  const customerById = new Map(
    allCustomersList.customers.map((c) => [c.id, c]),
  )
  const karuteNumberByCustomerId = assignSequentialKaruteNumbers(
    allCustomersList.customers,
  )

  const recordedCustomerIds = new Set(records.map((r) => r.client_id))

  // Project records into KaruteListItem shape
  const items: KaruteListItem[] = records.map((r) => {
    const customer = customerById.get(r.client_id)
    const customerName = customer?.name ?? '不明'
    const entryCount = Array.isArray(r.entries)
      ? (r.entries[0]?.count ?? 0)
      : 0
    const isoDate = (r.session_date ?? r.created_at).slice(0, 10)
    const dt = new Date(`${isoDate}T00:00:00+09:00`)
    const weekday = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()]

    // Derive AI status from data shape — see types.ts for rationale.
    let aiStatus: KaruteAiStatus = 'draft'
    if (r.summary && r.summary.trim().length > 0) aiStatus = 'summarized'
    else if (r.transcript && r.transcript.trim().length > 0)
      aiStatus = 'pending'

    // Conversion status — entry count is the best signal we have.
    const conversionStatus: KaruteConversionStatus =
      entryCount > 0 ? 'active' : 'provisional'

    return {
      id: r.id,
      customerId: r.client_id,
      customerName,
      customerInitials: deriveFamilyInitials(customerName),
      customerKaruteNumber:
        karuteNumberByCustomerId.get(r.client_id) ?? '#00000',
      date: isoDate,
      weekday,
      // ANTHONY: service + duration aren't on karute_records yet — sending '—'
      // + 0 so the row reads honestly as "unset" until the columns land.
      service: '—',
      duration: 0,
      staffId: r.staff_profile_id,
      staffName: r.staff_profile_id
        ? (staffNameById.get(r.staff_profile_id) ?? 'Unknown')
        : '—',
      summary: r.summary ?? '',
      aiStatus,
      conversionStatus,
      href: `/karute/${r.id}`,
    }
  })

  // Synthesize placeholder rows for customers with NO records yet. Each links
  // to /karute/customer/[id] so staff can drop in and start the first session.
  const placeholders: KaruteListItem[] = allCustomersList.customers
    .filter((c) => !recordedCustomerIds.has(c.id))
    .sort((a, b) =>
      (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    )
    .map((c) => {
      const isoDate = (c.created_at ?? new Date().toISOString()).slice(0, 10)
      const dt = new Date(`${isoDate}T00:00:00+09:00`)
      const weekday = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()]
      return {
        id: `placeholder-${c.id}`,
        customerId: c.id,
        customerName: c.name,
        customerInitials: deriveFamilyInitials(c.name),
        customerKaruteNumber:
          karuteNumberByCustomerId.get(c.id) ?? '#00000',
        date: isoDate,
        weekday,
        service: 'まだセッションなし',
        duration: 0,
        staffId: c.assigned_staff_id ?? null,
        staffName: c.assigned_staff_id
          ? (staffNameById.get(c.assigned_staff_id) ?? '—')
          : '—',
        summary: '初回セッションを記録すると、ここに表示されます',
        aiStatus: 'draft',
        conversionStatus: 'provisional',
        href: `/karute/customer/${c.id}`,
        isPlaceholder: true,
      }
    })

  // monthCount — records whose session_date falls in the current month
  const now = new Date()
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthCount = items.filter((i) => i.date.startsWith(monthPrefix)).length

  // Customer combobox source for the NewKaruteDialog (reuses the loaded list).
  const customerOptions = allCustomersList.customers.map((c) => ({
    id: c.id,
    name: c.name,
  }))

  return (
    <KaruteRecordListView
      items={items}
      monthCount={monthCount}
      placeholders={placeholders}
      staffList={staffList.map((s) => ({
        id: s.id,
        name: s.full_name ?? 'Unknown',
        initials: deriveFamilyInitials(s.full_name ?? ''),
      }))}
      currentStaffId={currentStaffId}
      customerOptions={customerOptions}
    />
  )
}
