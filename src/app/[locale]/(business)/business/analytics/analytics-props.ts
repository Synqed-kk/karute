// 売上分析 — the room's PROP ASSEMBLY, beside the page rather than inside it.
//
// WHY THIS FILE EXISTS (the room-3 F1 law): the evidence harness imports THIS
// function, so an isolated shot is the same assembly the deployed page runs and
// a drift between them is a compile error rather than a picture nobody can
// check. `page.tsx` keeps the admission gate, the route params and the sheet
// import — the things a route entry owns.
//
// SERVER-ONLY BY CONSTRUCTION. Every read, join, sum and date format happens
// here, so the client receives plain strings and numbers. No timezone and no
// locale can drift between the two renders, and no data access exists on the
// client at all.
//
// THE PAGE BOUNDARY IS RESOLVED HERE, and the screen is handed the ANSWER. A
// staff member without the viewing right never receives the workspace at all —
// not hidden, not inert, ABSENT — which is strictly stronger than a client-side
// gate, and it is the only shape that can be true on a server: markup that is
// never rendered cannot be un-hidden.
//
// ONE FIXTURE WORLD. 日報's TODAY row is the 今日の運営 board's own day: the
// same booking rows, summed through the board's own `isEarningVisit`. Every
// other figure derives from the settlement ledger (fixtures-analytics), and the
// month's days always sum back to the month.
//
// THE MONTH IS A LINK (`?month=`), not client state — the day nav on 今日の運営
// set that pattern (⚖ Liam 22), and ⚖-ADJ C makes the chart's own click use it.
//
// ⚖ EVERY WORD FOR A NUMBER COMES FROM THE DICTIONARY (`dictionary.ts`). A tile
// label, a column head, a provenance row and a tour sentence naming the same
// figure read the SAME entry, so the page cannot call one number two things.

import {
  boardDayFigures,
  chartModel,
  composition,
  dailyLedger,
  distributeInt,
  LEDGER_MONTHS,
  menuEntries,
  monthCoords,
  monthFigures,
  priorVisitCounts,
  RANK_AGGREGATE,
  RANK_LABEL,
  sourceEntries,
  spanFigures,
  staffRanking,
  sumDays,
  ticketLiability,
  type DayFigures,
  type RankMetric,
  type RankMonth,
} from '@/business/lib/analytics'
import { jstDayKey, jstYmd } from '@/business/lib/clock'
import {
  defaultStoreId,
  listAppointments,
  listCustomers,
  listMenus,
  listStaff,
  listStoreOptions,
  readAnalyticsPlanes,
  readShellIdentity,
  renderNow,
  type StoreLens,
} from '@/business/lib/data'
import {
  avgNewTicket,
  decideLine,
  deltaTone,
  landingEstimate,
  landingGap,
  monthDelta,
  numberEntry,
  SCOPE_WORD,
  targetProgress,
  targetRemaining,
  UNCONNECTED_NUMBERS,
  type NumberId,
} from '@/business/lib/dictionary'
import { treatsPatients, yen } from '@/business/lib/today-board'
import type { AnalyticsProps, RankingByMetric, TableMetric, TileProps } from './AnalyticsScreen'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtMonth = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', ...JST })
const fmtMonthShort = new Intl.DateTimeFormat('ja-JP', { month: 'long', ...JST })
const WEEKDAY_WORD = ['日', '月', '火', '水', '木', '金', '土'] as const
const RANK_METRICS: RankMetric[] = ['total', 'consumed', 'existing', 'nw', 'ltv']

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`
/** Chart axis labels — canon's 万 shorthand. */
const manYen = (n: number) => `${Math.round(n / 10000).toLocaleString('ja-JP')}万`
/** Noon JST inside a month, for Intl to name it. */
const monthAt = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1, 3))
/** The per-day rate inside the 着地見込み formula. One decimal only when the
 *  division actually produced one — 「¥56,749.5」 is the mock's own line, and
 *  「¥56,750.0」 on a clean division would be a decimal that means nothing. */
const yen1 = (n: number) => {
  const whole = Number.isInteger(n)
  return `${n < 0 ? '−' : ''}¥${Math.abs(n).toLocaleString('ja-JP', {
    minimumFractionDigits: whole ? 0 : 1,
    maximumFractionDigits: 1,
  })}`
}

/**
 * THE 月次内訳 TABLE'S COLUMNS, in DOM order, each naming its dictionary entry.
 *
 * ⚖-ADJ D — NOTHING IS DROPPED. The mock's builder could only read eight
 * columns off the deployed table, so four went missing from the picture:
 * リピート率 · 稼働率 · LTV · 新規LTV. They are not removed here, they are SHED
 * — the cell stays in the DOM, labelled, and is revealed inside its row's own
 * detail line. `always` sheds at every width (the four), `sh1` (既存数) below
 * the first ladder rung and `sh2` (新規数) below the second, exactly as the
 * mock's own shed mechanism does.
 */
export const TABLE_METRICS: TableMetric[] = [
  { id: 'total', shed: null },
  { id: 'nw', shed: null },
  { id: 'collected', shed: null },
  { id: 'consumed', shed: null },
  { id: 'newCount', shed: 'sh2' },
  { id: 'existingCount', shed: 'sh1' },
  { id: 'nextRate', shed: null },
  { id: 'repeatRate', shed: 'always' },
  { id: 'util', shed: 'always' },
  { id: 'ltv', shed: 'always' },
  { id: 'newLtv', shed: 'always' },
]

/** The 見本データ refusals, spelled once. */
const REFUSALS = {
  export: '見本データのため実行できません',
  yearly: `年間表示は${LEDGER_MONTHS}か月を超える実績が必要です`,
  last30: '直近30日表示は準備中です',
} as const

const SAMPLE_NOTE =
  '見本データのため、書き出し・保存・設定の変更はできません。実データ接続後に有効になります。'

/** The retired trailing `<p class="footnote">`, verbatim (⚖ §2.10 K). */
const SOURCE_NOTE = 'どの数値も 売上・レジ の精算記録から導出。'

export interface AnalyticsPropsInput {
  locale: string
  /** The raw `?store=` value. Unknown or missing opens on the operator's own
   *  store, never the business-wide merge — `defaultStoreId` owns that rule. */
  store?: string
  /** The raw `?month=` value: an OFFSET back from the current month. */
  month?: string
  /** FIXTURE-SHAPED WORLD OVERRIDES, and the page never passes them. The
   *  evidence harness needs worlds this demo plane does not contain, and the
   *  only honest way to picture one is to run the REAL derivations over
   *  different inputs — never a class toggle and never hand-written markup. */
  world?: {
    /** 月間売上目標 — `0` is the store whose dial was never set. */
    target?: number
    /** A BUSINESS THAT DOES NOT SELL 回数券 — and that is ONE world, not a
     *  flag: no customer holds a balance AND no month consumed any. The REAL
     *  derivations run over it (`ticketLiability` included), so the absence of
     *  the chips is a property of the data rather than a class toggle. */
    noTickets?: boolean
    /** A STORE THAT TOOK THE SAME MONEY TWELVE MONTHS RUNNING — the only honest
     *  way to picture an exactly FLAT comparison, which the demo plane holds no
     *  two months of. It is one real ledger row copied across every month, so
     *  the flatness is a property of the data and every field stays internally
     *  possible; `monthDelta` then computes `±0` from figures, not from a flag. */
    levelMonths?: boolean
  }
}

export interface AnalyticsPropsResult {
  props: AnalyticsProps
  /** The RESOLVED lens, returned rather than re-derived by the caller. */
  storeKey: string
}

export async function analyticsProps({
  locale,
  store,
  month,
  world,
}: AnalyticsPropsInput): Promise<AnalyticsPropsResult> {
  const storeOptions = await listStoreOptions()
  const storeId = defaultStoreId(store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }
  const storeKey = clamped ? storeId! : 'all-stores'

  const shell = await readShellIdentity()
  const planes = await readAnalyticsPlanes(lens)

  // ── THE BOUNDARY, decided once, from the store's own dial ─────────────────
  const mayView = planes.policy.viewRoles.includes(shell.operator.role)
  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'
  const storeQuery = clamped ? `?store=${encodeURIComponent(storeId!)}` : ''
  if (!mayView) {
    return {
      storeKey,
      props: {
        denied: {
          title: '売上分析',
          message:
            'この画面を見る権限がありません。売上分析の閲覧にはオーナーまたは店舗管理者の権限が必要です。権限は管理者にご相談ください。',
          backLabel: '今日の運営に戻る',
          backHref: `/${locale}/business/today${storeQuery}`,
        },
      },
    }
  }

  // ONE CLOCK READ PER RENDER (the cycle-1 law).
  const now = renderNow()
  const today = jstYmd(now)
  const todayKey = jstDayKey(now)

  const requested = Number.parseInt(month ?? '0', 10)
  const monthsAgo = Number.isFinite(requested) ? Math.max(0, Math.min(LEDGER_MONTHS - 1, -requested)) : 0

  const [customerPlane, appointments, menus, staff] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens),
    listMenus(lens),
    listStaff(lens),
  ])
  const customers = world?.noTickets
    ? customerPlane.map((c) => ({ ...c, ticket_balance: null }))
    : customerPlane
  const ledgerBase = world?.noTickets
    ? planes.ledger.map((r) => ({ ...r, consumed: 0 }))
    : planes.ledger
  /** ⚠ ONE REAL ROW, COPIED ACROSS EVERY MONTH — not a `flat: true` flag. Each
   *  store's own `months_ago: 1` row becomes all twelve of its months, so a
   *  finished month read against a whole previous month lands EXACTLY level and
   *  `monthDelta` reaches `±0` through the arithmetic. */
  const ledgerPlane = world?.levelMonths
    ? ledgerBase.map((r) => {
        const base = ledgerBase.find((x) => x.store_id === r.store_id && x.months_ago === 1)
        return base ? { ...base, months_ago: r.months_ago } : r
      })
    : ledgerBase
  const target = world?.target ?? planes.target

  // The ledger, newest-first per store, merged when the lens spans stores.
  const ledger = Array.from({ length: LEDGER_MONTHS }, (_, ago) => {
    const rows = ledgerPlane.filter((r) => r.months_ago === ago)
    const base = rows[0]
    if (!base) return null
    if (rows.length === 1) return base
    const weight = rows.reduce((n, r) => n + r.total, 0) || 1
    const mix = (pick: (r: typeof base) => number) => rows.reduce((n, r) => n + pick(r) * r.total, 0) / weight
    return {
      ...base,
      total: rows.reduce((n, r) => n + r.total, 0),
      nw: rows.reduce((n, r) => n + r.nw, 0),
      collected: rows.reduce((n, r) => n + r.collected, 0),
      consumed: rows.reduce((n, r) => n + r.consumed, 0),
      new_count: rows.reduce((n, r) => n + r.new_count, 0),
      existing_count: rows.reduce((n, r) => n + r.existing_count, 0),
      next_rate: mix((r) => r.next_rate),
      repeat_rate: mix((r) => r.repeat_rate),
      util: mix((r) => r.util),
      ltv: mix((r) => r.ltv),
      new_ltv: mix((r) => r.new_ltv),
    }
  })

  // ── TODAY, read off the board's own rows ──────────────────────────────────
  const todaysBookings = appointments.filter((a) => jstDayKey(a.starts_at) === todayKey)
  const boardToday: DayFigures = boardDayFigures(
    todaysBookings,
    customers,
    priorVisitCounts(appointments, todayKey),
  )

  // ── the twelve months as the screen states them ───────────────────────────
  const currentCoords = monthCoords(now, 0, planes.closedWeekday)
  const currentRow = ledger[0]
  const currentRows = currentRow
    ? dailyLedger(currentCoords, monthFigures(currentRow), planes.dowWeight, boardToday)
    : []
  const currentShown = sumDays(currentRows)

  const months = Array.from({ length: LEDGER_MONTHS }, (_, i) => {
    const ago = LEDGER_MONTHS - 1 - i // chronological: oldest first
    const coords = monthCoords(now, ago, planes.closedWeekday)
    const row = ledger[ago]
    const shown: DayFigures = ago === 0 ? currentShown : row ? monthFigures(row) : { total: 0, nw: 0, collected: 0, consumed: 0, newCount: 0, existingCount: 0 }
    const at = monthAt(coords.y, coords.m)
    return {
      monthsAgo: ago,
      coords,
      row,
      shown,
      label: fmtMonth.format(at),
      short: fmtMonthShort.format(at),
      partial: ago === 0,
    }
  })

  const selected = months.find((m) => m.monthsAgo === monthsAgo) ?? months[months.length - 1]
  const selectedCoords = selected.coords
  const selectedRow = selected.row
  const selectedFigures = selectedRow
    ? monthFigures(selectedRow)
    : { total: 0, nw: 0, collected: 0, consumed: 0, newCount: 0, existingCount: 0 }
  const selectedRows = selected.partial
    ? currentRows
    : dailyLedger(selectedCoords, selectedFigures, planes.dowWeight, null)
  const shown = selected.partial ? currentShown : sumDays(selectedRows)

  // ── the like-for-like comparison ──────────────────────────────────────────
  const spanDays = selected.partial ? selectedCoords.elapsedDays : selectedCoords.daysInMonth
  const priorAgo = selected.monthsAgo + 1
  const priorRow = ledger[priorAgo]
  const priorCoords = monthCoords(now, priorAgo, planes.closedWeekday)
  const prior = priorRow
    ? spanFigures(priorCoords, monthFigures(priorRow), planes.dowWeight, spanDays)
    : null
  const priorLabelShort = fmtMonthShort.format(monthAt(priorCoords.y, priorCoords.m))
  /** ⚖ ONE PERCENTAGE-CHANGE IMPLEMENTATION (L2 B2-8). This used to run through
   *  a second, private `deltaLabel` that spelled the same idea differently
   *  (`+/−/±` against `▲/▼`) and disagreed about a zero baseline — so the
   *  dictionary's 「the ONE place it is computed」 was not true. `spanCompare` is
   *  a money comparison, so it reads in percent, from `monthDelta`. */
  const spanCmp = prior
    ? monthDelta(shown.total, prior.figures.total, 'yen')
    : ({ kind: 'na', text: '—' } as const)
  const spanDelta = spanCmp.kind === 'na' ? null : spanCmp.text
  const spanDeltaSign =
    spanCmp.kind === 'na' ? null : spanCmp.kind === 'up' ? 1 : spanCmp.kind === 'down' ? -1 : 0
  // WHICH SENTENCE IS TRUE HERE — whole-to-whole only when the month being
  // viewed is FINISHED and the previous month was not clamped. ⚠ THIS ONE
  // PREDICATE DECIDES EVERY 「同じ経過日数」 WORD: the comparison sentence, the
  // tile's footer, the tile's CHIP LABEL and the decide line all read it, so
  // the decision header cannot state one number under three descriptions
  // (L1 B1-2 · L2 B2-1).
  const wholeMonths = !selected.partial && prior !== null && prior.span === priorCoords.daysInMonth
  const comparison = !priorRow
    ? `${LEDGER_MONTHS}か月より前の実績がないため、前月と並べていません。`
    : prior && prior.figures.total > 0 && spanDelta
      ? wholeMonths
        ? `${selected.short}全体は前月（${priorLabelShort}全体 ${yen(prior.figures.total)}）との比較で ${spanDelta} — 月全体どうしの比較です。`
        : `比較は同じ経過日数どうし — ${priorLabelShort}1日〜${prior.span}日の ${yen(prior.figures.total)} に対して ${spanDelta}（月全体どうしの比較ではありません）。`
      : `${priorLabelShort}の同じ期間に実績がないため、比較できません。`
  /** The same branch, as the TILE's own short footer (§2.2 tile 1). */
  const compareFoot = !priorRow
    ? `${LEDGER_MONTHS}か月より前の実績がないため、前月と並べていません`
    : prior && prior.figures.total > 0 && spanDelta
      ? wholeMonths
        ? `前月（${priorLabelShort}全体 ${yen(prior.figures.total)}）と比較`
        : `${priorLabelShort}1日〜${prior.span}日の ${yen(prior.figures.total)} と比較`
      : `${priorLabelShort}の同じ期間に実績がないため、比較できません`

  const SUBTITLE = '総合・新規・回収・消化・稼働をひとつの画面で確認し、最初に見るべき数字を先に示します'
  const spanWord = `${selected.short}1日〜${spanDays}日`
  const asOf = selected.partial ? `・${selected.short}${today.d}日時点` : ''
  const periodWord = selected.partial ? '今月' : selected.short
  /** THE MONTH'S STATE, IN ONE SENTENCE — the retired attention strip's own
   *  headline. It now carries the provenance panel's 「{月}の扱い」 row and the
   *  head's tour text; the words did not change, their home did (§2.10 K). */
  const stateHeadline = selected.partial
    ? `${selected.short}は月の途中です（${spanWord}）`
    : `${selected.short}は完了した月です（${spanWord}）`
  const tilePrefix = selected.partial ? '今月の' : `${selected.short}の`

  // ── the target layer (the 集計表's 目標値 / 現状 / 着地 / GAP row) ──────────
  const remainingOpenDays = selected.partial
    ? selectedCoords.openDays.filter((d) => d > today.d).length
    : 0
  const pace = targetProgress(shown.total, target)
  const remaining = targetRemaining(shown.total, target)
  const landing = selected.partial
    ? landingEstimate(shown.total, selectedCoords.elapsedDays, selectedCoords.daysInMonth)
    : shown.total
  const gap = landingGap(landing, target)
  const averageNewTicket = avgNewTicket(shown.nw, shown.newCount)
  const settingsHref = `/${locale}/business/settings${storeQuery}`

  // ── 推移 chart + reading ──────────────────────────────────────────────────
  const chart = chartModel(
    months.map((m) => ({ short: m.short, total: m.shown.total, nw: m.shown.nw, partial: m.partial })),
    target,
  )
  const finished = months.filter((m) => !m.partial)
  const first = finished[0]
  const last = finished[finished.length - 1]
  const trendWord = !first || !last || first.shown.total === last.shown.total
    ? '横ばいで推移しています'
    : last.shown.total > first.shown.total
      ? '増減をはさみながら伸びています'
      : '増減をはさみながら落ちています'
  const currentMonth = months[months.length - 1]
  const reading =
    first && last
      ? `総合売上は${first.label}の${yen(first.shown.total)}から直近の完了月${last.short}の${yen(last.shown.total)}まで、${trendWord}。${currentMonth.short}は${currentMonth.short}1日〜${today.d}日時点の実績で、総合売上 ${yen(currentMonth.shown.total)}・新規売上 ${yen(currentMonth.shown.nw)}・新規数 ${currentMonth.shown.newCount}件です（月の途中のため、この行では前月と並べていません）。`
      : '表示できる月の実績がありません。'
  /** ⚖ §2.4 — the ONE derived sentence the chart is for. `lastRank` is the
   *  finished month's placing among the finished months, DERIVED: a callout
   *  that named a month because the mock's fixture peaked there would be wrong
   *  in every store whose best month is a different one. */
  const lastRank = last
    ? finished.filter((m) => m.shown.total > last.shown.total).length + 1
    : null
  const decide = decideLine({
    monthCount: LEDGER_MONTHS,
    lastShort: last?.short ?? null,
    lastTotalText: last ? yen(last.shown.total) : null,
    lastRank,
    currentShort: selected.short,
    currentTotal: shown.total,
    spanDeltaText: spanDelta,
    spanDeltaSign,
    wholeMonths,
  })

  // ── 売上の内訳 ────────────────────────────────────────────────────────────
  const menuName = new Map(menus.map((m) => [m.id, m.name]))
  const menuSegments = composition(shown.total, menuEntries(planes.menuMix, (id) => menuName.get(id)))
  const sourceSegments = composition(shown.total, sourceEntries(planes.sourceMix))
  const liability = ticketLiability(customers, appointments, storeId, planes.ticketUnitPrice)
  /** ⚖ RIDER — TICKET LANGUAGE AS A CAPABILITY (TYPE TIER 1, data presence).
   *  The plane carries no per-business 回数券 dial, so the chips render only
   *  where the world shows a ticket SIGNAL: money consumed this month, or a
   *  customer the lens can see holding a balance. A shop that does not sell
   *  回数券 gets no chips at all — never a 「回数券なし」 chip, which would
   *  name a product it does not have. Registry ⑦. */
  const hasTicketSignal = shown.consumed > 0 || customers.some((c) => c.ticket_balance !== null)

  // ── staff ranking ─────────────────────────────────────────────────────────
  const visibleStaff = new Map(staff.map((s) => [s.id, s.full_name]))
  const mix = planes.staffMix.filter(
    (m) => visibleStaff.has(m.staff_id) && treatsPatients(planes.staffQualifications[m.staff_id]),
  )
  const rankMonths: RankMonth[] = months.map((m) => ({
    short: m.short,
    partial: m.partial,
    total: m.shown.total,
    nw: m.shown.nw,
    consumed: m.shown.consumed,
    ltv: m.row?.ltv ?? 0,
  }))
  const provisional = `${currentMonth.short}1日〜${today.d}日は暫定`
  const ranking = Object.fromEntries(
    RANK_METRICS.map((metric) => {
      const rows = staffRanking(metric, rankMonths, mix, (id) => visibleStaff.get(id) ?? '担当者')
      return [
        metric,
        {
          aggregateLabel: `${LEDGER_MONTHS}か月${RANK_AGGREGATE[metric] === 'avg' ? '平均' : '合計'}（${provisional}）`,
          rows: rows.map((r) => ({
            staffId: r.staffId,
            name: r.name,
            rank: r.rank,
            aggregate: yen(r.aggregate),
            gap: r.rank === 1 ? null : `−${yen(r.gap)}`,
            months: r.months.map((c) => ({ value: yen(c.value), rank: c.rank })),
          })),
        },
      ]
    }),
  ) as RankingByMetric

  // ── the operator's own lane ───────────────────────────────────────────────
  const mineIndex = mix.findIndex((m) => m.staff_id === shell.operator.staff_id)
  const mineWeights = mix.map((m) => m.total)
  const mineNow = mineIndex >= 0 ? distributeInt(shown.total, mineWeights)[mineIndex] : null
  const minePrior = mineIndex >= 0 && prior ? distributeInt(prior.figures.total, mineWeights)[mineIndex] : null
  const mineCmp = monthDelta(mineNow, minePrior, 'yen')
  const bestRepeat = Math.max(...months.map((m) => m.row?.repeat_rate ?? 0))
  const selectedRepeat = selectedRow?.repeat_rate ?? 0
  const ownLane =
    mineIndex >= 0 && mineNow !== null
      ? {
          title: 'スタッフ本人にはこう見えます',
          sub: `${shell.operator.name}・${selected.short}（${spanWord}・自分の実績のみ・他スタッフとの比較なし・自分の過去実績に対する伸びとして表示）`,
          stats: [
            { label: selected.partial ? '今月' : `${selected.short}`, value: yen(mineNow), chip: null },
            {
              label: `前月同期間（${priorLabelShort}1日〜${prior?.span ?? 0}日）`,
              value: minePrior === null || minePrior <= 0 ? '実績なし' : yen(minePrior),
              chip: mineCmp.kind === 'na' ? null : mineCmp.text,
            },
            {
              label: `${numberEntry('repeatRate').label}（店舗全体）`,
              value: pct1(selectedRepeat),
              chip: selectedRepeat > 0 && selectedRepeat >= bestRepeat ? '店舗の自己ベスト' : null,
            },
          ],
          note: 'ランキングは表示されません（コーチング方針）',
        }
      : null

  // ── 月次内訳 table ────────────────────────────────────────────────────────
  const monthHref = (ago: number) =>
    `/${locale}/business/analytics${clamped ? `?store=${encodeURIComponent(storeId!)}&` : '?'}month=${-ago}`

  /** The raw value behind each column, per month — ONE source for the printed
   *  figure AND for the 前月比 tick under it, so a tick can never be the
   *  difference of two numbers the table is not showing. */
  const rawCell = (m: (typeof months)[number], id: NumberId): number => {
    switch (id) {
      case 'total': return m.shown.total
      case 'nw': return m.shown.nw
      case 'collected': return m.shown.collected
      case 'consumed': return m.shown.consumed
      case 'newCount': return m.shown.newCount
      case 'existingCount': return m.shown.existingCount
      case 'nextRate': return m.row?.next_rate ?? 0
      case 'repeatRate': return m.row?.repeat_rate ?? 0
      case 'util': return m.row?.util ?? 0
      case 'ltv': return m.row?.ltv ?? 0
      case 'newLtv': return m.row?.new_ltv ?? 0
      default: return 0
    }
  }
  const fmtCell = (id: NumberId, v: number): string => {
    const unit = numberEntry(id).unit
    if (unit === 'rate') return pct1(v)
    if (unit === 'count') return `${v}件`
    return yen(v)
  }

  const tableRows = months.map((m, i) => {
    const before = i > 0 ? months[i - 1] : null
    return {
      monthsAgo: m.monthsAgo,
      label: m.label,
      tag: m.partial ? `${m.short}${today.d}日時点` : null,
      selected: m.monthsAgo === selected.monthsAgo,
      partial: m.partial,
      href: monthHref(m.monthsAgo),
      cells: TABLE_METRICS.map((c) => fmtCell(c.id, rawCell(m, c.id))),
      // ⚠ THE PARTIAL MONTH IS NEVER COMPARED. Mask honesty at the cell level:
      // half a month beside a whole one is not a fall, and a ▼ there would say
      // it was.
      ticks: TABLE_METRICS.map((c) =>
        m.partial
          ? { kind: 'na' as const, text: '—' }
          : monthDelta(rawCell(m, c.id), before ? rawCell(before, c.id) : null, numberEntry(c.id).unit),
      ),
    }
  })
  const sum = (pick: (m: (typeof months)[number]) => number) => months.reduce((n, m) => n + pick(m), 0)
  const avg = (pick: (m: (typeof months)[number]) => number) => sum(pick) / months.length
  const stats = TABLE_METRICS.map((c) => {
    const unit = numberEntry(c.id).unit
    const isAvg = unit === 'rate' || c.id === 'ltv' || c.id === 'newLtv'
    const value = isAvg ? avg((m) => rawCell(m, c.id)) : sum((m) => rawCell(m, c.id))
    return { kicker: isAvg ? '平均' : '合計', value: fmtCell(c.id, value) }
  })

  // ── 日報 ──────────────────────────────────────────────────────────────────
  const dailyRows = selectedRows.map((r) => ({
    label: `${selected.short}${r.day}日（${WEEKDAY_WORD[r.wd]}）`,
    closed: r.closed,
    fromBoard: r.fromBoard,
    cells: r.closed
      ? []
      : [
          yen(r.total),
          yen(r.nw),
          yen(r.collected),
          yen(r.consumed),
          `${r.newCount}件`,
          `${r.existingCount}件`,
          pct1(selectedRow?.next_rate ?? 0),
          pct1(selectedRow?.repeat_rate ?? 0),
          pct1(selectedRow?.util ?? 0),
          yen(selectedRow?.ltv ?? 0),
          yen(selectedRow?.new_ltv ?? 0),
        ],
  }))

  // ── the five decision tiles (§2.2) ────────────────────────────────────────
  /** The 着地見込み tile's own step of the 画面の説明 walk. Composed here, ONCE,
   *  because the tile's declaration and the guide map both need it — and the
   *  estimate is the one number on the row that is not a measurement, so it
   *  earns its own explanation (the mock's own bold sentence). */
  const landingGuide = selected.partial
    ? `${numberEntry('landing').label} ${yen(landing)} は推計です。${spanWord}の${numberEntry('total').label} ${yen(shown.total)} ÷ ${selectedCoords.elapsedDays}日 ＝ ${yen1(shown.total / Math.max(1, selectedCoords.elapsedDays))}、× ${selectedCoords.daysInMonth}日（${selected.short}の暦日数）で出しています。${target > 0 ? `目標 ${yen(target)} との差が ${numberEntry('landingGap').label} ${yen(gap)} です。「残り${remainingOpenDays}営業日」は営業日ベース、この推計は暦日ベースです。` : '目標が未設定のため、着地GAPは出せません。'}`
    : `${selected.short}はもう終わった月なので、ここは推計ではなく実際の${numberEntry('total').label} ${yen(shown.total)} です。${target > 0 ? `目標 ${yen(target)} との差は ${yen(gap)} でした。` : '目標が未設定のため、差は出せません。'}`

  const totalEntry = numberEntry('total')
  const nwEntry = numberEntry('nw')
  const newCountEntry = numberEntry('newCount')
  const progressEntry = numberEntry('targetProgress')
  const landingEntry = numberEntry(selected.partial ? 'landing' : 'landingFinal')

  const tiles: TileProps[] = [
    {
      id: 'total',
      prefix: tilePrefix,
      label: totalEntry.label,
      suffix: '',
      scope: selected.partial ? `${spanWord}の合計` : `${selected.short}全体`,
      value: yen(shown.total),
      small: false,
      // ⚠ THE CHIP NAMES THE COMPARISON THE TILE ACTUALLY MADE. It used to
      // carry the literal 「同経過日数比」 on every month — including a finished
      // one, directly above its own footer saying 「前月（7月全体）と比較」 (L1
      // B1-2 · L2 B2-1). `wholeMonths` picks the entry, and the entry supplies
      // the word: 前月同経過日数比 on a partial or truncated comparison, 前月比
      // on a whole month against a whole month.
      chip:
        spanDelta === null
          ? null
          : { text: `${numberEntry(wholeMonths ? 'monthDelta' : 'spanCompare').label} ${spanDelta}`, tone: deltaTone(spanCmp.kind) },
      foot: compareFoot,
      link: null,
      bar: null,
      guide: null,
      calc: null,
    },
    {
      id: 'nw',
      prefix: tilePrefix,
      label: nwEntry.label,
      suffix: '',
      scope: selected.partial ? `${spanWord}の合計` : `${selected.short}全体`,
      value: yen(shown.nw),
      small: false,
      chip: null,
      foot: nwEntry.counts,
      link: null,
      bar: null,
      guide: null,
      calc: null,
    },
    {
      id: 'newCount',
      prefix: tilePrefix,
      label: newCountEntry.label,
      suffix: '',
      scope: selected.partial ? spanWord : `${selected.short}全体`,
      value: `${shown.newCount}件`,
      small: true,
      chip: null,
      foot:
        averageNewTicket === null
          ? `${newCountEntry.counts}まだ新規のご来店がありません。`
          : `${newCountEntry.counts}${numberEntry('avgNewTicket').label} ${yen(averageNewTicket)}`,
      link: null,
      bar: null,
      guide: null,
      calc: null,
    },
    {
      id: 'targetProgress',
      prefix: '',
      label: progressEntry.label,
      suffix: `（${periodWord}）`,
      // ⚠ A STORE WITH NO DIAL NEVER SEES A PERCENTAGE. 0% would be a verdict on
      // a target nobody set, and NaN% would be a bug wearing one.
      scope: target > 0 ? `${numberEntry('target').label} ${yen(target)}` : '',
      value: target > 0 ? `${pace}%` : '目標が未設定です',
      small: target <= 0,
      chip: null,
      foot:
        target <= 0
          ? null
          : selected.partial
            ? `残り${remainingOpenDays}営業日（営業日ベース）・${remaining >= 0 ? `${numberEntry('targetRemaining').label} ${yen(remaining)}` : `目標を ${yen(-remaining)} 上回っています`}`
            : `営業${selectedCoords.openDays.length}日で終了・${remaining >= 0 ? `${numberEntry('targetRemaining').label} ${yen(remaining)}` : `目標を ${yen(-remaining)} 上回っています`}`,
      // ONE TRUTH FOR 目標 (§4): the room READS `planes.target` and points at
      // the room that owns it. Never a second field, never a hardcoded yen.
      link: { href: settingsHref, label: '設定で変更' },
      bar: target > 0 ? Math.min(pace, 100) : null,
      guide: null,
      calc: null,
    },
    {
      // ⚖-ADJ A — A FINISHED MONTH HAS NOTHING TO ESTIMATE. It reads
      // 着地（確定）, its scope says 確定・月全体, its chip is the plain
      // difference from the target, and there is no 計算式 at all: a 推計 badge
      // over a month that is over would be the room lying about what it knows.
      id: selected.partial ? 'landing' : 'landingFinal',
      prefix: tilePrefix,
      label: landingEntry.label,
      suffix: '',
      scope: selected.partial ? `推計・暦日${selectedCoords.daysInMonth}日ベース` : '確定・月全体',
      value: yen(landing),
      small: false,
      // ⚖-ADJ A, AMENDED (Fable, fix round 1): the finished month's chip reads
      // the 着地GAP entry's own word too. One quantity, one name — and the tile
      // label 着地（確定） has already said the month is over, so a second word
      // for the same subtraction bought nothing.
      chip:
        target > 0
          ? {
              text: `${numberEntry('landingGap').label} ${gap > 0 ? `+${yen(gap)}` : yen(gap)}`,
              tone: gap >= 0 ? ('up' as const) : ('gap' as const),
            }
          : null,
      foot: null,
      link: null,
      bar: null,
      // the estimate earns its own step of the walk: it is the one number on
      // the row that is not a measurement.
      guide: { title: landingEntry.label, text: landingGuide },
      calc: selected.partial
        ? {
            title: '着地見込みの出し方（推計）',
            lines: [
              { k: `${spanWord}の${totalEntry.label}`, v: yen(shown.total), result: false },
              { k: `÷ ${selectedCoords.elapsedDays}日 ＝ 1日あたり`, v: yen1(shown.total / Math.max(1, selectedCoords.elapsedDays)), result: false },
              { k: `× ${selectedCoords.daysInMonth}日（${selected.short}の暦日数）`, v: yen(landing), result: false },
              ...(target > 0
                ? [{ k: `− ${numberEntry('target').label} ${yen(target)} ＝ ${numberEntry('landingGap').label}`, v: yen(gap), result: true }]
                : []),
            ],
            notes: [
              `${selectedCoords.elapsedDays}日分のペースをそのまま月末まで延ばした推計です。実績ではありません。`,
              target > 0
                ? `※ 目標進捗の「残り${remainingOpenDays}営業日」は営業日ベース、この推計は暦日ベースです。`
                : '※ 目標が未設定のため、着地GAPは出せません。',
            ],
          }
        : null,
    },
  ]

  // ── the provenance panel, GENERATED from the dictionary (§2.7) ────────────
  /** Every dictionary number this render actually PUT ON THE PAGE. Hand-writing
   *  the list is the defect the panel exists to prevent: a row nobody generated
   *  is a claim about a number the page may not even be showing. */
  const renderedIds: NumberId[] = [
    ...tiles.map((t) => t.id),
    'target',
    'targetRemaining',
    'remainingOpenDays',
    'spanCompare',
    'avgNewTicket',
    ...TABLE_METRICS.map((c) => c.id),
    'monthDelta',
    ...(hasTicketSignal ? (['ticketOutstanding'] as NumberId[]) : []),
  ]
  const provRows = [...new Set(renderedIds)].map((id) => {
    const e = numberEntry(id)
    return {
      id: e.id,
      key: e.alias ? `${e.label}（集計表の「${e.alias}」）` : e.label,
      value: `${e.counts}${e.formula}（${SCOPE_WORD[e.scope]}・出どころ：${e.owner}）`,
    }
  })
  const unconnectedRows = UNCONNECTED_NUMBERS.map((e) => ({
    id: e.id,
    key: e.label,
    value: `${e.counts}未接続：${e.needs}`,
  }))

  const props: AnalyticsProps = {
    denied: null,
    dateline: `サンプルデータ ${spanWord}${asOf ? `（${selected.short}${today.d}日時点）` : ''}`,
    period: {
      label: selected.label,
      prevHref: selected.monthsAgo + 1 < LEDGER_MONTHS && ledger[selected.monthsAgo + 1] ? monthHref(selected.monthsAgo + 1) : null,
      prevTitle:
        selected.monthsAgo + 1 < LEDGER_MONTHS && ledger[selected.monthsAgo + 1]
          ? `${priorLabelShort}を表示`
          : `${LEDGER_MONTHS}か月より前の営業実績がありません`,
      nextHref: selected.monthsAgo > 0 ? monthHref(selected.monthsAgo - 1) : null,
      nextTitle:
        selected.monthsAgo > 0
          ? `${fmtMonthShort.format(monthAt(monthCoords(now, selected.monthsAgo - 1, planes.closedWeekday).y, monthCoords(now, selected.monthsAgo - 1, planes.closedWeekday).m))}を表示`
          : '翌月はまだ営業実績がありません',
    },
    // ⚠SETTINGS-BATCH / registry ③: 年間 and 直近30日 are markup with no
    // behaviour behind them. They ship REFUSED with their reason rather than as
    // switches that flip a pressed state and render nothing (the dead-lever
    // class), and the thumb never travels to a refused option.
    scopes: [
      { key: 'monthly', label: '月間', pressed: true, disabled: false, title: '月単位で表示中' },
      { key: 'yearly', label: '年間', pressed: false, disabled: true, title: REFUSALS.yearly },
      { key: 'last30', label: '直近30日', pressed: false, disabled: true, title: REFUSALS.last30 },
    ],
    exportLabel: '月次パックを書き出す',
    exportRefusal: REFUSALS.export,
    tiles,
    // ⚠ NOTHING ELSE SHIPS. The retired target strip and attention strip were
    // still ASSEMBLED and serialized here while the screen read neither (L1
    // B1-4 · L2 B2-6) — and their words are not lost: the headline and the
    // comparison sentence are the provenance panel's 「{月}の扱い」 row and the
    // head's tour text, the figures line is tiles 1-3, the 平均単価 row is tile
    // 3's footer, and the 目標 trace is tile 4's real link (§2.10 K).
    trend: {
      chartSub: `${months[0].label}〜${currentMonth.label}（直近${LEDGER_MONTHS}か月）・総合売上と新規売上の比較`,
      chart,
      chartMonths: months.map((m) => ({
        label: m.label,
        partial: m.partial,
        asOf: m.partial ? `（${m.short}${today.d}日時点）` : '',
        total: yen(m.shown.total),
        nw: yen(m.shown.nw),
        href: monthHref(m.monthsAgo),
        note: m.partial
          ? `月の途中です（${m.short}${today.d}日時点）。前月と並べていません。`
          // ⚠ WHAT ALWAYS HAPPENS IS THE NAVIGATION (L1 B1-8). The row-open is
          // the desk rung's extra — the rule that opens the viewed row lives
          // inside `@container anpage (min-width: 800px)` — so promising it at
          // a phone width promised something that does not happen there.
          : '押すと下の表のその月へ移動します',
      })),
      gridLabels: chart.gridLines.map((g) => manYen(g.value)),
      targetLabel: target > 0 ? `${numberEntry('target').label} ${yen(target)}` : null,
      barLabels: chart.bars.map((b) => {
        const m = months[b.monthIndex]
        const e = numberEntry(b.series === 'total' ? 'total' : 'nw')
        return `${m.label} ${e.label} ${yen(b.series === 'total' ? m.shown.total : m.shown.nw)}`
      }),
      labelValues: chart.labels.map((l) => yen(l.value)),
      reading,
      decide,
      tableSub: `${lensLabel}・全指標`,
      tableLegend: `前月比：▲ 増えた / ▼ 減った（同じ列の前の月との差）・${currentMonth.short}は月の途中のため前月と並べていません`,
      emptyBefore: `${months[0].label}より前のデータはありません`,
      metrics: TABLE_METRICS.map((c) => ({ ...c, head: numberEntry(c.id).label })),
      rows: tableRows,
      // one は, not two (L2 B2-11): 「…うち9月は9月1日〜3日は暫定値を含む」
      statLabel: `統計（${LEDGER_MONTHS}か月・${currentMonth.short}は1日〜${today.d}日の暫定値を含む）`,
      stats,
      compositionSub: `${selected.label}（${spanWord}）・メニュー別と予約経路別`,
      menuSegments,
      sourceSegments,
      compositionEmpty: `${spanWord}にはまだ売上がないため、内訳を表示できません。`,
      // ⚖ §2.10 K — THE OLD `liability` SENTENCE HAS A NEW HOME, not a deletion:
      // it is these two chips, one figure each, each saying what it counts.
      tickets: hasTicketSignal
        ? [
            {
              // ⚠ THE BALANCE IS AS OF NOW, SO THE DATE IS TODAY'S (L1 B1-3).
              // `ticketLiability` takes no month at all — it counts the 残数 the
              // customers hold at this moment — so welding the SELECTED month's
              // name to today's day-of-month printed 「10月3日時点」 for a figure
              // measured on 9月3日: a date the figure was never read on.
              key: `${numberEntry('ticketOutstanding').label}（${today.m}月${today.d}日時点）`,
              value: yen(liability.amount),
              unit: `${liability.sessions}回分`,
            },
            {
              key: `${numberEntry('consumed').label}（${spanWord}）`,
              value: yen(shown.consumed),
              unit: null,
            },
          ]
        : [],
    },
    ranking: {
      permission: '店舗管理者以上に表示。スタッフ個人には自分の実績のみ表示されます（コーチング目的）。',
      sub: `指標を切り替えると合計・月別ともに再計算されます（${currentMonth.short}は${provisional}のため、${LEDGER_MONTHS}か月合計・平均は${currentMonth.short}分のみ暫定値を含みます）`,
      metrics: RANK_METRICS.map((key) => ({ key, label: RANK_LABEL[key] })),
      byMetric: ranking,
      monthHeads: months.map((m) => ({ short: m.short, tag: m.partial ? `${today.d}日` : null })),
      storeNote:
        storeOptions.length > 1
          ? '店舗ランキングは店舗ごとに表示範囲を分けているため、この画面では表示されません。'
          : '店舗ランキングは2店舗目の追加後に表示されます（単店舗では非表示）。',
      empty: 'この店舗で施術を担当するスタッフが登録されていません。',
      ownLane,
    },
    daily: {
      sub: `${selected.label}${selected.partial ? `1日〜${today.d}日` : ''}・${lensLabel}`,
      heads: ['日付', ...TABLE_METRICS.map((c) => numberEntry(c.id).label)],
      rows: dailyRows,
      trailing: selected.partial ? '以降のデータはありません' : null,
      foot: '次回予約率・リピート率・稼働率・LTV・新規LTVは月次で更新される指標のため、日次では当月の値を据え置いて表示しています。',
      boardNote: dailyRows.some((r) => r.fromBoard)
        ? '「本日」の行は 今日の運営 の当日実績をそのまま読み込んでいます。'
        : null,
    },
    provenance: {
      barLabel: 'この画面の値の設定元 ・ 見本データについて',
      title: 'この画面の値の設定元',
      // ⚖ §2.10 K — the trailing `<p class="footnote">`'s own sentence, in its
      // new home: the panel's lead, where it covers the whole grid rather than
      // being one hand-written row inside it.
      lead: `この画面が出している値の出どころです。まだつないでいないものは「未接続」と書いています。${SOURCE_NOTE}`,
      rows: provRows,
      monthRow: { key: `${selected.short}の扱い`, value: `${stateHeadline}。${comparison}` },
      storeRow: { key: '対象の店舗', value: `${lensLabel}・全指標` },
      unconnectedTitle: '未接続',
      unconnected: unconnectedRows,
      sample: SAMPLE_NOTE,
    },
    guides: {
      head: `${SUBTITLE}。${stateHeadline}。${comparison}`,
      kpis: `いちばん上の5つが、この月の判断に使う数字です。左から 総合売上・新規売上・新規数・目標進捗・着地見込み。${selected.partial ? '月の途中は、経過した日ぶんだけを合計しています。' : 'この月はもう終わっているので、どれも確定した数字です。'}`,
      landing: landingGuide,
      tabs: '推移・ランキング・日報 の3つを切り替えます。右の「内訳を見る」を押すと、推移の中の 売上の内訳 まで一気に移動します。',
      chart: `直近${LEDGER_MONTHS}か月の 総合売上（青）と 新規売上（ピンク）です。${target > 0 ? '点線が月間売上目標。' : ''}斜線の月は途中の月で、まだ月全体ではありません。棒を押すと、その月の表示に切り替わります。`,
      decide: 'グラフから読み取れることを1文にしています。数字を自分で見比べなくても、いまの立ち位置がわかります。',
      table: `${LEDGER_MONTHS}か月ぶんの内訳です。数字の下の ▲▼ は、同じ列の前の月との差。行を押すと、リピート率・稼働率・LTV・新規LTV も開きます。いちばん下の 統計 は${LEDGER_MONTHS}か月の合計と平均です。`,
      mix: 'この月の売上を メニュー別 と 予約経路別 に分けたものです。色の帯か、下のボタンを押すと、その1つだけを強調します。',
      tickets: '回数券の、まだ使われていない残りと、この月に消化されたぶんです。回数券を扱っていない店舗では表示されません。',
      footnote: 'この画面のどの数字が、どこから来ているかの一覧です。まだつないでいないものも「未接続」として並べています。',
      ranking: 'スタッフごとの実績です。指標を切り替えると、合計も月別も計算し直します。スタッフ本人の画面には順位は出ません。',
      daily: 'この月の1日ごとの内訳です。「本日」の行は 今日の運営 の当日実績をそのまま読み込んでいます。',
    },
  }

  return { props, storeKey }
}
