// 顧客 — the canon screen (fable-store-customers.html), transplanted whole
// under ⚖ Liam's 8/19 transplant ruling: same structure, same layout, same
// wording, running on PLAY-PHASE FIXTURES. It replaces the lean #723 table;
// there is no second implementation.
//
// Route: the (business) group adds no URL segment, and /[locale] +
// /[locale]/customers are already the phone app's, so Business lives under a
// /business/ segment. The group layout gates too; this page re-asserts the
// admission itself (idempotent) so the screen never depends on a parent's
// await for its authorization.
//
// SERVER COMPONENT ON PURPOSE. Every read, every join and every date format
// happens here, so the client receives plain strings: no timezone and no
// locale can drift between the two renders, and no data access exists on the
// client at all.
//
// WHAT IS DERIVED RATHER THAN STORED (⚖ 8/9, demo-data-product-truth): 最終来店,
// 来店履歴, 累計支払 and a customer's store affiliation all come from the
// booking rows. Storing them twice is how a fixture ends up claiming a visit
// that no booking backs.
//
// STORE ISOLATION on this screen: customers carry no store_id (CM-9), so the
// lens cannot filter the rows — the honest #723 behavior, kept. What the lens
// DOES clamp is every booking-derived value, and the store NAME: under a
// clamped lens no other store's name reaches the DOM, per the isolation law
// (hide, never show-and-refuse).

import { requireBusinessAdmission } from '@/business/lib/admission'
import {
  defaultStoreId,
  listAppointments,
  listCustomers,
  listMenus,
  listStaff,
  listStoreOptions,
  listVisits,
  type StoreLens,
} from '@/business/lib/data'
import { CustomersScreen, type CustomerRow } from './CustomersScreen'
import './customers.css'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })
const fmtFull = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', ...JST })
const fmtShort = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', ...JST })
const fmtTime = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, ...JST })

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [, { store }] = await Promise.all([params, searchParams])
  const storeOptions = await listStoreOptions()
  // A missing or unknown ?store= opens on the operator's own store rather than
  // erroring or merging every store — the lens is a view preference, and the
  // wrapper is the thing that clamps (defaultStoreId owns that rule).
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  const [customers, appointments, visits, menus, staff] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens),
    listVisits(lens),
    listMenus(lens),
    listStaff(lens),
  ])

  const menuName = new Map(menus.map((m) => [m.id, m.name]))
  const staffName = new Map(staff.map((s) => [s.id, s.full_name]))
  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))

  // 次回予約 per customer, within the lens: the earliest still-booked slot that
  // has NOT started yet. One `now` for the whole render, compared as ISO
  // instants — "already began" is an absolute fact, so no timezone enters here
  // (JST belongs to the display strings above).
  const now = new Date().toISOString()
  const nextByCustomer = new Map<string, (typeof appointments)[number]>()
  for (const a of [...appointments].sort((x, y) => x.starts_at.localeCompare(y.starts_at))) {
    if (a.status !== 'booked' || a.starts_at <= now || nextByCustomer.has(a.customer_id)) continue
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
  // belongs to a store iff they have an event there. Newest event wins; no
  // event at all is the CM-9 unassigned bucket.
  const affiliation = new Map<string, string>()
  for (const a of [...appointments].sort((x, y) => y.starts_at.localeCompare(x.starts_at))) {
    if (a.store_id && !affiliation.has(a.customer_id)) affiliation.set(a.customer_id, a.store_id)
  }

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
    }
  })

  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'

  return <CustomersScreen rows={rows} lensLabel={lensLabel} grouped={!clamped} />
}
