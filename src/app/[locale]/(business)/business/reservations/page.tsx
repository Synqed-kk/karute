// 予約一覧 — the canon screen (fable-store-reservations.html), transplanted
// whole under ⚖ Liam's 8/19 transplant ruling: same structure, same layout,
// same wording, running on PLAY-PHASE FIXTURES.
//
// SERVER COMPONENT ON PURPOSE, like 顧客 and 今日の運営: every read, join and
// date format happens here, so the client receives plain strings and integers.
// No timezone and no locale can drift between the two renders, and no data
// access exists on the client at all.
//
// ONE FIXTURE WORLD. The rows on this list ARE the appointment rows the Today
// board paints and the 顧客 screen reads for 次回予約 — same ids, same times,
// same prices, same store lens. The lifecycle word each row shows is DERIVED
// from the very fields the board paints from (status / board_state /
// settlement), so 「確定」 here and 来店なし there is not a thing that can happen.
// What this screen adds — acceptance, deadlines, flags, 根拠, 操作履歴 — sits in
// its own plane keyed to the same ids (src/business/lib/fixtures-reservations.ts).
//
// THE WINDOW is today plus six days, canon's own 7-day span, derived from the
// clock rather than typed (⚖ L-6). Past bookings belong to 来店履歴 on 顧客.
//
// M-87: a failed read replaces both panels with one red strip and drops every
// figure to 「—」. Fixtures cannot throw today; the branch ships because the
// mock's own rule — 「この画面の数字は1つも残さない」 — is a correctness
// requirement that has to be in place BEFORE the reads become real.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { jstDayKey, jstMinuteOfDay, jstSlot } from '@/business/lib/clock'
import {
  defaultStoreId,
  listAppointments,
  listCustomers,
  listMenus,
  listResources,
  listStaff,
  listStoreOptions,
  readReservationPlanes,
  renderNow,
  type StoreLens,
} from '@/business/lib/data'
import {
  eligibilityOf,
  lifecycleOf,
  qualificationTextOf,
  shiftWarningOf,
  sourceOf,
} from '@/business/lib/reservations'
import { hhmm, suppressedByAbsence, yen } from '@/business/lib/today-board'
import { ReservationsScreen, type ReservationRow, type SlotOption } from './ReservationsScreen'
import './reservations.css'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })

/** Canon's span: today and the six days after it. */
const WINDOW_DAYS = 7

export default async function ReservationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, { store }] = await Promise.all([params, searchParams])
  const storeOptions = await listStoreOptions()
  // A missing or unknown ?store= opens on the operator's own store, never the
  // business-wide merge — すべての店舗 left the sidebar switcher (⚖ Liam 8/20)
  // and defaultStoreId owns that rule for every screen. The lens stays a view
  // preference, never an error, and the wrapper is the thing that clamps.
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  try {
    return await reservationsScreen(locale, lens, clamped, storeId ?? undefined, storeOptions)
  } catch {
    // M-87. Nothing is re-read and nothing is guessed: the screen renders the
    // strip and no numbers at all.
    return <ReservationsScreen failed locale={locale} />
  }
}

/** The screen itself, given a lens. Exported for the same reason CustomersScreen
 *  exports its handlers: no renderer resolves inside territory, so a suite proves
 *  the payload by asking for it directly — and since ⚖ 8/20 the merged lens is
 *  the one no URL can ask for any more. */
export async function reservationsScreen(
  locale: string,
  lens: StoreLens,
  clamped: boolean,
  store: string | undefined,
  storeOptions: Array<{ id: string; name: string }>,
) {
  // ONE CLOCK ANCHOR PER RENDER (the #724 finding, and this page had the same
  // exposure). The fixture calendar is RELATIVE, so a second bare clock read
  // can straddle JST midnight: the read window, 表示日 and the 今日 filter would
  // then be derived from two different days in one render. `renderNow()` is the
  // request-pinned anchor, and every clock-defaulting helper below is handed it.
  const now = renderNow()
  const from = jstSlot(0, 0, 0, now)
  const to = jstSlot(WINDOW_DAYS, 0, 0, now)

  const [appointments, customers, menus, staff, resources, planes] = await Promise.all([
    listAppointments(lens, { from, to }),
    listCustomers(lens),
    listMenus(lens),
    listStaff(lens),
    listResources(lens),
    readReservationPlanes(lens),
  ])

  const customerById = new Map(customers.map((c) => [c.id, c]))
  const menuById = new Map(menus.map((m) => [m.id, m]))
  const staffName = new Map(staff.map((s) => [s.id, s.full_name]))
  const resourceName = new Map(resources.map((r) => [r.id, r.name]))
  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const recordById = new Map(planes.reservations.map((r) => [r.appointment_id, r]))
  const shiftOf = (id: string | null) => planes.shifts.find((s) => s.staff_id === id) ?? null

  const todayKey = jstDayKey(now)
  const closeMinute = planes.operatingHours.close

  const rows: ReservationRow[] = appointments
    .map((a) => {
      const record = recordById.get(a.id) ?? null
      const lifecycle = lifecycleOf(a, record)
      const source = sourceOf(a.source, lifecycle === 'pending_accept')
      const customer = customerById.get(a.customer_id) ?? null
      const menu = a.menu_id ? (menuById.get(a.menu_id) ?? null) : null
      const startMinute = jstMinuteOfDay(a.starts_at)
      const endMinute = jstMinuteOfDay(a.ends_at)
      const dayKey = jstDayKey(a.starts_at)
      const isToday = dayKey === todayKey
      const who = a.staff_id ? (staffName.get(a.staff_id) ?? '担当未定') : '担当未定'

      return {
        id: a.id,
        no: a.display_no,
        dateLabel: fmtDay.format(new Date(a.starts_at)),
        dayKey,
        isToday,
        startMinute,
        durationMinutes: endMinute - startMinute,
        timeLabel: `${hhmm(startMinute)}–${hhmm(endMinute)}`,
        customerName: customer?.name ?? '—',
        // La Estro's menus table is empty in production (contract §5), so the
        // blank case is the honest one to carry rather than a title fallback.
        menuName: menu?.name ?? 'メニュー未設定',
        staffName: who,
        // 【未定】 rather than a guess: no resource plane exists in core (C-4).
        resourceName: a.resource_id ? (resourceName.get(a.resource_id) ?? '【未定】') : '【未定】',
        sourceLabel: source.label,
        sourceGroup: source.group,
        sourceRef: source.ref,
        priceLabel: a.booked_price == null ? '受付価格の記録なし' : yen(a.booked_price),
        currentPriceLabel: menu ? yen(menu.price) : '公開価格の記録なし',
        // The store NAME only under viewAll: for a branch actor it is a
        // constant that advertises the other stores exist (isolation law).
        storeLabel: clamped ? null : a.store_id ? (storeName.get(a.store_id) ?? '店舗未設定') : '店舗未設定',
        lifecycle,
        flags: record?.flags ?? [],
        reassigned: a.reassigned_from != null,
        deadline: record?.deadline ?? null,
        eligibility: eligibilityOf(customer, source.group),
        proof:
          record?.proof ??
          `${source.label}で受け付けた予約です。受付価格は受付時のまま保持しています。`,
        // ⚖ cut #7: only the parties that DEVIATE from the customer.
        party: (customer?.party ?? []).map((p) => ({ role: p.role, name: p.name, note: p.note })),
        history: planes.auditTrail[a.id] ?? [],
        // Derived from the shift plane, not stored: the accept dialog warns only
        // where the booking really does fall outside its staff member's day.
        shiftWarning: shiftWarningOf(who, shiftOf(a.staff_id), startMinute, endMinute),
        // 担当資格 for the accept dialog's middle segment — the roster's own 資格
        // plane, never a literal (see qualificationTextOf).
        qualificationText: qualificationTextOf(
          a.staff_id ? planes.staffQualifications[a.staff_id] : undefined,
        ),
        // Derived from the absence record the board's incident band is built on.
        staffUnavailable: isToday && suppressedByAbsence({ staff_id: a.staff_id, startMinute }, planes.absence),
        settled: a.settlement === 'settled',
        ...registerEvidence(a.id, a.settlement, planes.register),
      }
    })
    // 日時順. The queue owns 期限順; a list whose heading says 日時 sorts by 日時,
    // so a change made on this screen visibly moves its row.
    .sort((x, y) => x.dayKey - y.dayKey || x.startMinute - y.startMinute || x.no.localeCompare(y.no))

  // 空き枠候補 (M-63 / M-72). The store's own 販売可能枠, already lens-clamped.
  //
  // NO DATE. The slots are a DAILY shape — the same way `./fixtures-today`
  // states one roster and the board applies it to whichever day you land on —
  // so a candidate is offered on the booking's OWN day. Stamping today's date on
  // them would have the screen proposing "move Friday's customer to this
  // afternoon", which is not a change, it is a different appointment.
  // Which slots can hold a given booking is arithmetic the client does with the
  // shared predicate; whether one is genuinely SAFE is core's (C-13), and the
  // honesty table says so.
  const slots: SlotOption[] = planes.sellSlots.map((s) => ({
    id: s.id,
    start: s.start,
    end: s.end,
    staffName: staffName.get(s.staff_id) ?? '担当未定',
    resourceName: resourceName.get(s.resource_id) ?? '【未定】',
  }))

  const lensLabel = clamped ? (storeName.get(store!) ?? 'この店舗') : 'すべての店舗'
  const spanLabel = `${fmtDay.format(now)}〜${fmtDay.format(new Date(jstSlot(WINDOW_DAYS - 1, 0, 0, now)))}`
  // Canon's date filter names the days it filters to (「本日 8月5日」/「8月6日以降」,
  // :405) rather than saying 「明日以降」 and leaving the reader to work out which
  // day that is. Computed off the same clock as the window, never typed (⚖ L-6).
  const todayLabel = fmtDay.format(now)
  const tomorrowLabel = fmtDay.format(new Date(jstSlot(1, 0, 0, now)))

  return (
    <ReservationsScreen
      locale={locale}
      rows={rows}
      slots={slots}
      lensLabel={lensLabel}
      spanLabel={spanLabel}
      todayLabel={todayLabel}
      tomorrowLabel={tomorrowLabel}
      store={clamped ? store! : null}
      boardNow={planes.boardNow}
      closeMinute={closeMinute}
    />
  )
}

/** レジ取引 evidence (M-67, ask C-14). Derived from the settlement flag and the
 *  register plane the Today board's money band already reads — the terminal
 *  that is holding a transaction is the reason the close is blocked, and it
 *  names the booking itself, so this cannot describe the wrong row. */
function registerEvidence(
  id: string,
  settlement: string | null,
  register: { terminal_held: Array<{ appointment_id: string; terminal: string; idempotency_id: string }> },
): { txNote: string; txDetail: string | null } {
  if (settlement === 'settled') return { txNote: 'レジで精算済み', txDetail: null }
  // The plane carries a LIST — more than one terminal can be holding, and a day
  // that is merely being VIEWED holds nothing at all (`data.ts` empties it off
  // today). This was written against the single-object shape the plane had
  // before the Today stack landed; reading `.appointment_id` off the array gave
  // `undefined`, so every row silently lost its evidence line.
  const held = register.terminal_held.find((t) => t.appointment_id === id)
  return {
    txNote: '未作成 — 閉店処理を止めています',
    txDetail: held ? `${held.terminal} が ${held.idempotency_id} を保留中` : null,
  }
}
