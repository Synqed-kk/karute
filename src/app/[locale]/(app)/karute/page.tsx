import { getSynqedClient } from '@/lib/synqed/client'
import { getStaffList } from '@/lib/staff'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { KaruteListView } from '@/components/karute/KaruteListView'
import {
  karuteRecordsToRichRows,
  type KaruteListRecord,
} from '@/lib/adapters/karute-list'

/**
 * Karute records list page at /[locale]/karute.
 *
 * Reads through synqed-core (the source of truth) — the same path the detail
 * page and the save flow use. Customer + staff names aren't joined by the list
 * endpoint, so we resolve them from the cached roster + customer list and remap
 * to the list adapter's historical field names.
 */
export default async function KaruteListPage() {
  const [{ karute_records }, staffList, customers] = await Promise.all([
    getSynqedClient().then((c) => c.karuteRecords.list({ page_size: 100 })),
    getStaffList(),
    getCachedCustomerList(),
  ])

  const staffNameById = new Map(staffList.map((s) => [s.id, s.full_name ?? '—']))
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]))

  const records: KaruteListRecord[] = karute_records.map((r) => ({
    id: r.id,
    // synqed-core has no dedicated session_date column; created_at drives both
    // the date bucket and the time, matching the detail page.
    session_date: r.created_at,
    created_at: r.created_at,
    summary: r.ai_summary,
    transcript: r.transcript,
    staff_profile_id: r.staff_id,
    customers: r.customer_id
      ? { id: r.customer_id, name: customerNameById.get(r.customer_id) ?? 'Unknown' }
      : null,
    profiles: r.staff_id
      ? { id: r.staff_id, full_name: staffNameById.get(r.staff_id) ?? '—' }
      : null,
    entries: [{ count: r.entry_count ?? 0 }],
  }))

  const rows = karuteRecordsToRichRows(records)

  return <KaruteListView rows={rows} />
}
