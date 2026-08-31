// 売上・レジ — the room's PROP ASSEMBLY, beside the page rather than inside it.
//
// WHY THIS FILE EXISTS (the room-3 F1 law, inherited from day one): the evidence
// harness imports THIS function, so an isolated shot is the same assembly the
// deployed page runs and a drift between them is a compile error rather than a
// picture nobody can check. `page.tsx` keeps the admission gate, the route
// params and the sheet import — the things a route entry owns.
//
// EVERY YEN FIGURE CROSSES THE CLIENT BOUNDARY AS A FORMATTED STRING. The screen
// holds no arithmetic, no clock and no data access at all: it cannot round
// differently from the server, and it cannot be handed a number and asked to
// decide what it means.

import { jstDayKey } from '@/business/lib/clock'
import {
  defaultStoreId,
  listAppointments,
  listCustomers,
  listMenus,
  listStoreOptions,
  readDayPlanes,
  readReservationPlanes,
  renderNow,
  type StoreLens,
} from '@/business/lib/data'
import { operator } from '@/business/lib/fixtures'
import {
  cashTolerance,
  closing as closingPlane,
  MAX_CASH_TOLERANCE,
  transactions as transactionPlane,
  type FixtureClosing,
  type FixtureTransaction,
} from '@/business/lib/fixtures-register'
import {
  accessFor,
  buildLedger,
  cashReasonLine,
  closingReadiness,
  countBy,
  DENOMINATION_LABEL,
  denominationTotal,
  FILTERS,
  heldForLens,
  ledgerTotals,
  permissionNotice,
  REDACTED,
  refundPreview,
  resolveTolerance,
  STATE_PILL,
  tenderReconciliation,
  type TransactionModel,
} from '@/business/lib/register'
import { hhmm, yen } from '@/business/lib/today-board'
import { type RegisterProps, type RegisterRowProps } from './RegisterScreen'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })

/** ⚠ THE REFUSALS, IN ONE PLACE. Every write this room can see is refused, and
 *  each one says WHY in its own words — a single generic sentence on four
 *  different buttons tells the reader nothing about which of them would have
 *  done what. They ride the controls' accessible names as well as their titles,
 *  because a screen reader drops `title` once `aria-describedby` is present
 *  (the room-3 F4 lesson). */
const REFUSAL = {
  refund: '見本データのため返金・取消は実行できません。返金は元の決済手段へ戻す実際の入出金のため、実データとレジ権限をつないだあとに有効になります。',
  outstanding: '見本データのため未収の扱いを記録できません。記録は実行者と理由を残す操作のため、実データの接続後に有効になります。',
  terminal: '見本データのため決済端末へ再接続できません。端末照合は実機との通信のため、決済端末をつないだあとに有効になります。',
  cash: '見本データのため現金計数を保存できません。計数の保存は実行者と差異理由を記録する操作のため、実データの接続後に有効になります。',
  reason: '見本データのため差異理由を保存できません。差異理由は実行者と一緒に計数記録へ残す操作のため、実データの接続後に有効になります。',
  close: '見本データのため閉店を確定できません。閉店はその時点の台帳を締める操作のため、実データの接続後に有効になります。',
  signoff: '店舗管理者の確認は別の画面で記録します。この画面は準備中のため、まだ開けません。',
  booking: 'この取引には予約がないため、予約一覧では確認できません。',
  // ⑲ A レジ THAT CANNOT RING A SALE IS A LEDGER. The button belongs where the
  // ledger is; the screen it opens — choosing the item, the quantity, the
  // payment — is registry ⑪ and is not built here.
  sell: '見本データのため店頭販売を記録できません。売上の記録は在庫と決済に触れる操作のため、商品の登録と実データをつないだあとに有効になります。',
  // ⑥ しきい値 の変更先. The 設定 room SHIPPED (room 9, 2026-09-01) and shows this
  // exact value on its 決済 section, so the sentence names the section rather
  // than calling the room 準備中 — a signpost that outlives its destination's
  // opening is a check lying about state. The WRITE is still refused, which is
  // what this sentence is for (registry ④).
  tolerance: '現金差異の承認しきい値は店舗設定で変更します。いまの値は「設定」＞決済で確認できます。見本データのため、この画面からは変更できません。',
} as const

const FOOTNOTE = '見本データのため実行・記録はできません — 実データ接続後に有効になります。'

export interface RegisterPropsInput {
  locale: string
  /** The raw `?store=` value. Unknown or missing opens on the operator's own
   *  store, never the business-wide merge — `defaultStoreId` owns that rule. */
  store?: string
  /** FIXTURE-SHAPED WORLD OVERRIDES, and the page never passes them. The
   *  evidence harness and the room's own suites need worlds this demo plane does
   *  not contain — a 120-transaction day, a day with no takings at all, a drawer
   *  out over the threshold, a role that may not see the money — and the only
   *  honest way to picture any of them is to run the REAL derivations on a
   *  different world, never a class toggle or a hand-written replica. Every
   *  field is exactly the shape the fixture modules export. */
  world?: {
    transactions?: FixtureTransaction[]
    closing?: FixtureClosing
    terminalHeld?: Array<{
      appointment_id: string
      amount: number
      terminal: string
      idempotency_id: string
      at: number
    }>
    /** The operator's role, so the capability gate can be seen from BOTH sides.
     *  The demo operator is a 店舗管理者 and passes it; a pin that only ever
     *  sees the passing case is not a pin. */
    role?: string
    tolerance?: number
  }
}

export interface RegisterPropsResult {
  props: RegisterProps
  /** The RESOLVED lens, so the clamp keeps exactly one home and `page.tsx` can
   *  key the screen by it — which is what resets the filter and the open
   *  transaction when the shop changes which store it is looking at. */
  storeKey: string
}

export async function registerProps({ locale, store, world }: RegisterPropsInput): Promise<RegisterPropsResult> {
  const storeOptions = await listStoreOptions()
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  // ONE CLOCK READ PER RENDER (the cycle-1 law): the day, the ledger's own day
  // filter and the closing checks all derive from this one instant, so a render
  // crossing JST midnight cannot put two different days on one screen.
  const now = renderNow()
  const todayKey = jstDayKey(now)

  const [customers, appointments, menus, dayPlanes, reservationPlanes] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens),
    listMenus(lens),
    readDayPlanes(lens, todayKey),
    readReservationPlanes(lens),
  ])

  // ⚖ 8/17 — the held list carries no store of its own, so it is clamped through
  // the bookings it names before anything on this page reads it.
  const appointmentById = new Map(appointments.map((a) => [a.id, a]))
  const terminalHeld = heldForLens(
    world?.terminalHeld ?? dayPlanes.register.terminal_held,
    appointmentById,
    clamped ? storeId! : null,
  )
  // ⚖ A CLOSE BELONGS TO ONE STORE (see the plane's own note). Under the
  // storeless `{viewAll:true}` lens there is no drawer to count and no day to
  // close, so the room says so instead of merging two stores' closes into a
  // figure no shop could act on.
  const closing = world?.closing ?? (clamped ? (closingPlane[storeId!] ?? null) : null)
  // ⚖ THE DIAL SHIPS WITH ITS GUARDRAIL, AND THE CLAMP IS AT THE READ — one
  // place, so the ceiling holds for the settings control, for this room's own
  // worlds, and for whatever writes the dial after reconnect.
  const tolerance = resolveTolerance(world?.tolerance ?? cashTolerance, MAX_CASH_TOLERANCE)
  const access = accessFor(world?.role ?? operator.role)
  /** ⚖ REDACTION IS STRUCTURAL — ONE GATE, ONE PLACE. Every figure this role may
   *  not see goes through here, so a new money surface cannot quietly ship
   *  un-gated the way the 決済手段の内訳 did: the strip hid 受領済み and the band
   *  underneath printed the same money again, channel by channel, with the
   *  sentence naming the total in words. */
  const redactMoney = (value: string) => (access.redactSummary ? REDACTED : value)

  const models = buildLedger({
    transactions: world?.transactions ?? transactionPlane,
    lensStoreId: clamped ? storeId! : null,
    appointments,
    customers,
    menus,
    terminalHeld,
    auditTrail: reservationPlanes.auditTrail,
  })

  const totals = ledgerTotals(models)
  const counts = countBy(models)

  // 完了した施術のうち、レジ取引が作られていないもの. Canon hard-codes one
  // customer's carry-over row; this is the same fact, derived — so it appears
  // when the day HAS one and honestly reads 「すべて記録済み」 when it does not.
  const settled = new Set(models.map((m) => m.appointmentId).filter(Boolean))
  // ⚖ THE ROW'S SUBJECT, AND THE ROW'S CONTENT, FROM ONE LIST. 未精算の施術 asks
  // two questions of the same day — did this store finish any visits at all
  // (does the row exist?) and are any of them missing from the ledger (is it
  // done?) — so both are read off one filter rather than two that could drift.
  const completedToday = appointments
    .filter(
      (a) =>
        jstDayKey(a.starts_at) === todayKey &&
        a.status === 'done',
    )
  const unsettledVisits = completedToday
    .filter((a) => !settled.has(a.id))
    .map((a) => ({
      bookingNo: a.display_no,
      who: customers.find((c) => c.id === a.customer_id)?.name ?? '—',
      amount: a.booked_price ?? 0,
    }))

  // ⑨ THE GATES' LANDING POINTS. Which transaction the terminal is holding and
  // which one carries the balance are LEDGER facts, resolved here off the rows
  // the page is about to print — so a jump can never aim at a transaction this
  // lens cannot see.
  const heldIds = new Set(terminalHeld.map((h) => h.appointment_id))
  // ⚖ F-M2 — THE HELD ROW CARRIES ITS OWN VERDICT, and it can be absent. The two
  // planes are independent: a held record whose booking never reached the
  // register has no ledger row here, and the gate must then have nowhere to send
  // anyone rather than a filter with no target in it.
  const terminalRow = models.find((m) => m.appointmentId !== null && heldIds.has(m.appointmentId)) ?? null
  // ⚖ F-S2 — AND THE ROW'S OWN VERDICT TRAVELS WITH IT. The gate narrows the
  // ledger through `matchesFilter`, so the filter it presses has to be the one
  // the target row is classed under; reading the model's `filter` here is the
  // same single read the row's pill and the counter strip make.
  const outstandingRow = models.find((m) => m.outstanding > 0) ?? null
  // ⚖ AND WHETHER THE ROW EXISTS AT ALL. A store with no card terminal never
  // holds a card record and never takes a card payment, so the day's own tenders
  // are what say the device is in the building — no business-type branch, and
  // nothing to configure.
  const hasCardTender = models.some((m) => m.tenders.some((t) => t.channel === 'card'))

  const verdict = closing
    ? closingReadiness({
        totals,
        closing,
        tolerance,
        heldCount: terminalHeld.length,
        heldAmount: terminalHeld.reduce((n, h) => n + h.amount, 0),
        unsettledVisits,
        terminalTx: terminalRow && { id: terminalRow.id, filter: terminalRow.filter },
        outstandingTx: outstandingRow && { id: outstandingRow.id, filter: outstandingRow.filter },
        hasCardTender,
        completedVisits: completedToday.length,
      })
    : null

  const reconciliation = tenderReconciliation(models)
  // ⚖ ONE HOME for 差異理由 as a SENTENCE. The drawer's printed row and the
  // read-only reason box are the same string with R-23's redaction gate applied
  // once — F-S7 gave the box a second reader, not a second reading.
  const cashReason = closing && verdict ? cashReasonLine(access, closing, verdict.variance) : ''

  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'
  const storeQuery = clamped ? `?store=${encodeURIComponent(storeId!)}` : ''

  // ── the terminal band ─────────────────────────────────────────────────────
  // A RECORDED FACT WITH ITS CONSEQUENCE STATED (⚖ A10/A11). The band never says
  // 「端末は使えません」 over a ledger that shows a card payment going through:
  // it names the moment the terminal started holding records, so an earlier card
  // line and this band are reading the same day. 二重請求 is DERIVED from the
  // idempotency ids the world already carries, never asserted as a bare zero.
  const heldSince = terminalHeld.length > 0 ? Math.min(...terminalHeld.map((h) => h.at)) : null
  const heldTerminals = [...new Set(terminalHeld.map((h) => h.terminal))]
  const duplicates = terminalHeld.length - new Set(terminalHeld.map((h) => h.idempotency_id)).size

  const rows: RegisterRowProps[] = models.map((m) => {
    const preview = refundPreview(m)
    return {
    id: m.id,
    state: m.state,
    stateLabel: m.stateLabel,
    filter: m.filter,
    pill: STATE_PILL[m.state],
    who: m.who,
    // ⚖ THE HEADLINE IS WHOEVER — OR WHATEVER — THE ROW IS ABOUT. A counter sale
    // to somebody the shop never recorded has no person, so what was sold takes
    // the top line and the row renders a line shorter (see `nameless`).
    title: m.nameless ? m.what : m.who,
    nameless: m.nameless,
    memberNumber: m.memberNumber,
    what: m.what,
    bookingNo: m.bookingNo,
    atLabel: m.atLabel,
    totalLabel: yen(m.total),
    receivedLabel: yen(m.received),
    // ONE sub-amount slot under the row's total, and it says which KIND of
    // money it is: still owed, or given back. A row that printed ¥1,100 with no
    // second line would read as a sale of ¥1,100 that the shop kept.
    subAmount:
      m.outstanding > 0
        ? { label: '未収', value: yen(m.outstanding), tone: 'warn' as const }
        : m.reversed > 0
          ? { label: '返金', value: yen(-m.reversed), tone: 'bad' as const }
          : null,
    tenderSummary: tenderSummary(m),
    // ── the inspector ──────────────────────────────────────────────────────
    facts: [
      { label: '予約', value: m.bookingNo ? `${m.bookingNo} / ${m.what}` : '予約なし・店頭販売' },
      { label: '受付元・確定', value: m.source ?? 'レジ（店頭販売）' },
      { label: '売上', value: yen(m.total) },
      {
        label: '受領 / 未収',
        value: `${yen(m.received)} / ${yen(m.outstanding)}`,
        tone: m.outstanding > 0 ? ('warn' as const) : undefined,
      },
      ...(m.reversed > 0
        ? [{ label: '返金・取消', value: yen(-m.reversed), tone: 'bad' as const }]
        : []),
      // ⚖ A11 — NEVER SILENT. More money went back than ever came in. The row
      // still balances by addition, which is exactly why it needs saying out
      // loud: the drawer is short by the difference and nothing else on the page
      // would tell the reader why.
      ...(m.received < 0
        ? [{
            label: '過返金',
            value: `${yen(-m.received)} 超過 — 受領額を超える返金が記録されています`,
            tone: 'bad' as const,
          }]
        : []),
    ],
    priceProof:
      m.acceptedPrice === null
        ? '予約のない店頭販売のため、予約時価格のスナップショットはありません。レジで確定した金額がこの取引の正本です。'
        : `確定 ${yen(m.acceptedPrice)} / 現在の公開価格 ${m.publishedPrice === null ? '未設定' : yen(m.publishedPrice)}。売上・返金は確定 ${yen(m.acceptedPrice)} を正本とし、現在価格で再計算しません。`,
    tenders: m.tenders.map((t) => ({
      label: t.label + (t.flag === 'pending' ? ' / 送信待ち' : t.flag === 'unpaid' ? ' / 次回来店時' : ''),
      amount: yen(t.amount),
      tone: t.flag === 'refund' ? ('refund' as const) : t.flag === 'unpaid' ? ('unpaid' as const) : undefined,
    })),
    // 返金・取消の内容 — canon opens a dialog for this; the dialog is not carried
    // (no <dialog> in this family's rooms), so what it WOULD reverse is shown as
    // read-only evidence beside the refused control. Refusing to act is honest;
    // hiding what the action would have done is not — and neither is promising a
    // reversal canon's own guard would refuse, which is why a row that fails the
    // guard prints the REFUSAL here instead of a list of lines.
    refundPreview:
      preview.refusal !== null
        ? `${preview.refusal}。`
        : preview.lines.length > 0
          ? preview.lines.map((l) => `${l.label} ${yen(-l.amount)}`).join(' / ')
          : null,
    refundNote:
      preview.refusal !== null
        ? '元の決済手段ごとの受領額と、この取引の受領済み合計が一致していません。金額の不一致を解消するまで返金は実行できません。'
        : preview.lines.length > 0
          ? '元の決済行は書き換えず、反対仕訳と理由、承認者を新しい監査行として追加します。'
          : m.reversed > 0
            ? 'この取引はすでに全額戻しています。反対仕訳と理由は下の監査履歴に残っています。'
            : '受領した金額がないため、戻せる決済行がありません。',
    // 閉店への影響 — the SAME verdict the checklist below prints, aimed at this
    // one row. A transaction that blocks the close says so where the reader is
    // looking at it, and it cannot disagree with the panel at the bottom of the
    // page because both read `closingReadiness` (⚖ A8).
    closingImpact: closingImpact(m, verdict?.checks ?? []),
    history: m.history,
    bookingHref: m.bookingNo ? `/${locale}/business/reservations${storeQuery}` : null,
    refundRefusal: REFUSAL.refund,
    // ⚖ THE GATE'S LANDING POINT HAS TO OFFER THE DECISION. 未収の扱い is the one
    // check a clinic or a salon with an account customer meets EVERY evening, and
    // 「次回来店時に請求」 is the answer they give — so the control that records it
    // says which decision it records, rather than 「未収として記録」, which records
    // the fact the page already knows and decides nothing.
    outstandingLabel: '次回来店時に請求として記録',
    outstandingRefusal: REFUSAL.outstanding,
    bookingRefusal: REFUSAL.booking,
    canRefund: access.refund,
    // canon `renderInspector` (:1301) — `item.state === "paid"`, and nothing
    // else. A 精算済み sale is the only shape whose original lines account for
    // its 受領額, which is the identity canon's own refund guard requires before
    // it will write (:1593). Offering the control on a part-paid or part-refunded
    // row would be a lever whose own evidence box prints the refusal.
    showRefund: m.state === 'paid',
    // ⚠ canon gates 未収として記録 on the CLOSE capability (:1305) exactly like
    // its siblings — it records a decision against the day's close, with an
    // executor and a reason. A role without it gets no control at all, which is
    // canon's own gating shape and this room's for the other four.
    canOutstanding: access.close,
    showOutstanding: m.outstanding > 0,
    }
  })

  const props: RegisterProps = {
    dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
    lensLabel,
    subtitle: '取引、決済手段、未収、返金、現金差異、閉店承認を同じ台帳で照合します。',
    permissionNotice: permissionNotice(access),
    money: [
      { key: 'gross', label: '総売上', value: redactMoney(yen(totals.gross)), redacted: access.redactSummary },
      { key: 'refunds', label: '返金・取消', value: yen(-totals.refunds), tone: totals.refunds > 0 ? 'bad' : undefined },
      { key: 'net', label: '純売上', value: redactMoney(yen(totals.net)), redacted: access.redactSummary },
      { key: 'collected', label: '受領済み', value: redactMoney(yen(totals.collected)), redacted: access.redactSummary },
      { key: 'outstanding', label: '未収', value: yen(totals.outstanding), tone: totals.outstanding > 0 ? 'warn' : undefined },
    ],
    moneyScope: `取引${counts.all}件 / 返金を差し引いた営業日集計`,
    // ⑰ the phone's 閉店 screen folds the day-strips to one line each, and a fold
    // that says nothing is worse than the band it replaced: each one carries the
    // two figures that decide something, WITH the word for what they count.
    moneyFold: `純売上 ${redactMoney(yen(totals.net))} / 未収 ${yen(totals.outstanding)}`,
    counts,
    countsFold: `全${counts.all}件 / 要確認 ${counts.attention}件`,
    filters: FILTERS,
    rows,
    sellLabel: '店頭販売を記録',
    sellRefusal: REFUSAL.sell,
    // ⧉ THE EXCEPTION BAND RENDERS WHEN THE DAY HOLDS ONE, AND NOT OTHERWISE
    // (the mock's ④ lever). It was a permanent slot that said 「異常なし」 on a
    // good day — a band whose whole job is to be alarming, printed 364 evenings
    // out of 365 saying nothing happened, is how a reader learns to skip the one
    // evening it matters. It is also the 26業種 lever with no business-type
    // branch anywhere: a shop with no card terminal simply never has a held
    // record, so it never sees the band.
    terminal:
      terminalHeld.length === 0
        ? null
        : {
            title: `決済端末（${heldTerminals.join('・')}）に送信待ちの取引が${terminalHeld.length}件あります`,
            copy: `${hhmm(heldSince!)}以降の${terminalHeld.length}件は端末内に保持されています。カードの新規決済は端末が復帰するまで記録できません。現金と受付価格には影響しません。`,
            // ⚖ F-S12 — A CONTROL'S NAME SAYS WHAT PRESSING IT DOES NOW. One
            // button, two jobs, so it needs both words: a fold that is already
            // open and still calls itself 「開く」 is telling a screen-reader
            // reader the opposite of what will happen.
            foldLabel: '決済端末の詳細を開く',
            foldCloseLabel: '決済端末の詳細を閉じる',
            stats: [
              { label: '端末内保持', value: `${terminalHeld.length}件` },
              { label: '対象金額', value: yen(terminalHeld.reduce((n, h) => n + h.amount, 0)) },
              {
                label: '二重請求',
                value: `${duplicates}件`,
                tone: duplicates > 0 ? ('warn' as const) : undefined,
              },
            ],
            recheckLabel: '再接続を確認',
            recheckRefusal: REFUSAL.terminal,
            // ⚑ THE CELL GOES WITH ITS BUTTON. The shipped room rendered the
            // action CELL unconditionally and only the button inside it
            // conditionally, so a role without the capability got an empty
            // bordered slot holding nothing — dead furniture in the band that
            // exists to be read fastest.
            canRecheck: access.close,
          },
    // ⚖ RULING (a), 8/24 — A ROLE THAT MAY NOT CLOSE GETS NO 閉店 VIEW AT ALL.
    // Redacting the closing desk figure by figure still handed a スタッフ two and
    // a half screens of checklist they can neither complete nor approve, every
    // gate greyed and every amount 「権限がありません」. The capability gate moves
    // one level up, from the sixteen controls to the VIEW that holds them —
    // ⚖ 8/17's own shape (hide, never show-and-refuse), applied to a room
    // instead of a button. The transaction desk they DO work at is untouched.
    close:
      closing && verdict && access.close
        ? {
            cash: {
              // ⚖ F12 — THE DRAWER IS THE OTHER HALF OF THE SAME GATE. 期待額 IS
              // `totals.cash`, which is the 内訳's 現金 差引 under a different
              // label; hiding one and printing the other two panels down is the
              // exact disease F5 fixed, only closed halfway. And the three go
              // together or not at all: 実査額 minus 差異 IS 期待額, so leaving
              // any two of them visible hands the reader the third.
              //
              // Canon's receipt: this whole band is the content of its
              // capability-gated `closeDialog` (:1625-1626 — `openCloseDialog`
              // refuses without the `close` capability), so a role that may not
              // close does not see the close's figures.
              expected: redactMoney(yen(verdict.expected)),
              // ⚖ 実査額 COMES OFF THE SHEET, and off the same call the checklist
              // row and the difference read (`countedCash`, one home). The band
              // used to read the stored field while the count sheet 200px below
              // printed its own total under 「この合計がそのまま実査額になります」 —
              // two independent reads of one quantity, and a world where they
              // disagreed rendered both figures, the sentence, and 差異 ¥0.
              counted: redactMoney(yen(verdict.counted)),
              variance: redactMoney(yen(verdict.variance)),
              // canon `renderSummary` (:1323) — the difference is BAD when it is
              // outside the tolerance, which is the same threshold the approval
              // rule reads. ONE verdict: a red figure and 「差異承認待ち」 can no
              // longer disagree, and a difference inside an allowance is not
              // painted as a fault. A tone belongs to its figure: with the figure
              // hidden there is nothing to paint red.
              varianceBad: !access.redactSummary && Math.abs(verdict.variance) > tolerance,
              redacted: access.redactSummary,
              // ⚖ NEVER A VERDICT OVER A NUMBER THAT CONTRADICTS IT, and ⚖ R-23
              // — never a verdict ABOUT a number this reader may not see. Both
              // readings live in `cashReasonLine`, one home.
              reason: cashReason,
              // ⑪ AND SOMEWHERE TO PUT ONE. The room named the missing reason in
              // four places and offered nowhere to write it. The field appears on
              // the days there IS a difference — the same data-presence rule
              // every other band obeys — and stands the printed row down while it
              // is there, because the same verdict twice, 40px apart, is what
              // this page already deleted once.
              reasonInput:
                verdict.variance === 0
                  ? null
                  : {
                      label: '差異理由',
                      // ⚖ F-S7 — THE REASON IS READ, NOT TYPED, IN THIS SLICE.
                      // A readOnly field CLIPS what will not fit on one line, so
                      // a real 70-character reason lost its tail with nothing
                      // saying so. It renders as wrapping text until the write
                      // is connected, and an empty one prints the room's OWN
                      // sentence for a missing reason (`cashReasonLine`, one
                      // home) rather than an example dressed up as a record.
                      value: closing.cash_reason !== '' ? closing.cash_reason : cashReason,
                      refusal: REFUSAL.reason,
                      // The three reasons a drawer is usually out. They FILL the
                      // field; they are not a taxonomy the shop has to learn.
                      chips: ['両替ミス', 'レシート訂正', '不明'],
                    },
              // ⚠ THE STATUS STAYS. Redaction hides AMOUNTS, not workflow: a
              // スタッフ still sees 未保存 / 保存済み / 差異承認待ち, because that is
              // what the shop is DOING, not what the shop TOOK.
              // ⚠ …AND FROM THE VERDICT, NOT FROM THE ROW. The checklist row is
              // presence-gated now (a cashless day has none), so the band reads
              // the workflow word the verdict publishes — the same string the
              // row prints when the row exists.
              status: verdict.cashStatus,
              statusDone: verdict.cashReady,
              // ⚠ 期待額 EXPLAINS ITSELF, or the closer cannot tell a wrong
              // expectation from a wrong drawer. The float is a labelled fact of
              // the day and the day's own cash sits under it, so the two rows add
              // up to the figure printed above them.
              floatLabel: '釣銭準備金',
              floatValue: redactMoney(yen(closing.cash_float)),
              dayCashLabel: '本日の現金',
              dayCashValue: redactMoney(`${yen(totals.cash)}（受領 − 返金）`),
              tolerance: redactMoney(`許容額 ${yen(tolerance)}（現金差異の承認しきい値）`),
              // ⑥ THE DIAL'S HOME, NAMED ON THE ROW THAT USES IT (registry ④).
              toleranceLinkLabel: '店舗設定で変更',
              toleranceLinkRefusal: REFUSAL.tolerance,
              saveLabel: '計数を保存',
              saveRefusal: REFUSAL.cash,
              // ⑩ 金種で数える — the count sheet, collapsed. 実査額 is what these
              // add up to, and `denominationTotal` is the one place that adds
              // them: the closer enters HOW MANY and the machine does the
              // arithmetic, so a mis-added column can never become a difference
              // that never existed.
              //
              // …AND THE SHEET IS PRESENT ONLY WHEN THE DAY HAS ONE. A closing
              // with no sheet keeps its typed 実査額 (`countedCash`), and an
              // empty grid claiming 「この合計がそのまま実査額になります」 over a ¥0
              // total would be the same lie in the other direction.
              denominations:
                closing.cash_count_sheet.length === 0
                  ? null
                  : {
                      summaryLabel: '金種で数える',
                      summaryNote: '枚数を入れると合計が出ます',
                      unit: '枚',
                      totalLabel: '合計',
                      totalValue: redactMoney(yen(denominationTotal(closing.cash_count_sheet))),
                      totalNote: 'この合計がそのまま実査額になります',
                      rows: closing.cash_count_sheet.map((d) => ({
                        key: String(d.denomination),
                        label: yen(d.denomination),
                        name: DENOMINATION_LABEL[d.denomination] ?? yen(d.denomination),
                        count: String(d.count),
                      })),
                    },
            },
            // ⚖ F12, THE SAME FIGURES ONE PANEL DOWN. The 現金計数と差異理由 row
            // prints 「期待 ¥8,300 / 実査 ¥8,300 / 差異 ¥0」 — the drawer band's
            // three numbers again, in a sentence. Gating the band and not this
            // row would move the leak rather than close it, so the gate is
            // applied wherever the amounts are PRINTED, not where they are read.
            // Only the cash row: the other four state 未収 and 端末保持 figures,
            // which this role sees unredacted in the strip and the terminal band
            // — hiding them HERE would be a new inconsistency in the other
            // direction. The row's label and its status pill are untouched.
            checks: verdict.checks.map((c) =>
              c.key === 'cash' ? { ...c, detail: redactMoney(c.detail) } : c,
            ),
            openCount: verdict.openCount,
            headline: verdict.closeReady ? '閉店の条件はすべて満たしています' : `${verdict.openCount}項目 未完了`,
            // ONE VERDICT, RENDERED AGAIN: the button's reason is the checklist's
            // own blocker list, so it cannot say something the rows above it do not.
            closeLabel: '閉店を確定',
            closeRefusal: verdict.closeReady
              ? REFUSAL.close
              : `${REFUSAL.close}（未完了: ${verdict.blockers.join('・')}）`,
            // ⚑ R-1 — SLICE B. 店舗管理者の確認 is canon's own SEPARATE
            // role-context page (fable-register-manager-signoff.html). It is not
            // built in this slice, so the control says exactly that instead of
            // pointing at a route that would 404 — an honest refusal, never a
            // dead href.
            signoffLabel: '店舗管理者の確認を開く',
            signoffRefusal: REFUSAL.signoff,
            // 閉店で記録される内容 — canon's close dialog's own content, read-only,
            // and now sitting directly above the button that freezes it.
            recordLabel: '閉店で記録される内容',
            recordNote: '確定した時点で固定されます',
            record: [
              { label: '総売上', value: redactMoney(yen(totals.gross)) },
              { label: '返金・取消', value: yen(-totals.refunds) },
              { label: '純売上', value: redactMoney(yen(totals.net)) },
              { label: '受領済み', value: redactMoney(yen(totals.collected)) },
              { label: '未収', value: yen(totals.outstanding) },
              // ⚖ F12 — the third printing of the same figure.
              { label: '現金差異', value: redactMoney(yen(verdict.variance)) },
              { label: '取引件数', value: `${counts.all}件` },
              // ⚠ 承認者 — WHO signed, not just when. The close record is what
              // 本部 reads back (registry ⑨/⑬) and what an audit asks for; a
              // record with a time and no name cannot answer either. Rendered
              // when the day HAS an approval — the page's own data-presence rule,
              // and an empty 承認者 cell on an unsigned day would be a slot
              // holding nothing.
              ...(closing.manager_signed_by !== null
                ? [{ label: '承認者', value: closing.manager_signed_by, wrap: true }]
                : []),
              { label: 'バージョン', value: `閉店 v${closing.close_version}` },
            ],
            // ⚖ THE SAME GATE AS THE STRIP. 受領済み is redacted for this role
            // and the 内訳 is that exact money again, split by the手段 it arrived
            // on — a role that may not see the total may not see its parts.
            reconciliation: reconciliation.rows.map((r) => ({
              label: r.label,
              received: redactMoney(yen(r.received)),
              reversed: r.reversed === 0 ? '—' : redactMoney(yen(r.reversed)),
              net: redactMoney(yen(r.net)),
            })),
            reconciliationNote: access.redactSummary
              ? 'この役割では決済手段ごとの内訳と受領済みの照合結果を表示できません。'
              : reconciliation.balanced
                ? `決済手段の内訳は受領済み ${yen(totals.collected)} と一致しています。`
                : '決済手段の内訳が受領済みと一致しません。閉店前に取引を確認してください。',
            reconciliationBalanced: reconciliation.balanced,
          }
        : null,
    // ⚖ A CLOSE BELONGS TO ONE STORE — and only THAT is worth explaining. A role
    // without the capability is told nothing about a room it does not have (hide,
    // never show-and-refuse); a reader who simply has no store selected is told
    // how to get one, because that is a thing they can fix in one press.
    closeUnavailable:
      access.close && !clamped
        ? '閉店処理は店舗ごとに行います。サイドバーで店舗を選ぶと、その店舗の現金ドロアと閉店チェックが表示されます。'
        : null,
    actionFootnote: FOOTNOTE,
    emptyDay: models.length === 0,
  }

  return { props, storeKey: clamped ? storeId! : 'all-stores' }
}

/** 決済手段 in one line, for the ledger row. canon `tenderSummary` (:1201-1206),
 *  on this room's own states. */
function tenderSummary(m: TransactionModel): string {
  if (m.state === 'held') return 'カード / 端末内'
  // canon `tenderSummary` (:1204) reads 返金済み and 取消済み the same way — the
  // original line is kept and a reversal sits beside it — and 一部返金 is that
  // shape with money still on the sale, so it says which part is left.
  if (m.state === 'refunded' || m.state === 'voided') return '元決済 + 反対仕訳'
  if (m.state === 'partial-refund') return '元決済 + 反対仕訳（一部）'
  if (m.state === 'partial') return `${m.tenders.filter((t) => t.flag === '').map((t) => t.label).join(' + ')} + 未収`
  return m.tenders.map((t) => t.label).join(' + ')
}

/** What THIS transaction does to the day's close, read off the same verdict the
 *  closing panel prints. Never a second judgement. */
function closingImpact(
  m: TransactionModel,
  checks: Array<{ key: string; done: boolean; label: string }>,
): string {
  const open = (key: string) => checks.some((c) => c.key === key && !c.done)
  // Read off the row's own PENDING LINE, not off its state word: a row can be
  // held by the terminal AND have money given back, and one word can only say
  // one of those. The line is the fact; the state is a headline.
  if (m.tenders.some((t) => t.flag === 'pending') && open('terminal')) {
    return 'この取引は端末内に保持されているため、閉店チェックの「決済端末の送信」が未完了です。'
  }
  if (m.received < 0) {
    return '受領額を超える返金が記録されています。現金の返金は期待額を減らし、再計数の対象になります。閉店前にこの取引を確認してください。'
  }
  if (m.outstanding > 0 && open('outstanding')) {
    return 'この取引の未収があるため、閉店チェックの「未収の扱い」が未判断のままです。'
  }
  if (m.state === 'refunded' || m.state === 'voided') {
    return `${m.state === 'voided' ? '取消済み' : '返金済み'}のため純売上には含みません。現金の返金は期待額を減らし、再計数の対象になります。`
  }
  // ⚖ MONEY THAT MOVED BACK IS LOOKED AT. A part-refunded row keeps part of its
  // sale AND takes part of it back out of the drawer, so the same consequence
  // canon states for a full reversal applies to it — which is the whole reason
  // it is counted under 要確認 rather than sitting in 精算済み.
  if (m.state === 'partial-refund') {
    return '一部が返金されているため、返金分は純売上に含みません。現金の返金は期待額を減らし、再計数の対象になります。'
  }
  return 'この取引は閉店を妨げていません。'
}
