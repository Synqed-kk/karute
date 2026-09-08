// 売上分析 — the room's derivations, in one pure module.
//
// WHY THIS IS NOT IN THE PAGE (the today-board.ts reason): every number on this
// screen has to agree with every other one. The target strip's 今月, the
// attention line's 総合売上, the 推移 table's current-month row, the 日報's
// column sum and the staff ranking's store total are ONE figure rendered five
// times; 日報's 本日 row and the 今日の運営 board's 本日の売上 are ONE sum of
// the same booking rows. That discipline is only checkable if the arithmetic
// can be called on its own, so it lives here and the page composes.
//
// THE MASK-HONESTY PROPERTY (W1A, carried from canon): a month in progress is
// never presented as a finished one. Its figure is the ELAPSED days only, it
// carries the day it was read on, and the only comparison offered against the
// previous month is over an EQUAL number of elapsed days — stated in the copy,
// not left for the reader to assume.
//
// THE MONTH IS A PLAN, THE DAYS ARE ITS DISTRIBUTION. A month row states the
// month's total; the days are spread across the store's OPEN days by canon's
// own largest-remainder distribution, so the days always sum back to the month
// exactly and a 定休日 can never be allocated a yen. TODAY is the one day that
// is not distributed: it is read from the appointment world, which is what
// makes 日報 and the board the same day rather than two stories about it.
//
// Everything here is pure: dates arrive as the render anchor, rows arrive as
// arguments, nothing reads a clock or a module-level fixture.

import { jstDayKey, jstYmd } from './clock'
import type { FixtureAppointment, FixtureCustomer } from './fixtures'
import type { FixtureMix, FixtureMonthlySales, FixtureSourceMix, FixtureStaffMix } from './fixtures-analytics'
import { bookingCategory, customerStoreAffiliation, isEarningVisit } from './today-board'

/** How far back the ledger reaches. The 推移 chart's own window, and the floor
 *  the month nav refuses to walk past. */
export const LEDGER_MONTHS = 12

/** Largest-remainder integer distribution — canon's own (`distributeInt`), and
 *  the reason a segment bar, a daily ledger and a staff column can each be
 *  asserted to sum back to their source EXACTLY. Independent per-cell rounding
 *  is what puts a ¥3 hole in a total nobody can explain. */
export function distributeInt(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0)
  if (sumW <= 0) return weights.map(() => 0)
  const raw = weights.map((w) => (total * w) / sumW)
  const floors = raw.map(Math.floor)
  const used = floors.reduce((a, b) => a + b, 0)
  const remainder = Math.round(total - used)
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < remainder; k += 1) floors[order[k % order.length].i] += 1
  return floors
}

/** The calendar coordinates of one ledger month. `monthsAgo` 0 is the month the
 *  reader is standing in — the only one whose `elapsedDays` is not the whole
 *  month. Weekdays come from a UTC calendar Date built out of Y/M/D, which is a
 *  pure calendar question with no timezone in it. */
export interface MonthCoords {
  y: number
  /** 1-based. */
  m: number
  monthsAgo: number
  daysInMonth: number
  /** 1-based day numbers the store is open (定休日 removed). */
  openDays: number[]
  /** Days of the month that have happened, inclusive of today. */
  elapsedDays: number
  isCurrent: boolean
}

export function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function monthCoords(now: Date, monthsAgo: number, closedWeekday: number): MonthCoords {
  const today = jstYmd(now)
  const absolute = today.y * 12 + (today.m - 1) - monthsAgo
  const y = Math.floor(absolute / 12)
  const m = (absolute % 12) + 1
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const openDays: number[] = []
  for (let d = 1; d <= daysInMonth; d += 1) {
    if (weekdayOf(y, m, d) !== closedWeekday) openDays.push(d)
  }
  const isCurrent = monthsAgo === 0
  return { y, m, monthsAgo, daysInMonth, openDays, elapsedDays: isCurrent ? today.d : daysInMonth, isCurrent }
}

/** What one day of the month earned. `null` on a 定休日: the row says 定休日
 *  rather than a column of ¥0, which would read as a day that opened and sold
 *  nothing. */
export interface DayRow {
  day: number
  wd: number
  closed: boolean
  total: number
  nw: number
  collected: number
  consumed: number
  newCount: number
  existingCount: number
  /** TODAY — read from the appointment world rather than distributed. */
  fromBoard: boolean
}

/** The five money/count figures a day carries. */
export interface DayFigures {
  total: number
  nw: number
  collected: number
  consumed: number
  newCount: number
  existingCount: number
}

const FIGURE_KEYS = ['total', 'nw', 'collected', 'consumed', 'newCount', 'existingCount'] as const

/** A month row as the arithmetic wants it — the fixture's snake_case flattened
 *  to the same five keys a day carries, so one distribution serves both. */
export function monthFigures(row: FixtureMonthlySales): DayFigures {
  return {
    total: row.total,
    nw: row.nw,
    collected: row.collected,
    consumed: row.consumed,
    newCount: row.new_count,
    existingCount: row.existing_count,
  }
}

/** The month spread across its open days. Every figure is distributed with the
 *  same weights, so the day rows sum back to the month figure exactly. */
function spreadMonth(month: MonthCoords, figures: DayFigures, dowWeight: Record<number, number>): DayFigures[] {
  const weights = month.openDays.map((d) => dowWeight[weekdayOf(month.y, month.m, d)] ?? 1)
  const columns = Object.fromEntries(
    FIGURE_KEYS.map((k) => [k, distributeInt(figures[k], weights)]),
  ) as Record<(typeof FIGURE_KEYS)[number], number[]>
  return month.openDays.map((_, i) => ({
    total: columns.total[i],
    nw: columns.nw[i],
    collected: columns.collected[i],
    consumed: columns.consumed[i],
    newCount: columns.newCount[i],
    existingCount: columns.existingCount[i],
  }))
}

/**
 * The 日報 rows for one month, and with them the month's own displayed figures.
 *
 * A finished month shows every day. The month in progress shows only the days
 * that have HAPPENED — the mask-honesty rule in one line — and its TODAY row is
 * `boardToday` rather than a distributed estimate, so 日報 and the 今日の運営
 * board are the same day.
 */
export function dailyLedger(
  month: MonthCoords,
  figures: DayFigures,
  dowWeight: Record<number, number>,
  boardToday: DayFigures | null,
): DayRow[] {
  const spread = spreadMonth(month, figures, dowWeight)
  const byOpenDay = new Map(month.openDays.map((d, i) => [d, spread[i]]))
  const rows: DayRow[] = []
  for (let d = 1; d <= Math.min(month.elapsedDays, month.daysInMonth); d += 1) {
    const wd = weekdayOf(month.y, month.m, d)
    const share = byOpenDay.get(d)
    if (!share) {
      rows.push({ day: d, wd, closed: true, total: 0, nw: 0, collected: 0, consumed: 0, newCount: 0, existingCount: 0, fromBoard: false })
      continue
    }
    const isToday = month.isCurrent && d === month.elapsedDays && boardToday !== null
    rows.push({ day: d, wd, closed: false, ...(isToday ? boardToday : share), fromBoard: isToday })
  }
  return rows
}

/** The month as the screen states it: the sum of the rows it is showing. A
 *  finished month lands back on the fixture's own figure; the month in progress
 *  lands on its elapsed days, today's included at the board's value. */
export function sumDays(rows: DayRow[]): DayFigures {
  return rows.reduce<DayFigures>(
    (acc, r) => ({
      total: acc.total + r.total,
      nw: acc.nw + r.nw,
      collected: acc.collected + r.collected,
      consumed: acc.consumed + r.consumed,
      newCount: acc.newCount + r.newCount,
      existingCount: acc.existingCount + r.existingCount,
    }),
    { total: 0, nw: 0, collected: 0, consumed: 0, newCount: 0, existingCount: 0 },
  )
}

/**
 * The same span of an EARLIER month — the like-for-like half of the comparison.
 *
 * THE HONESTY RULE: the span is the number of days that have elapsed in the
 * month being viewed, so a month that is 22 days old is only ever put beside 22
 * days of the month before it. A shorter previous month is clamped to its own
 * length, and the clamped span is returned so the copy can say which days it
 * actually compared instead of implying a full month.
 */
export function spanFigures(
  month: MonthCoords,
  figures: DayFigures,
  dowWeight: Record<number, number>,
  throughDay: number,
): { span: number; figures: DayFigures } {
  const span = Math.max(0, Math.min(throughDay, month.daysInMonth))
  const spread = spreadMonth(month, figures, dowWeight)
  const rows = month.openDays
    .map((d, i) => ({ d, share: spread[i] }))
    .filter((x) => x.d <= span)
    .map<DayRow>((x) => ({ day: x.d, wd: 0, closed: false, ...x.share, fromBoard: false }))
  return { span, figures: sumDays(rows) }
}

/** What TODAY earned, read off the appointment rows the 今日の運営 board draws.
 *  `isEarningVisit` is the board's OWN predicate, imported rather than
 *  restated — that shared call is the whole reconciliation. */
export function boardDayFigures(
  dayBookings: FixtureAppointment[],
  customers: FixtureCustomer[],
  priorVisits: Map<string, number>,
): DayFigures {
  const customerById = new Map(customers.map((c) => [c.id, c]))
  const earning = dayBookings.filter(isEarningVisit)
  const out: DayFigures = { total: 0, nw: 0, collected: 0, consumed: 0, newCount: 0, existingCount: 0 }
  for (const b of earning) {
    const price = b.booked_price ?? 0
    const customer = customerById.get(b.customer_id)
    // A booking whose customer cannot be resolved is still money the day took;
    // it just cannot be called 新規 or 既存, so it counts as neither.
    const category = customer ? bookingCategory(customer, priorVisits.get(b.customer_id) ?? 0) : null
    out.total += price
    if (category === 'new') { out.nw += price; out.newCount += 1 }
    else if (category !== null) { out.existingCount += 1 }
    if (category === 'ticket') out.consumed += price
    if (b.settlement === 'settled') out.collected += price
  }
  return out
}

/** Completed visits BEFORE a given day, per customer — the input
 *  `bookingCategory` needs to tell 新規 from 再来. Counted off the same rows,
 *  so a customer's first visit is 新規 on the day of it and 既存 after. */
export function priorVisitCounts(all: FixtureAppointment[], beforeDayKey: number): Map<string, number> {
  const counts = new Map<string, number>()
  for (const a of all) {
    if (a.status !== 'done' || jstDayKey(a.starts_at) >= beforeDayKey) continue
    counts.set(a.customer_id, (counts.get(a.customer_id) ?? 0) + 1)
  }
  return counts
}

// ── staff ranking ───────────────────────────────────────────────────────────

export type RankMetric = 'total' | 'consumed' | 'existing' | 'nw' | 'ltv'

export const RANK_LABEL: Record<RankMetric, string> = {
  total: '総合売上',
  consumed: '消化売上',
  existing: '既存顧客売上',
  nw: '新規顧客売上',
  ltv: 'LTV',
}

/** LTV is an AVERAGE of a per-person figure; the other four are sums of money
 *  the person billed. The aggregate column has to say which it is. */
export const RANK_AGGREGATE: Record<RankMetric, 'sum' | 'avg'> = {
  total: 'sum', consumed: 'sum', existing: 'sum', nw: 'sum', ltv: 'avg',
}

/** One month as the ranking reads it. `partial` carries the mask-honesty flag
 *  into the aggregate column's own label. */
export interface RankMonth {
  short: string
  partial: boolean
  total: number
  nw: number
  consumed: number
  ltv: number
}

export interface RankRow {
  staffId: string
  name: string
  rank: number
  aggregate: number
  /** Distance to the leader; 0 on the leader's own row. */
  gap: number
  months: Array<{ value: number; rank: number }>
}

function metricSource(metric: RankMetric, month: RankMonth): number {
  if (metric === 'existing') return month.total - month.nw
  if (metric === 'nw') return month.nw
  if (metric === 'consumed') return month.consumed
  if (metric === 'ltv') return month.ltv
  return month.total
}

/**
 * The ranking table for one metric.
 *
 * Money metrics are DISTRIBUTED off the month's own figure with
 * largest-remainder, so a month's staff column sums back to the store's month
 * exactly — the ranking can never total to something the 推移 table disagrees
 * with. LTV is a multiplier on the store's average instead, because averaging a
 * distributed sum would say something different from what the column is called.
 */
export function staffRanking(
  metric: RankMetric,
  months: RankMonth[],
  mix: FixtureStaffMix[],
  nameOf: (staffId: string) => string,
): RankRow[] {
  if (mix.length === 0) return []
  const weights = mix.map((m) => (metric === 'ltv' ? m.ltv_factor : m[metric]))
  const perMonth = months.map((month) => {
    const source = Math.round(metricSource(metric, month))
    if (metric === 'ltv') return mix.map((m) => Math.round(source * m.ltv_factor))
    return distributeInt(source, weights)
  })

  const rows = mix.map((m, si) => {
    const values = perMonth.map((v) => v[si])
    const sum = values.reduce((a, b) => a + b, 0)
    return {
      mixIndex: si,
      staffId: m.staff_id,
      name: nameOf(m.staff_id),
      // The average is rounded HERE, not at the formatter, so the gap below is
      // the difference between the two figures the table actually prints. Two
      // independently-rounded numbers can disagree by a yen, and a 上位との差
      // that does not equal the subtraction the reader can do in their head is
      // the same defect as a column that does not sum.
      aggregate: RANK_AGGREGATE[metric] === 'avg' ? Math.round(sum / Math.max(months.length, 1)) : sum,
      values,
    }
  })

  // Per-month placings, computed on the SAME values the cells print, so a badge
  // can never disagree with the number it sits next to.
  const monthRanks = perMonth.map((values) =>
    values
      .map((v, si) => ({ si, v }))
      .sort((a, b) => b.v - a.v)
      .reduce<number[]>((acc, o, idx) => { acc[o.si] = idx + 1; return acc }, []),
  )

  const sorted = [...rows].sort((a, b) => b.aggregate - a.aggregate)
  const leader = sorted[0]?.aggregate ?? 0
  return sorted.map((row, idx) => ({
    staffId: row.staffId,
    name: row.name,
    rank: idx + 1,
    aggregate: row.aggregate,
    gap: leader - row.aggregate,
    months: row.values.map((value, mi) => ({ value, rank: monthRanks[mi][row.mixIndex] })),
  }))
}

// ── composition ─────────────────────────────────────────────────────────────

export interface CompSegment {
  label: string
  amount: number
  /** 0–1. */
  share: number
}

/** A stacked bar's segments, distributed off the month's own 総合売上 so they
 *  sum back to the figure the target strip is showing. A month with no money
 *  yet returns zero segments rather than a bar of zero-width slivers — the
 *  screen says so in words instead. */
export function composition(monthTotal: number, entries: Array<{ label: string; weight: number }>): CompSegment[] {
  if (monthTotal <= 0 || entries.length === 0) return []
  const amounts = distributeInt(monthTotal, entries.map((e) => e.weight))
  return entries.map((e, i) => ({ label: e.label, amount: amounts[i], share: amounts[i] / monthTotal }))
}

/** メニュー別 entries, labelled from the menu rows themselves so the bar can
 *  never name a menu the store does not have. A null menu id is the その他
 *  remainder bucket. */
export function menuEntries(
  mix: FixtureMix[],
  menuName: (id: string) => string | undefined,
): Array<{ label: string; weight: number }> {
  return mix.map((m) => ({
    label: m.menu_id === null ? 'その他' : (menuName(m.menu_id) ?? 'メニュー未設定'),
    weight: m.weight,
  }))
}

export function sourceEntries(mix: FixtureSourceMix[]): Array<{ label: string; weight: number }> {
  return mix.map((m) => ({ label: m.label, weight: m.weight }))
}

// ── 回数券 未消化残 ──────────────────────────────────────────────────────────

/**
 * The store's outstanding 回数券 liability, DERIVED rather than stated: the
 * 残数 the 顧客 screen already shows, valued at the store's 基準価格. Storing
 * the yen figure a second time is how it would end up disagreeing with the
 * balances it is made of.
 *
 * Customers carry no store (CM-9), so a customer belongs to the store their
 * most recent booking is in — the same derivation the 顧客 screen uses for the
 * store column. A customer who has never booked anywhere belongs to no store
 * and is out of a store's liability.
 */
export function ticketLiability(
  customers: FixtureCustomer[],
  appointments: FixtureAppointment[],
  storeId: string | null,
  unitPrice: number,
): { sessions: number; amount: number } {
  // The affiliation rule moved to today-board.ts when 受信トレイ needed the same
  // answer for a thread with no booking — one spelling of "which store is this
  // customer's" across the family (A8). Behaviour is unchanged.
  const affiliation = customerStoreAffiliation(appointments)
  const sessions = customers
    .filter((c) => storeId === null || affiliation.get(c.id) === storeId)
    .reduce((n, c) => n + (c.ticket_balance ?? 0), 0)
  return { sessions, amount: sessions * unitPrice }
}

// ── the 推移 chart ───────────────────────────────────────────────────────────

/**
 * The plot box and bar geometry — THE ACCEPTED MOCK'S OWN
 * (ANALYTICS-MOCK-v1.html: `VW 980 · VH 320 · PL 54 · PR 972 · PT 12 · PB 268`,
 * `BW 24 / SW 17 / GAP 7`), computed here so the SVG can be rendered
 * declaratively and every question about it can be asserted without a browser.
 *
 * ⚠ THE TWO BARS ARE DIFFERENT WIDTHS. 総合売上 is the fat one (24) and 新規売上
 * the slim one (17) — the mock's own pair, and the reason the eye reads「how much
 * of the month was new」without a legend. A single `barW` cannot state that.
 */
export const CHART = {
  w: 980,
  h: 320,
  ml: 54,
  mr: 8,
  mt: 12,
  mb: 52,
  /** 総合売上's width. */
  barW: 24,
  /** 新規売上's width. */
  newW: 17,
  pairGap: 7,
  step: 500000,
} as const

export interface ChartBar {
  monthIndex: number
  series: 'total' | 'nw'
  x: number
  y: number
  w: number
  h: number
  /** The month in progress — drawn hatched, never solid (mask honesty). */
  partial: boolean
}

export interface ChartModel {
  /** The top of the y domain. */
  niceMax: number
  gridLines: Array<{ y: number; value: number }>
  bars: ChartBar[]
  axis: Array<{ x: number; short: string; partial: boolean }>
  /** One full-height band per month: the hover/click target and the crosshair's
   *  own x. A month is ONE thing to point at, not two bars. */
  groups: Array<{ monthIndex: number; x: number; w: number; center: number }>
  baselineY: number
  plotTop: number
  /** Where the dashed 目標 rule sits, or `null` when no target is set. */
  targetY: number | null
  /** Selective direct labels — the PEAK finished month's 総合 and the month in
   *  progress's 新規. Placed clear of BOTH bars in the group. */
  labels: Array<{ monthIndex: number; series: 'total' | 'nw'; x: number; y: number; value: number }>
}

/**
 * ⚠ THE DOMAIN HAS TO COVER THE TARGET LINE AS WELL AS THE TALLEST BAR. A
 * domain taken from the bars alone puts the dashed 目標 rule off the top of the
 * plot in every store that is behind its goal — which is precisely the store
 * that needs to see it. The extra step of headroom is so the right-anchored
 * 目標 label clears the top edge rather than sitting half outside it.
 */
export function chartModel(
  months: Array<{ short: string; total: number; nw: number; partial?: boolean }>,
  target = 0,
): ChartModel {
  const plotW = CHART.w - CHART.ml - CHART.mr
  const plotH = CHART.h - CHART.mt - CHART.mb
  const maxBar = months.reduce((n, m) => Math.max(n, m.total, m.nw), 0)
  const ceiling = Math.max(maxBar, target > 0 ? target * 1.06 : 0)
  const niceMax = Math.max(Math.ceil(ceiling / CHART.step) * CHART.step, CHART.step)
  const groupW = plotW / Math.max(months.length, 1)
  const offset = (groupW - (CHART.barW + CHART.pairGap + CHART.newW)) / 2
  const baselineY = CHART.mt + plotH
  const yOf = (v: number) => baselineY - (v / niceMax) * plotH

  const gridLines: ChartModel['gridLines'] = []
  for (let s = 0; s * CHART.step <= niceMax; s += 1) {
    const value = s * CHART.step
    gridLines.push({ y: yOf(value), value })
  }

  // The peak FINISHED month — derived, never a month name written into the
  // code. A callout that said 「8月」 because the mock's fixture peaked in
  // August would be wrong in every store whose best month is not August.
  let peak = -1
  months.forEach((m, i) => {
    if (m.partial) return
    if (peak < 0 || m.total > months[peak].total) peak = i
  })

  const bars: ChartBar[] = []
  const axis: ChartModel['axis'] = []
  const groups: ChartModel['groups'] = []
  const labels: ChartModel['labels'] = []
  months.forEach((m, i) => {
    const partial = m.partial === true
    const groupStart = CHART.ml + i * groupW
    const xTotal = groupStart + offset
    const xNew = xTotal + CHART.barW + CHART.pairGap
    const hTotal = (m.total / niceMax) * plotH
    const hNew = (m.nw / niceMax) * plotH
    bars.push({ monthIndex: i, series: 'total', x: xTotal, y: baselineY - hTotal, w: CHART.barW, h: hTotal, partial })
    bars.push({ monthIndex: i, series: 'nw', x: xNew, y: baselineY - hNew, w: CHART.newW, h: hNew, partial })
    axis.push({ x: groupStart + groupW / 2, short: m.short, partial })
    groups.push({ monthIndex: i, x: groupStart, w: groupW, center: groupStart + groupW / 2 })
    const clear = Math.min(baselineY - hTotal, baselineY - hNew) - 7
    if (i === peak) labels.push({ monthIndex: i, series: 'total', x: xTotal + CHART.barW / 2 + 4, y: clear, value: m.total })
    if (partial) labels.push({ monthIndex: i, series: 'nw', x: xNew + CHART.newW / 2 + 2, y: clear, value: m.nw })
  })
  return {
    niceMax,
    gridLines,
    bars,
    axis,
    groups,
    baselineY,
    plotTop: CHART.mt,
    targetY: target > 0 ? yOf(target) : null,
    labels,
  }
}

/**
 * Where the hover card may sit. THE POPUP LAW in one function: the card is
 * centred on its bar, and then pushed back inside the plot so it always fits
 * whole — canon lets the first and last month's card run past the panel edge,
 * where `.panel { overflow: hidden }` clips it.
 *
 * Returns the LEFT edge in the same pixel space the anchor is given in.
 */
export function clampTooltipLeft(anchorCenter: number, tooltipWidth: number, wrapWidth: number, pad = 8): number {
  const ideal = anchorCenter - tooltipWidth / 2
  const max = wrapWidth - tooltipWidth - pad
  if (max <= pad) return Math.max(pad, (wrapWidth - tooltipWidth) / 2)
  return Math.max(pad, Math.min(ideal, max))
}

/**
 * The other half of the popup law. The card is drawn UPWARD from its `top`
 * (translateY(-100%)), so its visual top edge is `top − height`: over the
 * tallest bar, canon's `barTop − 8` puts that edge above the panel, which
 * clips (`.panel { overflow: hidden }`). Pushing `top` down to at least
 * `height + pad` keeps the whole card inside.
 */
export function clampTooltipTop(anchorTop: number, tooltipHeight: number, wrapHeight: number, pad = 8): number {
  return Math.max(tooltipHeight + pad, Math.min(anchorTop - pad, Math.max(wrapHeight, tooltipHeight + pad)))
}
