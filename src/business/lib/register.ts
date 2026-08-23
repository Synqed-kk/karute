// 売上・レジ — the room's derivations, in one pure module.
//
// MONEY IS DATA, NEVER CODE. Not one yen figure below is written down: every
// total, every variance and every verdict is computed from the rows the fixture
// plane and the booking world already hold, and every one of them reaches the
// screen through ONE formatter. A number a component invents is a number no
// test can catch being wrong.
//
// TOTALS DERIVE FROM ROWS (A8: one home). The strip's five money tiles are sums
// over the ledger the panel below prints, so a total that disagrees with its own
// rows is impossible by construction rather than by vigilance — and each row's
// own tenders must account for its total, which is the invariant `rowBalances`
// pins and canon's own refund guard enforces at the point of writing
// (fable-store-sales-register.html:1593).
//
// WHAT THIS ROOM BORROWS RATHER THAN RESTATES:
//   · 受付価格 — the booking's `booked_price`, the price agreed when the booking
//     was taken. Sales and refunds are settled on it and never re-priced.
//   · the terminal's held transactions — `fixtures-today`'s `register.terminal_held`,
//     the same rows 今日の運営 counts, so the two screens cannot disagree about
//     how many the terminal is sitting on.
//   · 返金 — the same reversals `register.refunds` aggregates.
//   · the money formatter and the clock formatter — the board's own `yen`/`hhmm`.
//   · a transaction's store — its BOOKING's store, the `threadStore` shape
//     受信トレイ already uses.
//
// Times are JST minutes from midnight throughout.

import type { FixtureAppointment, FixtureCustomer, FixtureMenu } from './fixtures'
import type { FixtureClosing, FixtureTender, FixtureTransaction } from './fixtures-register'
import { hhmm, yen } from './today-board'

// THE MONEY FORMATTER IS THE FAMILY'S, AND THERE IS ONLY ONE. This room used to
// wrap `yen` in a `signedYen` of its own for the one case a money desk has that
// no other room did — a NEGATIVE line — which left the family with two spellings
// of a minus and seven call sites still on the unsigned one, each of them a
// 「¥-1,100」 waiting for the first negative to reach it. The sign rule moved into
// `today-board`'s `yen` itself, in canon's own shape (:1163-1166), and the
// wrapper is gone: one formatter, one minus, every figure in the family.

// ── capabilities ────────────────────────────────────────────────────────────

/** ⚠ REGISTRY ⑥ — レジ権限. Canon gates SIXTEEN controls on `close` and three on
 *  `refund` (`data-capability`, fable-store-sales-register.html:731-871) and
 *  resolves them through a role table its own comment calls "a mock preview
 *  projection only… production authorization must come from Core"
 *  (:928-938). There IS no capability in the real grants model — `admission.ts`
 *  returns a user, a business and nothing else — so this room reads the
 *  operator's role from the fixture plane and names the real dial in the build
 *  report's registry instead of guessing a contract.
 *
 *  THREE ROWS, NOT CANON'S FIVE. Canon projects owner / manager / senior /
 *  practitioner / frontdesk; the family's own role vocabulary is オーナー /
 *  店舗管理者 / スタッフ (`fixtures-today`'s `overridePolicy.roles`). Inventing
 *  two role words so that two more table rows could exist would ship a dial
 *  nobody can select — canon's 主任 (refund without close) is named in the
 *  registry instead, where the real grants model will answer it.
 *
 *  FAIL-CLOSED. A role this table does not know gets NOTHING: `accessFor`
 *  returns the least privilege rather than a default that admits. */
export interface SalesAccess {
  /** 返金・取消 may be executed. */
  refund: boolean
  /** 端末照合・現金計数・未収・閉店 may be executed. */
  close: boolean
  /** 総売上・純売上・受領済み are hidden from this role (canon's own
   *  `redactSummary`, :936-937). */
  redactSummary: boolean
}

export const SALES_ACCESS_BY_ROLE: Record<string, SalesAccess> = {
  オーナー: { refund: true, close: true, redactSummary: false },
  店舗管理者: { refund: true, close: true, redactSummary: false },
  スタッフ: { refund: false, close: false, redactSummary: true },
}

export const NO_ACCESS: SalesAccess = { refund: false, close: false, redactSummary: true }

export function accessFor(role: string): SalesAccess {
  return SALES_ACCESS_BY_ROLE[role] ?? NO_ACCESS
}

/** canon `renderPermissionNotice` (:984-1001) — what the page says out loud when
 *  the operator's role cannot do everything on it. `null` = nothing to say. One
 *  sentence per real case, never a generic 「権限がありません」 that leaves the
 *  reader guessing which half is missing. */
export function permissionNotice(access: SalesAccess): string | null {
  if (access.redactSummary) {
    return 'この役割では総売上・純売上・受領済みを表示せず、返金と閉店操作も実行できません。'
  }
  if (!access.close) {
    return 'この役割では返金・取消を実行できます。端末照合、現金計数、未収、閉店操作は店舗管理者権限が必要です。'
  }
  return null
}

/** The figure a redacted role sees in place of a money tile. One string, one
 *  home — a second spelling would let two tiles disagree about what redaction
 *  looks like. */
export const REDACTED = '権限がありません'

// ── the transaction model ───────────────────────────────────────────────────

/** SIX states, and every one of them is a different job for the shop:
 *  精算済み nothing left to do · 一部入金 money is owed · 端末保持 the money was
 *  taken but the record is stuck inside the terminal · 返金済み the sale was
 *  reversed in full · 取消済み the sale was VOIDED rather than refunded · 一部返金
 *  some of the money went back and some of it stayed. 端末保持 is NOT 未収: the
 *  customer has paid.
 *
 *  ⚖ MONEY THAT MOVED BACK IS NEVER 精算済み. A row with a reversal on it AND
 *  money still received is the shape the first cut of this room called `paid` —
 *  the drawer is short by the reversal, the day's close has to re-count, and the
 *  ledger said 精算済み over it. 一部返金 is its own state, with its own pill and
 *  its own place under 要確認, because canon's attention semantics are exactly
 *  that: money moved back, so look at it.
 *
 *  返金 vs 取消 is canon's own distinction (`refundKind`, :832 / :1602-1603) —
 *  「決済済み金額を返金」 against 「未締め売上を取消」 — and it survives here rather
 *  than being flattened, because a shop reconciles the two differently. */
export type TransactionState = 'paid' | 'partial' | 'held' | 'refunded' | 'voided' | 'partial-refund'

export const STATE_LABEL: Record<TransactionState, string> = {
  paid: '精算済み',
  partial: '一部入金',
  held: '端末保持',
  refunded: '返金済み',
  voided: '取消済み',
  'partial-refund': '一部返金',
}

/** The pill each state wears. SEMANTIC (⚖ the one-way accent law): amber says
 *  somebody owes money, red says the money left again, indigo says the money
 *  went back in PART — a different job from a reversal that finished the sale —
 *  and green says finished. */
export const STATE_PILL: Record<TransactionState, string> = {
  paid: 'pill good',
  partial: 'pill warn',
  held: 'pill alert',
  refunded: 'pill alert',
  voided: 'pill alert',
  'partial-refund': 'pill indigo',
}

/** canon writes the reversal LINE from the dialog's kind (:1597-1599) —
 *  「現金 返金」 for a 返金, 「現金 取消」 for a 取消 — so the kind is carried on the
 *  line the register wrote, in exactly the place `tenderChannel` already reads
 *  the channel from. Nothing else in the plane knows it, and inventing a second
 *  field for it would be a second home for one fact. */
const VOID_MARK = '取消'

export type RegisterFilter = 'all' | 'paid' | 'partial' | 'attention'

export const FILTERS: Array<{ key: RegisterFilter; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'paid', label: STATE_LABEL.paid },
  { key: 'partial', label: STATE_LABEL.partial },
  { key: 'attention', label: '要確認' },
]

export interface TenderRow {
  label: string
  amount: number
  flag: FixtureTender['flag']
  /** canon `tenderEvidenceChannel` (:1069-1079) — 現金 / カード / 回数券 / 未収 /
   *  その他. 回数券消化 is its OWN channel because a redemption brings no cash
   *  in, and folding it into カード made canon's manager attestation lie
   *  (W1-E fix, ⚖ Liam 8/8 — the comment is canon's own). */
  channel: 'cash' | 'card' | 'ticket' | 'unpaid' | 'other'
}

export interface TransactionModel {
  id: string
  storeId: string
  state: TransactionState
  stateLabel: string
  filter: RegisterFilter
  /** 顧客名, or the 店頭販売 sentence when the register recorded nobody. */
  who: string
  memberNumber: string | null
  /** What was sold — the MENU's name for a booking, the item for a 店頭販売. */
  what: string
  /** 予約番号, and `null` on a sale with no booking. */
  bookingNo: string | null
  appointmentId: string | null
  at: number
  atLabel: string
  /** 受付価格 for a booking, the sale price for a 店頭販売. */
  total: number
  /** Money actually in, net of its own reversals. Never includes 未収. Goes
   *  BELOW ZERO on an over-refund — more was given back than ever came in — and
   *  the room prints that fact rather than clamping it away (⚖ A11). */
  received: number
  /** Still owed. */
  outstanding: number
  /** Reversed, as a positive magnitude. */
  reversed: number
  tenders: TenderRow[]
  /** The 予約時価格 snapshot sentence's two figures, and `null` for a sale with
   *  no booking to have been priced at. */
  acceptedPrice: number | null
  publishedPrice: number | null
  /** 受付元・確定 — the booking's own 予約経路. */
  source: string | null
  history: Array<{ time: string; what: string; detail: string }>
}

/** A transaction belongs to the store its BOOKING belongs to — that is where the
 *  person who can act on it works, and it is stated once, in the booking. Only a
 *  店頭販売 with no booking carries its own store, because the register it was
 *  taken at is the only thing that knows. The appointment map handed in is
 *  already store-CLAMPED (`listAppointments(lens)`), so a booking this lens
 *  cannot read yields `null` and the row is simply absent — ⚖ 8/17: hide, never
 *  show-and-refuse. Same shape as 受信トレイ's `threadStore`. */
export function transactionStore(
  tx: FixtureTransaction,
  byId: Map<string, FixtureAppointment>,
): string | null {
  // `null` here means EXACTLY ONE THING — the booking this sale settles is not
  // in the readable world — because the walk-in arm cannot produce it: the plane
  // types a 店頭販売 as carrying a store, so a storeless walk-in never reaches
  // this function to be silently dropped.
  if (tx.appointment_id !== null) return byId.get(tx.appointment_id)?.store_id ?? null
  return tx.store_id
}

/** ⚖ 8/17 STORE ISOLATION, second seam. `readDayPlanes(...).register.terminal_held`
 *  is a TODAY-ONLY snapshot with no store field on it, so the door cannot clamp
 *  it and the reader has to: each held row names a BOOKING, and the booking is
 *  what says which store's terminal is holding it. Under a lens that cannot read
 *  that booking the row is absent — otherwise 代官山's terminal band would claim
 *  to be holding 銀座's ¥6,600, which is both a leak and a lie about a device in
 *  a different building.
 *
 *  ⚠ OUT OF FENCE, REPORTED, NOT TOUCHED: 今日の運営 reads the same list
 *  unclamped (`business/today/page.tsx:379`) and prints 「端末保持 1件」 on every
 *  store's board. Named in the build report; the fix is the today room's. */
export function heldForLens<T extends { appointment_id: string }>(
  held: T[],
  byId: Map<string, FixtureAppointment>,
  lensStoreId: string | null,
): T[] {
  if (lensStoreId === null) return held
  return held.filter((h) => byId.get(h.appointment_id)?.store_id === lensStoreId)
}

/** canon `tenderEvidenceChannel` (:1069-1079), on the label the register wrote. */
export function tenderChannel(label: string, flag: FixtureTender['flag']): TenderRow['channel'] {
  if (flag === 'unpaid') return 'unpaid'
  if (label.startsWith('現金')) return 'cash'
  if (label.startsWith('カード')) return 'card'
  if (label.startsWith('回数券')) return 'ticket'
  return 'other'
}

/** ⚖ EVERY ROW'S TENDERS MUST ACCOUNT FOR ITS TOTAL. received + 未収 + 返金 =
 *  総額, per transaction. Canon enforces the same identity at the moment of
 *  writing a refund — 「元の決済手段と受領額が一致しないため、返金を実行できません」
 *  (:1593-1596) — and this room enforces it on every row it renders, which is
 *  what makes the strip's totals structurally unable to disagree with the ledger
 *  under them.
 *
 *  AND THE REVERSAL SIDE, which the sum alone cannot see: a channel may only
 *  give back what that channel took in. 現金 ¥1,100 in and 現金 ¥3,000 back out
 *  balances the addition perfectly and is still an impossible drawer, so the
 *  per-channel guard canon applies before it writes (:1591-1593, its
 *  `originalTenders` are the positive lines of the SAME payment) is applied here
 *  before the room renders. An over-refund is an INVALID row, never a display
 *  case (⚖ 8/9, demo data = product truth). */
export function rowBalances(
  m: Pick<TransactionModel, 'total' | 'received' | 'outstanding' | 'reversed' | 'tenders'>,
): boolean {
  if (m.received + m.outstanding + m.reversed !== m.total) return false
  const inBy = new Map<TenderRow['channel'], number>()
  const outBy = new Map<TenderRow['channel'], number>()
  for (const t of m.tenders) {
    if (t.flag === 'unpaid') continue
    if (t.flag === 'refund') outBy.set(t.channel, (outBy.get(t.channel) ?? 0) - t.amount)
    else if (t.amount > 0) inBy.set(t.channel, (inBy.get(t.channel) ?? 0) + t.amount)
  }
  for (const [channel, out] of outBy) if (out > (inBy.get(channel) ?? 0)) return false
  return true
}

/** ⚠ canon's refusal, word for word (:1594). The guard that stops a refund from
 *  being written is the same guard that decides whether this room may show a
 *  preview of one, so the sentence has ONE home. */
export const REFUND_MISMATCH = '元の決済手段と受領額が一致しないため、返金を実行できません'

export interface RefundPreview {
  /** Per-tender NET remaining — what a refund would actually reverse, positive
   *  magnitudes, in the order the register wrote the lines. */
  lines: Array<{ label: string; amount: number }>
  /** canon's own refusal (:1593-1596), or `null` when the guard would pass. */
  refusal: string | null
}

/** canon `applyRefund`'s guard and its reversal builder (:1591-1599), read as a
 *  PREVIEW rather than as a write. The original lines are the positive,
 *  non-reversal ones; each is NETTED against what its own channel has already
 *  had taken back, because a second refund may only reverse what is still there.
 *  Then canon's identity is checked on the netted figures — the original tenders
 *  must account for 受領額 — and a row that fails it shows canon's refusal
 *  instead of a list of lines the guard would never let through. A preview that
 *  promised 「現金 −¥3,300」 on a part-paid sale would be advertising a refund the
 *  product refuses. */
export function refundPreview(m: Pick<TransactionModel, 'tenders' | 'received'>): RefundPreview {
  const originals = m.tenders.filter((t) => t.amount > 0 && t.flag !== 'refund')
  const backBy = new Map<TenderRow['channel'], number>()
  for (const t of m.tenders) {
    if (t.flag !== 'refund') continue
    backBy.set(t.channel, (backBy.get(t.channel) ?? 0) - t.amount)
  }
  const lines: Array<{ label: string; amount: number }> = []
  let net = 0
  for (const t of originals) {
    const alreadyBack = backBy.get(t.channel) ?? 0
    const taken = Math.min(t.amount, alreadyBack)
    backBy.set(t.channel, alreadyBack - taken)
    const remaining = t.amount - taken
    net += remaining
    if (remaining > 0) lines.push({ label: t.label, amount: remaining })
  }
  if (originals.length === 0 || net !== m.received) return { lines: [], refusal: REFUND_MISMATCH }
  return { lines, refusal: null }
}

export interface LedgerInput {
  transactions: FixtureTransaction[]
  /** ⚖ 8/17 STORE ISOLATION, AND IT IS EXPLICIT HERE RATHER THAN INHERITED.
   *  受信トレイ gets its clamp for free because every fact it resolves comes
   *  through a store-clamped read; a 店頭販売 has no booking to resolve, so its
   *  store arrives as a RAW field on the money plane and nothing has filtered
   *  it. Caught live on the first render: 代官山's ledger showed 銀座's two
   *  walk-in sales. The resolved lens is therefore a required parameter and the
   *  clamp is one line below — which also catches a booking-backed row whose
   *  booking ever leaked past `listAppointments`. `null` = the storeless
   *  `{viewAll:true}` lens, the only case that reads every store. */
  lensStoreId: string | null
  /** Store-clamped, exactly as `listAppointments(lens)` returns them. */
  appointments: FixtureAppointment[]
  customers: FixtureCustomer[]
  menus: FixtureMenu[]
  /** `readDayPlanes(lens, today).register.terminal_held` — the world's own
   *  record of what the terminal is holding. The pending tender on a held sale
   *  is BUILT from this, never restated in the money plane. */
  terminalHeld: Array<{ appointment_id: string; amount: number; terminal: string; idempotency_id: string; at: number }>
  /** 操作履歴 per booking — `readReservationPlanes(lens).auditTrail`. */
  auditTrail: Record<string, Array<[string, string, string]>>
}

export function buildLedger(input: LedgerInput): TransactionModel[] {
  const byId = new Map(input.appointments.map((a) => [a.id, a]))
  const customerById = new Map(input.customers.map((c) => [c.id, c]))
  const menuById = new Map(input.menus.map((m) => [m.id, m]))
  const heldBy = new Map(input.terminalHeld.map((h) => [h.appointment_id, h]))

  const models: TransactionModel[] = []
  for (const tx of input.transactions) {
    const storeId = transactionStore(tx, byId)
    // A transaction this lens cannot read is simply ABSENT — hide, never
    // show-and-refuse (⚖ 8/17), and it leaves nothing behind: no row, no count,
    // no yen in any total on the page.
    if (storeId === null) continue
    if (input.lensStoreId !== null && storeId !== input.lensStoreId) continue

    const booking = tx.appointment_id ? (byId.get(tx.appointment_id) ?? null) : null
    // A booking-backed row whose booking has vanished from the readable world is
    // NOT rendered from the plane's own scraps: the plane deliberately holds no
    // total, no customer and no store for it, so there would be nothing honest
    // left to print.
    if (tx.appointment_id && !booking) continue

    // ── the pending tender, derived from the world's own terminal record ────
    const held = tx.appointment_id ? (heldBy.get(tx.appointment_id) ?? null) : null
    const rawTenders: FixtureTender[] = held
      ? [...tx.tenders, { label: held.terminal, amount: held.amount, flag: 'pending' as const }]
      : tx.tenders

    const tenders: TenderRow[] = rawTenders.map((t) => ({
      label: t.label,
      amount: t.amount,
      flag: t.flag,
      channel: tenderChannel(t.label, t.flag),
    }))

    const outstanding = tenders.filter((t) => t.flag === 'unpaid').reduce((n, t) => n + t.amount, 0)
    const reversed = tenders.filter((t) => t.flag === 'refund').reduce((n, t) => n - t.amount, 0)
    const received = tenders
      .filter((t) => t.flag === '' || t.flag === 'pending' || t.flag === 'refund')
      .reduce((n, t) => n + t.amount, 0)

    const total = booking ? (booking.booked_price ?? 0) : (tx.amount ?? 0)
    const menu = booking?.menu_id ? menuById.get(booking.menu_id) : undefined
    const customer = tx.customer_id
      ? customerById.get(tx.customer_id)
      : booking
        ? customerById.get(booking.customer_id)
        : undefined

    // ⚖ A REVERSAL IS THE HEADLINE. It is read FIRST, before 端末保持, because
    // money that went back out is the fact a money desk has to act on and the
    // terminal's own hold is stated globally by the closing check. A row that is
    // both keeps both: its state says 一部返金 and its 閉店への影響 still names the
    // terminal, which it reads off the row's own pending line rather than off
    // this word.
    const state: TransactionState =
      reversed > 0
        ? received > 0
          ? 'partial-refund'
          : tenders.some((t) => t.flag === 'refund' && t.label.includes(VOID_MARK))
            ? 'voided'
            : 'refunded'
        : held
          ? 'held'
          : outstanding > 0
            ? 'partial'
            : 'paid'

    models.push({
      id: tx.id,
      storeId,
      state,
      stateLabel: STATE_LABEL[state],
      filter: state === 'paid' ? 'paid' : state === 'partial' ? 'partial' : 'attention',
      who: customer ? customer.name : '店頭販売（予約なし）',
      memberNumber: customer ? customer.member_number : null,
      what: booking ? (menu ? menu.name : 'メニュー未設定') : (tx.item ?? '店頭販売'),
      bookingNo: booking ? booking.display_no : null,
      appointmentId: tx.appointment_id,
      at: tx.at,
      atLabel: hhmm(tx.at),
      total,
      received,
      outstanding,
      reversed,
      tenders,
      // The snapshot canon puts at the top of its inspector: what the booking was
      // taken at, beside what the same menu is published at now. A sale with no
      // booking was never priced in advance, so it has no snapshot to show and
      // says so rather than printing its own price twice.
      acceptedPrice: booking ? (booking.booked_price ?? null) : null,
      publishedPrice: booking ? (menu?.price ?? null) : null,
      source: booking ? booking.source : null,
      history: [
        ...tx.audit,
        ...(tx.appointment_id ? (input.auditTrail[tx.appointment_id] ?? []) : []),
      ]
        .map(([time, what, detail]) => ({ time, what, detail }))
        .sort((a, b) => b.time.localeCompare(a.time)),
    })
  }

  // 時刻順, newest first — a money desk reads its day backwards from the last
  // thing that happened, and canon's own ledger is in register order.
  return models.sort((a, b) => b.at - a.at)
}

// ── the strip ───────────────────────────────────────────────────────────────

export interface RegisterTotals {
  /** 総売上 — every transaction's total. */
  gross: number
  /** 返金・取消 — every reversal, as a positive magnitude. */
  refunds: number
  /** 純売上 — 総売上 − 返金. */
  net: number
  /** 受領済み — money in, net of reversals, 未収 excluded. */
  collected: number
  /** 未収 — still owed. */
  outstanding: number
  /** 現金の期待額 — every 現金-family tender, reversals included (a cash refund
   *  takes money back OUT of the drawer). canon `totals().cash` (:1187-1189). */
  cash: number
}

export function ledgerTotals(models: TransactionModel[]): RegisterTotals {
  const gross = models.reduce((n, m) => n + m.total, 0)
  const refunds = models.reduce((n, m) => n + m.reversed, 0)
  return {
    gross,
    refunds,
    net: gross - refunds,
    collected: models.reduce((n, m) => n + m.received, 0),
    outstanding: models.reduce((n, m) => n + m.outstanding, 0),
    cash: models.reduce(
      (n, m) => n + m.tenders.filter((t) => t.channel === 'cash').reduce((c, t) => c + t.amount, 0),
      0,
    ),
  }
}

export function matchesFilter(m: Pick<TransactionModel, 'filter'>, filter: RegisterFilter): boolean {
  return filter === 'all' || m.filter === filter
}

export interface RegisterCounts {
  all: number
  paid: number
  partial: number
  attention: number
}

/** The four figures the counter strip prints, counted through the SAME predicate
 *  the filter row presses — so a number can never name a slice and then open a
 *  different one (the template's own law). */
export function countBy(models: TransactionModel[]): RegisterCounts {
  return {
    all: models.length,
    paid: models.filter((m) => matchesFilter(m, 'paid')).length,
    partial: models.filter((m) => matchesFilter(m, 'partial')).length,
    attention: models.filter((m) => matchesFilter(m, 'attention')).length,
  }
}

/** ⚖ THE COUNTERS ARE THE FILTER ROW. The pairing is stated here and nowhere
 *  else, which is what makes the 1:1 structural rather than a coincidence the
 *  suite has to watch. */
export const COUNTER_FILTER: Record<keyof RegisterCounts, RegisterFilter> = {
  all: 'all',
  paid: 'paid',
  partial: 'partial',
  attention: 'attention',
}

/** The three small counters beside the main cell, in the strip's own order.
 *  `alarm` marks the figure that changes what the shop does next; the red is
 *  applied only above zero, because a counter that is red at 0 warns about
 *  nothing. */
export const COUNTER_STATS: Array<{ key: keyof RegisterCounts; label: string; alarm: boolean }> = [
  { key: 'paid', label: STATE_LABEL.paid, alarm: false },
  { key: 'partial', label: STATE_LABEL.partial, alarm: true },
  { key: 'attention', label: '要確認', alarm: true },
]

// ── 現金と閉店 ──────────────────────────────────────────────────────────────

/** canon `cashVariance` (:1348-1350): what was counted minus what the tenders
 *  say should be there. DERIVED, never stored — the money plane records a count
 *  and the ledger produces an expectation, and the difference is what they make
 *  between them. */
export const cashVariance = (counted: number, expected: number): number => counted - expected

/** canon `varianceRequiresApproval` (:1352-1354). The threshold is the named
 *  dial (`fixtures-register`'s `cashTolerance`), never a constant in here. */
export function varianceRequiresApproval(saved: boolean, variance: number, tolerance: number): boolean {
  return saved && Math.abs(variance) > tolerance
}

/** ⚖ THE DIAL SHIPS WITH ITS GUARDRAIL (the mistake-proofing law). The threshold
 *  a store may set is clamped at the READ, in one place, so no settings control
 *  — and no fixture world, and no future writer — can raise the amount a drawer
 *  may be out by WITHOUT a reason to a figure that would hide a whole
 *  transaction. A dial without its ceiling is a dial that lets a manager harm
 *  their own shop, which is the exact shape the law forbids. */
export function resolveTolerance(raw: number, ceiling: number): number {
  return Math.min(raw, ceiling)
}

/** canon `cashClosingReady` (:1356-1358): saved, AND either inside the tolerance
 *  or approved by a 店舗管理者. Both arms are carried — the approval is a FACT
 *  the world records (`FixtureClosing.variance_approved`), even though the
 *  control that writes it is a separate role context this slice does not build.
 *  Dropping the arm would have made an approved difference permanently unable to
 *  close a day. */
export function cashClosingReady(saved: boolean, requiresApproval: boolean, approved: boolean): boolean {
  return saved && (!requiresApproval || approved)
}

export interface ClosingCheckRow {
  key: 'terminal' | 'cash' | 'outstanding' | 'unsettled' | 'signoff'
  label: string
  detail: string
  done: boolean
  status: string
}

export interface ClosingVerdict {
  checks: ClosingCheckRow[]
  /** How many of the five are still open. */
  openCount: number
  /** canon `prerequisitesReady` (:1360-1362) — the four the shop itself can
   *  finish. */
  prerequisitesReady: boolean
  /** 店舗管理者の確認 has been received (canon's `managerSigned`). */
  managerSigned: boolean
  /** Everything a close needs before anyone may sign it off. */
  closeReady: boolean
  /** canon `cashClosingReady` (:1356-1358). */
  cashReady: boolean
  variance: number
  requiresApproval: boolean
  /** The reasons, in plain words, WHY the day cannot be closed yet. ONE home:
   *  the checklist rows, the closing button's refusal and the transaction
   *  inspector's 閉店への影響 all read this same list, so the page cannot say
   *  「あと1項目」 in one band and 「準備完了」 in another (⚖ A8). */
  blockers: string[]
}

export interface ClosingInput {
  totals: RegisterTotals
  closing: FixtureClosing
  tolerance: number
  heldCount: number
  heldAmount: number
  /** 完了した施術のうち、レジ取引が作られていないもの — canon hard-codes one
   *  customer's carry-over row (小松様, :814); the generalisation is what a
   *  second shop would actually need, and it makes the row DERIVED rather than
   *  a sentence that is true for one demo day. */
  unsettledVisits: Array<{ bookingNo: string; who: string; amount: number }>
}

/** ONE VERDICT, RENDERED N TIMES. Every 「閉店できるか」 question on the page —
 *  the five checklist rows, the 閉店を確定 refusal, the 閉店承認 status and a
 *  transaction's own 閉店への影響 line — reads this one call. */
export function closingReadiness(input: ClosingInput): ClosingVerdict {
  const { totals, closing, tolerance, heldCount, heldAmount, unsettledVisits } = input

  const terminalDone = heldCount === 0
  const variance = cashVariance(closing.cash_counted, totals.cash)
  const requiresApproval = varianceRequiresApproval(closing.cash_saved, variance, tolerance)
  // canon `cashClosingReady`: saved, and either inside the tolerance or
  // APPROVED. The approval itself is a WRITE this slice cannot make, so an
  // unapproved difference stays open and says why — but the arm is read from the
  // world, so a day whose difference HAS been signed for closes.
  const cashReady = cashClosingReady(closing.cash_saved, requiresApproval, closing.variance_approved)
  const outstandingDone = totals.outstanding === 0 || closing.outstanding_decision !== null
  const unsettledDone = unsettledVisits.length === 0
  const managerSigned = closing.manager_signed_at !== null

  const checks: ClosingCheckRow[] = [
    {
      key: 'terminal',
      label: '決済端末の送信',
      detail: terminalDone
        ? '送信済み / 二重請求0件'
        : `端末内に${heldCount}件保持 / 対象 ${yen(heldAmount)}`,
      done: terminalDone,
      status: terminalDone ? '完了' : '未完了',
    },
    {
      key: 'cash',
      label: '現金計数と差異理由',
      detail: `期待 ${yen(totals.cash)} / 実査 ${yen(closing.cash_counted)} / 差異 ${yen(variance)}`,
      done: cashReady,
      // canon `renderClosing`'s own `cashLabel` (:1374), approval arm included.
      status: !closing.cash_saved
        ? '未保存'
        : requiresApproval && !closing.variance_approved
          ? '差異承認待ち'
          : requiresApproval
            ? '差異承認済み'
            : '保存済み',
    },
    {
      key: 'outstanding',
      label: '未収の扱い',
      detail:
        totals.outstanding === 0
          ? '未収なし'
          : closing.outstanding_decision !== null
            ? `${yen(totals.outstanding)} / ${closing.outstanding_decision}`
            : `${yen(totals.outstanding)} の扱いが未判断`,
      done: outstandingDone,
      status: totals.outstanding === 0 ? '完了' : closing.outstanding_decision !== null ? '記録済み' : '未判断',
    },
    {
      key: 'unsettled',
      label: '未精算の施術',
      detail: unsettledDone
        ? '完了した施術はすべてレジに記録済み'
        : unsettledVisits
            .map((v) => `${v.bookingNo}・${v.who}・${yen(v.amount)}・レジ取引未作成`)
            .join(' / '),
      done: unsettledDone,
      status: unsettledDone ? '完了' : '未記録',
    },
    {
      key: 'signoff',
      label: '閉店承認',
      detail: managerSigned
        ? `店舗管理者の確認を${hhmm(closing.manager_signed_at!)}に受信`
        : '店舗管理者の確認待ち — 別の画面で記録が必要です',
      done: managerSigned,
      status: managerSigned ? '確認済み' : '未確認',
    },
  ]

  const prerequisitesReady = terminalDone && cashReady && outstandingDone && unsettledDone
  return {
    checks,
    openCount: checks.filter((c) => !c.done).length,
    prerequisitesReady,
    managerSigned,
    closeReady: prerequisitesReady && managerSigned,
    cashReady,
    variance,
    requiresApproval,
    blockers: checks.filter((c) => !c.done).map((c) => c.label),
  }
}

/** canon `buildTenderReconciliation` (:1106-1130) — the day's money grouped by
 *  the channel it arrived on, with the identity that has to hold before a close
 *  may be saved: what came in, plus what went back out, equals the net, and the
 *  net equals 受領済み. It is what the closing snapshot WOULD record, which is
 *  why this slice shows it as read-only evidence beside a refused button rather
 *  than hiding it behind one. */
export interface ReconciliationRow {
  channel: TenderRow['channel']
  label: string
  received: number
  reversed: number
  net: number
}

const CHANNEL_LABEL: Record<TenderRow['channel'], string> = {
  cash: '現金',
  card: 'カード',
  ticket: '回数券',
  unpaid: '未収',
  other: 'その他',
}

export function tenderReconciliation(models: TransactionModel[]): {
  rows: ReconciliationRow[]
  received: number
  reversed: number
  /** SIDE A — the tender records, summed by the channel each line arrived on. */
  net: number
  /** SIDE B — the ROW TOTALS, and it is computed a different way ON PURPOSE. */
  fromRows: number
  balanced: boolean
} {
  const grouped = new Map<TenderRow['channel'], ReconciliationRow>()
  for (const m of models) {
    for (const t of m.tenders) {
      // 未収 is not a tender: nothing arrived on it, so counting it here would
      // put money the shop has not got into the reconciliation.
      if (t.flag === 'unpaid') continue
      const row = grouped.get(t.channel) ?? {
        channel: t.channel,
        label: CHANNEL_LABEL[t.channel],
        received: 0,
        reversed: 0,
        net: 0,
      }
      if (t.amount >= 0) row.received += t.amount
      else row.reversed += t.amount
      row.net += t.amount
      grouped.set(t.channel, row)
    }
  }
  const rows = [...grouped.values()]
  const received = rows.reduce((n, r) => n + r.received, 0)
  const reversed = rows.reduce((n, r) => n + r.reversed, 0)
  const net = rows.reduce((n, r) => n + r.net, 0)
  // ⚖ TWO SIDES, DERIVED INDEPENDENTLY, OR THE SENTENCE IS DECORATION. The first
  // cut compared the grouped tenders against 受領済み — which is the SAME sum of
  // the SAME lines by a different route, so 「一致しません」 could never print and
  // the page carried a reassurance that could not fail. Side B reads each row's
  // OWN 総額 instead: 総額 − 未収 − 返金 is what the row SAYS it received, and it
  // comes from the booking's 受付価格 rather than from the tender lines. The two
  // agree exactly when every row balances — so a row whose lines do not account
  // for its total is what makes the sentence say so.
  const fromRows = models.reduce((n, m) => n + (m.total - m.outstanding - m.reversed), 0)
  return { rows, received, reversed, net, fromRows, balanced: net === fromRows }
}
