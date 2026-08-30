// カルテ — the room's derivations. Every judgement this page shows is made here
// ONCE and rendered wherever it is needed, so a pill and the filter that counts
// it can never disagree (⚖ A8: more than one home for one verdict is the
// disease, not the symptom).
//
// PURE, AND THAT IS THE POINT. Nothing here reads the clock, touches data or
// knows React: the room's server assembly hands these functions the rows the
// store-clamped fixture door returned, and the room's SCREEN calls the same
// predicates on the client so the search, the filters and the window walk narrow
// the list by exactly the rules the counts were computed with.
//
// ⚖ ONE TRUTH, TWO DOORS. A record is the phone app's record. The eight
// categories, the summary/edited pair, the outcome vocabulary and the consent
// badge are the phone's own contract (`src/lib/karute/detail-screen.ts`,
// `CurrentSessionCard.tsx`, `outcome-types.ts`) — quoted here by SHAPE rather
// than imported, because Business territory may not reach into `src/lib/karute/*`
// runtime (packet §3). Each mirrored shape names the file it mirrors.

import { jstDayKey } from './clock'
import { type FixtureAppointment, type FixtureCustomer, type FixtureMenu, type FixtureStaff } from './fixtures'
import {
  type FixtureKaruteEntry,
  type FixtureKarutePhoto,
  type FixtureKaruteRecord,
  type KaruteCategory,
} from './fixtures-karute'

// ── the eight drawers ───────────────────────────────────────────────────────

/** ⚖ THE ORDER IS THE PHONE'S, VERBATIM (`CATEGORY_ORDER`,
 *  CurrentSessionCard.tsx): concerns raised → condition read → life context →
 *  treatment done → preferences → products → next visit → anything else. Staff
 *  skim a record by TYPE, not by the order the lines happened to arrive in, and
 *  a computer door that reshuffled the drawers would be teaching a second habit
 *  for one record. */
export const CATEGORY_ORDER: KaruteCategory[] = [
  'concern',
  'condition',
  'lifestyle',
  'treatment',
  'preference',
  'product',
  'next',
  'note',
]

/** The phone's own labels (`messages/ja.json`
 *  karuteDetail.currentSession.categories.*). ⚠ NOT the proposal mock's
 *  invented set (治療 / 体調・状態 / 施術の好み …): the packet's §2 says the field
 *  set AND ITS LABELS come from the detail-screen contract, and a staff member
 *  who writes into 気になる点 on the phone must read 気になる点 on the computer. */
export const CATEGORY_LABEL: Record<KaruteCategory, string> = {
  concern: '気になる点',
  condition: '部位',
  lifestyle: 'ライフスタイル',
  treatment: '施術',
  preference: '好み',
  product: '製品',
  next: '次回',
  note: 'メモ',
}

// ── who may see what ────────────────────────────────────────────────────────

/** What a role may do in this room. TWO questions, and they are different:
 *  reading a discarded record's CONTENT, and re-pointing a record at another
 *  customer. Nothing else in this room is gated — a カルテ list is the store's
 *  own census, and canon puts no role gate on reading it. */
export interface KaruteAccess {
  /** ⚖ Liam 8/20 ②: the reason and the content of a 破棄済み record are a
   *  manager/authority read. The ROW itself is not gated — existence is never
   *  hidden, from anyone, including the person who discarded it (⚖ 8/20 ①). */
  discardContent: boolean
  /** カルテの顧客変更 — the phone's `records.reassign` capability, threaded the
   *  same way (`staffCanReassignRecords`). HIDE, never show-and-refuse: a staff
   *  member without it never sees the ⇆ at all, exactly as on the phone. */
  reassign: boolean
}

const NO_ACCESS: KaruteAccess = { discardContent: false, reassign: false }

const ACCESS_BY_ROLE: Record<string, KaruteAccess> = {
  オーナー: { discardContent: true, reassign: true },
  店舗管理者: { discardContent: true, reassign: true },
  スタッフ: { discardContent: false, reassign: false },
}

/** FAIL-CLOSED, and on this table's OWN rows only. `Object.hasOwn` rather than a
 *  bare index: a role named `constructor` or `__proto__` resolves through the
 *  prototype chain, `?? NO_ACCESS` never fires, and every flag reads `undefined`
 *  — which is falsy for `discardContent` by luck rather than by rule. The room-4
 *  F-M1 lesson, carried. */
export function accessFor(role: string): KaruteAccess {
  return Object.hasOwn(ACCESS_BY_ROLE, role) ? ACCESS_BY_ROLE[role] : NO_ACCESS
}

/** What the page says out loud about what this reader cannot see. One sentence
 *  per real rule, never a generic 「権限がありません」.
 *
 *  ⚖ Liam 8/30 D3 — THE TRANSCRIPT LINE IS THE SAME FOR EVERYONE, and it says
 *  what is TRUE: whether a manager may read a staff member's transcript is a
 *  per-business setting (dial #16 文字起こしの公開範囲), enforced at the data
 *  door, and this room opens no transcript door in either mode. The room must
 *  never print 「管理者も文字起こしは見られません」 — that would be this page
 *  inventing a rule the business is the one who decides. */
export function permissionNotice(access: KaruteAccess): string[] {
  const lines = ['文字起こしの閲覧は店舗の設定に従います（未接続）。この画面では録音の文字起こしは表示しません。']
  if (!access.discardContent) {
    lines.push('破棄されたカルテは一覧に残りますが、その内容と破棄の理由は店舗管理者のみが確認できます。')
  }
  return lines
}

// ── the record's state ──────────────────────────────────────────────────────

/** FIVE states, and every one of them is a different job for the shop:
 *  · summarized  AI要約済 — written up and confirmed, nothing owed
 *  · draft       下書き — the AI wrote a summary nobody has confirmed
 *  · pending     AI補完待ち — there are notes, the summary has not been made
 *  · provisional 仮カルテ — the record was opened and nothing was written in it
 *  · discarded   破棄済み — thrown away, KEPT, and grayed (⚖ 8/20)
 *
 *  ⚖ 破棄 OUTRANKS EVERYTHING. A discarded record is not "a 下書き that was also
 *  discarded": the discard is the whole of what the row means, and a pill that
 *  said 下書き over a thrown-away record would invite somebody to finish it. */
export type RecordState = 'summarized' | 'draft' | 'pending' | 'provisional' | 'discarded'

export const STATE_LABEL: Record<RecordState, string> = {
  summarized: 'AI要約済',
  draft: '下書き',
  pending: 'AI補完待ち',
  provisional: '仮カルテ',
  discarded: '破棄済み',
}

/** State → its pill. The shell's four pills are the family's vocabulary, and
 *  these colours are SEMANTIC (⚖ the one-way accent law): green says the record
 *  is finished, amber says the shop still owes it something. 破棄済み and 下書き
 *  take the NEUTRAL pill on purpose — ⚖ Liam 8/25 ruling B's rendering law says
 *  a discard is a plain fact and never a warning, so it gets no red, no
 *  threshold and no grade. A staffer must never hesitate to throw away a
 *  genuinely bad take in order to protect the colour of a row. */
export const STATE_PILL: Record<RecordState, string> = {
  summarized: 'pill good',
  draft: 'pill',
  pending: 'pill warn',
  provisional: 'pill warn',
  discarded: 'pill',
}

/** THE ONE PLACE a record's state is decided. Canon's own precedence
 *  (MOCK-karute-list.html `aiChipHtml`): nothing written → 仮カルテ, before any
 *  question about the summary is asked. 破棄 is added ABOVE that. */
export function stateOf(record: Pick<FixtureKaruteRecord, 'entries' | 'summary_ai' | 'summary_state' | 'discarded'>): RecordState {
  if (record.discarded) return 'discarded'
  if (record.entries.length === 0) return 'provisional'
  if (record.summary_ai === null) return 'pending'
  return record.summary_state === 'confirmed' ? 'summarized' : 'draft'
}

// ── the session's outcome ───────────────────────────────────────────────────

/** The phone's own vocabulary and its own labels (`Outcome` in
 *  src/lib/karute/outcome-types.ts; recording.outcome.chip.* in
 *  messages/ja.json). 通常ご来店 is NOT a sales outcome and never carries a
 *  reason — the same rule the phone states. */
export const OUTCOME_LABEL: Record<'success' | 'no_deal' | 'pending' | 'revisit', string> = {
  success: '成約',
  no_deal: '不成約',
  pending: '仮カルテ',
  revisit: '通常ご来店',
}

export const OUTCOME_PILL: Record<'success' | 'no_deal' | 'pending' | 'revisit', string> = {
  success: 'pill good',
  no_deal: 'pill alert',
  pending: 'pill warn',
  revisit: 'pill indigo',
}

/** recording.outcome.reason.* — the phone's five, in its order. */
export const DECLINE_LABEL: Record<'budget' | 'considering' | 'mismatch' | 'follow_up' | 'other', string> = {
  budget: '予算',
  considering: '検討中',
  mismatch: '店舗ミスマッチ',
  follow_up: '後日連絡予定',
  other: 'その他',
}

/** What the outcome MEANS for the shop's numbers, in the phone's own words
 *  (recording.outcome.*.desc / autoNote). `null` = the outcome speaks for
 *  itself and there is nothing to add. */
export function outcomeNote(
  outcome: { status: 'success' | 'no_deal' | 'pending' | 'revisit'; reason: string | null } | null,
): string | null {
  if (!outcome) return null
  if (outcome.status === 'revisit') return '「通常ご来店」は成約率の集計に含めません（既存のお客様の通常のご来店のため）。'
  if (outcome.status === 'pending') return '未決のまま14日が経過すると、自動的に「不成約」に切り替わります。'
  if (outcome.status === 'no_deal' && outcome.reason) return `お断りの理由: ${outcome.reason}`
  return null
}

// ── search ──────────────────────────────────────────────────────────────────

/** Canon's own normaliser (MOCK-karute-list.html `normalizeForSearch`), carried
 *  line for line because every step of it is load-bearing Japanese search
 *  behaviour: NFKC folds ﾐﾎﾝ and Ｃ-3001 onto their ordinary forms, the
 *  hiragana→katakana shift makes みほん find ミホン, and dropping spaces and the
 *  dash family makes 「見本 あかり」 findable as みほんあかり and C3001 findable as
 *  C-3001. The QUERY and every indexed field go through this same function —
 *  one normaliser, or the box quietly fails on half the ways a name is typed. */
export function normalizeForSearch(value: string | null | undefined): string {
  let s = value == null ? '' : String(value)
  s = s.normalize('NFKC')
  s = s.toLowerCase()
  s = s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
  s = s.replace(/\s+/g, '')
  s = s.replace(/[-‐-―−ー]/g, '')
  return s
}

/** THE SIX FIELDS THE BOX PROMISES, AND ONLY THOSE — 顧客名・かな・顧客番号・
 *  カルテ番号・サービス・スタッフ.
 *
 *  ⚠ CANON ALSO INDEXED THE SUMMARY TEXT, AND THIS ROOM DELIBERATELY DOES NOT.
 *  Two reasons, and the second one decides it. A box whose own label names six
 *  fields and secretly matches a seventh is a surface lying about itself. And a
 *  summary is RECORD CONTENT: a 破棄済み record's content is a 店舗管理者 read
 *  (⚖ 8/20 ②), so a staff member typing a word from it and watching the row
 *  appear would be reading, through the search box, exactly the text the room
 *  refuses to print. The index is built from the row's own six visible fields,
 *  so it can never surface something the reader is not allowed to see. */
export function searchHay(row: {
  customerName: string
  furigana: string | null
  memberNumber: string
  id: string
  service: string
  staffName: string
}): string {
  return [row.customerName, row.furigana ?? '', row.memberNumber, row.id, row.service, row.staffName]
    .map(normalizeForSearch)
    .join(' ')
}

export function matchesSearch(
  row: Parameters<typeof searchHay>[0],
  query: string,
): boolean {
  const q = normalizeForSearch(query)
  return q === '' || searchHay(row).includes(q)
}

// ── the filters, and the counts that must agree with them ───────────────────

export type RecordFilter = 'all' | 'week' | 'pending' | 'draft'

/** Canon's four (MOCK-karute-list.html `STATE_FILTERS`), in canon's order. */
export const FILTERS: Array<{ key: RecordFilter; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'week', label: '今週' },
  { key: 'pending', label: 'AI補完待ち' },
  { key: 'draft', label: '下書き' },
]

/** ⚖ THE PILL/COUNT LAW'S OWN PREDICATE (packet §7b-3). The count printed beside
 *  a filter is computed by THIS function and the tap applies THIS function, so a
 *  counter can never name a number its own press does not produce. */
export function matchesFilter(row: { state: RecordState; thisWeek: boolean }, filter: RecordFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'week') return row.thisWeek
  if (filter === 'pending') return row.state === 'pending'
  return row.state === 'draft'
}

// ── the date-windowed backward walk ─────────────────────────────────────────

/** ⚖ CHUNK-LOADING, ADOPTED (packet §7b-1). A records desk does not page: it
 *  shows the recent stretch and walks backwards on request, because "the last
 *  two weeks" is a question a shop asks and "page 3 of 7" is not. The window is
 *  a span of DAYS, so the number of rows a step reveals is whatever the shop
 *  actually did in those days — which is the honest shape, and the one the
 *  version-negotiated real read lands on at reconnect (registry ⑧/⑨). */
export const WINDOW_DAYS = 14

/** Rows within `steps` windows of the newest one, plus how many are still
 *  behind the walk. Rows must arrive NEWEST FIRST.
 *
 *  A STEP THAT REVEALS NOTHING IS NOT A STEP. A shop with a quiet fortnight
 *  would otherwise have to press さらに表示 three times at a list that does not
 *  change, which reads as a broken button rather than as an empty stretch — so
 *  the walk keeps extending until the span either gains a row or reaches the
 *  oldest record there is. `hidden` is what the head's 表示中 gap names. */
export function windowRows<T extends { dayKey: number }>(
  rows: T[],
  steps: number,
): { visible: T[]; hidden: number; cutoff: number | null } {
  if (rows.length === 0) return { visible: [], hidden: 0, cutoff: null }
  const newest = rows[0].dayKey
  const oldest = rows[rows.length - 1].dayKey
  let step = Math.max(1, Math.floor(steps))
  let cutoff = newest - step * WINDOW_DAYS + 1
  let visible = rows.filter((r) => r.dayKey >= cutoff)
  let before = rows.filter((r) => r.dayKey >= cutoff + WINDOW_DAYS).length
  while (visible.length === before && cutoff > oldest) {
    step += 1
    before = visible.length
    cutoff = newest - step * WINDOW_DAYS + 1
    visible = rows.filter((r) => r.dayKey >= cutoff)
  }
  return { visible, hidden: rows.length - visible.length, cutoff }
}

// ── the model ───────────────────────────────────────────────────────────────

export interface KaruteEntryModel {
  category: KaruteCategory
  label: string
  text: string
  /** The 手書き chip — a line a person wrote, which 再生成 must never overwrite. */
  handwritten: boolean
}

export interface KaruteRecordModel {
  /** カルテ番号. */
  id: string
  /** ⚠ The record's own store, resolved through its BOOKING. Carried so the
   *  isolation pin can be made on the model rather than on a rendered string. */
  storeId: string | null
  customerId: string
  customerName: string
  furigana: string | null
  /** 顧客番号 — the cross-store join key the world already owns. */
  memberNumber: string
  /** Person-mark initials, pre-split by the world so this room parses no names. */
  mark: string
  staffId: string | null
  staffName: string
  /** The menu the session was booked under. Canon's own サービス column. */
  service: string
  /** 予約番号 — the booking this record belongs to, in the world's own words. */
  bookingNo: string
  /** The booking's own start instant, carried so the assembly formats the
   *  session's time from the BOOKING rather than looking the row back up by a
   *  display number (a second join, and one that ties on any two bookings that
   *  ever share a number). */
  startsAt: string
  /** JST day index of the session (jstDayKey). The window walk's axis, and a
   *  sortable day the client can compare without owning a clock. */
  dayKey: number
  /** Server-decided, because 今週 is a CLOCK question and the client has none. */
  thisWeek: boolean
  state: RecordState
  /** The one-line preview under the customer's name in the list. `null` = there
   *  is nothing to preview, and the row says WHY rather than printing a blank. */
  preview: string | null
  /** 施術記録 — the eight drawers, in the phone's order, present ones only. */
  entries: KaruteEntryModel[]
  /** 詳細記録, split to bullets the way the phone's own summary card does. */
  summaryBullets: string[]
  /** True when a person rewrote the AI's summary — the amber pencil. */
  summaryEdited: boolean
  /** 記録の履歴 — the record's own events, NEWEST FIRST, which is what the
   *  section says out loud. Built as ONE sorted list rather than a discard row
   *  printed above an unsorted edit array: a section that claims an order its
   *  own rendering does not produce is §A.8's class, and it goes wrong the day a
   *  record has both a discard and an edit (B1-4).
   *  Each actor's NAME is resolved through the roster — the plane holds only
   *  their id, so the room can never print a name the world does not agree with,
   *  and an actor the lens cannot resolve is not named at all. */
  history: Array<{ minute: number; kind: 'discard' | 'edit'; by: string; note: string | null }>
  /** True when this reader may not read the record's content. Carried so a COUNT
   *  is never computed from a redacted array — a permission-made 0 is a false
   *  number, and ⚖ §7a's 「omit, never 0」 applies to it (B2-3). */
  contentWithheld: boolean
  photos: FixtureKarutePhoto[]
  aiMessage: string | null
  /** 同意確認済 — `null` when the session was never recorded at all. */
  consentOnFile: boolean | null
  hasRecording: boolean
  outcome: { status: 'success' | 'no_deal' | 'pending' | 'revisit'; reason: string | null } | null
  ticketRedeemed: boolean
  /** ⚖ 破棄. The row's own facts (who, when) are the census and stay for
   *  everyone; the REASON is withheld from a reader who may not read it — and
   *  withheld HERE, before anything is serialized, never by the screen. */
  discarded: {
    at: number
    by: string
    reason: string | null
    /** ⚖ 8/20's stress-test build requirement (b): a discarded record that HAD a
     *  ticket burn must still tell a manager so, because money never
     *  auto-reverses and the correction is theirs to make. Derived BEFORE the R2
     *  null-out — R2 keeps the burn out of every NUMBER, it does not erase the
     *  fact that one happened. `false` for a reader who may not read content. */
    hadTicketBurn: boolean
  } | null
  /** 来店回数 as of this session, counted from the world's completed bookings —
   *  the phone's `visit_count`, derived rather than stored (the same reason
   *  `listVisits` rebuilds visits from bookings). */
  visitNumber: number
  /** The session BEFORE this one, or `null` for a first visit. */
  previousDayKey: number | null
}

export interface BuildRecordsInput {
  records: FixtureKaruteRecord[]
  /** ⚠ THE CLAMP. Only bookings the lens returned — a record whose booking is
   *  not in this list is not this store's record and never becomes a row. */
  appointments: FixtureAppointment[]
  customers: FixtureCustomer[]
  menus: FixtureMenu[]
  staff: FixtureStaff[]
  /** jstDayKey of today, for the 今週 window. */
  todayKey: number
  /** JST weekday of today (0=Sun), for canon's Monday-start week. */
  todayWeekday: number
  access: KaruteAccess
}

/** Canon's own week (MOCK-karute-list.html `mondayOf`): Monday-start, derived
 *  from the day being looked at rather than decided by a constant. Exported so
 *  the suite can pin the boundary at every weekday including Sunday, which is
 *  the one the naive `1 - getDay()` gets wrong by six days. */
export function weekWindow(todayKey: number, weekday: number): { from: number; to: number } {
  const from = todayKey + (weekday === 0 ? -6 : 1 - weekday)
  return { from, to: from + 6 }
}

/**
 * Every record the lens can see, newest first.
 *
 * ⚠ THE JOIN IS THE GATE. A record resolves only through a booking the
 * store-clamped door returned, so another store's records are not filtered out
 * of the output — they never enter it, and nothing about them (a name, a
 * summary, a カルテ番号) exists anywhere in what this function returns. That is
 * what makes the leaves-nothing-behind pin provable on the serialized props
 * rather than on the pixels.
 *
 * ⚠ AND THE DISCARD REDACTION HAPPENS HERE, for the same reason: a reader
 * without `discardContent` is not handed the content and told not to look at
 * it. The row keeps its census facts — the date, the person it was bound to at
 * record time (⚖ R3: facts, not choice), the staff member, the service and the
 * 破棄済み pill — and carries nothing else.
 */
export function buildRecords(input: BuildRecordsInput): KaruteRecordModel[] {
  const { records, appointments, customers, menus, staff, todayKey, todayWeekday, access } = input
  const bookingById = new Map(appointments.map((a) => [a.id, a]))
  const customerById = new Map(customers.map((c) => [c.id, c]))
  const menuById = new Map(menus.map((m) => [m.id, m]))
  const staffById = new Map(staff.map((s) => [s.id, s]))
  const week = weekWindow(todayKey, todayWeekday)
  /** A roster id → the name the world states for it. An id the LENS cannot
   *  resolve is not named: an actor from a store this reader cannot see must not
   *  arrive through a history row (⚖ the 8/17 isolation law), and 「—」 is the
   *  honest answer rather than a guessed name. */
  const nameOf = (id: string) => staffById.get(id)?.full_name ?? '—'

  // 来店回数 — completed bookings per customer, oldest first, so a session's
  // visit number is its own position in that list. Built from the SAME clamped
  // booking set, so a 銀座 record never counts a 代官山 visit.
  const doneByCustomer = new Map<string, string[]>()
  for (const a of [...appointments].filter((x) => x.status === 'done').sort((x, y) => x.starts_at.localeCompare(y.starts_at))) {
    const list = doneByCustomer.get(a.customer_id) ?? []
    list.push(a.id)
    doneByCustomer.set(a.customer_id, list)
  }

  const models: KaruteRecordModel[] = []
  for (const record of records) {
    const booking = bookingById.get(record.appointment_id)
    if (!booking) continue
    const customer = customerById.get(booking.customer_id)
    if (!customer) continue
    const member = staffById.get(booking.staff_id ?? '')
    const menu = menuById.get(booking.menu_id ?? '')

    const state = stateOf(record)
    const readable = record.discarded === null || access.discardContent

    // The world's own day index (`jstDayKey`), never a second spelling of it:
    // the window walk, the 今週 window and the 今月 census all compare days on
    // this one axis, and a private copy of the arithmetic is how two of them
    // end up disagreeing across a JST midnight.
    const dayKey = jstDayKey(booking.starts_at)
    const visits = doneByCustomer.get(booking.customer_id) ?? []
    const index = visits.indexOf(booking.id)
    const previous = index > 0 ? bookingById.get(visits[index - 1]) : undefined

    const summaryText = record.summary_edited ?? record.summary_ai

    models.push({
      id: record.id,
      storeId: booking.store_id,
      customerId: customer.id,
      customerName: customer.name,
      furigana: customer.furigana,
      memberNumber: customer.member_number,
      mark: customer.mark,
      staffId: booking.staff_id,
      staffName: member?.full_name ?? '担当なし',
      service: menu?.name ?? 'メニュー未記録',
      bookingNo: booking.display_no,
      startsAt: booking.starts_at,
      dayKey,
      thisWeek: dayKey >= week.from && dayKey <= week.to,
      state,
      preview: readable ? summaryText : null,
      entries: readable
        ? CATEGORY_ORDER.flatMap((category) =>
            record.entries
              .filter((e: FixtureKaruteEntry) => e.category === category)
              .map((e) => ({ category, label: CATEGORY_LABEL[category], text: e.text, handwritten: e.author === 'staff' })),
          )
        : [],
      // The phone's own split (`karuteSummaryToBullets`): one line per item, and
      // an empty line is not an item.
      summaryBullets: readable && summaryText ? summaryText.split('\n').map((l) => l.trim()).filter(Boolean) : [],
      summaryEdited: readable && record.summary_edited !== null,
      history: [
        ...(record.discarded
          ? [{
              minute: record.discarded.minute,
              kind: 'discard' as const,
              by: nameOf(record.discarded.by_staff_id),
              reason: access.discardContent ? record.discarded.reason : null,
            }].map((d) => ({ minute: d.minute, kind: d.kind, by: d.by, note: d.reason }))
          : []),
        ...(readable
          ? record.summary_edits.map((e) => ({ minute: e.minute, kind: 'edit' as const, by: nameOf(e.by_staff_id), note: e.note }))
          : []),
      ].sort((a, b) => b.minute - a.minute),
      contentWithheld: !readable,
      photos: readable ? record.photos : [],
      aiMessage: readable ? record.ai_message : null,
      consentOnFile: record.recording ? record.recording.consent : null,
      hasRecording: record.recording !== null,
      // ⚖ R2 — A DISCARDED ROW FEEDS NOTHING. Its outcome and its ticket burn
      // are withheld from EVERY reader, manager included: they are not privacy,
      // they are inputs to the shop's numbers, and a thrown-away record must not
      // be one. Structural, so no future consumer has to remember the rule.
      outcome: record.discarded ? null : record.outcome,
      ticketRedeemed: record.discarded ? false : record.ticket_redeemed,
      discarded: record.discarded
        ? {
            at: record.discarded.minute,
            by: nameOf(record.discarded.by_staff_id),
            reason: access.discardContent ? record.discarded.reason : null,
            // Read off the PLANE, not off the R2-nulled model field above.
            hadTicketBurn: access.discardContent && record.ticket_redeemed,
          }
        : null,
      visitNumber: index >= 0 ? index + 1 : 1,
      previousDayKey: previous ? jstDayKey(previous.starts_at) : null,
    })
  }

  return models.sort((a, b) => (b.dayKey - a.dayKey) || a.id.localeCompare(b.id))
}

// ── the tour card's room-local placement correction ─────────────────────────

interface Box { left: number; top: number; width: number; height: number }

/**
 * ⚠ ROOM-LOCAL CORRECTION to the SHARED engine's documented LAST RESORT.
 *
 * `spotCardAt` (`@/business/lib/guide`) places the tour card below the target,
 * else above it, else BESIDE it — and when a region has no free side at all its
 * last resort is `Math.max(10, target.left - card.width - 12)`, which puts the
 * card on top of the thing it is explaining. That is unreachable for most rooms
 * and unavoidable for this one: a full-page records table and an eight-drawer
 * session card are both FULL-WIDTH and TALLER THAN THE VIEWPORT, so neither has
 * a free side. Measured on the shipped tip: at 390 the card sat 223×226px over
 * 「カルテの一覧」 including its own heading; at 1280 it clipped the section
 * title to 「ルテの一覧」.
 *
 * The engine is ONE SHARED HOME for every Business page and is FROZEN for this
 * room, so the correction lives here — the register room's D-M2 precedent
 * (room-local now, engine fix queued). It is deliberately the SMALLEST one that
 * fixes the actual failure: the card keeps the x the engine chose, and only its
 * TOP moves, to whichever viewport edge is farther from the target's heading
 * zone. Keeping x matters — pushing the card sideways at 1280 would turn a 23px
 * sliver into a 300px overlap.
 *
 * A card that does not sit over the heading is returned untouched, so every
 * ordinary step still gets exactly the engine's answer.
 */
export function keepCardOffHeading(
  at: { top: number; left: number },
  card: { width: number; height: number },
  target: Box,
  viewport: { width: number; height: number },
  /** A section's heading lives in its first rows; 64px covers the room's own
   *  `.kr-sec-title` line plus its margin at every band. */
  headingZone = 64,
): { top: number; left: number } {
  const zoneTop = target.top
  const zoneBottom = target.top + Math.min(headingZone, target.height)
  const overlapsX = at.left < target.left + target.width && at.left + card.width > target.left
  const overlapsHeading = at.top < zoneBottom && at.top + card.height > zoneTop
  if (!overlapsX || !overlapsHeading) return at
  const zoneMid = (zoneTop + zoneBottom) / 2
  const room = { top: zoneMid, bottom: viewport.height - zoneMid }
  const top = room.bottom >= room.top ? viewport.height - card.height - 10 : 10
  return { top: Math.max(10, top), left: at.left }
}

// ── 記録のないお客様 — the quiet reveal, never a standing section ─────────────

export interface RevealCandidate {
  customerId: string
  name: string
  furigana: string | null
  memberNumber: string
  mark: string
}

/**
 * ⚖ A PAGE FOR RECORDS SHOWS RECORDS (packet §7a). The proposal mock kept a
 * standing 「カルテ未作成のお客様」 section under the list; this room does not.
 * Prospects live on the 顧客 surface, and a records page that lists people with
 * no records is answering a question nobody asked it.
 *
 * What survives is the case the section was really for: somebody searches a
 * name, gets nothing, and needs to know whether the person exists at all. That
 * is ONE quiet line, shown only WHILE SEARCHING.
 *
 * ⚠ STORE-LENS-SCOPED, and the scope is the world's own: a customer belongs to
 * the stores they have BOOKINGS in (`customerStoreAffiliation`'s rule), so the
 * candidates are drawn from the clamped booking set and a store can never learn
 * that another store's customer exists (⚖ the 8/17 isolation law). A customer
 * with no booking anywhere belongs to no store and is revealed only under the
 * storeless lens — hide, never show-and-refuse.
 */
export function revealCandidates(input: {
  appointments: FixtureAppointment[]
  customers: FixtureCustomer[]
  records: KaruteRecordModel[]
  /** `true` when the lens is a single store; the affiliation gate applies only
   *  then, because the storeless lens has no store to be outside of. */
  clamped: boolean
}): RevealCandidate[] {
  const withRecords = new Set(input.records.map((r) => r.customerId))
  const affiliated = new Set(input.appointments.map((a) => a.customer_id))
  return input.customers
    .filter((c) => !withRecords.has(c.id))
    .filter((c) => !input.clamped || affiliated.has(c.id))
    .map((c) => ({ customerId: c.id, name: c.name, furigana: c.furigana, memberNumber: c.member_number, mark: c.mark }))
}

/** The reveal's own search, on the three fields a person is looked up by. Same
 *  normaliser as the record search — one spelling of "does this match", so the
 *  reveal cannot fire on a query the list would not have. */
export function matchesReveal(candidate: RevealCandidate, query: string): boolean {
  const q = normalizeForSearch(query)
  if (q === '') return false
  return [candidate.name, candidate.furigana ?? '', candidate.memberNumber]
    .map(normalizeForSearch)
    .some((field) => field.includes(q))
}

// ── the head's own numbers ──────────────────────────────────────────────────

export interface MonthCensus {
  /** Records whose session falls in the CURRENT JST calendar month. */
  total: number
  /** …of which are 破棄済み. ⚖ Liam 8/25 ruling B: the count is visible, and it
   *  is a plain fact — never a warning, no threshold, no grade. Named
   *  separately rather than folded into the total, because ⚖ R2 says a
   *  discarded record feeds no statistic: a reader has to be able to take it
   *  back out of the number without doing arithmetic. */
  discarded: number
}

/** ⚖ 今月 IS A CALENDAR QUESTION, NOT A 30-DAY WINDOW, and the calendar is
 *  JST's. `year`/`month` are the render's own JST year and 1-based month
 *  (`jstYmd`), passed in rather than read, so this function owns no clock and
 *  the `TZ=UTC` jest run proves the boundary rather than the server's locale. */
export function monthCensus(rows: KaruteRecordModel[], year: number, month: number): MonthCensus {
  const inMonth = rows.filter((r) => {
    // `jstDayKey` counts whole JST days, so `dayKey * DAY` READ IN UTC is that
    // JST day at 00:00 — the getUTC* reads below are therefore JST calendar
    // values by construction, and the server's own timezone cannot shift a
    // record into the neighbouring month (`jstYmd` uses the same trick).
    const d = new Date(r.dayKey * 86_400_000)
    return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month
  })
  return { total: inMonth.length, discarded: inMonth.filter((r) => r.discarded !== null).length }
}
