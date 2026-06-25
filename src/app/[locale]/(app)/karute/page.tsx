import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { assignStaffColors } from '@/lib/staff-colors'
import { listSynqedKaruteRows, mergeKaruteRows } from '@/lib/karute/synqed-records'
import { listAllCustomers } from '@/lib/customers/list-all'
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
  const synqed = await getSynqedClient()

  // Booking → staff for placeholder rows. QuickReserve scrapes the 担当 onto
  // each appointment, but customer.assigned_staff_id (a separate "preferred
  // staff" field) is never set by the sync — so placeholder stripes were
  // blank. Derive 担当 from the customer's booking instead. Read the recent
  // appointment list UNWINDOWED (same as enrichCustomers): a date window keyed
  // on "today" drops a booking that has already passed (a 5/31 visit viewed on
  // 6/01), which is exactly why the first attempt still showed blank.
  const nowMs = new Date().getTime()

  const [
    staffList,
    allCustomersList,
    currentStaffId,
    synqedKaruteRows,
    apptList,
    synqedStaff,
  ] = await Promise.all([
      getStaffList(),
      // Page to completion so カルテ rows + placeholder rows resolve for every
      // customer, not just the first 500 (server clamps page_size at 500).
      // Business-wide (NOT store-scoped): karute records are business-wide, so
      // this list backs record-name enrichment AND the New カルテ dialog's
      // customer picker (which filters client-side) — scoping it would drop
      // cross-store records' names and block creating a karute for another
      // store's walk-in. Per-store roster scoping waits on the synqed-core
      // karute store filter (synqed-core #18).
      listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
      getCurrentUserStaffId(),
      // synqed-core is the sole karute store (the Supabase karute_records table
      // is empty and being dropped).
      listSynqedKaruteRows(synqed),
      // Recent appointments (UNWINDOWED, like enrichCustomers) + the synqed
      // staff roster — resolve each placeholder customer's 担当 from their
      // booking, translating the synqed staff id into the profile id the
      // color/name maps key on (same boundary translation getAppointmentsByDate
      // does). No from/to filter on purpose: a window keyed on today drops a
      // customer's already-past booking and the stripe goes blank again.
      synqed.appointments.list({ page_size: 200 }),
      synqed.staff.list({ page_size: 200 }),
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
    service?: string | null
    duration_minutes?: number | null
  }

  // mergeKaruteRows still gives us the sort (session_date ?? created_at desc) +
  // 200-cap; there's no longer a Supabase side to union in.
  const records = mergeKaruteRows<RecordRow>([], synqedKaruteRows)

  // Build lookup maps
  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )
  // DISTINCT staff colors over the FULL roster — identical map on every
  // surface, no per-id hash collisions. Resolved into staffColorKey on each
  // row below so KaruteListRow can render via getStaffColorByKey.
  const staffColors = assignStaffColors(staffList.map((s) => s.id))
  const customerById = new Map(
    allCustomersList.customers.map((c) => [c.id, c]),
  )
  const karuteNumberByCustomerId = assignSequentialKaruteNumbers(
    allCustomersList.customers,
  )

  const recordedCustomerIds = new Set(records.map((r) => r.client_id))

  // ── Booking → staff for placeholder rows ─────────────────────────────
  // synqed staff id → profile id. Appointments arrive keyed by the synqed
  // staff id; staffNameById + staffColors key off the profile id (=
  // synqed staff.user_id). Profile-less synqed staff fall back to their
  // synqed id — exactly how getStaffList ids them too, so name/color still
  // resolve. Mirrors the boundary translation in getAppointmentsByDate.
  const profileByStaffId = new Map(
    synqedStaff.staff
      .filter((s): s is typeof s & { user_id: string } => s.user_id != null)
      .map((s) => [s.id, s.user_id]),
  )

  // customer id → their booking's staff profile id. Pick the nearest
  // upcoming booking (the 担当 the customer is about to see); fall back to
  // the latest in-window booking so a customer whose only slot is earlier
  // today still resolves to a stylist.
  const bookingStaffByCustomer = new Map<string, string>()
  {
    const apptsByCustomer = new Map<string, typeof apptList.appointments>()
    for (const a of apptList.appointments) {
      const arr = apptsByCustomer.get(a.customer_id)
      if (arr) arr.push(a)
      else apptsByCustomer.set(a.customer_id, [a])
    }
    for (const [cid, appts] of apptsByCustomer) {
      const sorted = [...appts].sort(
        (x, y) =>
          new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime(),
      )
      const chosen =
        sorted.find((a) => new Date(a.starts_at).getTime() >= nowMs) ??
        sorted[sorted.length - 1]
      if (chosen) {
        bookingStaffByCustomer.set(
          cid,
          profileByStaffId.get(chosen.staff_id) ?? chosen.staff_id,
        )
      }
    }
  }

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
      // Real fields from synqed-core (2026-06-11 migration). '—' / 0
      // remain the honest "unset" displays for records that predate the
      // columns; the row's `duration > 0 && ...` guard hides the
      // duration line when unknown.
      service: r.service || '—',
      duration: r.duration_minutes ?? 0,
      staffId: r.staff_profile_id,
      staffColorKey: r.staff_profile_id
        ? (staffColors.get(r.staff_profile_id)?.key ?? null)
        : null,
      staffName: r.staff_profile_id
        ? (staffNameById.get(r.staff_profile_id) ?? 'Unknown')
        : '—',
      summary: r.summary ?? '',
      aiStatus,
      conversionStatus,
      href: `/karute/${r.id}`,
    }
  })

  // Phase B: synthesize placeholder rows for customers with NO records yet.
  // Each links to the customer hub (/customers/[id]) — the single canonical
  // customer page — so a カルテ-list tap and a 顧客-list tap land on the SAME
  // place. (Previously /karute/customer/[id], a near-duplicate of the hub that
  // the spike never had — removed for a predictable 2-page nav.)
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
      // 担当 comes from the customer's booking (QuickReserve scrapes it onto
      // the appointment). assigned_staff_id is a separate preferred-staff
      // field the sync never sets — so it was always null here, leaving the
      // stripe blank and no 担当 on the card. Fall back to it only when the
      // customer has no booking in the window.
      const bookingStaffId =
        bookingStaffByCustomer.get(c.id) ?? c.assigned_staff_id ?? null
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
        staffId: bookingStaffId,
        staffColorKey: bookingStaffId
          ? (staffColors.get(bookingStaffId)?.key ?? null)
          : null,
        staffName: bookingStaffId
          ? (staffNameById.get(bookingStaffId) ?? '—')
          : '—',
        summary: '初回セッションを記録すると、ここに表示されます',
        aiStatus: 'draft',
        conversionStatus: 'provisional',
        href: `/customers/${c.id}`,
        isPlaceholder: true,
      }
    })

  // monthCount — records whose session_date falls in the current month
  const now = new Date()
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthCount = items.filter((i) => i.date.startsWith(monthPrefix)).length

  // Customer combobox source for the NewKaruteDialog. Reuses the same
  // list we already loaded above for the customer-name lookup map —
  // no extra round trip. Shape matches the shared CustomerOption
  // contract from src/components/karute/CustomerCombobox (id + name)
  // so the dialog plugs straight into the same picker the recording
  // flow uses.
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
