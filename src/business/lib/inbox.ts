// 受信トレイ — the room's derivations, in one pure module.
//
// WHY THIS IS NOT IN THE PAGE: every fact this room shows is a fact some OTHER
// desk already holds — the booking's deadline is 予約一覧's, the delivery
// verdict is 今日の運営's 次に決めること card's, the 連絡同意 is the 顧客台帳's,
// the booking line is the appointment's. A room that restated any of them would
// be a second home for a verdict that already has one (A8), so the borrowing
// has to be callable on its own to be checkable. It lives here; the page
// composes; the screen renders strings.
//
// Everything is DERIVED wherever a derivation exists (⚖ 8/9, product truth):
//   · a thread's STATUS is its 次に決めること card's state, or — with no card —
//     whether the 予約一覧 row's own deadline has passed the pinned board clock
//   · a thread's 期限 is `deadlineOf(lifecycleOf(...))`, the 予約一覧's own
//     function, so a deadline cannot say two things in two rooms
//   · a thread's STORE is its booking's store; a thread with no booking takes
//     its customer's affiliation (today-board's `customerStoreAffiliation`)
//   · 連絡同意 is the customer ledger's, in the 顧客 screen's own words
//   · the 履歴 is the booking's own 操作履歴 merged with the message plane's
//     events — the plane carries only what the audit trail does not
//
// Times are JST minutes from midnight throughout (see fixtures-today.ts).

import type { FixtureAppointment, FixtureConsent, FixtureCustomer, FixtureMenu } from './fixtures'
import type { FixtureDecision } from './fixtures-today'
import type { FixtureReservation } from './fixtures-reservations'
import type { FixtureThread, ThreadCategory } from './fixtures-inbox'

/** Re-exported so the screen imports ONE module for the room's vocabulary — the
 *  client boundary never reaches into the fixture plane, which is what keeps
 *  the data seal a structural fact rather than a convention. */
export type { ThreadCategory }
import { deadlineOf, lifecycleOf } from './reservations'
import { customerStoreAffiliation, hhmm, yen } from './today-board'

export type ThreadStatus = 'new' | 'attention' | 'waiting' | 'resolved'

/** ONE label per status — canon spells its 空き待ち row 未提案 and every other
 *  open row 要対応, which is two words for one state. 期限超過 is not a fifth
 *  status: it is 要対応 whose deadline has passed, and it is derived from the
 *  clock exactly as 予約一覧 derives its own flag. */
export const STATUS_LABEL: Record<ThreadStatus, string> = {
  new: '未対応',
  attention: '要対応',
  waiting: '返信待ち',
  resolved: '解決済み',
}

export const CATEGORY_LABEL: Record<ThreadCategory, string> = {
  change: '予約変更',
  noshow: '来店なし',
  waitlist: '空き待ち',
  delivery: '配信失敗',
}

/** The queue's filter chips, canon's own set and order
 *  (fable-store-inbox.html:449-454). 未完了 and 解決済み are status filters; the
 *  four between them are the categories. */
export type ThreadFilter = 'open' | ThreadCategory | 'resolved'
export const FILTERS: Array<{ key: ThreadFilter; label: string }> = [
  { key: 'open', label: '未完了' },
  { key: 'change', label: CATEGORY_LABEL.change },
  { key: 'noshow', label: CATEGORY_LABEL.noshow },
  { key: 'waitlist', label: CATEGORY_LABEL.waitlist },
  { key: 'delivery', label: CATEGORY_LABEL.delivery },
  { key: 'resolved', label: '解決済み' },
]

// ── 連絡同意 ────────────────────────────────────────────────────────────────

export type ChannelKey = 'LINE' | 'SMS' | 'メール'
export const CHANNELS: ChannelKey[] = ['LINE', 'SMS', 'メール']

/** Three states, never two. 「まだ記録していない」 and 「本人が断った」 are
 *  different facts about a business's obligations, and a room that collapses
 *  them into 「不可」 tells the operator a customer refused when nobody ever
 *  asked. The 顧客 screen already draws that distinction (「—」 vs 「同意なし」)
 *  and this room says the same words about the same person. */
export type ConsentVerdict = 'allowed' | 'refused' | 'unrecorded'

export interface ChannelState {
  key: ChannelKey
  verdict: ConsentVerdict
  /** The 顧客 screen's own wording, CustomersScreen.tsx:562-579. Pinned equal to
   *  its `consentLabel` on every customer in the ledger, so the two rooms cannot
   *  describe one person's consent two ways. */
  label: string
  /** Where a message would actually go, or null when consent exists but the
   *  destination does not resolve (LINE 同意あり / 連携未確認 is the live case)
   *  and when there is no consent to resolve one for. */
  destination: string | null
}

/** Usable = the customer said yes AND there is somewhere to send it. Consent
 *  without a resolvable destination is not a channel, it is a task. */
export const isUsable = (c: ChannelState) => c.verdict === 'allowed' && c.destination !== null

export function channelStates(
  customer: Pick<FixtureCustomer, 'consent' | 'line_linked' | 'phone' | 'email'>,
): ChannelState[] {
  const c: FixtureConsent | null = customer.consent
  return [
    {
      key: 'LINE',
      verdict: c == null ? 'unrecorded' : c.line ? 'allowed' : 'refused',
      label:
        c == null ? '—' : c.line ? (customer.line_linked ? '同意あり / 連携確認済み' : '同意あり / 連携未確認') : '同意なし',
      destination: c?.line && customer.line_linked ? 'LINE連携済み' : null,
    },
    {
      key: 'SMS',
      verdict: c == null ? 'unrecorded' : c.sms ? 'allowed' : 'refused',
      label: c == null ? '—' : c.sms ? (customer.phone ?? '同意あり') : '同意なし',
      destination: c?.sms ? customer.phone : null,
    },
    {
      key: 'メール',
      verdict: c == null ? 'unrecorded' : c.email ? 'allowed' : 'refused',
      label: c == null ? '—' : c.email ? (customer.email ?? '同意あり') : '同意なし',
      destination: c?.email ? customer.email : null,
    },
  ]
}

/** The channel a reply would go out on, and — when there is none — WHY, in the
 *  words that name the next real step. Four outcomes, each a different job:
 *  send it · confirm the LINE link · ask for consent · nobody has ever asked. */
export function recommendedChannel(states: ChannelState[]): { channel: ChannelKey | null; reason: string } {
  const usable = states.find(isUsable)
  if (usable) return { channel: usable.key, reason: `${usable.key}（${usable.destination}）へ送信できます` }
  if (states.some((s) => s.verdict === 'allowed')) {
    const blocked = states.filter((s) => s.verdict === 'allowed').map((s) => s.key).join('・')
    return { channel: null, reason: `${blocked}の同意はありますが、送信先が確認できていません` }
  }
  if (states.every((s) => s.verdict === 'unrecorded')) {
    return { channel: null, reason: '連絡同意が未記録のため、送信先を選べません' }
  }
  return { channel: null, reason: '同意のある連絡方法がありません' }
}

// ── the thread model ────────────────────────────────────────────────────────

export interface ThreadHistoryRow {
  time: string
  what: string
  detail: string
}

export interface ThreadModel {
  id: string
  category: ThreadCategory
  categoryLabel: string
  mark: string
  markTone: FixtureThread['mark_tone']
  status: ThreadStatus
  statusLabel: string
  /** 期限超過 — derived from the pinned board clock, never stored; also false
   *  on a resolved thread whatever the raw deadline says (the display gate at
   *  its derivation site, buildThreads' `displayOverdue`). */
  overdue: boolean
  customerId: string
  customerName: string
  /** 顧客番号, so a duplicate pair (見本 あかり appears twice in this ledger) is
   *  never two rows the reader cannot tell apart. */
  memberNumber: string
  subject: string
  preview: string
  receivedLabel: string
  receivedMinute: number
  dueLabel: string
  dueMinute: number | null
  source: string
  /** 証跡 — the decision's own proof rows, or the 予約一覧 row's own sentence, or
   *  (only when neither exists) the message plane's. */
  proofTitle: string
  proofLines: string[]
  /** 予約・候補 — the booking's own line, or what a thread with no booking has. */
  bookingLabel: string
  bookingNo: string | null
  deliveryState: FixtureThread['delivery_state']
  deliveryLabel: string
  next: string
  reply: string
  channels: ChannelState[]
  recommended: ChannelKey | null
  recommendedReason: string
  history: ThreadHistoryRow[]
  storeId: string | null
}

export interface ThreadInput {
  threads: FixtureThread[]
  customers: FixtureCustomer[]
  /** Store-clamped, exactly as `listAppointments(lens)` returns them. */
  appointments: FixtureAppointment[]
  menus: FixtureMenu[]
  reservations: FixtureReservation[]
  decisions: FixtureDecision[]
  auditTrail: Record<string, Array<[string, string, string]>>
  /** The pinned moment the whole world is showing (`boardNow`). */
  nowMinute: number
  closeMinute: number
  /** Formats a booking's day the way every other room formats it. Passed in so
   *  this module holds no Intl and no clock. */
  dayLabel: (iso: string) => string
  minuteOf: (iso: string) => number
}

export const DELIVERY_WORD: Record<NonNullable<FixtureThread['delivery_state']>, string> = {
  sent: '送信済み',
  undelivered: '配信失敗',
  unsent: '未送信',
}

/** A thread is visible to a lens when the work is THIS store's. A thread about
 *  a booking belongs to the booking's store — that is where the person who can
 *  act on it works, and clamping by the customer instead would post a 銀座
 *  booking's message task to 代官山's queue. Only a thread with NO booking falls
 *  back to the customer's own affiliation. Both readings are the same one map,
 *  and the clamped appointment list is what makes them isolation (⚖ 8/17: hide,
 *  never show-and-refuse — a hidden thread leaves no trace at all). */
export function threadStore(
  thread: Pick<FixtureThread, 'appointment_id' | 'customer_id'>,
  byId: Map<string, FixtureAppointment>,
  affiliation: Map<string, string>,
): string | null {
  if (thread.appointment_id) return byId.get(thread.appointment_id)?.store_id ?? null
  return affiliation.get(thread.customer_id) ?? null
}

export function buildThreads(input: ThreadInput): ThreadModel[] {
  const byId = new Map(input.appointments.map((a) => [a.id, a]))
  const affiliation = customerStoreAffiliation(input.appointments)
  const customerById = new Map(input.customers.map((c) => [c.id, c]))
  const menuById = new Map(input.menus.map((m) => [m.id, m]))
  const reservationBy = new Map(input.reservations.map((r) => [r.appointment_id, r]))
  const decisionBy = new Map(
    input.decisions.filter((d) => d.appointment_id).map((d) => [d.appointment_id!, d]),
  )

  const models: ThreadModel[] = []
  for (const t of input.threads) {
    const storeId = threadStore(t, byId, affiliation)
    // The clamp. A thread whose booking this lens cannot read, and a thread
    // whose customer has never booked here, are both simply absent.
    if (storeId === null) continue
    const customer = customerById.get(t.customer_id)
    if (!customer) continue

    const booking = t.appointment_id ? (byId.get(t.appointment_id) ?? null) : null
    const record = t.appointment_id ? (reservationBy.get(t.appointment_id) ?? null) : null
    const decision = t.appointment_id ? (decisionBy.get(t.appointment_id) ?? null) : null

    // ── 期限 — the 予約一覧's own function, on the 予約一覧's own row ──────
    const dueMinute = booking
      ? deadlineOf(lifecycleOf(booking, record), record, input.closeMinute)
      : t.due
    const overdue = dueMinute !== null && dueMinute < input.nowMinute

    // ── status — the board's own verdict where the board has one ─────────
    // With no card, the only thing that can make a received message URGENT is
    // its own deadline having passed. A deadline that is still ahead is not a
    // problem, it is a schedule — so a future one leaves the thread 未対応 and
    // canon's own 空き待ち row keeps the status canon gives it.
    const status: ThreadStatus = decision
      ? decision.state === 'resolved'
        ? 'resolved'
        : decision.state === 'waiting'
          ? 'waiting'
          : 'attention'
      : overdue
        ? 'attention'
        : 'new'

    // A resolved thread's deadline is history, not a live overrun — painting
    // 超過 on a closed case would tell the operator to hurry on work that is
    // already done. `overdue` above still drives the no-card status branch
    // (a resolved thread only ever gets there via a decision, never this),
    // so only the DISPLAY value is gated.
    const displayOverdue = overdue && status !== 'resolved'

    // ── 配信状態 — the decision's `notification`, or the plane's own ──────
    const deliveryState = decision ? decision.notification : t.delivery_state
    // A decision-backed thread carries NO delivery detail of its own (the
    // plane law, fixtures-inbox.ts:14-17) — the card's proofs are 証跡's, where
    // the SAME array already renders two rows below. Restating them here was a
    // second home for the same rows (A8) that could disagree with itself.
    const deliveryDetail = decision ? null : t.delivery_detail
    const deliveryLabel = deliveryState
      ? deliveryDetail
        ? `${DELIVERY_WORD[deliveryState]} / ${deliveryDetail}`
        : DELIVERY_WORD[deliveryState]
      : '記録なし'

    // ── 証跡 ──────────────────────────────────────────────────────────────
    const proofTitle = decision ? decision.proof_title : '記録された根拠'
    const proofLines = decision
      ? decision.proofs
      : record
        ? [record.proof]
        : t.source_proof
          ? [t.source_proof]
          : []

    // ── 予約・候補 — the booking's own row, never a restated one ───────────
    const menu = booking?.menu_id ? menuById.get(booking.menu_id) : undefined
    const bookingLabel = booking
      ? `${input.dayLabel(booking.starts_at)} ${hhmm(input.minuteOf(booking.starts_at))} ${menu ? menu.name : 'メニュー未設定'} / ${booking.booked_price === null ? '価格未記録' : `受付価格 ${yen(booking.booked_price)}`}`
      : '候補の枠はまだ確保していません'

    const channels = channelStates(customer)
    const { channel, reason } = recommendedChannel(channels)

    const history: ThreadHistoryRow[] = [
      ...t.events,
      ...(t.appointment_id ? (input.auditTrail[t.appointment_id] ?? []) : []),
    ]
      .map(([time, what, detail]) => ({ time, what, detail }))
      .sort((a, b) => b.time.localeCompare(a.time))

    models.push({
      id: t.id,
      category: t.category,
      categoryLabel: CATEGORY_LABEL[t.category],
      mark: t.mark,
      markTone: t.mark_tone,
      status,
      statusLabel: overdue && status === 'attention' ? '期限超過' : STATUS_LABEL[status],
      overdue: displayOverdue,
      customerId: customer.id,
      customerName: customer.name,
      memberNumber: customer.member_number,
      subject: t.subject,
      preview: t.preview,
      receivedLabel: hhmm(t.received),
      receivedMinute: t.received,
      dueLabel:
        dueMinute === null
          ? '期限なし'
          : displayOverdue
            ? `${hhmm(dueMinute)}まで（超過）`
            : `${hhmm(dueMinute)}まで`,
      dueMinute,
      source: t.source,
      proofTitle,
      proofLines,
      bookingLabel,
      bookingNo: booking ? booking.display_no : null,
      deliveryState,
      deliveryLabel,
      next: t.next,
      reply: t.reply,
      channels,
      recommended: channel,
      recommendedReason: reason,
      history,
      storeId,
    })
  }

  // 期限順 — the queue is ordered by what runs out first, and a thread with no
  // deadline sits behind every thread that has one. Resolved rows fall to the
  // bottom whatever their deadline was: they are history, not work.
  return models.sort((a, b) => {
    const rank = (m: ThreadModel) => (m.status === 'resolved' ? 2 : 0)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    const due = (m: ThreadModel) => (m.dueMinute === null ? Number.MAX_SAFE_INTEGER : m.dueMinute)
    if (due(a) !== due(b)) return due(a) - due(b)
    return a.receivedMinute - b.receivedMinute
  })
}

/** Narrowed to the two fields the rule actually needs (the reservations
 *  sibling's own pattern, `matchesFilters` in ./reservations) so the client
 *  screen's own thinner thread props satisfy it too — one function, one home,
 *  callable from both the tests and the render it was tested against. */
export function matchesFilter(t: Pick<ThreadModel, 'status' | 'category'>, filter: ThreadFilter): boolean {
  if (filter === 'open') return t.status !== 'resolved'
  if (filter === 'resolved') return t.status === 'resolved'
  return t.category === filter
}

export interface InboxSummary {
  open: number
  attention: number
  waiting: number
  resolved: number
  failures: number
}

/** The five figures the strip prints. 配信失敗 counts threads whose 配信状態 —
 *  the decision card's own `notification` where one exists, this plane's own
 *  `delivery_state` where none does — reads undelivered, rather than canon's
 *  「delivery カテゴリー かつ 要対応」, which double-counts the category chip and
 *  goes to zero the moment such a thread is answered while its message is still
 *  undelivered. One reading, one home. */
export function summarize(threads: ThreadModel[]): InboxSummary {
  return {
    open: threads.filter((t) => t.status !== 'resolved').length,
    attention: threads.filter((t) => t.status === 'attention').length,
    waiting: threads.filter((t) => t.status === 'waiting').length,
    resolved: threads.filter((t) => t.status === 'resolved').length,
    failures: threads.filter((t) => t.deliveryState === 'undelivered').length,
  }
}
