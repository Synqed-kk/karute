// 予約一覧 derivations — every number and every word on the screen that is not
// literally a fixture field.
//
// THE RULE THIS FILE EXISTS FOR: 要対応 is not a stored state. It is ONE
// predicate (`isQueued`) that the queue, the 要対応 tile, the 最短期限 tile and
// the 状態 filter all read, so those four surfaces cannot disagree — canon's own
// discipline, and the reason its comment says 「数字はどこにも直書きしない」.
//
// THE SECOND RULE: the lifecycle word is DERIVED from the same per-booking
// fields the Today board paints from (`status`, `board_state`, `settlement`)
// plus the one field core has no room for (`pending`, ask C-1). A booking
// therefore cannot read 確定 on the list while its card says 来店なし on the
// board — there is no second copy of the fact to drift.

import type { FixtureAppointment, FixtureCustomer } from './fixtures'
import { NEEDS_STAFF, WANTS_CHANGE, type FixtureReservation } from './fixtures-reservations'
import type { FixtureSellSlot, FixtureShift } from './fixtures-today'
import { hhmm } from './today-board'

export { NEEDS_STAFF, WANTS_CHANGE }

/** The 7 lifecycle words (M-30). The vocabulary's 正本 is 言語・表示設定; this is
 *  the mapping table only, and it is fixed at seven so the 状態 pill never wraps
 *  (longest: 予約元で管理). Tones are canon's own pill classes. */
export type Lifecycle =
  | 'pending_accept'
  | 'confirmed'
  | 'awaiting_settlement'
  | 'settled'
  | 'cancelled'
  | 'no_show'
  | 'external'

export const LIFECYCLE: Record<Lifecycle, { label: string; tone: string }> = {
  pending_accept: { label: '受付判断', tone: 'warn' },
  confirmed: { label: '確定', tone: 'good' },
  awaiting_settlement: { label: '精算待ち', tone: 'warn' },
  settled: { label: '精算済み', tone: 'good' },
  // `alert` is the repo's red pill (business-shell.css); canon spells the same
  // paint `bad` on this page. One pill, one class name.
  cancelled: { label: '取消', tone: 'alert' },
  no_show: { label: '来店なし', tone: 'alert' },
  external: { label: '予約元で管理', tone: 'indigo' },
}

/** Undecided lifecycles — the only ones a deadline can put in the queue. A
 *  settled / cancelled / no-show / externally-owned booking is finished here
 *  whatever date it carries; what is left of it belongs to another desk. */
export const OPEN_LIFECYCLE: Lifecycle[] = ['pending_accept', 'confirmed', 'awaiting_settlement']

const isExternal = (source: string) => source.startsWith('外部予約元')

/**
 * The lifecycle word for one booking. Terminal outcomes win over provenance:
 * an externally-booked customer who did not turn up is 来店なし, not
 * 予約元で管理 — which is also what the board's card says, so the two agree by
 * construction rather than by review.
 */
export function lifecycleOf(
  booking: Pick<FixtureAppointment, 'status' | 'board_state' | 'settlement' | 'source'>,
  record: Pick<FixtureReservation, 'pending'> | null,
): Lifecycle {
  if (booking.status === 'cancelled') return 'cancelled'
  if (booking.board_state === 'noshow') return 'no_show'
  if (record?.pending) return 'pending_accept'
  if (booking.settlement === 'settled') return 'settled'
  if (booking.settlement === 'awaiting') return 'awaiting_settlement'
  if (isExternal(booking.source)) return 'external'
  return 'confirmed'
}

/**
 * 期限 for one booking, JST minutes from midnight, or null.
 *
 * 精算期限 is NOT stored anywhere: it IS 閉店 (設定 §営業時間), so a store that
 * changes its hours moves every settlement deadline with it and no fixture has
 * to be re-typed. Everything else comes from the exception record.
 */
export function deadlineOf(
  lifecycle: Lifecycle,
  record: Pick<FixtureReservation, 'deadline'> | null,
  closeMinute: number,
): number | null {
  if (lifecycle === 'awaiting_settlement') return closeMinute
  return record?.deadline ?? null
}

/** 要対応 — the ONE definition. Queue, both tiles and the 状態 filter read it. */
export function isQueued(lifecycle: Lifecycle, deadline: number | null): boolean {
  return deadline !== null && OPEN_LIFECYCLE.includes(lifecycle)
}

/** 状態フラグ (M-31): the stored half plus the two derived ones. 期限超過 comes
 *  from the clock and 担当変更あり from the booking's own `reassigned_from`, so
 *  neither can be stored stale. 期限超過 leads — it is the one that changes what
 *  you do next. */
export function flagsOf(stored: string[], reassigned: boolean, overdue: boolean): string[] {
  const flags = [...stored]
  if (reassigned) flags.push('担当変更あり')
  return overdue ? ['期限超過', ...flags] : flags
}

/** Which decision a queue card is asking for. Read from state + flags, never
 *  from an id: canon's earlier version branched on 「R-4838」 by name and went
 *  quietly wrong the moment the data changed. */
export type DecisionKind = 'accept' | 'change' | 'escalate' | 'settle' | 'open'

export function decisionKindOf(lifecycle: Lifecycle, flags: string[]): DecisionKind {
  if (flags.includes(NEEDS_STAFF)) return 'escalate'
  if (flags.includes(WANTS_CHANGE)) return 'change'
  if (lifecycle === 'pending_accept') return 'accept'
  if (lifecycle === 'awaiting_settlement') return 'settle'
  return 'open'
}

export const DEADLINE_WORD: Record<DecisionKind, string> = {
  accept: '回答期限',
  change: '回答期限',
  escalate: '対応期限',
  settle: '精算期限',
  open: '対応期限',
}

export const QUEUE_ACTION: Record<DecisionKind, string> = {
  accept: '受付リクエストを確認',
  change: '日時・担当変更を確認',
  escalate: '判断できる担当者へ相談',
  settle: '精算へ',
  open: '予約を確認',
}

/** 受付元 (M-18 / M-27). The booking's `source` already carries the channel and
 *  its reference number ('Reserve #357552'); the label is its first token and
 *  the filter group is a fold of that. 「Reserveリクエスト」 vs 「Reserve」 is the
 *  acceptance state showing through the label, exactly as canon has it. */
export function sourceOf(source: string, pending: boolean): { label: string; group: 'reserve' | 'store' | 'external'; ref: string | null } {
  const [base, ...rest] = source.split(' ')
  const ref = rest.join(' ') || null
  if (isExternal(source)) return { label: '外部予約元', group: 'external', ref }
  if (base === 'Reserve') return { label: pending ? 'Reserveリクエスト' : 'Reserve', group: 'reserve', ref }
  return { label: base, group: 'store', ref }
}

/** 価格条件 (M-49). Strongest-first, the same precedence the board's カテゴリー
 *  uses (VIP over 回数券 over everything), so one customer is not a VIP on one
 *  screen and a 回数券 holder on the other. */
export function eligibilityOf(
  customer: Pick<FixtureCustomer, 'vip' | 'ticket_balance'> | null,
  group: 'reserve' | 'store' | 'external',
): string {
  if (group === 'external') return '外部予約元 / 自動調整対象外'
  if (customer?.vip) return 'VIP / 自動調整対象外'
  if ((customer?.ticket_balance ?? 0) > 0) return '回数券 / 自動調整対象外'
  return group === 'reserve' ? '単発オンライン / 対象' : '店頭受付 / 対象'
}

/** 「あと34分」/「期限超過 2時間」 — canon's own wording, from a signed minute
 *  count. Hours swallow a zero-minute remainder ('2時間', never '2時間0分'). */
export function spanText(minutes: number): string {
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return h ? `${h}時間${m ? `${m}分` : ''}` : `${m}分`
}

/** 勤務時間 warning (M-70's 7th fact, ask C-11). DERIVED from the shift plane:
 *  a request that runs past the end of its staff member's day is the reason the
 *  accept dialog exists. `null` = the booking sits inside the shift and there is
 *  nothing to warn about — an always-present warning warns about nothing. */
export function shiftWarningOf(
  staffName: string,
  shift: Pick<FixtureShift, 'start' | 'end'> | null,
  startMinute: number,
  endMinute: number,
): string | null {
  if (!shift) return `${staffName} はこの日の勤務予定がありません`
  const window = `${staffName} ${hhmm(shift.start)}–${hhmm(shift.end)}`
  if (endMinute > shift.end) return `${window}・この予約は${endMinute - shift.end}分超過`
  if (startMinute < shift.start) return `${window}・この予約は${shift.start - startMinute}分早い開始`
  return null
}

/** 空き枠候補 (M-63 / M-72, ask C-13). The candidates are the store's own
 *  販売可能枠 that are LONG ENOUGH to hold this booking — a slot that cannot fit
 *  the treatment is not a candidate, and offering one is how two managers
 *  double-book. Core owns this search for real; the honesty table says so. */
/** The four filters (M-15–M-18), as ONE predicate. It lives here rather than
 *  inside the screen for the reason the whole file exists: 状態 = 要対応 has to
 *  select exactly the rows the queue holds, and the only way to guarantee that
 *  is for both to read the same `queued` flag rather than two look-alike
 *  conditions. 検索 covers canon's four fields (name, 予約番号, menu, 担当).
 *  ⚠ RECONNECT: the search is client-side over one fetched page (ask S-4);
 *  cross-store rows must stay excluded server-side, never by this filter. */
export interface ReservationFilters {
  search: string
  date: 'all' | 'today' | 'future'
  status: 'all' | 'attention' | Lifecycle
  source: 'all' | 'reserve' | 'store' | 'external'
}

export function matchesFilters(
  row: {
    no: string
    customerName: string
    menuName: string
    staffName: string
    isToday: boolean
    lifecycle: Lifecycle
    sourceGroup: 'reserve' | 'store' | 'external'
    queued: boolean
  },
  f: ReservationFilters,
): boolean {
  if (f.status === 'attention' ? !row.queued : f.status !== 'all' && row.lifecycle !== f.status) return false
  if (f.date === 'today' && !row.isToday) return false
  if (f.date === 'future' && row.isToday) return false
  if (f.source !== 'all' && row.sourceGroup !== f.source) return false
  const q = f.search.trim().toLowerCase()
  if (!q) return true
  return [row.no, row.customerName, row.menuName, row.staffName].join(' ').toLowerCase().includes(q)
}

export function safeSlotsFor<T extends Pick<FixtureSellSlot, 'start' | 'end'>>(
  slots: T[],
  durationMinutes: number,
): T[] {
  return slots.filter((s) => s.end - s.start >= durationMinutes)
}
