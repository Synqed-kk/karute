// 売上分析 — the canon screen (fable-store-sales-analytics.html), transplanted
// whole under ⚖ Liam's 8/19 transplant ruling: same structure, same layout,
// same wording, running on PLAY-PHASE FIXTURES.
//
// SERVER COMPONENT ON PURPOSE, like the other three rooms: every read, join,
// sum and date format happens here, so the client receives plain strings and
// numbers. No timezone and no locale can drift between the two renders, and no
// data access exists on the client at all.
//
// THE PAGE BOUNDARY IS RESOLVED HERE, and the screen is handed the ANSWER. A
// staff member without the viewing right never receives the workspace at all —
// not hidden, not inert, ABSENT — which is strictly stronger than canon's
// client-side gate, and it is the only shape that can be true on a server:
// markup that is never rendered cannot be un-hidden. The policy itself
// (fixtures-analytics `analyticsPolicy`) is read HERE and nowhere else; no
// client component sees a role name.
//
// ONE FIXTURE WORLD. 日報's TODAY row is the 今日の運営 board's own day: the
// same booking rows, summed through the board's own `isEarningVisit`. Every
// other figure derives from the settlement ledger (fixtures-analytics), and the
// month's days always sum back to the month.
//
// THE MONTH IS A LINK (`?month=`), not client state — the day nav on 今日の運営
// set that pattern (⚖ Liam 22). One month's data per request, real navigation.

import { requireBusinessAdmission } from '@/business/lib/admission'
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
import { treatsPatients, yen } from '@/business/lib/today-board'
import { AnalyticsScreen, type AnalyticsProps, type RankingByMetric } from './AnalyticsScreen'
import './analytics.css'

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

/** 「+12.4%」 / 「−3.1%」 / 「±0%」 — signed, one decimal, and honest about a
 *  zero baseline (a percentage change from nothing is not a number). */
function deltaLabel(current: number, prior: number): string | null {
  if (prior <= 0) return null
  const pct = ((current - prior) / prior) * 100
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '±'
  return `${sign}${Math.abs(pct).toFixed(1)}%`
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string; month?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  const storeOptions = await listStoreOptions()
  // A missing or unknown ?store= opens on the operator's own store, never the
  // business-wide merge — defaultStoreId owns that rule for every screen.
  const storeId = defaultStoreId(query.store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  const shell = await readShellIdentity()
  const planes = await readAnalyticsPlanes(lens)

  // ── THE BOUNDARY, decided once, from the store's own dial ─────────────────
  // Canon gates the whole room to オーナー / 店舗管理者 and shows a staff member
  // their own lane instead. Denied means the workspace is never composed at
  // all: no ledger read, no staff names, nothing to un-hide.
  const mayView = planes.policy.viewRoles.includes(shell.operator.role)
  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const lensLabel = clamped ? (storeName.get(storeId!) ?? 'この店舗') : 'すべての店舗'
  const storeQuery = clamped ? `?store=${encodeURIComponent(storeId!)}` : '?'
  if (!mayView) {
    return (
      <AnalyticsScreen
        denied={{
          title: '売上分析',
          message:
            'この画面を見る権限がありません。売上分析の閲覧にはオーナーまたは店舗管理者の権限が必要です。権限は管理者にご相談ください。',
          backLabel: '今日の運営に戻る',
          backHref: `/${locale}/business/today${storeQuery === '?' ? '' : storeQuery}`,
        }}
      />
    )
  }

  // ONE CLOCK READ PER RENDER (the cycle-1 law). Every month label, the elapsed
  // span, the day rows and the 本日 pin all derive from this one instant, so a
  // render crossing JST midnight cannot put two different days on one screen.
  const now = renderNow()
  const today = jstYmd(now)
  const todayKey = jstDayKey(now)

  // ?month= is an OFFSET back from the current month, clamped to the ledger.
  // Unparseable falls back to the current month rather than erroring: the month
  // is a view preference, exactly like ?day= on the board.
  const requested = Number.parseInt(query.month ?? '0', 10)
  const monthsAgo = Number.isFinite(requested) ? Math.max(0, Math.min(LEDGER_MONTHS - 1, -requested)) : 0

  const [customers, appointments, menus, staff] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens),
    listMenus(lens),
    listStaff(lens),
  ])

  // The ledger, newest-first per store, merged when the lens spans stores.
  // Money and counts add; rates are weighted by the money they describe, so a
  // merged 稼働率 is the stores' real combined figure and not an average of
  // two averages.
  const ledger = Array.from({ length: LEDGER_MONTHS }, (_, ago) => {
    const rows = planes.ledger.filter((r) => r.months_ago === ago)
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
  // A finished month is its own figure. The month in progress is the sum of the
  // days that have HAPPENED, today's at the board's value — the mask-honesty
  // rule, applied once here and read everywhere else.
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
  // THE HONESTY: the span is the days that have elapsed in the month being
  // viewed, and the previous month is only ever read over the SAME span. The
  // copy names both spans, so nothing is left to be assumed.
  const spanDays = selected.partial ? selectedCoords.elapsedDays : selectedCoords.daysInMonth
  const priorAgo = selected.monthsAgo + 1
  const priorRow = ledger[priorAgo]
  const priorCoords = monthCoords(now, priorAgo, planes.closedWeekday)
  const prior = priorRow
    ? spanFigures(priorCoords, monthFigures(priorRow), planes.dowWeight, spanDays)
    : null
  const priorLabelShort = fmtMonthShort.format(monthAt(priorCoords.y, priorCoords.m))
  const spanDelta = prior ? deltaLabel(shown.total, prior.figures.total) : null
  // WHICH SENTENCE IS TRUE HERE. 「同じ経過日数どうし」 and 「月全体どうしの
  // 比較」 are different claims and only one of them can hold at a time, so the
  // copy is chosen by the state rather than printed unconditionally: it is
  // whole-month-to-whole-month only when the month being viewed is FINISHED and
  // the previous month was not clamped. A finished 31-day month beside a 30-day
  // one IS whole-to-whole; a finished 30-day month beside a 31-day one is NOT —
  // its comparand stops at day 30 — and a month in progress never is.
  const wholeMonths = !selected.partial && prior !== null && prior.span === priorCoords.daysInMonth
  const comparison = !priorRow
    ? `${LEDGER_MONTHS}か月より前の実績がないため、前月と並べていません。`
    : prior && prior.figures.total > 0 && spanDelta
      ? wholeMonths
        ? `${selected.short}全体は前月（${priorLabelShort}全体 ${yen(prior.figures.total)}）との比較で ${spanDelta} — 月全体どうしの比較です。`
        : `比較は同じ経過日数どうし — ${priorLabelShort}1日〜${prior.span}日の ${yen(prior.figures.total)} に対して ${spanDelta}（月全体どうしの比較ではありません）。`
      : `${priorLabelShort}の同じ期間に実績がないため、比較できません。`

  const spanWord = `${selected.short}1日〜${spanDays}日`
  const asOf = selected.partial ? `・${selected.short}${today.d}日時点` : ''

  // ── target strip ──────────────────────────────────────────────────────────
  const remainingOpenDays = selected.partial
    ? selectedCoords.openDays.filter((d) => d > today.d).length
    : 0
  const pace = planes.target > 0 ? Math.round((shown.total / planes.target) * 100) : 0

  // ── attention 内訳 ────────────────────────────────────────────────────────
  const averageNewTicket = shown.newCount > 0 ? Math.round(shown.nw / shown.newCount) : null

  // ── 推移 chart + reading ──────────────────────────────────────────────────
  const chart = chartModel(months.map((m) => ({ short: m.short, total: m.shown.total, nw: m.shown.nw })))
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

  // ── 売上の内訳 ────────────────────────────────────────────────────────────
  const menuName = new Map(menus.map((m) => [m.id, m.name]))
  const menuSegments = composition(shown.total, menuEntries(planes.menuMix, (id) => menuName.get(id)))
  const sourceSegments = composition(shown.total, sourceEntries(planes.sourceMix))
  const liability = ticketLiability(customers, appointments, storeId, planes.ticketUnitPrice)

  // ── staff ranking ─────────────────────────────────────────────────────────
  // The mix is clamped twice on purpose: to the roster the LENS can see (store
  // isolation — another store's people never reach the DOM) and to the people
  // who actually treat (資格, via the board's own predicate).
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
  // ⚖ coaching principle: a staff member sees their OWN lane and their own
  // history — never a placing against colleagues. So this card carries her
  // month, her same-span previous month, and the store's rate NAMED as the
  // store's; it carries no rank, and no share of anyone else.
  const mineIndex = mix.findIndex((m) => m.staff_id === shell.operator.staff_id)
  const mineWeights = mix.map((m) => m.total)
  const mineNow = mineIndex >= 0 ? distributeInt(shown.total, mineWeights)[mineIndex] : null
  const minePrior = mineIndex >= 0 && prior ? distributeInt(prior.figures.total, mineWeights)[mineIndex] : null
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
              chip: minePrior !== null && minePrior > 0 ? deltaLabel(mineNow, minePrior) : null,
            },
            {
              label: 'リピート率（店舗全体）',
              value: pct1(selectedRepeat),
              chip: selectedRepeat > 0 && selectedRepeat >= bestRepeat ? '店舗の自己ベスト' : null,
            },
          ],
          note: 'ランキングは表示されません（コーチング方針）',
        }
      : null

  // ── 月次内訳 table ────────────────────────────────────────────────────────
  const tableRows = months.map((m) => ({
    monthsAgo: m.monthsAgo,
    label: m.label,
    tag: m.partial ? `${m.short}${today.d}日時点` : null,
    selected: m.monthsAgo === selected.monthsAgo,
    cells: [
      yen(m.shown.total),
      yen(m.shown.nw),
      yen(m.shown.collected),
      yen(m.shown.consumed),
      `${m.shown.newCount}件`,
      `${m.shown.existingCount}件`,
      pct1(m.row?.next_rate ?? 0),
      pct1(m.row?.repeat_rate ?? 0),
      pct1(m.row?.util ?? 0),
      yen(m.row?.ltv ?? 0),
      yen(m.row?.new_ltv ?? 0),
    ],
  }))
  const sum = (pick: (m: (typeof months)[number]) => number) => months.reduce((n, m) => n + pick(m), 0)
  const avg = (pick: (m: (typeof months)[number]) => number) => sum(pick) / months.length
  const statCells = [
    `合計 ${yen(sum((m) => m.shown.total))}`,
    `合計 ${yen(sum((m) => m.shown.nw))}`,
    `合計 ${yen(sum((m) => m.shown.collected))}`,
    `合計 ${yen(sum((m) => m.shown.consumed))}`,
    `合計 ${sum((m) => m.shown.newCount)}件`,
    `合計 ${sum((m) => m.shown.existingCount)}件`,
    `平均 ${pct1(avg((m) => m.row?.next_rate ?? 0))}`,
    `平均 ${pct1(avg((m) => m.row?.repeat_rate ?? 0))}`,
    `平均 ${pct1(avg((m) => m.row?.util ?? 0))}`,
    `平均 ${yen(avg((m) => m.row?.ltv ?? 0))}`,
    `平均 ${yen(avg((m) => m.row?.new_ltv ?? 0))}`,
  ]

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

  const monthHref = (ago: number) =>
    `/${locale}/business/analytics${clamped ? `?store=${encodeURIComponent(storeId!)}&` : '?'}month=${-ago}`

  const props: AnalyticsProps = {
    denied: null,
    lensLabel,
    dateline: `サンプルデータ ${spanWord}${asOf ? `（${selected.short}${today.d}日時点）` : ''}`,
    subtitle: '総合・新規・回収・消化・稼働をひとつの画面で確認し、最初に見るべき数字を先に示します',
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
    // ⚠SETTINGS-BATCH / registry: 年間 and 直近30日 are canon markup with no
    // canon behaviour. They ship REFUSED with their reason rather than as
    // switches that flip a pressed state and render nothing (the dead-lever
    // class), and the scopes themselves are named in the build report for the
    // roadmap batch — never invented here.
    scopes: [
      { key: 'monthly', label: '月間', pressed: true, disabled: false, title: '月単位で表示中' },
      { key: 'yearly', label: '年間', pressed: false, disabled: true, title: `年間表示は${LEDGER_MONTHS}か月を超える実績が必要です` },
      { key: 'last30', label: '直近30日', pressed: false, disabled: true, title: '直近30日表示は準備中です' },
    ],
    target: {
      periodWord: selected.partial ? '今月' : selected.short,
      actual: yen(shown.total),
      goal: yen(planes.target),
      pacePercent: pace,
      paceText: selected.partial
        ? `目標進捗 ${pace}%・残り${remainingOpenDays}営業日`
        : `目標進捗 ${pace}%・営業${selectedCoords.openDays.length}日で終了`,
      trace: '目標は設定で店舗・スタッフ別に変更',
    },
    attention: {
      // Canon paints this strip's heading amber while the month is still
      // running — the one VISUAL cue that says "careful, this is partial",
      // which is the whole point of the room's honesty rule. A finished month
      // has nothing to be careful about, so it takes the indigo info tone.
      tone: selected.partial ? 'amber' : 'indigo',
      headline: selected.partial
        ? `${selected.short}は月の途中です（${spanWord}）`
        : `${selected.short}は完了した月です（${spanWord}）`,
      line: `総合売上 ${yen(shown.total)}・新規売上 ${yen(shown.nw)}・新規数 ${shown.newCount}件（${spanWord}${asOf}）。`,
      comparison,
      whyRows: [
        `新規数 ${shown.newCount}件（${spanWord}）`,
        averageNewTicket === null
          ? `新規売上の平均単価 — 新規のご来店がまだありません（${spanWord}）`
          : `新規売上の平均単価 ${yen(averageNewTicket)}（${spanWord}）`,
      ],
    },
    trend: {
      chartSub: `${months[0].label}〜${currentMonth.label}（直近${LEDGER_MONTHS}か月）・総合売上と新規売上の比較`,
      chart,
      chartMonths: months.map((m) => ({
        label: m.label,
        partial: m.partial,
        asOf: m.partial ? `（${m.short}${today.d}日時点）` : '',
        total: yen(m.shown.total),
        nw: yen(m.shown.nw),
      })),
      gridLabels: chart.gridLines.map((g) => manYen(g.value)),
      barLabels: chart.bars.map((b) => {
        const m = months[b.monthIndex]
        return `${m.label} ${b.series === 'total' ? '総合売上' : '新規売上'} ${yen(b.series === 'total' ? m.shown.total : m.shown.nw)}`
      }),
      labelValues: chart.labels.map((l) => yen(l.value)),
      reading,
      tableSub: `${lensLabel}・全指標`,
      emptyBefore: `${months[0].label}より前のデータはありません`,
      rows: tableRows,
      statLabel: `統計（${LEDGER_MONTHS}か月・うち${currentMonth.short}は${provisional}値を含む）`,
      statCells,
      compositionSub: `${selected.label}（${spanWord}）・メニュー別と予約経路別`,
      menuSegments,
      sourceSegments,
      compositionEmpty: `${spanWord}にはまだ売上がないため、内訳を表示できません。`,
      liability:
        liability.sessions === 0
          ? `回数券 未消化残 なし — 消化売上 ${yen(shown.consumed)}（${spanWord}）`
          : `回数券 未消化残 ${yen(liability.amount)}（${liability.sessions}回分）— 消化売上 ${yen(shown.consumed)}（${spanWord}）`,
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
      rows: dailyRows,
      trailing: selected.partial ? '以降のデータはありません' : null,
      foot: '次回予約率・リピート率・稼働率・LTV・新規LTVは月次で更新される指標のため、日次では当月の値を据え置いて表示しています。',
      // Only on a month that actually holds today's row.
      boardNote: dailyRows.some((r) => r.fromBoard)
        ? '「本日」の行は 今日の運営 の当日実績をそのまま読み込んでいます。'
        : null,
    },
    footnote: 'どの数値も 売上・レジ の精算記録から導出。',
  }

  return <AnalyticsScreen {...props} />
}
