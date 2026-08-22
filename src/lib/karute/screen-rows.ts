// Sessions-list (カルテ tab) screen assembly — the row derivation MOVED VERBATIM
// out of app/[locale]/(app)/karute/page.tsx (packet 05) so the web page and the
// facade screen endpoint share ONE source of truth for how the カルテ list is
// built (record → KaruteListItem projection, staff name/color maps, booking →
// staff resolution for placeholder rows, placeholder synthesis, monthCount,
// customerOptions). Pure over explicit inputs: callers own their own fan-out
// (cookie-scoped on the web page, Bearer/business-scoped in the facade route).

import type { SynqedClient } from '@synqed-kk/client'
import { assignStaffColors } from '@/lib/staff-colors'
import {
  type KaruteListRow,
  mergeKaruteRows,
} from '@/lib/karute/synqed-records'
import type { listAllCustomers } from '@/lib/customers/list-all'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import type {
  KaruteAiStatus,
  KaruteConversionStatus,
  KaruteListItem,
} from '@/components/karute/spike-lifted/list/types'

type CustomerList = Awaited<ReturnType<typeof listAllCustomers>>
type SynqedApptList = Awaited<ReturnType<SynqedClient['appointments']['list']>>
type SynqedStaffList = Awaited<ReturnType<SynqedClient['staff']['list']>>

export interface SessionsListScreen {
  items: KaruteListItem[]
  placeholders: KaruteListItem[]
  /** Total karute records this month (not filtered) — status-line only. */
  monthCount: number
  /** Staff filter pills (id + display name + initials). */
  staffList: Array<{
    id: string
    name: string
    initials: string
    /** 経営メンバー — for the 新規カルテ dialog's staff picker, and for
     *  StaffSelector's own default-list hiding (search reveals them;
     *  ⚖ 2026-09-01 overturn of Ⓒ). This list itself stays complete. */
    isManagement?: boolean
  }>
  /** The viewer's staff id, or null when the session has no active staff. */
  currentStaffId: string | null
  /** New カルテ dialog combobox source — id + name, plus phone/furigana so
   *  the combobox can match on those too. */
  customerOptions: Array<{
    id: string
    name: string
    phone: string | null
    furigana: string | null
  }>
}

export function buildSessionsListScreen(args: {
  staffList: Array<{ id: string; full_name: string | null; isManagement?: boolean }>
  /**
   * #496 store clamp — staff ids assigned to the active store (or floating),
   * null = no store lens (business-wide). REQUIRED so every caller (web page,
   * facade routes) makes the store-scope decision explicitly; passing the full
   * roster unfiltered re-opens the cross-branch staff-name leak.
   */
  storeStaffIds: Set<string> | null
  allCustomersList: CustomerList
  storeCustomerList: CustomerList | null
  currentStaffId: string | null
  synqedKaruteRows: KaruteListRow[]
  apptList: SynqedApptList
  synqedStaff: SynqedStaffList
}): SessionsListScreen {
  const {
    staffList,
    storeStaffIds,
    allCustomersList,
    storeCustomerList,
    currentStaffId,
    synqedKaruteRows,
    apptList,
    synqedStaff,
  } = args

  // Booking → staff for placeholder rows. QuickReserve scrapes the 担当 onto
  // each appointment, but customer.assigned_staff_id (a separate "preferred
  // staff" field) is never set by the sync — so placeholder stripes were
  // blank. Derive 担当 from the customer's booking instead. Read the recent
  // appointment list UNWINDOWED (same as enrichCustomers): a date window keyed
  // on "today" drops a booking that has already passed (a 5/31 visit viewed on
  // 6/01), which is exactly why the first attempt still showed blank.
  const nowMs = new Date().getTime()

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

  // Build lookup maps — name resolution stays BUSINESS-WIDE so a record
  // written by another branch's staff still shows their name, but the 担当
  // picker below only offers staff assigned to the active store (or floating
  // staff) — the full roster was leaking every branch's staff names into
  // every store's dropdown. (#496)
  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )
  const visibleStaff = storeStaffIds
    ? staffList.filter((s) => storeStaffIds.has(s.id))
    : staffList
  // DISTINCT staff colors over the VISIBLE roster — the same list feeds the
  // selector (which derives its own colors from it), so chip and row-stripe
  // colors agree. An out-of-store staff's old rows fall back to the neutral
  // color via getStaffColorByKey. (#496)
  const staffColors = assignStaffColors(visibleStaff.map((s) => s.id))
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
    // Karute rows carry core's staff_id VERBATIM, and the writers are mixed:
    // the recording pipeline (and the appointment-staff save fallback) stamp
    // the SYNQED staff id, while web/facade interactive saves stamp the
    // profile id (Liam field report 7/24: pipeline records rendered 担当
    // "Unknown" and escaped the 自分/担当 filters). Same boundary translation
    // as appointments (by-date.ts): synqed ids map to the profile id every
    // name/color/filter map keys off; profile ids miss the map and pass
    // through unchanged.
    const recordStaffProfileId = r.staff_profile_id
      ? (profileByStaffId.get(r.staff_profile_id) ?? r.staff_profile_id)
      : null
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
      staffId: recordStaffProfileId,
      staffColorKey: recordStaffProfileId
        ? (staffColors.get(recordStaffProfileId)?.key ?? null)
        : null,
      staffName: recordStaffProfileId
        ? (staffNameById.get(recordStaffProfileId) ?? 'Unknown')
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
  // Restrict the placeholder roster to the active branch so "新規のお客様"
  // follows the same lens as the records. For a cross-store viewer with a pinned
  // store, storeCustomerList carries that branch's members; null otherwise (no
  // pin → business-wide, OR clamped → allCustomersList is already store-scoped).
  const storeCustomerIds = storeCustomerList
    ? new Set(storeCustomerList.customers.map((c) => c.id))
    : null
  const placeholders: KaruteListItem[] = allCustomersList.customers
    .filter(
      (c) =>
        !recordedCustomerIds.has(c.id) &&
        (!storeCustomerIds || storeCustomerIds.has(c.id)),
    )
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
  // contract from src/components/karute/CustomerCombobox (id + name +
  // phone + furigana) so the dialog plugs straight into the same
  // picker the recording flow uses, phone search included.
  const customerOptions = allCustomersList.customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone ?? null,
    furigana: c.furigana ?? null,
  }))

  return {
    items,
    placeholders,
    monthCount,
    staffList: visibleStaff.map((s) => ({
      id: s.id,
      name: s.full_name ?? 'Unknown',
      initials: deriveFamilyInitials(s.full_name ?? ''),
      isManagement: s.isManagement ?? false,
    })),
    currentStaffId:
      // Same clamp as the picker: the New-カルテ dialog must not default to
      // a staff the store filter hides (Greptile on #496).
      currentStaffId && storeStaffIds && !storeStaffIds.has(currentStaffId)
        ? null
        : currentStaffId,
    customerOptions,
  }
}
