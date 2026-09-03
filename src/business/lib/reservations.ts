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

/** The inspector's primary action, as canon branches it (fable-store-
 *  reservations.html:658-667). EIGHT states, tested in canon's own order —
 *  `escalate` and `change` come off the FLAGS and outrank every lifecycle test,
 *  and 受付リクエストを確認 needs the booking to still be queued: a 受付判断 whose
 *  deadline has been cleared is no longer a decision this screen can take, so it
 *  falls through to the 受信トレイ branch exactly as canon does.
 *
 *  Returned as a key rather than markup so the screen owns the DOM and this
 *  owns the branching — the reason canon's comment says the old id-name version
 *  (「R-4838/R-4831/R-4817 を名指しで分岐」) 「データが増えるたびに嘘になる導線だった」. */
export type PrimaryAction =
  | 'escalate'
  | 'change'
  | 'accept'
  | 'settle'
  | 'external'
  | 'record'
  | 'propose'
  | 'contact'
  | 'today'

export function primaryActionOf(
  lifecycle: Lifecycle,
  flags: string[],
  deadline: number | null,
): PrimaryAction {
  const kind = decisionKindOf(lifecycle, flags)
  if (kind === 'escalate') return 'escalate'
  if (kind === 'change') return 'change'
  if (kind === 'accept' && isQueued(lifecycle, deadline)) return 'accept'
  if (lifecycle === 'awaiting_settlement') return 'settle'
  if (lifecycle === 'external') return 'external'
  if (lifecycle === 'confirmed') return 'record'
  if (lifecycle === 'pending_accept') return 'propose'
  if (lifecycle === 'cancelled' || lifecycle === 'no_show') return 'contact'
  return 'today'
}

/** THE COUNTS ARE THE FILTERS (⚖-ADJ D, the accepted mock). A chip stores
 *  CRITERIA, never a cached row set: pressing one sets the five filters below
 *  and the list re-derives. Canon's own mapping is kept where it stood
 *  (w2-bookings-customers.js `applySavedView`, :734-745) and two chips join it —
 *  精算待ち and 本日, which used to be summary tiles nobody could press.
 *
 *  ⚖-ADJ E — 一致なしを確認 IS NOW A REAL JOB. Canon's `'none'` was a deliberate
 *  empty-result view (a saved view that matches nothing has to be visibly
 *  survivable); the accepted mock reads the same words as 「受付価格を照合できない
 *  予約」, which this screen's own 価格の証拠 surface can answer from the two price
 *  labels every row already carries. The empty-result case stays survivable —
 *  it is what a search matching nothing does, and the suite pins it there. */
export type SavedView = 'all' | 'attention' | 'settling' | 'today' | 'reserve' | 'none'

/** The chip row, in the mock's own order. ONE list, read by the control that
 *  draws the chips and by the counts beside them, so a chip can never be
 *  counted with a predicate the list does not run. */
/**
 * ⚖ THE LADDER IS KEYED TO THE **PAGE**, NOT TO THE VIEWPORT — and these are the
 * numbers, spelled ONCE so the sheet's `@container` bands and the screen's own
 * band read cannot drift apart (the probe measures that they agree).
 *
 * THE HAZARD, in the shell's own arithmetic: the rail is 264px at ≥1024 with the
 * sidebar open and 76px everywhere else, so the page a room is given FALLS BY
 * 188px as the viewport crosses 1024. A layout chosen from a viewport width is a
 * layout chosen from the wrong number.
 *
 * WHERE EACH NUMBER COMES FROM, in the accepted mock's own arithmetic:
 *   · 1015 — the mock's desk layout is proven at viewport 1280 with its own
 *     264px sidebar, so the widest page it was ACCEPTED at is 1280 − 264 = 1016.
 *     Below that the mock's own narrow band takes over.
 *   · 891 — the mock's one-column band starts at viewport 1099, where its
 *     sidebar is 208px: 1099 − 208 = 891.
 *   · 699 — the mock's phone band starts at viewport 899, where its sidebar is
 *     still 208px in flow: 899 − 208 = 691, and 699 is where the head's four
 *     parts genuinely stop fitting (the same measurement the 録音 room took).
 * Monotonic by construction: one page width, one answer, and a page that grows
 * can never lose a column.
 */
export const PAGE_BANDS = { narrow: 1015, oneColumn: 891, phone: 699 } as const

export const CHIP_VIEWS: SavedView[] = ['all', 'attention', 'settling', 'today', 'reserve', 'none']

export const CHIP_LABEL: Record<SavedView, string> = {
  all: 'すべて',
  attention: '要対応',
  settling: '精算待ち',
  today: '本日',
  reserve: 'Reserve受付',
  none: '一致なしを確認',
}

export function viewFilters(view: SavedView): ReservationFilters {
  return {
    date: view === 'today' ? 'today' : 'all',
    status: view === 'attention' ? 'attention' : view === 'settling' ? 'awaiting_settlement' : 'all',
    source: view === 'reserve' ? 'reserve' : 'all',
    price: view === 'none' ? 'unmatched' : 'all',
    search: '',
  }
}

/** Each chip's number, taken over the SAME predicate the list runs. The pin is
 *  both ways: this count IS the number of rows the chip reveals when pressed,
 *  for every chip and every lens. A count computed a second way is the disease
 *  (⚖ one verdict, one home). */
export function chipCounts<
  R extends Parameters<typeof matchesFilters>[0] & { priceLabel: string; currentPriceLabel: string },
>(rows: readonly R[]): Record<SavedView, number> {
  const out = {} as Record<SavedView, number>
  for (const v of CHIP_VIEWS) out[v] = rows.filter((r) => matchesFilters(r, viewFilters(v))).length
  return out
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

const two = (n: number) => (n < 10 ? `0${n}` : `${n}`)

/**
 * 「あと21分00秒」/「期限超過 54分00秒」 — the accepted mock's own `cdText`,
 * ported line for line (RESERVATIONS-MOCK-v1.html:1113). Seconds always two
 * digits so the rail's number never changes width as it counts; hours appear
 * only when there is at least one.
 *
 * ⚖-ADJ M — THIS IS DISPLAY, AND ONLY DISPLAY. `elapsedSec` is the client's own
 * tick since mount; the row's 期限超過 flag, its queue membership and its pill
 * stay the MINUTE derivation on the server-pinned `boardNow`, which is the one
 * truth the suite tests. So a countdown crossing zero in front of a reader
 * reads 「期限超過 0分NN秒」 while the pill still says what the render said. A
 * second client-side `overdue` would be a second copy of a fact, which is the
 * one thing this room's whole derivation file exists to prevent.
 */
export function countdownText(deadlineMinute: number, nowMinute: number, elapsedSec: number): string {
  const left = deadlineMinute * 60 - (nowMinute * 60 + elapsedSec)
  if (left <= 0) {
    const over = -left
    const h = Math.floor(over / 3600)
    return `期限超過 ${h ? `${h}時間` : ''}${Math.floor((over % 3600) / 60)}分${two(over % 60)}秒`
  }
  const h = Math.floor(left / 3600)
  return `あと${h ? `${h}時間` : ''}${Math.floor((left % 3600) / 60)}分${two(left % 60)}秒`
}

/**
 * 来店なし memory (rider #3, ⚖ 9/2). How many times THIS customer has already
 * failed to turn up — the same `board_state === 'noshow'` rows the Today board
 * paints, so the two screens count one thing.
 *
 * THREE RULES, EACH FOR A REASON:
 *   · the rows handed in are the LENS's own, so a branch counts only its own
 *     store's no-shows and the isolation law holds by construction rather than
 *     by a filter someone could forget (⚖ 8/17);
 *   · a booking that has not happened yet is not a no-show — the cut is the
 *     room's ONE pinned clock (`boardNow` on today's day key), never a wall
 *     clock, so the number is the same on every render;
 *   · a booking never counts ITSELF. The tag is memory about the customer's
 *     other visits; on the no-show row the pill already says what happened, and
 *     a row explaining itself back to the reader is noise.
 */
export function noShowCountOf(
  rows: ReadonlyArray<{ id: string; customerId: string; boardState: string | null; dayKey: number; endMinute: number }>,
  customerId: string,
  exceptId: string,
  now: { dayKey: number; minute: number },
): number {
  return rows.filter(
    (r) =>
      r.id !== exceptId &&
      r.customerId === customerId &&
      r.boardState === 'noshow' &&
      (r.dayKey < now.dayKey || (r.dayKey === now.dayKey && r.endMinute <= now.minute)),
  ).length
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

/** 担当資格 — the middle segment of the accept dialog's 担当資格・設備 fact
 *  (M-70). Canon writes the literal 「小顔対応済み」 because its own fixture staff
 *  for that one booking holds 小顔; a literal here would affirm a qualification
 *  the assigned staff may not have, which is the untrue-affirmative defect
 *  class. So it is READ from the roster's 資格 plane (fixtures-today
 *  `staffQualifications`): the dialog states which qualifications the person
 *  actually holds, and states plainly when the roster has none on file.
 *  A dialog whose whole job is 「確認しました」 cannot be the thing that lies. */
export function qualificationTextOf(qualifications: string[] | undefined): string {
  return qualifications?.length ? `${qualifications.join('・')}対応済み` : '資格の登録なし'
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
  /** ⚖-ADJ E — 受付価格の照合. `unmatched` keeps the rows whose 受付時に合意 and
   *  現在の公開価格 cannot be reconciled, which is the job the 価格の証拠 panel
   *  exists for and the only axis this screen can answer from its own data. */
  price: 'all' | 'unmatched'
}

/** 受付価格が照合できない — the two labels the row already carries, compared.
 *
 *  ONE COMPARISON, and it is enough: a row with no recorded 受付価格 reads
 *  「受付価格の記録なし」 and a menu with no published price reads
 *  「公開価格の記録なし」, so a missing figure can never equal the one beside it.
 *  Comparing the LABELS rather than the numbers keeps one formatter and one
 *  truth — the same strings the panel prints are the ones the filter judges. */
export function priceUnmatched(row: { priceLabel: string; currentPriceLabel: string }): boolean {
  return row.priceLabel !== row.currentPriceLabel
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
    priceLabel: string
    currentPriceLabel: string
  },
  f: ReservationFilters,
): boolean {
  if (f.status === 'attention' ? !row.queued : f.status !== 'all' && row.lifecycle !== f.status) return false
  if (f.date === 'today' && !row.isToday) return false
  if (f.date === 'future' && row.isToday) return false
  if (f.source !== 'all' && row.sourceGroup !== f.source) return false
  if (f.price === 'unmatched' && !priceUnmatched(row)) return false
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
