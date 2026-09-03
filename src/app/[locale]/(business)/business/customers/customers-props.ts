// 顧客 — the room's PROP ASSEMBLY, beside the page rather than inside it.
//
// WHY THIS FILE EXISTS (the room-3 F1 law): the evidence harness imports THIS
// function, so an isolated shot is the same assembly the deployed route runs and
// a drift between them is a compile error rather than a picture nobody can
// check. `page.tsx` keeps the admission gate, the route params, the sheet import
// and the render — the things a route entry owns.
//
// SERVER-ONLY BY CONSTRUCTION. Every read goes through `@/business/lib/data`'s
// store-clamped fixture door; every date crosses the client boundary as a
// FORMATTED STRING and every day comparison as `jstDayKey`'s integer. The screen
// holds no clock, no formatter and no data access at all, so no timezone and no
// locale can drift between the two renders.
//
// ONE CLOCK ANCHOR. `renderNow()` is read ONCE here and handed down: 次回予約's
// "already began" test, 最終来店, 来店履歴, 累計支払, the 空き日数 fact and the
// 新規/再来 split all hang off that single instant, so a render crossing JST
// midnight cannot put two different days on one screen. There is no `new Date()`
// anywhere in this room (`render-clock.test.ts` pins it).
//
// WHAT IS DERIVED RATHER THAN STORED (⚖ 8/9, demo-data-product-truth): 最終来店,
// 来店履歴, 累計支払, a customer's store affiliation and the 新規/再来 category
// all come from the booking rows. Storing them twice is how a fixture ends up
// claiming a visit that no booking backs.
//
// STORE ISOLATION: customers carry no store_id (CM-9), so the lens cannot filter
// the rows — the honest #723 behaviour, kept. What the lens DOES clamp is every
// booking-derived value, and the store NAME: under a clamped lens no other
// store's name reaches the DOM, per the isolation law (hide, never
// show-and-refuse).

import { jstDayKey } from '@/business/lib/clock'
import {
  defaultStoreId,
  listAppointments,
  listCustomers,
  listMenus,
  listStaff,
  listStoreOptions,
  listVisits,
  renderNow,
  type StoreLens,
} from '@/business/lib/data'
import {
  bookingCategory,
  customerStoreAffiliation,
  CATEGORY_LABEL,
  type BookingCategory,
} from '@/business/lib/today-board'
import { priorVisitCounts } from '@/business/lib/analytics'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })
const fmtFull = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', ...JST })
const fmtShort = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', ...JST })
const fmtTime = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, ...JST })

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

/** ⚖ RIDER §3.3 — THE CHIP RENDERS FOR 新規 AND VIP ONLY. 再来 is the default
 *  state of a customer list and 回数券 already has a column of its own, so a chip
 *  for either repeats what the row already says (the big-tech simplicity law).
 *  The CATEGORY itself is still carried for every row, from the board's own
 *  function, so nothing here is a second opinion about who is new. */
const CHIPPED: BookingCategory[] = ['new', 'vip']

export interface CustomerRow {
  id: string
  no: string
  name: string
  furigana: string | null
  mark: string
  phone: string | null
  email: string | null
  source: string
  identityCheck: string | null
  storeLabel: string | null
  groupKey: string
  hasNext: boolean
  nextLabel: string
  nextMenu: string
  nextDetail: string
  nextPrice: string
  ticket: number | null
  wallet: number | null
  lastVisitShort: string | null
  lastVisitFull: string | null
  totalSpent: number | null
  consent: { line: boolean; sms: boolean; email: boolean } | null
  lineLinked: boolean
  merge: 'open' | 'pending' | 'none'
  /** ⚖-ADJ M — the other half of the pair, by 顧客番号. WO-1b removed this from
   *  the row because nothing read it; the compare drawer reads it now, so it is
   *  back. The merge warning's own sentence is unchanged: the partner is named
   *  in the drawer's head, never bolted onto the warning. */
  duplicateOf: string | null
  party: Array<{ role: string; name: string; note: string }>
  thin: boolean
  externalOwner: boolean
  note: string | null
  history: Array<{ date: string; service: string; amount: string }>
  bookings: Array<{ date: string; detail: string }>
  /** ⚖ RIDER §3.1 — whole JST days since the last COMPLETED visit in this lens.
   *  `null` = no completed visit here. A FACT, not a threshold: the manager reads
   *  「なし ・ 最終来店から 22日」 and judges. The 再来の目安日数 dial that would
   *  turn it into a filter is registry ④ — a dial without its default and its
   *  guardrail is the thing the mistake-proofing law forbids. */
  daysSinceLastVisit: number | null
  /** The row's own words for that number, in the 次回予約 cell's sub-line. */
  winBack: string
  /** The inspector head's 最終来店 line, with the same number in ( ). */
  lastVisitMeta: string
  category: BookingCategory
  /** The chip's label, or `null` where the category is not chipped. */
  categoryChip: string | null
  /** ⚖ RIDER §3.2 — the next visit uses the last count. A FACT at exactly 1,
   *  never a configurable 「残り○回で知らせる」 (registry ⑤). */
  ticketEnding: boolean
}

export interface CustomersProps {
  rows: CustomerRow[]
  lensLabel: string
  grouped: boolean
  /** ⚖-ADJ B — TRUTH-FIXES ALWAYS CONNECT. Both rooms exist on main now, so the
   *  two 準備中 doors become real links. Neither room reads a customer parameter
   *  yet (registry ①), so the link carries this page's own lens and nothing
   *  else — a door that opens the right store's room is the whole truth it can
   *  tell today. */
  inboxHref: string
  karuteHref: string
}

export interface CustomersPropsInput {
  locale: string
  /** The raw `?store=` value. Unknown or missing opens on the operator's own
   *  store, never the business-wide merge — `defaultStoreId` owns that rule. */
  store?: string
  /** FIXTURE-SHAPED WORLD OVERRIDES, and the page never passes them. The
   *  evidence harness needs worlds this demo plane does not contain — a
   *  100-customer roster, a desk with no duplicate candidates, a customer whose
   *  回数券 sits at exactly 1 — and the only honest way to picture any of them is
   *  to run the REAL derivations on a different fixture world, never a class
   *  toggle or a hand-written replica. Every field is exactly the shape the
   *  fixture module exports; the world file itself is never edited (four lanes
   *  read it). ⚠ THE LENS STILL DECIDES: the one line below applies the door's
   *  own rule to whatever the harness supplies, so a synthetic world cannot
   *  smuggle another store's booking past the isolation proof. */
  world?: {
    customers?: Awaited<ReturnType<typeof listCustomers>>
    appointments?: Awaited<ReturnType<typeof listAppointments>>
  }
}

export interface CustomersPropsResult {
  props: CustomersProps
  /** The RESOLVED lens, returned rather than re-derived by the caller so the
   *  clamp keeps exactly one home. */
  storeKey: string
}

export async function customersProps({
  locale,
  store,
  world,
}: CustomersPropsInput): Promise<CustomersPropsResult> {
  const storeOptions = await listStoreOptions()
  // A missing or unknown ?store= opens on the operator's own store rather than
  // erroring or merging every store — the lens is a view preference, and the
  // wrapper is the thing that clamps (defaultStoreId owns that rule).
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  const [doorCustomers, doorAppointments, doorVisits, menus, staff] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens),
    listVisits(lens),
    listMenus(lens),
    listStaff(lens),
  ])
  const customers = world?.customers ?? doorCustomers
  const appointments = world?.appointments
    ? world.appointments.filter((a) => (clamped ? a.store_id === storeId : true))
    : doorAppointments
  const visits = world?.appointments
    ? appointments
        .filter((a) => a.status === 'done')
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    : doorVisits

  const menuName = new Map(menus.map((m) => [m.id, m.name]))
  const staffName = new Map(staff.map((s) => [s.id, s.full_name]))
  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))

  // THE ONE CLOCK READ. Everything below is derived from this instant.
  const now = renderNow()
  const nowIso = now.toISOString()
  const todayKey = jstDayKey(now)

  // 次回予約 per customer, within the lens: the earliest still-booked slot that
  // has NOT started yet. Compared as ISO instants: "already began" is an absolute
  // fact, so no timezone enters here (JST belongs to the display strings above).
  const nextByCustomer = new Map<string, (typeof appointments)[number]>()
  for (const a of [...appointments].sort((x, y) => x.starts_at.localeCompare(y.starts_at))) {
    if (a.status !== 'booked' || a.starts_at <= nowIso || nextByCustomer.has(a.customer_id)) continue
    nextByCustomer.set(a.customer_id, a)
  }

  // Visit-derived facts. `listVisits` already returns newest-first.
  const visitsByCustomer = new Map<string, typeof visits>()
  for (const v of visits) {
    const bucket = visitsByCustomer.get(v.customer_id)
    if (bucket) bucket.push(v)
    else visitsByCustomer.set(v.customer_id, [v])
  }

  // Store affiliation, derived exactly the way core derives it: a customer
  // belongs to a store iff they have an event there. Newest event wins; no event
  // at all is the CM-9 unassigned bucket. The board's own function, so the two
  // screens cannot disagree about where a customer belongs.
  const affiliation = customerStoreAffiliation(appointments)

  // ⚖ RIDER §3.3 — THE CATEGORY IS THE BOARD'S OWN, on the SAME lens-clamped
  // appointments 今日の運営 and 売上分析 read, so a customer is never 新規 on one
  // page and 再来 on another.
  const priorVisits = priorVisitCounts(appointments, todayKey)

  const rows: CustomerRow[] = customers.map((c) => {
    const next = nextByCustomer.get(c.id) ?? null
    const mine = visitsByCustomer.get(c.id) ?? []
    const lastVisit = mine[0] ?? null
    const affiliated = affiliation.get(c.id) ?? null

    // 累計支払 is summed WITHIN THE LENS. Core's own field is business-wide,
    // which would show a branch viewer another store's money in one number
    // (contract §5 flags exactly this) — the lensed sum is the reading that
    // cannot leak. Flagged in the PR body as a reconnect decision.
    const spent = c.external_owner ? null : mine.reduce((sum, v) => sum + (v.booked_price ?? 0), 0)

    const daysSince = lastVisit === null ? null : todayKey - jstDayKey(lastVisit.starts_at)
    const category = bookingCategory(c, priorVisits.get(c.id) ?? 0)

    return {
      id: c.id,
      no: c.member_number,
      name: c.name,
      furigana: c.furigana,
      mark: c.mark,
      phone: c.phone,
      email: c.email,
      source: c.source,
      identityCheck: c.identity_check,
      // The store NAME only under viewAll (contract's `crossStore` gate).
      storeLabel: clamped ? null : affiliated ? (storeName.get(affiliated) ?? null) : '店舗未設定',
      groupKey: clamped ? '' : (affiliated ?? ''),
      hasNext: next != null,
      nextLabel: next ? `${fmtDay.format(new Date(next.starts_at))} ${fmtTime.format(new Date(next.starts_at))}` : 'なし',
      nextMenu: next ? (next.menu_id ? (menuName.get(next.menu_id) ?? 'メニュー未設定') : 'メニュー未設定') : '予約なし',
      nextDetail: next
        ? `${fmtDay.format(new Date(next.starts_at))} ${fmtTime.format(new Date(next.starts_at))}–${fmtTime.format(new Date(next.ends_at))} / ${
            next.menu_id ? (menuName.get(next.menu_id) ?? 'メニュー未設定') : 'メニュー未設定'
          }${next.staff_id ? ` / ${staffName.get(next.staff_id) ?? '担当未定'}` : ''}`
        : '次回予約なし',
      nextPrice: next ? (next.booked_price == null ? '受付価格の記録なし' : yen(next.booked_price)) : '予約確定後に記録',
      ticket: c.ticket_balance,
      wallet: c.wallet_balance,
      lastVisitShort: lastVisit ? fmtShort.format(new Date(lastVisit.starts_at)) : null,
      lastVisitFull: lastVisit ? fmtFull.format(new Date(lastVisit.starts_at)) : null,
      totalSpent: spent,
      consent: c.consent,
      lineLinked: c.line_linked,
      merge: c.merge_status,
      duplicateOf: c.duplicate_of,
      party: c.party,
      thin: c.thin,
      externalOwner: c.external_owner,
      note: c.note,
      history: mine.map((v) => ({
        date: fmtShort.format(new Date(v.starts_at)),
        service: v.menu_id ? (menuName.get(v.menu_id) ?? 'メニュー未設定') : 'メニュー未設定',
        amount: v.booked_price == null ? '—' : yen(v.booked_price),
      })),
      // T4 関連する予約・レジ記録 — already lens-clamped by listAppointments.
      bookings: appointments
        .filter((a) => a.customer_id === c.id)
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
        .map((a) => ({
          date: fmtShort.format(new Date(a.starts_at)),
          detail: `${fmtTime.format(new Date(a.starts_at))} ${
            a.menu_id ? (menuName.get(a.menu_id) ?? 'メニュー未設定') : 'メニュー未設定'
          }${a.staff_id ? ` / ${staffName.get(a.staff_id) ?? '担当未定'}` : ''}`,
        })),
      daysSinceLastVisit: daysSince,
      winBack: winBackLine(daysSince),
      lastVisitMeta:
        lastVisit === null
          ? '最終来店 記録なし'
          : `最終来店 ${fmtFull.format(new Date(lastVisit.starts_at))}（${daysSince === 0 ? '本日' : `${daysSince}日前`}）`,
      category,
      categoryChip: CHIPPED.includes(category) ? CATEGORY_LABEL[category] : null,
      ticketEnding: c.ticket_balance === 1,
    }
  })

  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'
  // The page's own lens, carried into the two doors exactly as the store
  // switcher carries it. Never dropped: a door that lands on a different store
  // than the one being read is worse than no door.
  const storeQuery = clamped ? `?store=${storeId!}` : ''

  return {
    props: {
      rows,
      lensLabel,
      grouped: !clamped,
      inboxHref: `/${locale}/business/inbox${storeQuery}`,
      karuteHref: `/${locale}/business/karute${storeQuery}`,
    },
    storeKey: clamped ? storeId! : 'all',
  }
}

/** ⚖ RIDER §3.1 — the 空き日数 fact in the row's own words. A number with its
 *  unit and its subject, never a bare figure (⚖ 8/25: 来店10回, not 10回). */
export function winBackLine(daysSince: number | null): string {
  if (daysSince === null) return '来店記録なし'
  if (daysSince <= 0) return '本日来店'
  return `最終来店から ${daysSince}日`
}
