/**
 * 売上分析 — the transplanted room's pins.
 *
 * THE ONE THING THIS SUITE IS FOR: this screen's numbers have to agree, with
 * each other and with the rooms next door. A 日報 that says the store took
 * ¥62,700 today over a board that says ¥55,000 is worse than no analytics at
 * all — it teaches the reader to distrust every figure on the page. So most
 * assertions here are EQUALITIES BETWEEN SURFACES, not spot-checks.
 *
 * Second job: the mask-honesty property W1A proved. A month in progress is
 * never shown as a finished one, and the only comparison offered is over an
 * equal number of elapsed days.
 *
 * Third job: the viewing boundary, and the store-isolation law on every list.
 *
 * NOTE ON RENDER SMOKES: react-dom is deliberately OFF territory's import
 * allowlist (business-isolation.test.ts), so a section is smoke-tested by
 * asserting the props the screen is handed for it — the technique the 顧客 and
 * 今日の運営 suites use. The pixels are proven by the deployed real-browser
 * pass in the room's evidence folder.
 */

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import {
  chartModel,
  clampTooltipLeft,
  clampTooltipTop,
  composition,
  dailyLedger,
  distributeInt,
  LEDGER_MONTHS,
  monthCoords,
  monthFigures,
  barPath,
  boardDayFigures,
  priorVisitCounts,
  spanFigures,
  staffRanking,
  sumDays,
  ticketLiability,
  weekdayOf,
  type RankMetric,
  type RankMonth,
} from '@/business/lib/analytics'
import { jstDayKey, jstYmd } from '@/business/lib/clock'
import { appointments, customers, menus, operator, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { analyticsPolicy, dowWeight, salesLedger, salesTargets, staffMix, menuMix, sourceMix } from '@/business/lib/fixtures-analytics'
import { closedWeekday, pricingRule, staffQualifications } from '@/business/lib/fixtures-today'
import { dayTotals, treatsPatients, isEarningVisit } from '@/business/lib/today-board'
import * as data from '@/business/lib/data'
import AnalyticsPage from '@/app/[locale]/(business)/business/analytics/page'
import { AnalyticsScreen, type AnalyticsProps } from '@/app/[locale]/(business)/business/analytics/AnalyticsScreen'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

function serviceStub(fallback: unknown, byTable: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({
    select: () => chain(r),
    eq: () => chain(r),
    maybeSingle: async () => r,
  })
  return { from: (table: string) => chain(table in byTable ? byTable[table] : fallback) }
}

/** The props a page hands its screen — the page returns an element tree and no
 *  renderer is available in territory (see the header). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function propsOf<T>(node: any, screen: unknown): T | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === screen) return node.props as T
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
    const hit = propsOf<T>(kid, screen)
    if (hit) return hit
  }
  return null
}

const room = async (q: { store?: string; month?: string } = {}) =>
  propsOf<AnalyticsProps>(
    await AnalyticsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve(q) }),
    AnalyticsScreen,
  )!

const board = async (store?: string) =>
  propsOf<TodayProps>(
    await TodayPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve(store ? { store } : {}),
    }),
    TodayScreen,
  )!

const yenNumber = (s: string) => Number(s.replace(/[^0-9-]/g, ''))

beforeEach(() => {
  supabase.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
  })
  service.mockReturnValue(
    serviceStub(
      { data: null, error: null },
      {
        business_workspace_grants: { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null },
        profiles: { data: { customer_id: 'biz-1', is_management: false }, error: null },
      },
    ),
  )
})

// ── 1. the ledger holds no impossible state (⚖ 8/9) ─────────────────────────

describe('the settlement ledger is possible', () => {
  it('covers exactly twelve months for every store, once each', () => {
    for (const store of [STORE_A, STORE_B]) {
      const ago = salesLedger.filter((r) => r.store_id === store).map((r) => r.months_ago).sort((a, b) => a - b)
      expect(ago).toEqual(Array.from({ length: LEDGER_MONTHS }, (_, i) => i))
    }
  })

  it('every revenue type is a SUBSET of the month it belongs to, and no count or rate is impossible', () => {
    for (const row of salesLedger) {
      expect(row.total).toBeGreaterThan(0)
      expect(row.nw).toBeLessThanOrEqual(row.total)
      expect(row.collected).toBeLessThanOrEqual(row.total)
      expect(row.consumed).toBeLessThanOrEqual(row.total)
      expect(row.nw).toBeGreaterThanOrEqual(0)
      expect(row.new_count).toBeGreaterThan(0)
      expect(row.existing_count).toBeGreaterThan(0)
      for (const rate of [row.next_rate, row.repeat_rate, row.util]) {
        expect(rate).toBeGreaterThan(0)
        expect(rate).toBeLessThanOrEqual(1)
      }
      // 新規LTV above LTV would say a first-time customer is worth more over a
      // lifetime than a customer is — the impossible state, not a teaching case.
      expect(row.new_ltv).toBeLessThanOrEqual(row.ltv)
    }
  })

  it('every store has a target, and every ranking share names a real practitioner in that store', () => {
    expect(Object.keys(salesTargets).sort()).toEqual([STORE_A, STORE_B].sort())
    for (const m of staffMix) {
      expect(treatsPatients(staffQualifications[m.staff_id])).toBe(true)
      for (const w of [m.total, m.consumed, m.existing, m.nw, m.ltv_factor]) expect(w).toBeGreaterThan(0)
    }
    // Reception is never a candidate — p-09 is 受付・会計 only.
    expect(staffMix.some((m) => m.staff_id === 'p-09')).toBe(false)
  })

  it('every composition slice names a menu the store actually has (or the その他 bucket)', () => {
    const byId = new Map(menus.map((m) => [m.id, m]))
    for (const m of menuMix) {
      expect(m.weight).toBeGreaterThan(0)
      if (m.menu_id === null) continue
      const menu = byId.get(m.menu_id)
      expect(menu).toBeDefined()
      // A 全店舗 menu (store_id null) is legal in any store's mix.
      expect(menu!.store_id === null || menu!.store_id === m.store_id).toBe(true)
    }
    for (const s of sourceMix) expect(s.weight).toBeGreaterThan(0)
  })
})

// ── 2. the distribution is exact ────────────────────────────────────────────

describe('largest-remainder distribution', () => {
  it('always sums back to its source, whatever the weights', () => {
    for (const total of [0, 1, 7, 780000, 1_700_001]) {
      for (const weights of [[1], [1, 1, 1], [42, 24, 16, 18], [1.35, 0.86, 0.92, 1.22, 1.45]]) {
        expect(distributeInt(total, weights).reduce((a, b) => a + b, 0)).toBe(total)
      }
    }
  })

  it('a zero-weight slot is never allocated anything — a 定休日 cannot take money', () => {
    expect(distributeInt(1000, [1, 0, 1])[1]).toBe(0)
    expect(distributeInt(1000, [0, 0, 0])).toEqual([0, 0, 0])
  })
})

// ── 3. the days sum to the month, and the 定休日 is honest ──────────────────

describe('日報 rows', () => {
  const now = new Date()

  it('a FINISHED month distributes to exactly its own figure, and every closed day is marked', () => {
    const coords = monthCoords(now, 1, closedWeekday)
    const row = salesLedger.find((r) => r.store_id === STORE_A && r.months_ago === 1)!
    const rows = dailyLedger(coords, monthFigures(row), dowWeight, null)
    expect(rows).toHaveLength(coords.daysInMonth)
    expect(sumDays(rows)).toEqual(monthFigures(row))
    for (const r of rows) {
      expect(r.closed).toBe(weekdayOf(coords.y, coords.m, r.day) === closedWeekday)
      if (r.closed) expect(r.total).toBe(0)
    }
  })

  it('the month IN PROGRESS shows only the days that have happened', () => {
    const coords = monthCoords(now, 0, closedWeekday)
    const row = salesLedger.find((r) => r.store_id === STORE_A && r.months_ago === 0)!
    const rows = dailyLedger(coords, monthFigures(row), dowWeight, null)
    expect(rows).toHaveLength(jstYmd(now).d)
    expect(rows.every((r) => r.day <= jstYmd(now).d)).toBe(true)
  })

  it("TODAY's row is the board's own day, not a distributed estimate", () => {
    const coords = monthCoords(now, 0, closedWeekday)
    const row = salesLedger.find((r) => r.store_id === STORE_A && r.months_ago === 0)!
    const pinned = { total: 12345, nw: 1, collected: 2, consumed: 3, newCount: 1, existingCount: 2 }
    const rows = dailyLedger(coords, monthFigures(row), dowWeight, pinned)
    const last = rows[rows.length - 1]
    if (!last.closed) {
      expect(last.fromBoard).toBe(true)
      expect(last.total).toBe(12345)
    }
  })
})

// ── 4. THE RECONCILIATION — 日報's 本日 IS the board's 本日 ─────────────────

describe('one fixture world', () => {
  it("日報's 本日 row carries the 今日の運営 board's own 本日の売上, to the yen", async () => {
    const [analytics, todayBoard] = await Promise.all([room({ store: STORE_A }), board(STORE_A)])
    const boardRow = analytics.daily!.rows.find((r) => r.fromBoard)
    // A 定休日 today legitimately has no board row; the assertion below is what
    // proves the pin on every other day, and the guard keeps it honest rather
    // than vacuous.
    const todayIsOpen = weekdayOf(jstYmd(new Date()).y, jstYmd(new Date()).m, jstYmd(new Date()).d) !== closedWeekday
    expect(Boolean(boardRow)).toBe(todayIsOpen)
    if (!boardRow) return
    expect(boardRow.cells[0]).toBe(todayBoard.ops.total)
  })

  it("the board's own sum is what the room read — same rows, same predicate", async () => {
    const todayKey = jstDayKey(new Date())
    const rows = appointments().filter((a) => jstDayKey(a.starts_at) === todayKey && a.store_id === STORE_A)
    const figures = boardDayFigures(rows, customers, priorVisitCounts(appointments(), todayKey))
    expect(figures.total).toBe(dayTotals(rows, 0).total)
    // and the two counts add up to the visits the board counts as earning
    expect(figures.newCount + figures.existingCount).toBeLessThanOrEqual(rows.filter(isEarningVisit).length)
  })

  it('the month figure is ONE number: target strip, attention line and the 推移 row all print it', async () => {
    const p = await room({ store: STORE_A })
    const fromTarget = yenNumber(p.target!.actual)
    const current = p.trend!.rows.find((r) => r.monthsAgo === 0)!
    expect(yenNumber(current.cells[0])).toBe(fromTarget)
    expect(p.attention!.line).toContain(p.target!.actual)
  })

  it('the 日報 column sums back to the month figure the rest of the page shows', async () => {
    const p = await room({ store: STORE_A })
    const summed = p.daily!.rows
      .filter((r) => !r.closed)
      .reduce((n, r) => n + yenNumber(r.cells[0]), 0)
    expect(summed).toBe(yenNumber(p.target!.actual))
  })

  it('every staff column sums back to the store month — a ranking cannot outgrow its own store', async () => {
    const p = await room({ store: STORE_A })
    const rows = p.ranking!.byMetric.total.rows
    const perMonth = p.ranking!.monthHeads.map((_, mi) =>
      rows.reduce((n, r) => n + yenNumber(r.months[mi].value), 0),
    )
    const storeMonths = p.trend!.rows.map((r) => yenNumber(r.cells[0]))
    expect(perMonth).toEqual(storeMonths)
  })

  it("the operator's own-lane figure is the SAME call her ranking cell is — one verdict, two renderings", async () => {
    for (const month of ['0', '-1']) {
      const p = await room({ store: STORE_A, month })
      const lane = p.ranking!.ownLane!
      const mine = p.ranking!.byMetric.total.rows.find((r) => r.name === '見本 あずさ')!
      const mi = p.ranking!.monthHeads.length - 1 - Number(month.replace('-', '') || '0')
      expect(lane.stats[0].value).toBe(mine.months[mi].value)
    }
  })

  it('the 本日 note is only said on a month that actually holds a 本日 row', async () => {
    const back = await room({ store: STORE_A, month: '-1' })
    expect(back.daily!.rows.some((r) => r.fromBoard)).toBe(false)
    expect(back.daily!.boardNote).toBeNull()
    expect(back.daily!.trailing).toBeNull()
  })

  it('回数券 未消化残 is the customers own 残数 at the store 基準価格, never a second stored number', () => {
    const liability = ticketLiability(customers, appointments(), STORE_A, pricingRule.base)
    const affiliated = new Map<string, string>()
    for (const a of [...appointments()].sort((x, y) => y.starts_at.localeCompare(x.starts_at))) {
      if (a.store_id && !affiliated.has(a.customer_id)) affiliated.set(a.customer_id, a.store_id)
    }
    const expected = customers
      .filter((c) => affiliated.get(c.id) === STORE_A)
      .reduce((n, c) => n + (c.ticket_balance ?? 0), 0)
    expect(liability.sessions).toBe(expected)
    expect(liability.amount).toBe(expected * pricingRule.base)
  })
})

// ── 5. MASK HONESTY (W1A) ───────────────────────────────────────────────────

describe('a month in progress is never shown as a finished one', () => {
  it('the current month prints its ELAPSED days, tagged with the day it was read on', async () => {
    const p = await room({ store: STORE_A })
    const plan = salesLedger.find((r) => r.store_id === STORE_A && r.months_ago === 0)!
    const shown = yenNumber(p.target!.actual)
    const d = jstYmd(new Date()).d
    const coords = monthCoords(new Date(), 0, closedWeekday)
    // TWO reasons this could read low — fewer days shown, or today's pin
    // coming in under its distributed share — so the day count is asserted
    // separately. A pin that can be true for two reasons is not a pin.
    expect(p.daily!.rows).toHaveLength(d)
    if (d < coords.daysInMonth) expect(shown).toBeLessThan(plan.total)
    const current = p.trend!.rows.find((r) => r.monthsAgo === 0)!
    expect(current.tag).toContain(`${d}日時点`)
    expect(p.attention!.headline).toContain('月の途中です')
    expect(p.dateline).toContain(`${d}日`)
  })

  it('the comparison is over an EQUAL span, and says so', async () => {
    const p = await room({ store: STORE_A })
    const d = jstYmd(new Date()).d
    expect(p.attention!.comparison).toContain('同じ経過日数')
    expect(p.attention!.comparison).toContain('月全体どうしの比較ではありません')
    expect(p.attention!.comparison).toContain(`1日〜${d}日`)
  })

  it('the previous month is read over the SAME span, not its whole self', () => {
    const coords = monthCoords(new Date(), 1, closedWeekday)
    const row = salesLedger.find((r) => r.store_id === STORE_A && r.months_ago === 1)!
    const partial = spanFigures(coords, monthFigures(row), dowWeight, 10)
    const whole = spanFigures(coords, monthFigures(row), dowWeight, 99)
    expect(partial.span).toBe(10)
    expect(partial.figures.total).toBeLessThan(whole.figures.total)
    // A span longer than the month clamps to the month, and says the clamped
    // number — the copy must not claim to have compared 31 days of a 30-day
    // month.
    expect(whole.span).toBe(coords.daysInMonth)
    expect(whole.figures.total).toBe(row.total)
  })

  it('a FINISHED month says it is finished, and compares whole month to whole span', async () => {
    const p = await room({ store: STORE_A, month: '-1' })
    expect(p.attention!.headline).toContain('完了した月です')
    expect(p.trend!.rows.find((r) => r.monthsAgo === 1)!.selected).toBe(true)
    const row = salesLedger.find((r) => r.store_id === STORE_A && r.months_ago === 1)!
    expect(yenNumber(p.target!.actual)).toBe(row.total)
  })
})

// ── 6. the month nav is a real lever ────────────────────────────────────────

describe('the month nav', () => {
  it('moves the whole period — label, dateline, 日報 and the selected row', async () => {
    const now = await room({ store: STORE_A })
    const back = await room({ store: STORE_A, month: '-1' })
    expect(back.period!.label).not.toBe(now.period!.label)
    expect(back.dateline).not.toBe(now.dateline)
    expect(back.daily!.rows.length).toBeGreaterThan(now.daily!.rows.length)
    expect(back.trend!.rows.find((r) => r.selected)!.monthsAgo).toBe(1)
    expect(now.trend!.rows.find((r) => r.selected)!.monthsAgo).toBe(0)
  })

  it('refuses the future and the pre-ledger past WITH A REASON, never silently', async () => {
    const now = await room({ store: STORE_A })
    expect(now.period!.nextHref).toBeNull()
    expect(now.period!.nextTitle).toContain('翌月はまだ営業実績がありません')
    expect(now.period!.prevHref).not.toBeNull()

    const oldest = await room({ store: STORE_A, month: `-${LEDGER_MONTHS - 1}` })
    expect(oldest.period!.prevHref).toBeNull()
    expect(oldest.period!.prevTitle).toContain('より前の営業実績がありません')
    expect(oldest.period!.nextHref).not.toBeNull()
  })

  it('an out-of-range or junk ?month= lands on a real month rather than erroring', async () => {
    for (const month of ['-99', '5', 'abc', '']) {
      const p = await room({ store: STORE_A, month })
      expect(p.period!.label).toBeTruthy()
      expect(p.daily!.rows.length).toBeGreaterThan(0)
    }
  })

  it('the month link carries the store lens with it', async () => {
    const p = await room({ store: STORE_B })
    expect(p.period!.prevHref).toContain(`store=${STORE_B}`)
  })
})

// ── 7. no dead levers ───────────────────────────────────────────────────────

describe('every control does something, or refuses out loud', () => {
  it('the 表示範囲 scopes that cannot act are DISABLED with their reason, never pressable no-ops', async () => {
    const p = await room({ store: STORE_A })
    const live = p.scopes!.filter((s) => !s.disabled)
    expect(live).toHaveLength(1)
    expect(live[0].pressed).toBe(true)
    for (const s of p.scopes!.filter((s) => s.disabled)) {
      expect(s.pressed).toBe(false)
      expect(s.title.length).toBeGreaterThan(0)
    }
  })

  it('the 指標 switch really re-sorts — five metrics, five different readings', async () => {
    const p = await room({ store: STORE_A })
    const orders = (['total', 'consumed', 'existing', 'nw', 'ltv'] as RankMetric[]).map((m) =>
      p.ranking!.byMetric[m].rows.map((r) => r.name).join('>'),
    )
    expect(new Set(orders).size).toBeGreaterThan(1)
    for (const m of ['total', 'consumed', 'existing', 'nw'] as RankMetric[]) {
      expect(p.ranking!.byMetric[m].aggregateLabel).toContain('合計')
    }
    expect(p.ranking!.byMetric.ltv.aggregateLabel).toContain('平均')
  })

  it('the 内訳 rows exist for the 内訳 button to reveal', async () => {
    const p = await room({ store: STORE_A })
    expect(p.attention!.whyRows).toHaveLength(2)
    for (const row of p.attention!.whyRows) expect(row.length).toBeGreaterThan(0)
  })

  it('every bar the hover card can be raised on has a label behind it', async () => {
    const p = await room({ store: STORE_A })
    expect(p.trend!.chart.bars).toHaveLength(p.trend!.chartMonths.length * 2)
    expect(p.trend!.barLabels).toHaveLength(p.trend!.chart.bars.length)
    for (const label of p.trend!.barLabels) expect(label).toMatch(/売上/)
  })
})

// ── 8. THE VIEWING BOUNDARY ─────────────────────────────────────────────────

describe('the viewing boundary', () => {
  const realRole = operator.role
  afterEach(() => {
    operator.role = realRole
  })

  it('the store dial admits the manager and the owner, and nobody else', () => {
    expect(analyticsPolicy.viewRoles).toContain('店舗管理者')
    expect(analyticsPolicy.viewRoles).toContain('オーナー')
    expect(analyticsPolicy.viewRoles).not.toContain('スタッフ')
    expect(analyticsPolicy.viewRoles).toContain(realRole)
  })

  it('a staff member is handed the refusal, and the workspace is never composed at all', async () => {
    operator.role = 'スタッフ'
    const p = await room({ store: STORE_A })
    expect(p.denied).not.toBeNull()
    expect(p.denied!.message).toContain('権限がありません')
    expect(p.denied!.backHref).toContain('/business/today')
    // Not hidden, not inert — ABSENT. No ledger, no ranking, no staff name.
    expect(p.trend).toBeUndefined()
    expect(p.ranking).toBeUndefined()
    expect(p.daily).toBeUndefined()
    expect(JSON.stringify(p)).not.toContain('見本 はなこ')
  })

  it('a manager is handed the workspace and no refusal', async () => {
    const p = await room({ store: STORE_A })
    expect(p.denied).toBeNull()
    expect(p.ranking!.byMetric.total.rows.length).toBeGreaterThan(0)
    expect(p.trend!.rows).toHaveLength(LEDGER_MONTHS)
  })
})

// ── 9. STORE ISOLATION on every list ────────────────────────────────────────

describe('store isolation', () => {
  it('the door hands a clamped lens nothing from the other store', async () => {
    const planes = await data.readAnalyticsPlanes(STORE_A)
    for (const row of [...planes.ledger, ...planes.staffMix, ...planes.menuMix, ...planes.sourceMix]) {
      expect(row.store_id).toBe(STORE_A)
    }
    expect(planes.target).toBe(salesTargets[STORE_A])
  })

  it("a branch's page never names the other store's people or its takings", async () => {
    const b = await room({ store: STORE_B })
    const names = b.ranking!.byMetric.total.rows.map((r) => r.name)
    // p-01 / p-04 / p-06 work テスト銀座店 only.
    expect(names).not.toContain('見本 はなこ')
    expect(names).not.toContain('見本 しろう')
    expect(names).not.toContain('見本 あずさ')
    expect(JSON.stringify(b)).not.toContain('テスト銀座店')
    const a = await room({ store: STORE_A })
    expect(yenNumber(a.target!.actual)).not.toBe(yenNumber(b.target!.actual))
  })

  it("the operator's own lane only appears in a store she treats in", async () => {
    expect((await room({ store: STORE_A })).ranking!.ownLane).not.toBeNull()
    expect((await room({ store: STORE_B })).ranking!.ownLane).toBeNull()
  })

  it('the own-lane card carries no placing and no colleague — the coaching principle', async () => {
    const lane = (await room({ store: STORE_A })).ranking!.ownLane!
    expect(lane.note).toContain('ランキングは表示されません')
    const text = JSON.stringify(lane)
    for (const other of ['見本 はなこ', '見本 しろう', '見本 ごろう', 'テスト さぶろう']) {
      expect(text).not.toContain(other)
    }
    expect(text).not.toMatch(/順位|位中/)
  })
})

// ── 10. the popup law ───────────────────────────────────────────────────────

describe('the hover card fits whole at every edge', () => {
  const W = 210
  const H = 84

  it('never runs off the left, even centred on the first bar', () => {
    expect(clampTooltipLeft(20, W, 900)).toBeGreaterThanOrEqual(8)
    expect(clampTooltipLeft(0, W, 900)).toBeGreaterThanOrEqual(8)
  })

  it('never runs off the right, even centred on the last bar', () => {
    expect(clampTooltipLeft(890, W, 900) + W).toBeLessThanOrEqual(900)
    expect(clampTooltipLeft(2000, W, 900) + W).toBeLessThanOrEqual(900)
  })

  it('stays centred on its bar when there is room — the clamp only bites at an edge', () => {
    expect(clampTooltipLeft(450, W, 900)).toBe(450 - W / 2)
  })

  it('never runs off the top over the tallest bar', () => {
    // The card is drawn upward from `top`, so its visual top is top − height.
    expect(clampTooltipTop(4, H, 300) - H).toBeGreaterThanOrEqual(0)
    expect(clampTooltipTop(-50, H, 300) - H).toBeGreaterThanOrEqual(0)
  })

  it('sits above its anchor when there is room, and never below the plot', () => {
    expect(clampTooltipTop(200, H, 300)).toBe(192)
    expect(clampTooltipTop(5000, H, 300)).toBeLessThanOrEqual(300)
  })

  it('a viewport narrower than the card still returns a finite position', () => {
    expect(Number.isFinite(clampTooltipLeft(50, W, 100))).toBe(true)
    expect(Number.isFinite(clampTooltipTop(10, H, 40))).toBe(true)
  })
})

// ── 11. the chart's arithmetic ──────────────────────────────────────────────

describe('the 推移 chart', () => {
  const series = [
    { short: '9月', total: 1240000, nw: 545000 },
    { short: '10月', total: 1310000, nw: 560000 },
    { short: '8月', total: 300000, nw: 90000 },
  ]

  it('every bar sits inside the plot box, and the taller month draws the taller bar', () => {
    const model = chartModel(series)
    for (const b of model.bars) {
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y + b.h).toBeLessThanOrEqual(model.baselineY + 0.001)
      expect(b.x).toBeGreaterThanOrEqual(60)
    }
    const totals = model.bars.filter((b) => b.series === 'total')
    expect(totals[1].h).toBeGreaterThan(totals[0].h)
    expect(totals[2].h).toBeLessThan(totals[0].h)
  })

  it('the grid tops the tallest month and starts at zero', () => {
    const model = chartModel(series)
    expect(model.gridLines[0].value).toBe(0)
    expect(model.gridLines[model.gridLines.length - 1].value).toBeGreaterThanOrEqual(1310000)
  })

  it('a zero month draws no bar at all rather than a baseline artefact', () => {
    expect(barPath(10, 10, 22, 0)).toBe('')
    expect(barPath(10, 10, 22, 40)).toContain('M10,50')
  })

  it('an all-zero series still produces a readable axis rather than dividing by zero', () => {
    const model = chartModel([{ short: '1月', total: 0, nw: 0 }])
    expect(model.bars.every((b) => b.h === 0)).toBe(true)
    expect(model.gridLines.length).toBeGreaterThan(1)
  })
})

// ── 12. composition ─────────────────────────────────────────────────────────

describe('売上の内訳', () => {
  it('the segments sum back to the month, to the yen', () => {
    const segs = composition(1_700_000, [{ label: 'a', weight: 42 }, { label: 'b', weight: 24 }, { label: 'c', weight: 16 }, { label: 'その他', weight: 18 }])
    expect(segs.reduce((n, s) => n + s.amount, 0)).toBe(1_700_000)
    expect(segs.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1, 6)
  })

  it('a month with no money says so instead of drawing a bar of slivers', async () => {
    expect(composition(0, [{ label: 'a', weight: 1 }])).toEqual([])
    const p = await room({ store: STORE_A })
    expect(p.trend!.compositionEmpty).toContain('内訳を表示できません')
  })

  it('the page names only menus this store has', async () => {
    const p = await room({ store: STORE_B })
    const labels = p.trend!.menuSegments.map((s) => s.label)
    expect(labels).not.toContain('テスト整体 60分') // a テスト銀座店 menu
    expect(labels).toContain('その他')
  })
})

// ── 13. ranking arithmetic ──────────────────────────────────────────────────

describe('the staff ranking', () => {
  const months: RankMonth[] = [
    { short: '7月', partial: false, total: 1650000, nw: 555000, consumed: 475000, ltv: 47000 },
    { short: '8月', partial: true, total: 400000, nw: 140000, consumed: 110000, ltv: 48500 },
  ]
  const mix = staffMix.filter((m) => m.store_id === STORE_A)
  const nameOf = (id: string) => id

  it('a money metric distributes the store month exactly, month by month', () => {
    for (const metric of ['total', 'consumed', 'existing', 'nw'] as RankMetric[]) {
      const rows = staffRanking(metric, months, mix, nameOf)
      months.forEach((m, mi) => {
        const source = metric === 'existing' ? m.total - m.nw : metric === 'nw' ? m.nw : metric === 'consumed' ? m.consumed : m.total
        expect(rows.reduce((n, r) => n + r.months[mi].value, 0)).toBe(source)
      })
    }
  })

  it('LTV is an AVERAGE of a per-person figure, not a distributed sum', () => {
    const rows = staffRanking('ltv', months, mix, nameOf)
    const top = rows[0]
    expect(top.aggregate).toBeCloseTo((top.months[0].value + top.months[1].value) / 2, 6)
  })

  it('placings agree with the numbers printed beside them', () => {
    const rows = staffRanking('total', months, mix, nameOf)
    months.forEach((_, mi) => {
      const ordered = [...rows].sort((a, b) => b.months[mi].value - a.months[mi].value)
      ordered.forEach((r, idx) => expect(r.months[mi].rank).toBe(idx + 1))
    })
    expect(rows[0].gap).toBe(0)
    expect(rows[rows.length - 1].gap).toBeGreaterThan(0)
  })

  it('an empty roster returns an empty table rather than a broken one', () => {
    expect(staffRanking('total', months, [], nameOf)).toEqual([])
  })
})

// ── 14. the month-start edge, on a pinned clock ─────────────────────────────

describe('the first day of a month', () => {
  const RealDate = Date
  /** Only the zero-argument construction is faked; clock.ts and the month
   *  arithmetic need real `new Date(iso)` AND the statics (`Date.UTC` is what
   *  builds every calendar coordinate), so they are carried across — a stub
   *  without them fails inside the code under test rather than proving
   *  anything about it. */
  function pin(iso: string): () => void {
    const at = new RealDate(iso)
    const stub = function (this: unknown, ...args: unknown[]) {
      return args.length === 0 ? new RealDate(at) : new RealDate(...(args as [string]))
    } as unknown as DateConstructor
    stub.UTC = RealDate.UTC
    stub.parse = RealDate.parse
    stub.now = () => at.getTime()
    globalThis.Date = stub
    return () => {
      globalThis.Date = RealDate
    }
  }

  it('renders one elapsed day sanely — a span of 1, not a blank month', async () => {
    // 2026-09-01 12:00 JST. September 1st 2026 is a Tuesday, so the store is
    // open and the day carries the board's own figures.
    const restore = pin('2026-09-01T03:00:00.000Z')
    try {
      const p = await room({ store: STORE_A })
      expect(p.daily!.rows).toHaveLength(1)
      expect(p.daily!.rows[0].label).toContain('1日')
      expect(p.attention!.headline).toContain('1日〜1日')
      expect(p.dateline).toContain('1日〜1日')
      expect(p.attention!.comparison).toContain('1日〜1日')
      expect(yenNumber(p.target!.actual)).toBeGreaterThanOrEqual(0)
      // The month in progress is a sliver of its own plan, and says so.
      expect(p.trend!.rows.find((r) => r.monthsAgo === 0)!.tag).toContain('1日時点')
    } finally {
      restore()
    }
  })

  it('a first-of-month that is the 定休日 shows the closed day, not an empty table', async () => {
    // 2026-06-01 is a Monday — the store's 定休日.
    const restore = pin('2026-06-01T03:00:00.000Z')
    try {
      expect(closedWeekday).toBe(1)
      const p = await room({ store: STORE_A })
      expect(p.daily!.rows).toHaveLength(1)
      expect(p.daily!.rows[0].closed).toBe(true)
      expect(yenNumber(p.target!.actual)).toBe(0)
      expect(p.trend!.compositionEmpty).toContain('内訳を表示できません')
      expect(p.trend!.menuSegments).toEqual([])
    } finally {
      restore()
    }
  })
})

// ── 15. the calendar helpers ────────────────────────────────────────────────

describe('JST month coordinates', () => {
  it('reads the month in JST, not the server timezone', () => {
    // 2026-08-31T15:30Z is already 00:30 JST on 9/1.
    expect(jstYmd(new Date('2026-08-31T15:30:00.000Z'))).toMatchObject({ y: 2026, m: 9, d: 1 })
    expect(jstYmd(new Date('2026-08-31T14:30:00.000Z'))).toMatchObject({ y: 2026, m: 8, d: 31 })
  })

  it('walks backwards across a year boundary', () => {
    const now = new Date('2026-02-10T03:00:00.000Z')
    expect(monthCoords(now, 0, 1)).toMatchObject({ y: 2026, m: 2, elapsedDays: 10 })
    expect(monthCoords(now, 3, 1)).toMatchObject({ y: 2025, m: 11, daysInMonth: 30 })
    expect(monthCoords(now, 11, 1)).toMatchObject({ y: 2025, m: 3 })
  })

  it('knows February in a leap year and out of one', () => {
    expect(monthCoords(new Date('2028-03-10T03:00:00.000Z'), 1, 1).daysInMonth).toBe(29)
    expect(monthCoords(new Date('2026-03-10T03:00:00.000Z'), 1, 1).daysInMonth).toBe(28)
  })
})
