// 顧客 — the CLIENT-SAFE half of the room's row rules (PR-2, Vercel on #992).
//
// `CustomersScreen` ('use client') builds a row for a customer added in the screen
// with the SAME rules the server assembly uses. Those rules used to live in
// `customers-props.ts`, which reads `@/business/lib/data` — so importing one pure
// helper from there put the data door (and, under the practice switch, Supabase
// and core-reach) into the browser bundle. They live HERE now, with no data,
// door or admission reach; both the props file and the screen import them.
// foundation.test.ts's TRANSITIVE server-only pin keeps it that way.

import { bookingCategory, CATEGORY_LABEL, type BookingCategory } from '@/business/lib/today-board'
import type { CustomerRow } from './customers-props'

/** ⚖ RIDER §3.3 — THE CHIP RENDERS FOR 新規 AND VIP ONLY. 再来 is the default
 *  state of a customer list and 回数券 already has a column of its own, so a chip
 *  for either repeats what the row already says (the big-tech simplicity law).
 *  The CATEGORY itself is still carried for every row, from the board's own
 *  function, so nothing here is a second opinion about who is new. */
export const CHIPPED: BookingCategory[] = ['new', 'vip']

/**
 * A row for a customer added IN THIS SCREEN ONLY, built by the SAME rules the
 * server assembly uses (⚖ G1).
 *
 * ⚠ IT LIVES HERE, BESIDE THOSE RULES, AND NOT IN THE SCREEN. The screen used to
 * hand-write the derived half of this row and got two of them wrong: `0` for
 * 累計支払 (the server says a customer with no completed visit is `null` → 「—」,
 * ⚖ B1-5b, so the new row printed a confident ¥0) and no chip (the server chips
 * 新規, which is exactly what someone just added is). A second home for a
 * derivation is a second answer; there is one home now, and both callers use it.
 *
 * Everything derived is derived: the category comes from `bookingCategory` on
 * the customer shape this row really has — no ticket, not VIP, zero prior
 * visits — rather than from the string 'new' typed by hand.
 */
export function localCustomerRow(input: {
  seq: number
  name: string
  furigana: string | null
  phone: string
  email: string | null
  source: string
  storeLabel: string | null
}): CustomerRow {
  const category = bookingCategory(
    { ticket_balance: null, vip: false } as Parameters<typeof bookingCategory>[0],
    0,
  )
  return {
    id: `local-${input.seq}`,
    no: `C-${input.seq}`,
    name: input.name,
    furigana: input.furigana,
    mark: input.name.split(/\s+/)[0].slice(0, 3),
    phone: input.phone,
    email: input.email,
    source: input.source,
    identityCheck: null,
    storeLabel: input.storeLabel,
    groupKey: '',
    hasNext: false,
    nextLabel: 'なし',
    nextMenu: '予約なし',
    nextDetail: '次回予約なし',
    nextPrice: '予約確定後に記録',
    ticket: null,
    wallet: null,
    lastVisitShort: null,
    lastVisitFull: null,
    // no completed visit in this lens — unknown, never a confident ¥0
    totalSpent: null,
    consent: { line: false, sms: false, email: false },
    lineLinked: false,
    merge: 'none',
    duplicateOf: null,
    party: [],
    thin: false,
    externalOwner: false,
    note: null,
    history: [],
    bookings: [],
    daysSinceLastVisit: null,
    winBack: winBackLine(null),
    lastVisitMeta: '最終来店 記録なし',
    category,
    categoryChip: CHIPPED.includes(category) ? CATEGORY_LABEL[category] : null,
    ticketEnding: false,
  }
}

/** ⚖ RIDER §3.1 — the 空き日数 fact in the row's own words. A number with its
 *  unit and its subject, never a bare figure (⚖ 8/25: 来店10回, not 10回). */
export function winBackLine(daysSince: number | null): string {
  if (daysSince === null) return '来店記録なし'
  if (daysSince <= 0) return '本日来店'
  return `最終来店から ${daysSince}日`
}
