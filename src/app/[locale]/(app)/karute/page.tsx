import {
  getBusinessId,
  getCurrentUserStaffId,
  getStaffList,
} from '@/lib/staff'
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
 * Phase A (this commit): one row per karute record, date-grouped,
 * AI status badges, karute-specific filters. Matches the design
 * spike's KaruteList structure end-to-end.
 *
 * Phase B (next): append placeholder rows for customers with NO
 * karute records yet so brand-new customers still appear (Liam's
 * earlier ask). Today they're invisible on this tab; the customer-
 * centric chip-row view we shipped previously is still reachable
 * via the 顧客 tab → tap a customer → karute detail page.
 *
 * ANTHONY: karute_records currently lacks `service` (text) and
 * `duration_minutes` (int) columns. The row renderer expects both;
 * for now we fall back to "施術" + 0 minutes. Adding those columns
 * (+ a brief service-type config UI) makes the row read with real
 * salon-treatment context.
 */
export default async function KaruteRecordsListPage() {
  const supabase = await createClient()
  const businessId = await getBusinessId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const synqed = await getSynqedClient()

  const [recordsRes, staffList, allCustomersList, currentStaffId] =
    await Promise.all([
      sb
        .from('karute_records')
        .select(
          'id, session_date, created_at, summary, transcript, staff_profile_id, client_id, entries(count)',
        )
        .eq('customer_id', businessId)
        .order('session_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(200),
      getStaffList(),
      synqed.customers.list({
        page: 1,
        page_size: 500,
        sort_by: 'created_at',
        sort_order: 'asc',
      }),
      getCurrentUserStaffId(),
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

  const records = ((recordsRes.data ?? []) as RecordRow[]).map((r) => r)

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
      // ANTHONY: service + duration aren't on karute_records yet —
      // fallback values until the schema gets those columns.
      service: '施術',
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

  // Phase B: synthesize placeholder rows for customers with NO records
  // yet. Each links to /karute/customer/[id] (the customer's karute
  // folder view) so staff can drop in and start the first session.
  // Sorted newest-customer-first so the most recent signups bubble up.
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
        // ANTHONY: when service + duration columns land on karute_records,
        // these stay empty for placeholder rows (no session yet). The
        // string here is the user-facing label shown in lieu of a service.
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
    />
  )
}

// Local createClient import — avoids re-resolving via the top-level
// import dance that depends on cookies()
import { createClient } from '@/lib/supabase/server'
