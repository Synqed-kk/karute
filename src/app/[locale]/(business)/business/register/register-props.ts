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
  transactions as transactionPlane,
  type FixtureClosing,
  type FixtureTransaction,
} from '@/business/lib/fixtures-register'
import {
  accessFor,
  buildLedger,
  closingReadiness,
  countBy,
  FILTERS,
  heldForLens,
  ledgerTotals,
  permissionNotice,
  REDACTED,
  signedYen,
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
  close: '見本データのため閉店を確定できません。閉店はその時点の台帳を締める操作のため、実データの接続後に有効になります。',
  signoff: '店舗管理者の確認は別の画面で記録します。この画面は準備中のため、まだ開けません。',
  booking: 'この取引には予約がないため、予約一覧では確認できません。',
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
  const tolerance = world?.tolerance ?? cashTolerance
  const access = accessFor(world?.role ?? operator.role)

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
  const unsettledVisits = appointments
    .filter(
      (a) =>
        jstDayKey(a.starts_at) === todayKey &&
        a.status === 'done' &&
        !settled.has(a.id),
    )
    .map((a) => ({
      bookingNo: a.display_no,
      who: customers.find((c) => c.id === a.customer_id)?.name ?? '—',
      amount: a.booked_price ?? 0,
    }))

  const verdict = closing
    ? closingReadiness({
        totals,
        closing,
        tolerance,
        heldCount: terminalHeld.length,
        heldAmount: terminalHeld.reduce((n, h) => n + h.amount, 0),
        unsettledVisits,
      })
    : null

  const reconciliation = tenderReconciliation(models, totals.collected)

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

  const rows: RegisterRowProps[] = models.map((m) => ({
    id: m.id,
    state: m.state,
    stateLabel: m.stateLabel,
    filter: m.filter,
    pill: STATE_PILL[m.state],
    who: m.who,
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
          ? { label: '返金', value: signedYen(-m.reversed), tone: 'bad' as const }
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
        ? [{ label: '返金・取消', value: signedYen(-m.reversed), tone: 'bad' as const }]
        : []),
    ],
    priceProof:
      m.acceptedPrice === null
        ? '予約のない店頭販売のため、予約時価格のスナップショットはありません。レジで確定した金額がこの取引の正本です。'
        : `確定 ${yen(m.acceptedPrice)} / 現在の公開価格 ${m.publishedPrice === null ? '未設定' : yen(m.publishedPrice)}。売上・返金は確定 ${yen(m.acceptedPrice)} を正本とし、現在価格で再計算しません。`,
    tenders: m.tenders.map((t) => ({
      label: t.label + (t.flag === 'pending' ? ' / 送信待ち' : t.flag === 'unpaid' ? ' / 次回来店時' : ''),
      amount: signedYen(t.amount),
      tone: t.flag === 'refund' ? ('refund' as const) : t.flag === 'unpaid' ? ('unpaid' as const) : undefined,
    })),
    // 返金・取消の内容 — canon opens a dialog for this; the dialog is not carried
    // (no <dialog> in this family's rooms), so what it WOULD reverse is shown as
    // read-only evidence beside the refused control. Refusing to act is honest;
    // hiding what the action would have done is not.
    refundPreview:
      m.received > 0
        ? m.tenders
            .filter((t) => t.amount > 0 && t.flag !== 'unpaid')
            .map((t) => `${t.label} ${signedYen(-t.amount)}`)
            .join(' / ')
        : null,
    refundNote:
      m.received > 0
        ? '元の決済行は書き換えず、反対仕訳と理由、承認者を新しい監査行として追加します。'
        : m.reversed > 0
          ? 'この取引はすでに返金済みです。反対仕訳と理由は下の監査履歴に残っています。'
          : '受領した金額がないため、戻せる決済行がありません。',
    // 閉店への影響 — the SAME verdict the checklist below prints, aimed at this
    // one row. A transaction that blocks the close says so where the reader is
    // looking at it, and it cannot disagree with the panel at the bottom of the
    // page because both read `closingReadiness` (⚖ A8).
    closingImpact: closingImpact(m, verdict?.checks ?? []),
    history: m.history,
    bookingHref: m.bookingNo ? `/${locale}/business/reservations${storeQuery}` : null,
    refundRefusal: REFUSAL.refund,
    outstandingRefusal: REFUSAL.outstanding,
    bookingRefusal: REFUSAL.booking,
    canRefund: access.refund,
    // canon `renderInspector` (:1301) offers 返金・取消 only where there is money
    // to give back — a refunded sale has none left and a held one has money the
    // terminal has not confirmed. Offering the control there would be a lever
    // whose own evidence box says it cannot do anything.
    showRefund: m.received > 0 && m.state !== 'held',
    showOutstanding: m.outstanding > 0,
  }))

  const props: RegisterProps = {
    dateline: `サンプルデータ ${fmtDay.format(now)} / ${lensLabel}`,
    lensLabel,
    subtitle: '取引、決済手段、未収、返金、現金差異、閉店承認を同じ台帳で照合します。',
    permissionNotice: permissionNotice(access),
    money: [
      { key: 'gross', label: '総売上', value: access.redactSummary ? REDACTED : yen(totals.gross), redacted: access.redactSummary },
      { key: 'refunds', label: '返金・取消', value: signedYen(-totals.refunds), tone: totals.refunds > 0 ? 'bad' : undefined },
      { key: 'net', label: '純売上', value: access.redactSummary ? REDACTED : yen(totals.net), redacted: access.redactSummary },
      { key: 'collected', label: '受領済み', value: access.redactSummary ? REDACTED : yen(totals.collected), redacted: access.redactSummary },
      { key: 'outstanding', label: '未収', value: yen(totals.outstanding), tone: totals.outstanding > 0 ? 'warn' : undefined },
    ],
    moneyScope: `取引${counts.all}件 / 返金を差し引いた営業日集計`,
    counts,
    filters: FILTERS,
    rows,
    terminal: {
      ok: terminalHeld.length === 0,
      title:
        terminalHeld.length === 0
          ? '決済端末に送信待ちの取引はありません'
          : `決済端末（${heldTerminals.join('・')}）に送信待ちの取引が${terminalHeld.length}件あります`,
      copy:
        terminalHeld.length === 0
          ? '本日の決済はすべて送信済みです。現金と受付価格には影響しません。'
          : `${hhmm(heldSince!)}以降の${terminalHeld.length}件は端末内に保持されています。カードの新規決済は端末が復帰するまで記録できません。現金と受付価格には影響しません。`,
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
      canRecheck: access.close,
    },
    close:
      closing && verdict
        ? {
            cash: {
              expected: yen(totals.cash),
              counted: yen(closing.cash_counted),
              variance: signedYen(verdict.variance),
              varianceBad: verdict.variance !== 0,
              reason:
                closing.cash_reason !== ''
                  ? closing.cash_reason
                  : verdict.requiresApproval
                    ? '差異の理由が記録されていません'
                    : '差異なし — 理由の記録は不要です',
              status: verdict.checks.find((c) => c.key === 'cash')!.status,
              statusDone: verdict.cashReady,
              tolerance: `許容額 ${yen(tolerance)}（現金差異の承認しきい値）`,
              saveLabel: '計数を保存',
              saveRefusal: REFUSAL.cash,
              canSave: access.close,
            },
            checks: verdict.checks,
            openCount: verdict.openCount,
            headline: verdict.closeReady ? '閉店の条件はすべて満たしています' : `${verdict.openCount}項目 未完了`,
            // ONE VERDICT, RENDERED AGAIN: the button's reason is the checklist's
            // own blocker list, so it cannot say something the rows above it do not.
            closeLabel: '閉店を確定',
            closeRefusal: verdict.closeReady
              ? REFUSAL.close
              : `${REFUSAL.close}（未完了: ${verdict.blockers.join('・')}）`,
            canClose: access.close,
            // ⚑ R-1 — SLICE B. 店舗管理者の確認 is canon's own SEPARATE
            // role-context page (fable-register-manager-signoff.html). It is not
            // built in this slice, so the control says exactly that instead of
            // pointing at a route that would 404 — an honest refusal, never a
            // dead href.
            signoffLabel: '店舗管理者の確認を開く',
            signoffRefusal: REFUSAL.signoff,
            // 閉店で記録される内容 — canon's close dialog's own content, read-only.
            recordLabel: '閉店で記録される内容',
            record: [
              { label: '総売上', value: access.redactSummary ? REDACTED : yen(totals.gross) },
              { label: '返金・取消', value: signedYen(-totals.refunds) },
              { label: '純売上', value: access.redactSummary ? REDACTED : yen(totals.net) },
              { label: '受領済み', value: access.redactSummary ? REDACTED : yen(totals.collected) },
              { label: '未収', value: yen(totals.outstanding) },
              { label: '現金差異', value: signedYen(verdict.variance) },
              { label: '取引件数', value: `${counts.all}件` },
              { label: 'バージョン', value: `閉店 v${closing.close_version}` },
            ],
            reconciliation: reconciliation.rows.map((r) => ({
              label: r.label,
              received: yen(r.received),
              reversed: r.reversed === 0 ? '—' : signedYen(r.reversed),
              net: signedYen(r.net),
            })),
            reconciliationNote: reconciliation.balanced
              ? `決済手段の内訳は受領済み ${yen(totals.collected)} と一致しています。`
              : '決済手段の内訳が受領済みと一致しません。閉店前に取引を確認してください。',
            reconciliationBalanced: reconciliation.balanced,
          }
        : null,
    closeUnavailable: '閉店処理は店舗ごとに行います。サイドバーで店舗を選ぶと、その店舗の現金ドロアと閉店チェックが表示されます。',
    actionFootnote: FOOTNOTE,
    emptyDay: models.length === 0,
  }

  return { props, storeKey: clamped ? storeId! : 'all-stores' }
}

/** 決済手段 in one line, for the ledger row. canon `tenderSummary` (:1201-1206),
 *  on this room's own states. */
function tenderSummary(m: TransactionModel): string {
  if (m.state === 'held') return 'カード / 端末内'
  if (m.state === 'refunded') return '元決済 + 反対仕訳'
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
  if (m.state === 'held' && open('terminal')) {
    return 'この取引は端末内に保持されているため、閉店チェックの「決済端末の送信」が未完了です。'
  }
  if (m.outstanding > 0 && open('outstanding')) {
    return 'この取引の未収があるため、閉店チェックの「未収の扱い」が未判断のままです。'
  }
  if (m.state === 'refunded') {
    return '返金済みのため純売上には含みません。現金の返金は期待額を減らし、再計数の対象になります。'
  }
  return 'この取引は閉店を妨げていません。'
}
