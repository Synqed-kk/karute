// Sessions-list (カルテ tab) screen assembly — the row derivation MOVED VERBATIM
// out of app/[locale]/(app)/karute/page.tsx (packet 05) so the web page and the
// facade screen endpoint share ONE source of truth for how the カルテ list is
// built (record → KaruteListItem projection, staff name/color maps,
// monthCount, customerOptions). Pure over explicit inputs: callers own their
// own fan-out (cookie-scoped on the web page, Bearer/business-scoped in the
// facade route).

import type { SynqedClient } from '@synqed-kk/client'
import { assignStaffColors } from '@/lib/staff-colors'
import { partsInJst } from '@/lib/date/jst'
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
  /** Karute records dated in the current JST month, STORE-wide (not staff
   *  filtered) — status-line only. Source: a server `karuteRecords.list`
   *  total over the JST month window (PR-1b 正直ヘッダー; was a client-side
   *  filter over the loaded ≤200-row page, which under-counted once the
   *  page filled). */
  monthCount: number
  /** Store-wide karute total, unfiltered by date or staff (PR-1b plumbing —
   *  not rendered until PR-2a's 全件 display; see the DTO's matching field). */
  total: number
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
  /** See the matching field's doc on SessionsListScreen. */
  monthCount: number
  /** See the matching field's doc on SessionsListScreen. */
  total: number
}): SessionsListScreen {
  const {
    staffList,
    storeStaffIds,
    allCustomersList,
    currentStaffId,
    synqedKaruteRows,
    synqedStaff,
    monthCount,
    total,
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

  // mergeKaruteRows still gives us the sort (session_date ?? created_at desc)
  // and the id dedupe; there's no longer a Supabase side to union in. The
  // limit is the input's own length, i.e. NO cap (PR-2a): the caller decides
  // how many rows it fetched, and a two-week window paged to completion can
  // legitimately exceed the old 200 default, which would have silently
  // truncated it. Every pre-2a caller passes ≤200 rows, so this is a no-op for
  // them (slice(0, n) over n rows).
  const records = mergeKaruteRows<RecordRow>([], synqedKaruteRows, synqedKaruteRows.length)

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
    // JST-EXPLICIT weekday (fix round 5 — this was a LIVE PRODUCTION BUG).
    // The instant is anchored to JST midnight, but `.getDay()` reads it back in
    // SERVER-LOCAL time. On this Mac (JST) that agreed by luck; on Vercel and
    // in CI (both UTC) the same instant is 15:00 the PREVIOUS day, so every
    // カルテ row shipped a weekday one day early. There is no TZ override in
    // vercel.json or the workflows to lean on, and there shouldn't be — the
    // date is a JST business fact and must be computed as one, whatever the
    // server's clock is set to. partsInJst already does exactly this via Intl.
    const weekday = ['日', '月', '火', '水', '木', '金', '土'][
      partsInJst(new Date(`${isoDate}T00:00:00+09:00`)).weekday
    ]

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

  // monthCount / total (PR-1b): both now server totals passed in by the
  // caller (page.tsx / screens/sessions route) — see the args doc above.

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
    total,
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
