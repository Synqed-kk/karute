// THE NUMBER DICTIONARY — one registry of the business numbers this product
// states, and the arithmetic that derives the new ones.
//
// ⚖ THE SPREADSHEET-ABSORPTION PLAN'S LAYER 2 (2026-09-03, Phase 1). The
// 集計表's every formula becomes a DICTIONARY ENTRY: defined once, computed on
// the server, shown identically wherever it appears. That is what kills the
// per-row IFS tables and the copy-paste drift class the two La Estro workbooks
// died of — a book that cannot say whether ¥9,350 or ¥93,500 is the right price
// because both are typed into different rows of the same column.
//
// PURE, LIKE `guide.ts` AND `spring.ts`, and the empty import inventory in
// foundation.test.ts is the pin. No React, no DOM, no clock, no fixture: an
// import here would mean the dictionary started knowing about one room's world.
//
// WHAT AN ENTRY IS FOR. A tile, a column head, a provenance row and a tour
// sentence all name the same number, so they all READ THE SAME ENTRY. A screen
// that spells 「新規売上」 as a literal is a second home for one word, and the
// day someone renames it the two disagree — which is exactly the disease this
// layer exists to end. The room's suite scans the source for literal labels.
//
// ⚖⚖ STORE-FIRST (Liam 9/2). Not one company-finance number lives here. Every
// entry is a STORE's own operating number; royalties, P&L and 本部 rollups are
// out of the product's data plane entirely.
//
// ⚖ THE DISCONNECTED-DEPTH LAW (Liam 8/17) HAS A HOME HERE TOO. Six numbers the
// 集計表 uses have no plane behind them yet. They are carried as `source:
// 'unconnected'` with the words for WHAT has to be connected, and they render in
// exactly ONE place — the provenance panel's 未接続 block. Never a tile, never a
// column, never a chip: a number nobody can compute is not a number the screen
// may state.

export type NumberUnit = 'yen' | 'count' | 'rate' | 'days'
export type NumberScope = 'month' | 'month-to-date' | 'as-of' | 'day'
export type NumberOwner = '売上・レジ' | '予約一覧' | '顧客' | '設定' | '売上分析' | '広告' | '外部'

export type NumberId =
  // plane-sourced — the ledger and the lists this room already reads
  | 'total'
  | 'nw'
  | 'collected'
  | 'consumed'
  | 'newCount'
  | 'existingCount'
  | 'nextRate'
  | 'repeatRate'
  | 'util'
  | 'ltv'
  | 'newLtv'
  | 'target'
  | 'targetProgress'
  | 'targetRemaining'
  | 'remainingOpenDays'
  | 'landing'
  | 'landingFinal'
  | 'landingGap'
  | 'spanCompare'
  | 'avgNewTicket'
  | 'ticketOutstanding'
  | 'monthDelta'
  // unconnected — named, with what each one needs
  | 'inquiries'
  | 'cvRate'
  | 'ticketPurchaseRate'
  | 'retentionRate'
  | 'subscriptionIncome'
  | 'googleReviews'

export interface NumberEntry {
  id: NumberId
  /** The word on the tile, the column head, the provenance row. */
  label: string
  /** What it counts, in one sentence. The tile footer and the provenance row. */
  counts: string
  /** The formula, in words, over the objects the product already holds. */
  formula: string
  scope: NumberScope
  owner: NumberOwner
  unit: NumberUnit
  source: 'plane' | 'unconnected'
  /** `unconnected` only: what has to be connected before it can be stated. */
  needs?: string
  /** The 集計表's own word, when the book calls it something else. */
  alias?: string
}

/** How a scope reads on the provenance panel. One word per scope, so a reader
 *  never has to work out whether a figure is a month or a running balance. */
export const SCOPE_WORD: Record<NumberScope, string> = {
  month: '対象月ぶん',
  'month-to-date': '月のはじめから今日まで',
  'as-of': 'その時点の残り',
  day: '1日ぶん',
}

export const NUMBERS: readonly NumberEntry[] = [
  // ── the settlement ledger's own five ──────────────────────────────────────
  {
    id: 'total',
    label: '総合売上',
    counts: 'その月に精算したすべての売上です。',
    formula: '売上・レジの精算記録を対象月で合計します。月の途中は、経過した日ぶんだけを合計します。',
    scope: 'month',
    owner: '売上・レジ',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'nw',
    label: '新規売上',
    counts: '総合売上のうち、はじめて来店したお客様からの売上です。',
    formula: '対象月の精算記録のうち、その日がはじめての来店だったお客様のぶんを合計します。',
    scope: 'month',
    owner: '売上・レジ',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'collected',
    label: '回収売上',
    counts: '総合売上のうち、その月のうちに入金まで済んだ売上です。',
    formula: '対象月の精算記録のうち、精算が完了しているぶんを合計します。',
    scope: 'month',
    owner: '売上・レジ',
    unit: 'yen',
    source: 'plane',
    alias: '入金',
  },
  {
    id: 'consumed',
    label: '消化売上',
    counts: '総合売上のうち、回数券を使って受けた施術のぶんです。',
    formula: '対象月の精算記録のうち、回数券の消化として計上したぶんを合計します。',
    scope: 'month',
    owner: '売上・レジ',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'newCount',
    label: '新規数',
    counts: 'はじめて来店したお客様の来店数です。',
    formula: '対象月の来店のうち、それより前に完了した来店がないお客様のぶんを数えます。',
    scope: 'month',
    owner: '予約一覧',
    unit: 'count',
    source: 'plane',
  },
  {
    id: 'existingCount',
    label: '既存数',
    counts: '2回目以降のお客様の来店数です。',
    formula: '対象月の来店のうち、それより前に完了した来店があるお客様のぶんを数えます。',
    scope: 'month',
    owner: '予約一覧',
    unit: 'count',
    source: 'plane',
  },
  // ── the four rates and the two averages ───────────────────────────────────
  {
    id: 'nextRate',
    label: '次回予約率',
    counts: '来店したその場で次の予約が入った割合です。',
    formula: '対象月の来店のうち、次回予約が入ったものの割合です。',
    scope: 'month',
    owner: '予約一覧',
    unit: 'rate',
    source: 'plane',
  },
  {
    id: 'repeatRate',
    label: 'リピート率',
    counts: 'もう一度来てくださったお客様の割合です。',
    formula: '対象月に来店したお客様のうち、以前にも来店があった方の割合です。',
    scope: 'month',
    owner: '顧客',
    unit: 'rate',
    source: 'plane',
  },
  {
    id: 'util',
    label: '稼働率',
    counts: '施術できる枠のうち、実際に埋まった割合です。',
    formula: '対象月の予約枠のうち、来店で埋まった枠の割合です。',
    scope: 'month',
    owner: '予約一覧',
    unit: 'rate',
    source: 'plane',
  },
  {
    id: 'ltv',
    label: 'LTV',
    counts: 'お客様おひとりが、これまでに使ってくださった金額の平均です。',
    formula: '対象月までの売上を、来店したお客様の人数でならしたものです。',
    scope: 'month',
    owner: '顧客',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'newLtv',
    label: '新規LTV',
    counts: 'はじめて来店したお客様おひとりあたりの、これまでの金額の平均です。',
    formula: '新規のお客様の売上を、新規のお客様の人数でならしたものです。',
    scope: 'month',
    owner: '顧客',
    unit: 'yen',
    source: 'plane',
  },
  // ── the target layer (the 集計表's 目標値 / 現状 / 着地 / GAP row) ──────────
  {
    id: 'target',
    label: '月間売上目標',
    counts: 'この店舗が、その月に立てている売上の目標額です。',
    formula: '設定で店舗ごとに決めた金額です。ここでは計算していません。',
    scope: 'month',
    owner: '設定',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'targetProgress',
    label: '目標進捗',
    counts: '目標に対して、いまどこまで来ているかです。',
    formula: '総合売上 ÷ 月間売上目標。目標が未設定のときは表示しません。',
    scope: 'month-to-date',
    owner: '売上分析',
    unit: 'rate',
    source: 'plane',
  },
  {
    id: 'targetRemaining',
    label: '目標まであと',
    counts: '目標に届くまで、あといくら必要かです。',
    formula: '月間売上目標 − 総合売上。上回っているときは、上回った額を出します。',
    scope: 'month-to-date',
    owner: '売上分析',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'remainingOpenDays',
    label: '残り営業日',
    counts: '今日より後に、その月であと何日開けるかです。',
    formula: '対象月の営業日から、今日までのぶんを引いた日数です。定休日は数えません。',
    scope: 'month-to-date',
    owner: '設定',
    unit: 'days',
    source: 'plane',
  },
  {
    id: 'landing',
    label: '着地見込み',
    counts: 'いまのペースのまま月末まで進んだ場合の、総合売上の推計です。',
    formula: '総合売上 ÷ 経過した日数 × その月の暦日数。実績ではなく推計です。',
    scope: 'month',
    owner: '売上分析',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'landingFinal',
    label: '着地（確定）',
    counts: '完了した月に、実際に上がった総合売上です。',
    formula: 'その月の総合売上そのものです。終わった月に推計はありません。',
    scope: 'month',
    owner: '売上・レジ',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'landingGap',
    label: '着地GAP',
    counts: '着地見込みが、目標にどれだけ足りないかです。',
    formula: '着地見込み − 月間売上目標。マイナスなら足りていません。',
    scope: 'month',
    owner: '売上分析',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'spanCompare',
    label: '前月同経過日数比',
    counts: '前の月の同じ日数ぶんと比べて、どれだけ増えたか減ったかです。',
    formula: '総合売上を、前の月の同じ経過日数ぶんの総合売上と比べます。月全体どうしの比較ではありません。',
    scope: 'month-to-date',
    owner: '売上分析',
    unit: 'rate',
    source: 'plane',
  },
  {
    id: 'avgNewTicket',
    label: '新規平均単価',
    counts: 'はじめて来店したお客様おひとりあたりの売上です。',
    formula: '新規売上 ÷ 新規数。新規のご来店がない月は出しません。',
    scope: 'month',
    owner: '売上分析',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'ticketOutstanding',
    label: '回数券 未消化残',
    counts: 'まだ使われていない回数券の残りぶんです。',
    formula: 'お客様ごとの残回数を合計し、店舗の基準価格をかけます。',
    scope: 'as-of',
    owner: '顧客',
    unit: 'yen',
    source: 'plane',
  },
  {
    id: 'monthDelta',
    label: '前月比',
    counts: '同じ列の、前の月との差です。',
    formula: '金額と件数は増減の割合、率はポイント差で出します。月の途中の行は比べません。',
    scope: 'month',
    owner: '売上分析',
    unit: 'rate',
    source: 'plane',
  },
  // ── 未接続 — named with what each one needs (⚖ disconnected-depth) ─────────
  {
    id: 'inquiries',
    label: '問い合わせ数',
    counts: 'その日に届いた問い合わせの件数です。',
    formula: '人が入力した件数を対象月で合計します。',
    scope: 'month',
    owner: '売上・レジ',
    unit: 'count',
    source: 'unconnected',
    needs: '売上・レジのレジ締めカードで人が入力する項目、または広告アドオンとの接続',
  },
  {
    id: 'cvRate',
    label: 'CV率',
    counts: '問い合わせのうち、来店につながった割合です。',
    formula: '新規数 ÷ 問い合わせ数。',
    scope: 'month',
    owner: '売上分析',
    unit: 'rate',
    source: 'unconnected',
    needs: '問い合わせ数',
  },
  {
    id: 'ticketPurchaseRate',
    label: '回数券購入率',
    counts: '来店したお客様のうち、回数券を買ってくださった割合です。',
    formula: '回数券の購入件数 ÷ 来店数。',
    scope: 'month',
    owner: '顧客',
    unit: 'rate',
    source: 'unconnected',
    needs: 'core の回数券購入記録',
  },
  {
    id: 'retentionRate',
    label: '継続率',
    counts: '回数券を使い切ったあとも、通い続けてくださった割合です。',
    formula: '回数券の終了後に次の購入があったお客様 ÷ 終了したお客様。',
    scope: 'month',
    owner: '顧客',
    unit: 'rate',
    source: 'unconnected',
    needs: 'core の回数券購入記録',
  },
  {
    id: 'subscriptionIncome',
    label: 'サブスク入金',
    counts: '毎月の定額プランから入金された金額です。',
    formula: '対象月に引き落とせたサブスクの金額を合計します。',
    scope: 'month',
    owner: '売上・レジ',
    unit: 'yen',
    source: 'unconnected',
    needs: '決済連携',
  },
  {
    id: 'googleReviews',
    label: 'Google口コミ数',
    counts: 'Googleに投稿されている口コミの件数です。',
    formula: 'Googleから取得した件数をそのまま表示します。',
    scope: 'as-of',
    owner: '外部',
    unit: 'count',
    source: 'unconnected',
    needs: 'Google API',
  },
]

const BY_ID = new Map<NumberId, NumberEntry>(NUMBERS.map((n) => [n.id, n]))

/** FAIL LOUD. A screen asking for a number the dictionary does not carry is a
 *  screen about to print a word nobody defined — better a crash in a suite than
 *  a label the reader cannot trace. */
export function numberEntry(id: NumberId): NumberEntry {
  const entry = BY_ID.get(id)
  if (!entry) throw new Error(`unknown number id: ${id}`)
  return entry
}

/** Every entry the dictionary can actually compute today. */
export const PLANE_NUMBERS = NUMBERS.filter((n) => n.source === 'plane')
/** Every entry that is named and honestly unbuilt. */
export const UNCONNECTED_NUMBERS = NUMBERS.filter((n) => n.source === 'unconnected')

// ── the arithmetic that belongs to the new entries ──────────────────────────
// The room's existing derivations stay in `analytics.ts`. What lives here is
// what the dictionary itself introduced, so each new entry's `formula` sentence
// has exactly one function behind it.

/**
 * 着地見込み — the month's pace, run to the end of the calendar month.
 *
 * ⚠ CALENDAR DAYS, NOT BUSINESS DAYS, and the copy says so beside it. The
 * spreadsheet's own landing formula projects on elapsed days; mixing in the
 * 定休日 calendar here would silently make two different projections available
 * and neither of them the one the label promises.
 *
 * `elapsedDays` is floored at 1: on the first day of a month a divide by zero
 * would print Infinity, which is not an estimate, it is a bug wearing one.
 */
export function landingEstimate(total: number, elapsedDays: number, daysInMonth: number): number {
  const days = Math.max(1, Math.floor(elapsedDays))
  return Math.round((total / days) * daysInMonth)
}

/** 着地GAP. Negative means the month is projected to land short. */
export function landingGap(landing: number, target: number): number {
  return landing - target
}

/** 目標進捗, as a whole percent. A store with no target dial gets 0 rather than
 *  NaN, and the screen shows 「目標が未設定です」 instead of a percentage. */
export function targetProgress(total: number, target: number): number {
  if (target <= 0) return 0
  return Math.round((total / target) * 100)
}

/** 目標まであと — SIGNED. Positive is the shortfall, negative is the amount the
 *  month is already over by, and the copy picks its sentence from the sign. */
export function targetRemaining(total: number, target: number): number {
  return target - total
}

/** 新規平均単価. `null` when nobody new came, because a per-person figure over
 *  zero people is not 0, it is nothing. */
export function avgNewTicket(nw: number, newCount: number): number | null {
  if (newCount <= 0) return null
  return Math.round(nw / newCount)
}

export type DeltaKind = 'up' | 'down' | 'flat' | 'na'

/**
 * 前月比 — the tick under a table cell, and the ONE place it is computed.
 *
 * THE TICK IS THE DIFFERENCE OF THE TWO NUMBERS THE TABLE PRINTS. Money and
 * counts read as a percentage of the earlier month; a rate reads in POINTS,
 * because a rate that goes from 46% to 49% did not rise 6.5%, it rose 3 points,
 * and saying the first is the sort of thing a spreadsheet does to a manager.
 *
 * `na` (an em-dash) is the honest answer in three cases, and the caller's
 * partial-month rule is the fourth: no previous month at all, a previous value
 * of zero (a change from nothing has no percentage), and a missing current
 * value. `rate` values are fractions in 0–1, as every rate in this room is.
 */
export function monthDelta(
  current: number | null,
  prior: number | null,
  unit: NumberUnit,
): { kind: DeltaKind; text: string } {
  if (current === null || prior === null || prior === 0) return { kind: 'na', text: '—' }
  const diff = current - prior
  if (diff === 0) return { kind: 'flat', text: '±0' }
  const arrow = diff > 0 ? '▲' : '▼'
  const size =
    unit === 'rate'
      ? `${Math.abs(diff * 100).toFixed(1)}pt`
      : `${Math.abs((diff / prior) * 100).toFixed(1)}%`
  return { kind: diff > 0 ? 'up' : 'down', text: `${arrow}${size}` }
}

/** The TONE a delta wears on a chip — and the reason it lives here rather than
 *  beside the chip: `flat` and `na` are NEUTRAL. A month exactly level with its
 *  comparand did not go up, and neither did a month with no comparand at all, so
 *  a green 「±0」 is the sheet congratulating nobody (L2 B2-7). */
export function deltaTone(kind: DeltaKind): 'up' | 'down' | 'neutral' {
  return kind === 'up' ? 'up' : kind === 'down' ? 'down' : 'neutral'
}

export interface DecideInput {
  /** How many months the chart is showing. */
  monthCount: number
  /** The most recent FINISHED month's short name, and its 総合売上 as printed. */
  lastShort: string | null
  lastTotalText: string | null
  /** 1 = the highest of the finished months. */
  lastRank: number | null
  /** The month being viewed. */
  currentShort: string
  currentTotal: number
  /** The equal-span comparison against the previous month, already formatted. */
  spanDeltaText: string | null
  /** −1 behind, 0 level, +1 ahead. */
  spanDeltaSign: number | null
  /** ⚠ THE ONE PREDICATE THAT DECIDES EVERY 「同じ経過日数」 WORD ON THE PAGE.
   *  True only when the month being viewed is FINISHED and the previous month
   *  was read whole — the same value the tile's chip and its footer read, so
   *  the three cannot describe one comparison three different ways (L1 B1-2 /
   *  B1-7, L2 B2-1). */
  wholeMonths: boolean
}

/**
 * THE ONE SENTENCE THE CHART IS FOR — 「what does this picture tell me to do」.
 *
 * Every clause has an honest fallback, because each of them can be untrue: a
 * world with no finished month has nothing to rank, a month with no takings yet
 * has nothing to compare, and a previous month that was empty cannot be a
 * baseline. A sentence assembled without those branches is the class of copy
 * that prints 「NaN% と出遅れています」 on the first of the month.
 */
export function decideLine(input: DecideInput): string {
  const { lastShort, lastTotalText, lastRank, currentShort, currentTotal } = input
  if (lastShort === null || lastTotalText === null || lastRank === null) {
    return `完了した月がまだないため、${currentShort}を並べる相手がありません。`
  }
  const rankWord = lastRank === 1 ? '最高' : `${lastRank}番目`
  const head = `直近の完了月${lastShort}は ${lastTotalText} で${input.monthCount}か月の${rankWord}。`
  if (currentTotal <= 0) return `${head}${currentShort}はまだ実績がありません。`
  if (input.spanDeltaText === null || input.spanDeltaSign === null) {
    return `${head}${currentShort}は前月に並べられる実績がないため、比較していません。`
  }
  const verdict =
    input.spanDeltaSign > 0 ? '上回っています' : input.spanDeltaSign < 0 ? '出遅れています' : '同じ水準です'
  /** The month being VIEWED is the month the head just named — saying its name
   *  a second time sets a month beside itself (L1 B1-7). */
  const subject = currentShort === lastShort ? '' : `${currentShort}は`
  /** ⚠ 「同じ経過日数で」 IS SAID ONLY WHERE IT IS TRUE. On a finished month read
   *  against a whole previous month the comparison really is month against
   *  month, and the elapsed-day wording would be describing a comparison this
   *  sentence did not make. */
  const how = input.wholeMonths ? '前月と比べて' : '同じ経過日数で'
  return `${head}${subject}${how} ${input.spanDeltaText} と${verdict}。`
}
