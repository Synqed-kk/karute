// Sessions-list (カルテ tab) screen assembly — the row derivation MOVED VERBATIM
// out of app/[locale]/(app)/karute/page.tsx (packet 05) so the web page and the
// facade screen endpoint share ONE source of truth for how the カルテ list is
// built (record → KaruteListItem projection, staff name/color maps,
// monthCount, customerOptions). Pure over explicit inputs: callers own their
// own fan-out (cookie-scoped on the web page, Bearer/business-scoped in the
// facade route).

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
type SynqedStaffList = Awaited<ReturnType<SynqedClient['staff']['list']>>

export interface SessionsListScreen {
  items: KaruteListItem[]
  /** Always []. Kept required — never delete — release-17 phones parse this
   *  key and the facade route 500s if it goes missing (see
   *  sessions-screen-dto.ts). Placeholder-row synthesis for customers with no
   *  karute yet was removed in PR-1a (未作成ブロック廃止); the field ships
   *  empty for forward compatibility only. */
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
  currentStaffId: string | null
  synqedKaruteRows: KaruteListRow[]
  synqedStaff: SynqedStaffList
}): SessionsListScreen {
  const {
    staffList,
    storeStaffIds,
    allCustomersList,
    currentStaffId,
    synqedKaruteRows,
    synqedStaff,
  } = args

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

  // synqed staff id → profile id. Karute records arrive keyed by either id
  // (see recordStaffProfileId below); staffNameById + staffColors key off
  // the profile id (= synqed staff.user_id). Profile-less synqed staff fall
  // back to their synqed id — exactly how getStaffList ids them too, so
  // name/color still resolve. Mirrors the boundary translation in
  // getAppointmentsByDate.
  const profileByStaffId = new Map(
    synqedStaff.staff
      .filter((s): s is typeof s & { user_id: string } => s.user_id != null)
      .map((s) => [s.id, s.user_id]),
  )

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

  // 未作成ブロック廃止 (PR-1a): placeholder rows for customers with no karute
  // yet used to be synthesized here. Always empty now — see the
  // `placeholders` doc comment on SessionsListScreen for why the field stays.
  const placeholders: KaruteListItem[] = []

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
