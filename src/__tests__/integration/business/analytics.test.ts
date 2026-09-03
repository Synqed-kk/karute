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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import {
  CHART,
  chartModel,
  clampTooltipLeft,
  clampTooltipTop,
  composition,
  dailyLedger,
  distributeInt,
  LEDGER_MONTHS,
  monthCoords,
  monthFigures,
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
import {
  avgNewTicket,
  decideLine,
  deltaTone,
  landingEstimate,
  landingGap,
  monthDelta,
  numberEntry,
  NUMBERS,
  PLANE_NUMBERS,
  SCOPE_WORD,
  targetProgress,
  targetRemaining,
  UNCONNECTED_NUMBERS,
  type NumberId,
} from '@/business/lib/dictionary'
import { jstDayKey, jstYmd } from '@/business/lib/clock'
import { appointments, customers, menus, operator, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { analyticsPolicy, dowWeight, salesLedger, salesTargets, staffMix, menuMix, sourceMix } from '@/business/lib/fixtures-analytics'
import { closedWeekday, pricingRule, staffQualifications } from '@/business/lib/fixtures-today'
import { dayTotals, treatsPatients, isEarningVisit } from '@/business/lib/today-board'
import * as data from '@/business/lib/data'
import AnalyticsPage from '@/app/[locale]/(business)/business/analytics/page'
import { AnalyticsScreen, type AnalyticsProps } from '@/app/[locale]/(business)/business/analytics/AnalyticsScreen'
import { analyticsProps } from '@/app/[locale]/(business)/business/analytics/analytics-props'
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

/** The room on an OVERRIDE WORLD — the same assembly the route runs, over
 *  inputs this demo plane does not contain (a store with no 目標 dial, a
 *  business that sells no 回数券). Never a class toggle: the REAL derivations
 *  run over different arguments. */
const propsWorld = async (input: Omit<Parameters<typeof analyticsProps>[0], 'locale'>) =>
  (await analyticsProps({ ...input, locale: 'ja' })).props

const board = async (store?: string) =>
  propsOf<TodayProps>(
    await TodayPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve(store ? { store } : {}),
    }),
    TodayScreen,
  )!

const yenNumber = (s: string) => Number(s.replace(/[^0-9-]/g, ''))

/** Pin the render clock. Only the zero-argument construction is faked; clock.ts
 *  and the month arithmetic need real `new Date(iso)` AND the statics
 *  (`Date.UTC` is what builds every calendar coordinate), so they are carried
 *  across — a stub without them fails inside the code under test rather than
 *  proving anything about it. Module scope because two sections need it: the
 *  month-start edges, and the comparison copy (whose wording depends on the
 *  LENGTHS of the month being viewed and the one before it, so it can only be
 *  pinned on a known calendar). */
const RealDate = Date
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

  /**
   * F-1. The pin above runs mix → roster. This one runs ROSTER → MIX, which is
   * the direction a person can disappear in: the ranking's candidate set is
   * `staffMix ∩ roster ∩ treatsPatients`, so a treating, store-assigned
   * practitioner with no `staffMix` row is simply absent from the ranking with
   * every other gate green — and nobody notices, because an absence has no
   * cell to be wrong. A ranking a practitioner is missing from is worse than no
   * ranking: it reads as "you earned nothing".
   */
  it('every practitioner the store roster carries has a ranking row — nobody can silently vanish', async () => {
    for (const store of [STORE_A, STORE_B]) {
      const roster = await data.listStaff(store)
      const treating = roster.filter((s) => treatsPatients(staffQualifications[s.id])).map((s) => s.id).sort()
      const ranked = staffMix.filter((m) => m.store_id === store).map((m) => m.staff_id).sort()
      // an empty candidate set would satisfy the equality for the wrong reason
      expect(treating.length).toBeGreaterThan(0)
      expect(ranked).toEqual(treating)
    }
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

  it('the month figure is ONE number: the tile, the 推移 row and the chart card all print it', async () => {
    // ⚠ THE SURFACES THIS ASSERTS ARE THE ONES THAT RENDER. It used to route
    // through the retired target strip and attention strip, which the screen
    // reads nowhere — so the equality it proved was between two invisible
    // props (L2 B2-6). The chart card's own month figure is added, because the
    // hover card was missing from the dictionary's render map (L1 B1-5).
    const p = await room({ store: STORE_A })
    const tile = yenNumber(p.tiles![0].value)
    const current = p.trend!.rows.find((r) => r.monthsAgo === 0)!
    expect(yenNumber(current.cells[0])).toBe(tile)
    const card = p.trend!.chartMonths[p.trend!.chartMonths.length - 1]
    expect(card.partial).toBe(true)
    expect(yenNumber(card.total)).toBe(tile)
  })

  it('the 日報 column sums back to the month figure the rest of the page shows', async () => {
    const p = await room({ store: STORE_A })
    const summed = p.daily!.rows
      .filter((r) => !r.closed)
      .reduce((n, r) => n + yenNumber(r.cells[0]), 0)
    expect(summed).toBe(yenNumber(p.tiles![0].value))
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

  /**
   * D-D, at the page level. Every yen the reader sees is a whole yen — not just
   * the ranking's average, but the 統計 row's averages and any figure a merged
   * lens weights. テスト代官山店's 12-month LTV average is 32,841.666…, so the
   * fixture genuinely forces a fraction and this cannot be green by luck.
   */
  it('no figure on the page prints a fraction of a yen, except the ONE named rate', async () => {
    const raw = salesLedger.filter((r) => r.store_id === STORE_B).reduce((n, r) => n + r.ltv, 0) / LEDGER_MONTHS
    expect(Number.isInteger(raw)).toBe(false)
    const p = await room({ store: STORE_B })
    const figures = JSON.stringify(p).match(/¥[\d,]+(?:\.\d+)?/g) ?? []
    expect(figures.length).toBeGreaterThan(50)
    // ⚠ THE EXCEPTION IS NAMED AND IT IS A RATE, NOT A TAKING: the 計算式's
    // 「÷ N日 ＝ 1日あたり」 line, the accepted mock's own 「¥56,749.5」. Rounding
    // it to a whole yen would make the formula stop reproducing the very figure
    // it explains (¥56,750 × 30 is not the landing the tile prints), which is a
    // worse lie than a decimal. It is the ONLY fractional figure on the page.
    const perDay = p.tiles!.find((t) => t.calc)!.calc!.lines[1].v
    expect(new Set(figures.filter((s) => s.includes('.')))).toEqual(new Set([perDay]))
    // a FINISHED month has no 計算式 at all, so it has no fraction anywhere
    const done = await room({ store: STORE_B, month: '-1' })
    const doneFigures = JSON.stringify(done).match(/¥[\d,]+(?:\.\d+)?/g) ?? []
    expect(doneFigures.filter((s) => s.includes('.'))).toEqual([])
  })
})

// ── 5. MASK HONESTY (W1A) ───────────────────────────────────────────────────

describe('a month in progress is never shown as a finished one', () => {
  // Every claim in this section reads the month in progress against the one
  // before it, and the comparison sentence names the PREVIOUS month's span —
  // `1日〜${min(今日, 前月の日数)}日` (page.tsx builds it off spanFigures, which
  // clamps to the comparand's own length). The day the assertion below computes
  // off the clock is therefore absent from the sentence whenever today has run
  // past the previous month's end: on 2026-12-31 the copy reads 「11月1日〜30日」
  // against an expected 「1日〜31日」, and the same holds every 3/29–31, 5/31,
  // 7/31, 10/31 and 12/31. (It also takes a different branch entirely on a 1st
  // whose comparand day is the 定休日 — 2027-04-01 over a Monday 3月1日 — which
  // says 「実績がないため、比較できません」 and names no span at all.) The section
  // reads the clock once per render, so it is pinned once here rather than per
  // assertion — same pin()/restore() idiom, same anchor its sibling sections
  // already use. The nested 'comparison sentence' block below keeps its own
  // pin: it lands on the same date for a different reason (three month-length
  // states, documented there) and must not silently follow this one.
  let restore = () => {}
  beforeEach(() => {
    restore = pin('2026-08-22T03:00:00.000Z')
  })
  afterEach(() => restore())

  it('the current month prints its ELAPSED days, tagged with the day it was read on', async () => {
    const p = await room({ store: STORE_A })
    const plan = salesLedger.find((r) => r.store_id === STORE_A && r.months_ago === 0)!
    const shown = yenNumber(p.tiles![0].value)
    const d = jstYmd(new Date()).d
    const coords = monthCoords(new Date(), 0, closedWeekday)
    // TWO reasons this could read low — fewer days shown, or today's pin
    // coming in under its distributed share — so the day count is asserted
    // separately. A pin that can be true for two reasons is not a pin.
    expect(p.daily!.rows).toHaveLength(d)
    if (d < coords.daysInMonth) expect(shown).toBeLessThan(plan.total)
    const current = p.trend!.rows.find((r) => r.monthsAgo === 0)!
    expect(current.tag).toContain(`${d}日時点`)
    expect(p.provenance!.monthRow.value).toContain('月の途中です')
    expect(p.dateline).toContain(`${d}日`)
  })

  it('the comparison is over an EQUAL span, and says so', async () => {
    const p = await room({ store: STORE_A })
    const d = jstYmd(new Date()).d
    expect(p.provenance!.monthRow.value).toContain('同じ経過日数')
    expect(p.provenance!.monthRow.value).toContain('月全体どうしの比較ではありません')
    expect(p.provenance!.monthRow.value).toContain(`1日〜${d}日`)
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
    expect(p.provenance!.monthRow.value).toContain('完了した月です')
    expect(p.trend!.rows.find((r) => r.monthsAgo === 1)!.selected).toBe(true)
    const row = salesLedger.find((r) => r.store_id === STORE_A && r.months_ago === 1)!
    expect(yenNumber(p.tiles![0].value)).toBe(row.total)
  })

  /**
   * D-A. The comparison SENTENCE has to be true of the comparison it labels,
   * and 「同じ経過日数どうし」 / 「月全体どうしの比較」 are mutually exclusive
   * claims. Pinned on a known calendar because the wording turns on the LENGTHS
   * of two months: 2026-08-22 gives a partial August, a finished July (31 days)
   * whose predecessor June (30) is read whole, and a finished June (30) whose
   * predecessor May (31) is NOT — three different truths in one clock.
   *
   * Three states, not two, on purpose: a fix that simply keyed the wording off
   * `partial` would pass the first two and lie on the third, so the third is
   * what makes this a pin rather than a restatement of the code.
   */
  describe('the comparison sentence states the comparison it actually made', () => {
    let restore: () => void
    beforeEach(() => {
      restore = pin('2026-08-22T03:00:00.000Z')
    })
    afterEach(() => restore())

    it('a month IN PROGRESS says equal elapsed days, and denies being a whole-month comparison', async () => {
      const p = await room({ store: STORE_A })
      expect(p.provenance!.monthRow.value).toContain('比較は同じ経過日数どうし')
      expect(p.provenance!.monthRow.value).toContain('月全体どうしの比較ではありません')
      expect(p.provenance!.monthRow.value).toContain('7月1日〜22日')
    })

    it('a finished month read against a WHOLE previous month says so, and drops the disclaimer', async () => {
      // 7月 (31 days) vs 6月 (30) — the span clamps to June's own length, so
      // both months are read whole and canon's disclaimer would be false.
      const p = await room({ store: STORE_A, month: '-1' })
      expect(p.provenance!.monthRow.value).toContain('月全体どうしの比較です')
      expect(p.provenance!.monthRow.value).not.toContain('ではありません')
      expect(p.provenance!.monthRow.value).not.toContain('同じ経過日数')
      // both months named, and the previous month's whole figure quoted
      expect(p.provenance!.monthRow.value).toContain('7月')
      expect(p.provenance!.monthRow.value).toContain('6月')
      const june = salesLedger.find((r) => r.store_id === STORE_A && r.months_ago === 2)!
      expect(p.provenance!.monthRow.value).toContain(june.total.toLocaleString('ja-JP'))
    })

    /**
     * ⚖ THE SAME PREDICATE DECIDES THE CHIP, THE FOOTER AND THE DECIDE LINE
     * (L1 B1-2 · B1-7 · L2 B2-1). The chip used to carry the literal
     * 「同経過日数比」 on every month, so a finished month printed it directly
     * above its own footer saying 「前月（7月全体）と比較」 — one number under
     * two contradictory descriptions, and the one the manager reads was the
     * false one. Three month states, because a fix keyed on `partial` alone
     * would pass two of them.
     */
    it('the chip, the footer and the decide line name ONE comparison, in all three month states', async () => {
      const spanWord = numberEntry('spanCompare').label
      const wholeWord = numberEntry('monthDelta').label

      // (1) a month IN PROGRESS — equal elapsed days
      const now = await room({ store: STORE_A })
      expect(now.tiles![0].chip!.text.startsWith(spanWord)).toBe(true)
      expect(now.tiles![0].foot).toContain('1日〜')
      expect(now.trend!.decide).toContain('同じ経過日数で')

      // (2) a FINISHED month against a WHOLE previous month — 前月比, and no
      //     elapsed-day claim anywhere on the decision header
      const whole = await room({ store: STORE_A, month: '-1' })
      expect(whole.tiles![0].chip!.text.startsWith(wholeWord)).toBe(true)
      expect(whole.tiles![0].chip!.text).not.toContain(spanWord)
      expect(whole.tiles![0].foot).toContain('全体')
      expect(whole.trend!.decide).not.toContain('同じ経過日数')
      expect(whole.trend!.decide).toContain('前月と比べて')

      // (3) a finished month whose comparand was TRUNCATED — still equal-span
      const cut = await room({ store: STORE_A, month: '-2' })
      expect(cut.tiles![0].chip!.text.startsWith(spanWord)).toBe(true)
      expect(cut.tiles![0].foot).toContain('1日〜')
      expect(cut.trend!.decide).toContain('同じ経過日数で')
    })

    it('a finished month whose comparand was TRUNCATED keeps the equal-span sentence', async () => {
      // 6月 (30 days) vs 5月 (31) — May is read only to day 30, so this is an
      // equal-span comparison and NOT a whole-month one. The state is
      // 'finished' either way, which is exactly why `partial` alone is not the
      // test the copy may be keyed on.
      const p = await room({ store: STORE_A, month: '-2' })
      expect(p.provenance!.monthRow.value).toContain('完了した月です')
      expect(p.provenance!.monthRow.value).toContain('比較は同じ経過日数どうし')
      expect(p.provenance!.monthRow.value).toContain('月全体どうしの比較ではありません')
      expect(p.provenance!.monthRow.value).toContain('5月1日〜30日')
    })
  })

  /**
   * D-E. The strip's TONE is the same state-awareness in colour: canon paints
   * the heading amber while the month is still running — its one visual
   * "careful, this is partial" cue — and the info indigo once it is finished.
   */
  /**
   * D-E, RE-EXPRESSED ON WHAT RENDERS. The retired amber/indigo strip carried
   * the month's state as a COLOUR, and the strip is gone — so the pin moves to
   * the three surfaces that carry the same state today, rather than to a prop
   * nothing draws (L2 B2-6). Two of the three are visual (the row's own cream
   * wash and its 途中 pill ride `partial`; the tile's scope names the span) and
   * the third is the sentence.
   */
  it('the month IN PROGRESS is marked as such on every surface that states it', async () => {
    const now = await room({ store: STORE_A })
    const nowRow = now.trend!.rows.find((r) => r.monthsAgo === 0)!
    expect(nowRow.partial).toBe(true)
    expect(nowRow.tag).toContain('日時点')
    expect(nowRow.ticks.every((t) => t.kind === 'na')).toBe(true)
    expect(now.tiles![0].scope).toContain('1日〜')
    expect(now.provenance!.monthRow.value).toContain('月の途中です')

    const done = await room({ store: STORE_A, month: '-1' })
    const doneRow = done.trend!.rows.find((r) => r.monthsAgo === 1)!
    expect(doneRow.partial).toBe(false)
    expect(doneRow.tag).toBeNull()
    expect(done.tiles![0].scope).toContain('全体')
    expect(done.provenance!.monthRow.value).toContain('完了した月です')
  })
})

// ── 6. the month nav is a real lever ────────────────────────────────────────

describe('the month nav', () => {
  // 「the month behind shows more rows than this one」 is 前月の日数 > 今日の日,
  // and the 日報 stops at today: 2026-12-31 hands 12月 31 elapsed rows against
  // 11月's 30, and 2026-08-31 ties 31 to 31 — the assertion is strict. Red on
  // the last day of every month at least as long as its predecessor (1/31,
  // 3/28–31, 5/31, 7/31, 8/31, 10/31, 12/31). Pinned once at the section head
  // for the same reason as §5: every test here renders a month relative to now.
  let restore = () => {}
  beforeEach(() => {
    restore = pin('2026-08-22T03:00:00.000Z')
  })
  afterEach(() => restore())

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

  it('the 内訳 button has a card to reveal, and the retired why-rows have their new home', async () => {
    const p = await room({ store: STORE_A })
    // the button scrolls to the 売上の内訳 card, which needs its two mix blocks
    expect(p.trend!.menuSegments.length + p.trend!.sourceSegments.length).toBeGreaterThan(0)
    // …and the panel's two why-rows are tile 3's value and its footer (§2.10 K)
    expect(p.tiles![2].value).toMatch(/^\d+件$/)
    expect(p.tiles![2].foot).toContain('平均単価')
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
    // The last line separates the two stores BY THEIR TAKINGS, so it needs a
    // month that has taken something: on a 1st that is also the 定休日 both
    // stores have earned ¥0 and 0 ≠ 0 is false (2026-06-01, 2027-02-01 and
    // 2027-03-01 are all Monday the 1st). The isolation claims above are true
    // on any clock — it is the discriminator that needs a trading day, so the
    // test is pinned with the file's own single-test idiom (§14).
    const restore = pin('2026-08-22T03:00:00.000Z')
    try {
      const b = await room({ store: STORE_B })
      const names = b.ranking!.byMetric.total.rows.map((r) => r.name)
      // p-01 / p-04 / p-06 work テスト銀座店 only.
      expect(names).not.toContain('見本 はなこ')
      expect(names).not.toContain('見本 しろう')
      expect(names).not.toContain('見本 あずさ')
      expect(JSON.stringify(b)).not.toContain('テスト銀座店')
      const a = await room({ store: STORE_A })
      expect(yenNumber(a.tiles![0].value)).not.toBe(yenNumber(b.tiles![0].value))
    } finally {
      restore()
    }
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
    // The bars are `<rect>`s now (the mock's own shape), so「draws nothing」is a
    // zero HEIGHT rather than an empty path — and the rect still sits ON the
    // baseline rather than one pixel under it.
    const model = chartModel([{ short: '1月', total: 0, nw: 0 }, { short: '2月', total: 900000, nw: 1 }])
    const zeros = model.bars.filter((b) => b.monthIndex === 0)
    expect(zeros).toHaveLength(2)
    for (const b of zeros) {
      expect(b.h).toBe(0)
      expect(b.y).toBe(model.baselineY)
    }
  })

  it('the two series are DIFFERENT widths, and the pair sits inside its own month band', () => {
    const model = chartModel(series)
    const totals = model.bars.filter((b) => b.series === 'total')
    const news = model.bars.filter((b) => b.series === 'nw')
    expect(totals[0].w).toBe(CHART.barW)
    expect(news[0].w).toBe(CHART.newW)
    expect(news[0].w).toBeLessThan(totals[0].w)
    model.groups.forEach((g, i) => {
      expect(totals[i].x).toBeGreaterThanOrEqual(g.x)
      expect(news[i].x + news[i].w).toBeLessThanOrEqual(g.x + g.w + 0.001)
      expect(g.center).toBeCloseTo(g.x + g.w / 2, 6)
    })
  })

  it('the y domain covers the TARGET line as well as the tallest bar', () => {
    // A domain taken from the bars alone runs the 目標 rule off the top of the
    // plot in exactly the store that is behind its goal.
    const behind = [{ short: '1月', total: 400000, nw: 100000 }]
    const model = chartModel(behind, 2_000_000)
    expect(model.niceMax).toBeGreaterThanOrEqual(2_000_000)
    expect(model.targetY).not.toBeNull()
    expect(model.targetY!).toBeGreaterThanOrEqual(model.plotTop)
    expect(model.targetY!).toBeLessThanOrEqual(model.baselineY)
    // …and no target means no line at all, rather than a rule at zero.
    expect(chartModel(behind, 0).targetY).toBeNull()
  })

  it('exactly the month in progress is hatched, and the callout names the DERIVED peak', () => {
    const world = [
      { short: '1月', total: 900000, nw: 200000, partial: false },
      { short: '2月', total: 1_500_000, nw: 300000, partial: false },
      { short: '3月', total: 1_100_000, nw: 250000, partial: false },
      { short: '4月', total: 120000, nw: 40000, partial: true },
    ]
    const model = chartModel(world, 1_000_000)
    expect(model.bars.filter((b) => b.partial)).toHaveLength(2)
    expect(model.bars.filter((b) => b.partial).every((b) => b.monthIndex === 3)).toBe(true)
    expect(model.axis.filter((a) => a.partial).map((a) => a.short)).toEqual(['4月'])
    // 2月 is the peak FINISHED month — not the last one, and not a month name
    // written into the code.
    expect(model.labels.map((l) => [l.monthIndex, l.series])).toEqual([[1, 'total'], [3, 'nw']])
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
    // 「その他 is present」 needs a month with money in it — composition(0, …)
    // is [] by design (the test above pins that), so on a 1st that is the
    // 定休日 there are no segments to name and the assertion goes red
    // (2026-06-01, 2027-02-01, 2027-03-01). Same single-test pin as §9.
    const restore = pin('2026-08-22T03:00:00.000Z')
    try {
      const p = await room({ store: STORE_B })
      const labels = p.trend!.menuSegments.map((s) => s.label)
      expect(labels).not.toContain('テスト整体 60分') // a テスト銀座店 menu
      expect(labels).toContain('その他')
    } finally {
      restore()
    }
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
    expect(top.aggregate).toBe(Math.round((top.months[0].value + top.months[1].value) / 2))
  })

  /**
   * D-D. The yen has no sub-unit, so ¥44,317.5 is not a precise figure, it is a
   * broken one — and the 上位との差 must be the subtraction the reader can do
   * between the two printed aggregates, not a second rounding of its own.
   *
   * The fixture is chosen so the honest average IS fractional (an odd sum over
   * two months): a pin on data that happens to divide evenly would be green for
   * the wrong reason.
   */
  it('the LTV aggregate and the gap beside it are whole yen, and agree with each other', () => {
    const odd: RankMonth[] = [
      { short: '7月', partial: false, total: 1650000, nw: 555000, consumed: 475000, ltv: 47001 },
      { short: '8月', partial: true, total: 400000, nw: 140000, consumed: 110000, ltv: 48502 },
    ]
    const rows = staffRanking('ltv', odd, mix, nameOf)
    // the raw averages this is rounding — at least one of them is genuinely
    // fractional, or the pin proves nothing
    const raws = rows.map((r) => (r.months[0].value + r.months[1].value) / 2)
    expect(raws.some((v) => !Number.isInteger(v))).toBe(true)
    for (const r of rows) {
      expect(Number.isInteger(r.aggregate)).toBe(true)
      expect(Number.isInteger(r.gap)).toBe(true)
      expect(r.gap).toBe(rows[0].aggregate - r.aggregate)
    }
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
  it('renders one elapsed day sanely — a span of 1, not a blank month', async () => {
    // 2026-09-01 12:00 JST. September 1st 2026 is a Tuesday, so the store is
    // open and the day carries the board's own figures.
    const restore = pin('2026-09-01T03:00:00.000Z')
    try {
      const p = await room({ store: STORE_A })
      expect(p.daily!.rows).toHaveLength(1)
      expect(p.daily!.rows[0].label).toContain('1日')
      expect(p.provenance!.monthRow.value).toContain('1日〜1日')
      expect(p.dateline).toContain('1日〜1日')
      expect(p.provenance!.monthRow.value).toContain('1日〜1日')
      expect(yenNumber(p.tiles![0].value)).toBeGreaterThanOrEqual(0)
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
      expect(yenNumber(p.tiles![0].value)).toBe(0)
      expect(p.trend!.compositionEmpty).toContain('内訳を表示できません')
      expect(p.trend!.menuSegments).toEqual([])
    } finally {
      restore()
    }
  })
})

// ── 15. the route sheet stays inside its own room ───────────────────────────

/**
 * D-C and D-B. Two properties of the route stylesheet that no render can prove
 * (react-dom is off territory's import allowlist, so there is no computed
 * style here) and that a browser pass only samples one click-path of — so they
 * are pinned at the SOURCE, which is where the defect lives.
 */
describe('analytics.css', () => {
  const SHEET = 'src/app/[locale]/(business)/business/analytics/analytics.css'
  const CSS = readFileSync(join(process.cwd(), SHEET), 'utf8')

  /**
   * ⚖ FENCE-METHOD AMENDMENT (room-5 lens 3, 8/30): A CSS-RULE PARSER IS ITSELF
   * A PIN THAT CAN LIE. The lane's earlier parser split on '}' and sliced to the
   * first '{', which is BLIND to the first rule of every at-rule block — the
   * media query's own brace is the one it finds — so a bare rule planted first
   * inside an `@media` stayed invisible to it. This one walks the braces: an
   * at-rule PRELUDE is dropped and its body is walked, `@keyframes` and
   * `@font-face` go entirely (so `from`/`to` never read as selectors), and the
   * red-proof below plants exactly the shape the old parser could not see.
   */
  function selectorsOf(src: string): string[] {
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '')
    const out: string[] = []
    let head = ''
    let depth = 0
    let skipTo = -1
    for (let i = 0; i < body.length; i += 1) {
      const c = body[i]
      if (c === '{') {
        const prelude = head.trim()
        head = ''
        depth += 1
        if (skipTo >= 0) continue
        if (prelude.startsWith('@keyframes') || prelude.startsWith('@font-face')) { skipTo = depth; continue }
        if (prelude.startsWith('@')) continue // a conditional group: keep walking its body
        for (const part of prelude.split(',')) {
          const t = part.trim()
          if (t) out.push(t)
        }
        continue
      }
      if (c === '}') {
        depth -= 1
        head = ''
        if (skipTo > depth) skipTo = -1
        continue
      }
      if (skipTo >= 0) continue
      if (c === ';' && depth === 0) { head = ''; continue }
      if (depth === 0 || head || c.trim()) head += c
    }
    return out
  }

  const selectors = selectorsOf(CSS)
  /** The OUTERMOST COMPOUND — everything up to the first descendant combinator,
   *  `.biz` removed. `.page.pg-analytics` is one compound, not two selectors. */
  const outermost = (sel: string) => {
    const first = sel.replace(/^\.biz\b/, '').trim().split(/[\s>+~]+/).filter(Boolean)[0] ?? ''
    return first
  }

  it('the parser can SEE the first rule inside an @media block', () => {
    // RED-PROOF, executed: the plant is the exact shape the old parser missed.
    const planted = selectorsOf('@media (max-width: 800px) {\n  .biz .panel { color: red; }\n}')
    expect(planted).toEqual(['.biz .panel'])
    expect(selectorsOf('@keyframes x { from { opacity: 0 } to { opacity: 1 } }')).toEqual([])
  })

  it('states no selector that another room could match — every rule is under the route class', () => {
    expect(selectors.length).toBeGreaterThan(120)
    // App Router keeps this sheet in the document after a soft navigation, so a
    // rule whose outermost compound is a shared one (`.panel`, `.page`)
    // restyles whichever room the reader walks into next. The route class in
    // the first compound means nothing here can match outside this screen's
    // root — and nothing has to win by insertion order to apply inside it.
    expect(selectors.filter((s) => !outermost(s).includes('.pg-analytics'))).toEqual([])
    // …which by construction means none of the family-shared names is stated
    // bare. Named too, because these are the five another room also defines.
    for (const shared of ['.page', '.panel', '.panel-head', '.subtitle', '.attention']) {
      expect(selectors.filter((s) => outermost(s) === shared)).toEqual([])
    }
  })

  it('every class this sheet owns is prefixed — the structural half of the fence', () => {
    // The neighbours state bare `.biz .<name>` rules on names canon's 売上分析
    // markup used (`.panel`, `.legend`, `.metric`, `.cell`, `.spot-card`). An
    // `an-` name exists nowhere else in the family, so there is no rule to
    // collide with — a fence that cannot rot as the neighbours grow.
    const owned = new Set<string>()
    for (const sel of selectors) {
      for (const cls of sel.match(/\.[A-Za-z][\w-]*/g) ?? []) {
        if (cls === '.biz' || cls === '.page' || cls === '.pg-analytics') continue
        owned.add(cls)
      }
    }
    const foreign = [...owned].filter((c) => !c.startsWith('.an-') && !c.startsWith('.is-'))
    expect(foreign).toEqual([])
  })

  it('the page scrolls and nothing else does — no vertical scroller, no height cap', () => {
    // ⚖ PAGE-SCROLL (Liam 8/22, ruled twice). The mock's own `.scrollarea` is
    // MOCK-ONLY (⚖-ADJ E): a nested scroller here would strand the sticky
    // 統計 row and hide rows inside a box.
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(body).not.toMatch(/max-height\s*:/)
    expect(body).not.toMatch(/overscroll-behavior/)
    // ⚠ THE ONE `overflow-y` IN THE SHEET EXISTS TO REMOVE A SCROLLER, not to
    // add one: `overflow-x: auto` alone computes `overflow-y: auto`, which made
    // the chart strip a nested vertical scroller (found by the probe, not
    // theorised). It is `hidden`, and it is the only one.
    const overflowY = [...body.matchAll(/overflow-y\s*:\s*([a-z]+)/g)].map((m) => m[1])
    expect(overflowY).toEqual(['hidden'])
    // the horizontal panners are named, and they are the only ones
    const panners = [...body.matchAll(/([^{}]+)\{[^}]*overflow-x\s*:\s*auto/g)].map((m) => m[1].trim())
    expect(panners.length).toBeGreaterThan(0)
    for (const p of panners) {
      expect(p).toMatch(/an-kpirow|an-chart-body|an-table-scroll|an-seg\b/)
    }
  })

  it('the root div is the one node carrying the route class', () => {
    const screen = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/analytics/AnalyticsScreen.tsx'),
      'utf8',
    )
    // Both returns — the workspace AND the denied boundary — root on it, or
    // half the room ships unstyled.
    expect(screen.match(/className=\{ROOT\}/g)).toHaveLength(2)
    expect(screen).toMatch(/const ROOT = 'page pg-analytics'/)
  })

  it('the month being viewed is visibly selected — its own wash, not the 統計 row and not the page', () => {
    const ruleFor = (sel: string) => CSS.match(new RegExp(`${sel}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    const bg = (sel: string) => (ruleFor(sel).match(/background:\s*([^;]+);/)?.[1] ?? '').trim()
    const selected = bg('\\.an-trow-body\\.is-sel')
    const totals = bg('\\.an-ttot')
    const partial = (ruleFor('\\.an-trow-body\\.is-partial').match(/background:\s*([^;]+);/)?.[1] ?? '').trim()
    expect(selected).toBeTruthy()
    expect(totals).toBeTruthy()
    expect(partial).toBeTruthy()
    // four-way distinct: the row, the 統計 row, the partial month's own cream,
    // and the white table it all sits in.
    expect(new Set([selected, totals, partial, '#fff']).size).toBe(4)
    // ⚖ R13: the family's selected treatment is a light accent WASH, never a fill.
    expect(selected).toBe('var(--select-bg)')
  })

  /**
   * ⚠ THE BLOCKER'S PIN (L4 B4-1) AND THE 統計 ROW'S (L1 B1-1), AS ONE
   * STRUCTURAL PROPERTY. A shed class is a THREE-PART bargain that has to be
   * struck in ONE place: the rung that HIDES the column is the rung that
   * restacks it into the open row's detail line, and the same rung is where the
   * 統計 row's total takes its own labelled line. The V2 tip struck the first
   * part inside `@container` and the second outside it, so opening a row at a
   * desk width ripped two LIVE columns (既存数, 新規数) out of the grid — and
   * never struck the third at all, so 4–6 totals were invisible above the
   * phone rung while a phone printed all eleven.
   *
   * Written as a BLOCK WALK rather than a selector grep on purpose: what makes
   * the defect impossible is co-location, and a grep for the rules cannot see
   * which `@container` they are in. The mutant is「lift one restack out of its
   * container query」and this is what turns it red.
   */
  it('a shed column is hidden, restacked and totalled by the SAME rung — never one without the others', () => {
    /** The sheet as `@`-blocks: `''` is the top level, otherwise the prelude. */
    const blocksOf = (src: string) => {
      const body = src.replace(/\/\*[\s\S]*?\*\//g, '')
      const out: Record<string, string> = { '': '' }
      let head = ''
      let depth = 0
      let cond = ''
      let start = -1
      for (let i = 0; i < body.length; i += 1) {
        const c = body[i]
        if (c === '{') {
          depth += 1
          if (depth === 1 && head.trim().startsWith('@')) {
            cond = head.trim().replace(/\s+/g, ' ')
            start = i + 1
          } else if (depth === 1) {
            out[''] += `${head.trim()} {`
          }
          head = ''
          continue
        }
        if (c === '}') {
          depth -= 1
          if (depth === 0 && start >= 0) {
            out[cond] = (out[cond] ?? '') + body.slice(start, i)
            cond = ''
            start = -1
          }
          head = ''
          continue
        }
        if (depth === 0) head += c
        else if (start < 0) out[''] += c
      }
      return out
    }
    const blocks = blocksOf(CSS)
    // The top level plus the three container rungs, and nothing else invented.
    expect(Object.keys(blocks)).toContain('@container anpage (max-width: 1035px)')
    expect(Object.keys(blocks)).toContain('@container anpage (max-width: 905px)')

    for (const cls of ['an-always', 'an-sh1', 'an-sh2']) {
      // where the COLUMN is hidden
      const hiding = Object.entries(blocks).filter(([, b]) =>
        new RegExp(`\\.an-trow > \\.${cls}\\s*\\{[^}]*display:\\s*none`).test(b),
      )
      expect(hiding).toHaveLength(1)
      const [rung, block] = hiding[0]
      // …restacks the open row's cell, in the SAME block
      expect(block).toMatch(new RegExp(`\\.an-trow-body\\.is-open > \\.an-cell\\.${cls}\\s*\\{[^}]*grid-column:\\s*1 / -1`))
      expect(block).toMatch(new RegExp(`\\.an-trow-body\\.is-open > \\.an-cell\\.${cls}::before\\s*\\{[^}]*attr\\(data-k\\)`))
      // …and gives the 統計 row's total its own labelled line, in the same block
      // (the `always` totals ride the ≥800 block, which is the same rung: the
      // four are shed at every width and the phone rung has its own chip list).
      const totalIn = cls === 'an-always' ? blocks['@container anpage (min-width: 800px)'] : block
      expect(totalIn).toMatch(new RegExp(`\\.an-trow-tot > \\.an-cell\\.${cls}\\s*\\{[^}]*grid-column:\\s*1 / -1`))
      expect(totalIn).toMatch(new RegExp(`\\.an-trow-tot > \\.an-cell\\.${cls}::before\\s*\\{[^}]*attr\\(data-k\\)`))
      expect(rung).toBe(cls === 'an-always' ? '' : rung)
    }
    // …and the cells that STAY are locked to the first line, so a restacked
    // cell can never drag the ones after it into column 1 (次回予約率's defect).
    expect(blocks['@container anpage (min-width: 800px)']).toMatch(
      /\.an-trow > td:not\(\.an-always\):not\(\.an-sh1\):not\(\.an-sh2\)\s*\{[^}]*grid-row:\s*1/,
    )
  })

  it('every chip tone the tiles can carry has its own look — and the flat one is grey, not green', () => {
    // ⚖ L2 B2-7: `.an-cmp`'s DEFAULT is the red 「down」 look, so a tone with no
    // rule of its own silently inherits it — which is how `flat` was painted
    // green (the old mapping sent 0 to `up`). The tone union is read off the
    // screen's own type, so a tone added there without a look here goes red.
    const screen = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/analytics/AnalyticsScreen.tsx'),
      'utf8',
    )
    const tones = screen
      .match(/chip: \{ text: string; tone: ([^}]*) \} \| null/)![1]
      .split('|')
      .map((t) => t.trim().replace(/'/g, ''))
    expect(tones).toEqual(['up', 'down', 'gap', 'neutral'])
    const bg = (sel: string) =>
      (CSS.match(new RegExp(`${sel}\\s*\\{([^}]*)\\}`))?.[1].match(/background:\s*([^;]+);/)?.[1] ?? '').trim()
    const looks = new Map<string, string>([['down', bg('\\.an-cmp')]])
    for (const tone of tones.filter((t) => t !== 'down')) looks.set(tone, bg(`\\.an-cmp\\.is-${tone}`))
    for (const [tone, look] of looks) expect(look === '' ? tone : look).not.toBe(tone)
    expect(new Set(looks.values()).size).toBe(tones.length)
    // grey, and it is the neutral family — never the green one
    expect(looks.get('neutral')).toBe('var(--an-wash)')
    expect(looks.get('neutral')).not.toBe(looks.get('up'))
  })

  it('the shell lifts its 1180 floor for this room — the ONE named shared-seam line', () => {
    // ⚖ ALL-SCREEN cannot hold behind the shell's min-width floor, and no route
    // sheet may reach up and lift its own (the shell's rule says so). The
    // opt-in list is SHELL-owned; this pins that the room is on it.
    const shell = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business-shell.css'),
      'utf8',
    )
    const rule = shell.match(/\.biz \.app:has\(([^)]*)\)\s*\{\s*min-width:\s*0/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toContain('.page.pg-analytics')
  })
})

// ── 15b. the Number Dictionary ──────────────────────────────────────────────

/**
 * ⚖ THE SPREADSHEET-ABSORPTION PLAN'S LAYER 2. The 集計表's every formula
 * becomes a dictionary entry — defined once, computed on the server, shown
 * identically wherever it appears. These pins are what stop it drifting back
 * into per-surface literals, which is the disease the two La Estro workbooks
 * died of.
 */
describe('the Number Dictionary', () => {
  it('every entry is complete, and only an unconnected one carries `needs`', () => {
    expect(NUMBERS.length).toBe(PLANE_NUMBERS.length + UNCONNECTED_NUMBERS.length)
    expect(new Set(NUMBERS.map((n) => n.id)).size).toBe(NUMBERS.length)
    expect(new Set(NUMBERS.map((n) => n.label)).size).toBe(NUMBERS.length)
    for (const n of NUMBERS) {
      expect(n.label.length).toBeGreaterThan(0)
      expect(n.counts.length).toBeGreaterThan(0)
      expect(n.formula.length).toBeGreaterThan(0)
      expect(SCOPE_WORD[n.scope]).toBeTruthy()
      if (n.source === 'unconnected') expect(n.needs && n.needs.length > 0).toBe(true)
      else expect(n.needs).toBeUndefined()
      // ⚠ NATIVE JP, and the 9/1 pass's own rule: no em-dash mid-sentence.
      expect(`${n.counts}${n.formula}`).not.toContain(' — ')
    }
  })

  it('an unknown id fails LOUD rather than printing a word nobody defined', () => {
    expect(() => numberEntry('nope' as NumberId)).toThrow(/unknown number id/)
  })

  it('⚖⚖ STORE-FIRST — no company-finance number exists in the dictionary', () => {
    // Liam 9/2: SYNQED Business is the stores-and-managers product. Royalties,
    // P&L and 本部 rollups stay out of the product's data plane entirely.
    for (const n of NUMBERS) {
      expect(`${n.label}${n.counts}${n.formula}`).not.toMatch(/ロイヤリティ|本部|営業利益|粗利|FC/)
    }
  })

  it('着地見込み is the pace run to the end of the CALENDAR month', () => {
    // the mock's own worked example
    expect(landingEstimate(113499, 2, 30)).toBe(1_702_485)
    // …and the first of the month is total × the month, never a divide by zero
    expect(landingEstimate(60000, 1, 31)).toBe(1_860_000)
    expect(Number.isFinite(landingEstimate(60000, 0, 31))).toBe(true)
    expect(landingEstimate(0, 3, 30)).toBe(0)
    expect(landingGap(1_702_485, 2_000_000)).toBe(-297_515)
    expect(landingGap(0, 2_000_000)).toBe(-2_000_000)
  })

  it('目標進捗 never divides by a target nobody set, and never prints NaN', () => {
    expect(targetProgress(113499, 2_000_000)).toBe(6)
    expect(targetProgress(500000, 0)).toBe(0)
    expect(Number.isNaN(targetProgress(500000, 0))).toBe(false)
    expect(targetRemaining(113499, 2_000_000)).toBe(1_886_501)
    // SIGNED: over the goal is a negative remainder, and the copy branches on it
    expect(targetRemaining(2_100_000, 2_000_000)).toBe(-100_000)
    expect(avgNewTicket(30233, 6)).toBe(5039)
    expect(avgNewTicket(0, 0)).toBeNull()
  })

  it('前月比 is a percentage for money and POINTS for a rate, and — with no baseline', () => {
    expect(monthDelta(1_650_000, 1_600_000, 'yen')).toEqual({ kind: 'up', text: '▲3.1%' })
    expect(monthDelta(1_290_000, 1_680_000, 'yen').text).toBe('▼23.2%')
    // a rate that went 46% → 49% rose THREE POINTS, not 6.5%
    expect(monthDelta(0.49, 0.46, 'rate')).toEqual({ kind: 'up', text: '▲3.0pt' })
    expect(monthDelta(100, 100, 'count')).toEqual({ kind: 'flat', text: '±0' })
    expect(monthDelta(100, null, 'count')).toEqual({ kind: 'na', text: '—' })
    expect(monthDelta(100, 0, 'count')).toEqual({ kind: 'na', text: '—' })
    expect(monthDelta(null, 100, 'count')).toEqual({ kind: 'na', text: '—' })
  })

  /**
   * ⚖ ONE PERCENTAGE-CHANGE IMPLEMENTATION (L2 B2-7 · B2-8). The room used to
   * carry a second, private helper beside `monthDelta` that spelled the same
   * idea differently (`+/−/±` against `▲/▼`), disagreed about a zero baseline,
   * and painted an exactly LEVEL month green. The tone belongs beside the
   * arithmetic, so both live here and the chip reads them.
   */
  it('a delta wears the tone its own kind earns — and a flat month is NEUTRAL, never green', () => {
    expect(deltaTone('up')).toBe('up')
    expect(deltaTone('down')).toBe('down')
    expect(deltaTone('flat')).toBe('neutral')
    expect(deltaTone('na')).toBe('neutral')
    // the kind a level month reaches, and the text it prints
    expect(monthDelta(100, 100, 'yen')).toEqual({ kind: 'flat', text: '±0' })
    expect(deltaTone(monthDelta(100, 100, 'yen').kind)).toBe('neutral')
  })

  it('the decide line has an honest sentence for every clause that can be missing', () => {
    const base = {
      monthCount: 12,
      lastShort: '8月',
      lastTotalText: '¥1,650,000',
      lastRank: 1,
      currentShort: '9月',
      currentTotal: 113499,
      spanDeltaText: '▼26.8%',
      spanDeltaSign: -1,
      wholeMonths: false,
    }
    expect(decideLine(base)).toBe('直近の完了月8月は ¥1,650,000 で12か月の最高。9月は同じ経過日数で ▼26.8% と出遅れています。')
    expect(decideLine({ ...base, lastRank: 3 })).toContain('12か月の3番目')
    expect(decideLine({ ...base, spanDeltaSign: 1, spanDeltaText: '▲4.2%' })).toContain('上回っています')
    expect(decideLine({ ...base, spanDeltaSign: 0, spanDeltaText: '±0' })).toContain('同じ水準です')
    expect(decideLine({ ...base, currentTotal: 0 })).toContain('9月はまだ実績がありません')
    expect(decideLine({ ...base, spanDeltaText: null, spanDeltaSign: null })).toContain('比較していません')
    expect(decideLine({ ...base, lastShort: null, lastTotalText: null, lastRank: null })).toContain('完了した月がまだない')
    for (const line of [decideLine(base), decideLine({ ...base, currentTotal: 0 })]) {
      expect(line).not.toContain('NaN')
      expect(line).not.toContain('undefined')
    }
  })

  /**
   * ⚖ ONE PREDICATE, THREE SENTENCES (L1 B1-2 · B1-7 · L2 B2-1). The elapsed-day
   * wording is a CLAIM about which comparison was made, and it was being said
   * unconditionally — on the chip as a literal, and in the decide line for a
   * whole month against a whole month. `wholeMonths` is the one input that
   * decides it, and the same value decides the chip's label and the footer.
   */
  it('the decide line says 「同じ経過日数で」 only where that is the comparison it made', () => {
    const base = {
      monthCount: 12,
      lastShort: '8月',
      lastTotalText: '¥1,650,000',
      lastRank: 2,
      currentShort: '8月',
      currentTotal: 1_650_000,
      spanDeltaText: '▲3.1%',
      spanDeltaSign: 1,
      wholeMonths: true,
    }
    // whole against whole: the elapsed-day claim is dropped…
    expect(decideLine(base)).toBe('直近の完了月8月は ¥1,650,000 で12か月の2番目。前月と比べて ▲3.1% と上回っています。')
    expect(decideLine(base)).not.toContain('同じ経過日数')
    // …and the month is not set beside ITSELF (the head already named it)
    expect(decideLine(base).match(/8月/g)).toHaveLength(1)
    // a truncated comparand is still an equal-span comparison, and says so
    expect(decideLine({ ...base, wholeMonths: false })).toContain('同じ経過日数で')
    // a different month being viewed keeps its own subject
    expect(decideLine({ ...base, currentShort: '6月' })).toContain('6月は前月と比べて')
  })
})

// ── 15c. the decision header, the ticks and the provenance panel ────────────

describe('the decision tiles', () => {
  it('five tiles, and every label is its DICTIONARY entry word — never a literal', () => {
    return room({ store: STORE_A }).then((p) => {
      expect(p.tiles).toHaveLength(5)
      for (const t of p.tiles!) expect(t.label).toBe(numberEntry(t.id).label)
      expect(p.tiles!.map((t) => t.id)).toEqual(['total', 'nw', 'newCount', 'targetProgress', 'landing'])
    })
  })

  it("tile 1 is the ONE month figure — the table's row and the 内訳 print the same number", async () => {
    const p = await room({ store: STORE_A })
    const tile = yenNumber(p.tiles![0].value)
    expect(yenNumber(p.trend!.rows.find((r) => r.monthsAgo === 0)!.cells[0])).toBe(tile)
    expect(p.trend!.menuSegments.reduce((n, s) => n + s.amount, 0)).toBe(tile)
  })

  it('the 着地見込み tile prints the operands its own formula names', async () => {
    const restore = pin('2026-09-03T04:00:00.000Z')
    try {
      const p = await room({ store: STORE_A })
      const land = p.tiles![4]
      const total = yenNumber(p.tiles![0].value)
      const coords = monthCoords(new Date(), 0, closedWeekday)
      expect(yenNumber(land.value)).toBe(landingEstimate(total, coords.elapsedDays, coords.daysInMonth))
      expect(land.calc).not.toBeNull()
      const lines = land.calc!.lines
      expect(lines).toHaveLength(4)
      expect(yenNumber(lines[0].v)).toBe(total)
      expect(lines[1].k).toContain(`÷ ${coords.elapsedDays}日`)
      expect(lines[2].k).toContain(`× ${coords.daysInMonth}日`)
      expect(yenNumber(lines[2].v)).toBe(yenNumber(land.value))
      expect(lines[3].result).toBe(true)
      // `yenNumber` drops U+2212 on purpose, so the magnitude is compared here
      // and the SIGN is compared as text three lines down.
      expect(yenNumber(lines[3].v)).toBe(Math.abs(landingGap(yenNumber(land.value), salesTargets[STORE_A])))
      // the GAP chip and the last line are the same subtraction, sign and all
      // (the minus is U+2212, which `yenNumber` drops on purpose — so the two
      // strings are compared, not two unsigned numbers)
      expect(land.chip!.text).toContain(lines[3].v)
      expect(lines[3].v.startsWith('−')).toBe(true)
      expect(land.chip!.tone).toBe('gap')
      expect(land.calc!.notes.join('')).toContain('推計')
      expect(land.calc!.notes.join('')).toContain('暦日ベース')
    } finally {
      restore()
    }
  })

  it('a store with no 目標 dial gets no percentage and a link to 設定, never 0% and never NaN', async () => {
    const p = await propsWorld({ store: STORE_A, world: { target: 0 } })
    const goal = p.tiles![3]
    expect(goal.value).toBe('目標が未設定です')
    expect(goal.value).not.toContain('%')
    expect(goal.bar).toBeNull()
    expect(goal.link!.href).toContain('/business/settings')
    // …and the chart drops its 目標 rule rather than drawing one at zero
    expect(p.trend!.targetLabel).toBeNull()
    expect(p.trend!.chart.targetY).toBeNull()
    // the landing tile still states the estimate, and says why there is no GAP
    expect(p.tiles![4].chip).toBeNull()
    expect(p.tiles![4].calc!.notes.join('')).toContain('目標が未設定')
  })

  it('⚖-ADJ A — a FINISHED month has nothing to estimate: 着地（確定）, no 計算式', async () => {
    const p = await room({ store: STORE_A, month: '-1' })
    const land = p.tiles![4]
    expect(land.id).toBe('landingFinal')
    expect(land.label).toBe(numberEntry('landingFinal').label)
    expect(land.label).toContain('確定')
    expect(land.scope).toBe('確定・月全体')
    expect(land.calc).toBeNull()
    // ⚖-ADJ A AMENDED (fix round 1): one quantity, one name. The chip reads the
    // 着地GAP entry's own word on a finished month too — the tile label
    // 着地（確定） has already said the month is over.
    expect(land.chip!.text).toContain(numberEntry('landingGap').label)
    expect(land.chip!.text).not.toContain('目標との差')
    // the value is the month's own total, not a projection of it
    expect(yenNumber(land.value)).toBe(yenNumber(p.tiles![0].value))
    // …and no VISIBLE string on the row calls a finished month an estimate.
    // (The tour sentence names 推計 only to deny it — 「推計ではなく実際の」 — so
    // the scan is over what the tile prints, not over its explanation.)
    const printed = p.tiles!.flatMap((t) => [t.prefix, t.label, t.suffix, t.scope, t.value, t.foot ?? '', t.chip?.text ?? ''])
    expect(printed.filter((x) => x.includes('推計'))).toEqual([])
    expect(land.guide!.text).toContain('推計ではなく実際の')
  })

  /**
   * ⚖ ONE IMPLEMENTATION, PROVED ON THE PAGE. The chip's percentage is the
   * difference of the two figures the tile itself prints — its value and the
   * comparand quoted in its own footer — recomputed here through `monthDelta`.
   * A second helper anywhere in the chain shows up as a different string.
   */
  it("tile 1's chip is the difference of the two numbers tile 1 prints", async () => {
    for (const month of ['0', '-1', '-2']) {
      const p = await room({ store: STORE_A, month })
      const tile = p.tiles![0]
      const comparand = yenNumber(tile.foot!.match(/¥[\d,]+/)![0])
      expect(tile.chip!.text.endsWith(monthDelta(yenNumber(tile.value), comparand, 'yen').text)).toBe(true)
    }
  })

  it('a month exactly LEVEL with the one before it prints ±0, in grey, and reads 同じ水準', async () => {
    // The world is one real ledger row copied across every month, so a finished
    // month against a whole previous month lands exactly level.
    const p = await propsWorld({ store: STORE_A, month: '-1', world: { levelMonths: true } })
    const chip = p.tiles![0].chip!
    expect(chip.text).toBe(`${numberEntry('monthDelta').label} ±0`)
    expect(chip.tone).toBe('neutral')
    expect(chip.tone).not.toBe('up')
    expect(p.trend!.decide).toContain('同じ水準です')
    // …and the tick under a level table cell agrees with the chip
    const rows = p.trend!.rows.filter((r) => !r.partial)
    expect(rows.slice(1).every((r) => r.ticks[0].kind === 'flat' && r.ticks[0].text === '±0')).toBe(true)
  })

  it('the ONE truth for 目標: the room reads the plane and links to the room that owns it', async () => {
    const p = await room({ store: STORE_A })
    // the target reaches the page through the tile's scope and the chart's own
    // dashed-rule label — the two surfaces that print it — and nowhere else.
    expect(p.tiles![3].scope).toBe(`${numberEntry('target').label} ¥${salesTargets[STORE_A].toLocaleString('ja-JP')}`)
    expect(p.trend!.targetLabel).toBe(p.tiles![3].scope)
    expect(p.tiles![3].link!.href).toContain('/business/settings')
    expect(p.tiles![3].link!.href).toContain(`store=${STORE_A}`)
  })
})

describe('the 月次内訳 table', () => {
  it('⚖-ADJ D — eleven columns, four shed by default, and NONE of them dropped', async () => {
    const p = await room({ store: STORE_A })
    const heads = p.trend!.metrics.map((c) => c.head)
    expect(heads).toEqual(['総合売上', '新規売上', '回収売上', '消化売上', '新規数', '既存数', '次回予約率', 'リピート率', '稼働率', 'LTV', '新規LTV'])
    for (const c of p.trend!.metrics) expect(c.head).toBe(numberEntry(c.id).label)
    // the four the mock's builder could not read off the deployed table
    expect(p.trend!.metrics.filter((c) => c.shed === 'always').map((c) => c.head)).toEqual(['リピート率', '稼働率', 'LTV', '新規LTV'])
    expect(p.trend!.metrics.filter((c) => c.shed === 'sh1').map((c) => c.head)).toEqual(['既存数'])
    expect(p.trend!.metrics.filter((c) => c.shed === 'sh2').map((c) => c.head)).toEqual(['新規数'])
    // every row carries every column — a shed cell is styled away, never absent
    for (const r of p.trend!.rows) {
      expect(r.cells).toHaveLength(11)
      expect(r.ticks).toHaveLength(11)
    }
    // …and 日報 keeps all eleven under their dictionary names
    expect(p.daily!.heads).toEqual(['日付', ...heads])
  })

  it('a tick is the difference of the two numbers the table PRINTS', async () => {
    const p = await room({ store: STORE_A })
    const rows = p.trend!.rows
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].partial) continue
      p.trend!.metrics.forEach((c, k) => {
        const unit = numberEntry(c.id).unit
        const cur = unit === 'rate' ? Number(rows[i].cells[k].replace('%', '')) / 100 : yenNumber(rows[i].cells[k])
        const prev = unit === 'rate' ? Number(rows[i - 1].cells[k].replace('%', '')) / 100 : yenNumber(rows[i - 1].cells[k])
        const expected = monthDelta(cur, prev, unit)
        expect(rows[i].ticks[k].kind).toBe(expected.kind)
        if (unit !== 'rate') expect(rows[i].ticks[k].text).toBe(expected.text)
      })
    }
  })

  it('the month in progress is NEVER compared, and neither is the first row', async () => {
    const p = await room({ store: STORE_A })
    const rows = p.trend!.rows
    const partial = rows.find((r) => r.partial)!
    expect(partial.ticks.every((t) => t.kind === 'na' && t.text === '—')).toBe(true)
    expect(rows[0].ticks.every((t) => t.kind === 'na')).toBe(true)
  })

  it('the 統計 row is Σ rows / 平均, and it is what the table prints', async () => {
    const p = await room({ store: STORE_A })
    expect(p.trend!.stats).toHaveLength(11)
    const summed = p.trend!.rows.reduce((n, r) => n + yenNumber(r.cells[0]), 0)
    expect(yenNumber(p.trend!.stats[0].value)).toBe(summed)
    expect(p.trend!.stats[0].kicker).toBe('合計')
    expect(p.trend!.stats[6].kicker).toBe('平均')
  })

  it('every row carries the link that makes it the viewed month, with the store lens on it', async () => {
    const p = await room({ store: STORE_B })
    for (const r of p.trend!.rows) {
      expect(r.href).toContain(`store=${STORE_B}`)
      expect(r.href).toContain(`month=${-r.monthsAgo}`)
    }
    expect(p.trend!.chartMonths.map((m) => m.href)).toEqual(p.trend!.rows.map((r) => r.href))
  })
})

describe('the provenance panel', () => {
  it('every row is GENERATED from the dictionary — a hand-written row cannot survive', async () => {
    const p = await room({ store: STORE_A })
    const rendered = new Set<NumberId>([
      ...p.tiles!.map((t) => t.id),
      ...p.trend!.metrics.map((c) => c.id),
      'target', 'targetRemaining', 'remainingOpenDays', 'spanCompare', 'avgNewTicket', 'monthDelta',
      'ticketOutstanding',
    ])
    expect(new Set(p.provenance!.rows.map((r) => r.id as NumberId))).toEqual(rendered)
    for (const r of p.provenance!.rows) {
      const e = numberEntry(r.id as NumberId)
      expect(r.key).toContain(e.label)
      expect(r.value).toContain(e.counts)
      expect(r.value).toContain(e.formula)
      expect(r.value).toContain(SCOPE_WORD[e.scope])
      expect(r.value).toContain(e.owner)
    }
    // the 集計表's own word for a number it calls something else
    expect(p.provenance!.rows.find((r) => r.id === 'collected')!.key).toContain('入金')
  })

  /**
   * §E — NO PROP SHIPS THAT NOTHING RENDERS (L1 B1-4 · L2 B2-6). Four props
   * (`target`, `attention`, `subtitle`, `lensLabel`) plus `trend.statCells`
   * were assembled, serialized and shipped while the screen read none of them
   * — carrying a retired string beside its own replacement, and in the target-0
   * world carrying 「目標進捗 0%」, the exact statement tile 4 refuses to make.
   * Pinned BOTH WAYS, so neither an unread prop nor an undeclared read survives.
   */
  it('every key of the serialized payload is read by the screen, and every read is a declared key', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/analytics/AnalyticsScreen.tsx'),
      'utf8',
    )
    /** One `export interface X {…}` block, brace-balanced. */
    const blockOf = (name: string) => {
      const at = src.indexOf(`export interface ${name} {`)
      expect(at).toBeGreaterThan(0)
      let depth = 0
      for (let i = src.indexOf('{', at); i < src.length; i += 1) {
        if (src[i] === '{') depth += 1
        else if (src[i] === '}' && (depth -= 1) === 0) return src.slice(at, i + 1)
      }
      throw new Error(`unbalanced ${name}`)
    }
    const declared = new Set<string>()
    for (const name of ['AnalyticsProps', 'TileProps', 'ProvRow']) {
      for (const m of blockOf(name).matchAll(/^\s{2,}(\w+)\??:/gm)) declared.add(m[1])
    }
    expect(declared.has('statCells')).toBe(false)
    expect(declared.has('attention')).toBe(false)
    // The render body — everything after the last type declaration.
    const body = src.slice(src.indexOf('const VIEWS = ['))
    const unread = [...declared].filter((k) => !new RegExp(`[.{,]\\s*${k}\\b`).test(body))
    expect(unread).toEqual([])
    // …and nothing is read that was never declared (a typo'd `props.x` is
    // `undefined` at runtime and silent).
    const read = new Set([...body.matchAll(/\bprops\.(\w+)/g)].map((m) => m[1]))
    expect([...read].filter((k) => !declared.has(k))).toEqual([])
  })

  /**
   * §K — NO HAND-WRITTEN PROVENANCE ROW (L2 B2-3). The 「すべての金額」 pair was
   * JSX sitting FIRST in the grid, at exactly the place §3's pin forbids it —
   * and invisible to both the suite and the mutant, because both read
   * `props.provenance.rows`. So this one reads the JSX.
   */
  it('no provenance row is hand-written — every key node comes from props', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/analytics/AnalyticsScreen.tsx'),
      'utf8',
    )
    const keyNodes = [...src.matchAll(/<div className="an-prov-k">([^<]*)</g)].map((m) => m[1].trim())
    // four: the generated entries, the month and the store this render was
    // scoped to, and the 未接続 block — every one of them `{…}` from props.
    expect(keyNodes).toHaveLength(4)
    for (const node of keyNodes) expect(node.startsWith('{') && node.endsWith('}')).toBe(true)
    expect(keyNodes.some((n) => /[ぁ-んァ-ヶ一-龯]/.test(n))).toBe(false)
  })

  it('the six 未接続 numbers are named with what each one needs, and nothing else', async () => {
    const p = await room({ store: STORE_A })
    expect(p.provenance!.unconnected).toHaveLength(6)
    expect(p.provenance!.unconnected.map((r) => r.key)).toEqual(UNCONNECTED_NUMBERS.map((n) => n.label))
    for (const r of p.provenance!.unconnected) {
      expect(r.value).toContain('未接続：')
      expect(r.value).toContain(numberEntry(r.id as NumberId).needs!)
    }
  })

  it('⚖ disconnected-depth — an unconnected number is never a tile, a column or a chip', async () => {
    const p = await room({ store: STORE_A })
    const unconnected = new Set(UNCONNECTED_NUMBERS.map((n) => n.id))
    for (const t of p.tiles!) expect(unconnected.has(t.id)).toBe(false)
    for (const c of p.trend!.metrics) expect(unconnected.has(c.id)).toBe(false)
    for (const r of p.provenance!.rows) expect(unconnected.has(r.id as NumberId)).toBe(false)
  })

  it('§2.10 K — every retired string has a NEW HOME, not a deletion', async () => {
    const p = await room({ store: STORE_A })
    const panel = JSON.stringify(p.provenance) + JSON.stringify(p.guides)
    // the attention strip's headline and its comparison sentence
    expect(panel).toContain(p.provenance!.monthRow.value)
    expect(panel).toContain(p.provenance!.monthRow.value)
    // the target strip's trace, now a real link
    expect(p.tiles![3].link!.label).toBe('設定で変更')
    // the 内訳 panel's 平均単価 row, now tile 3's footer
    expect(p.tiles![2].foot).toContain('平均単価')
    // the trailing footnote paragraph, now the panel's own lead (§K)
    expect(p.provenance!.lead).toContain('どの数値も 売上・レジ の精算記録から導出。')
    // the chart's own reading paragraph, now behind 12か月の説明を読む
    expect(p.trend!.reading.length).toBeGreaterThan(40)
  })
})

// ── 15d. the words on the page (fix round 1) ────────────────────────────────

/**
 * ⚖ 8/25, NUMBERS EXPLAIN THEMSELVES — INCLUDING THEIR TIME SCOPE. Every pin
 * here is a sentence that was making a claim the figure beside it did not
 * support: a balance stamped with a month it was never read in, a hover card
 * promising a gesture that only exists above a rung, a label with two は in one
 * clause, a count called a remainder, and an internal system name in front of
 * an owner.
 */
describe('the words the page states are true of the figures beside them', () => {
  const ROOM_SRC = ['analytics-props.ts', 'AnalyticsScreen.tsx'].map((f) => ({
    name: f,
    code: readFileSync(
      join(process.cwd(), `src/app/[locale]/(business)/business/analytics/${f}`),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
  }))

  it('§D — the 回数券 balance is stamped with TODAY, whatever month is being viewed', async () => {
    const restore = pin('2026-09-03T04:00:00.000Z')
    try {
      // The figure has no month input at all: it is the 残数 the customers hold
      // right now. Welding the SELECTED month's name to today's day-of-month
      // printed 「10月3日時点」 for a reading taken on 9月3日 (L1 B1-3).
      for (const month of ['0', '-1', '-11']) {
        const p = await room({ store: STORE_A, month })
        const chip = p.trend!.tickets.find((t) => t.key.startsWith(numberEntry('ticketOutstanding').label))!
        expect(chip.key).toContain('9月3日時点')
      }
      // …while the second chip is a MONTH's takings, so it keeps the month span
      const back = await room({ store: STORE_A, month: '-1' })
      expect(back.trend!.tickets[1].key).toContain('8月1日〜31日')
    } finally {
      restore()
    }
  })

  it('§G — the two ticket chips sit under a 回数券 group heading, and keep their own words', async () => {
    const p = await room({ store: STORE_A })
    expect(p.trend!.tickets.map((t) => t.key.split('（')[0])).toEqual([
      numberEntry('ticketOutstanding').label,
      numberEntry('consumed').label,
    ])
    // …and the group has a heading, so 消化売上 is tied to 回数券 even at ≤799
    // where the chips stack full width with nothing else beside them (L1 B1-6).
    const screen = ROOM_SRC.find((f) => f.name === 'AnalyticsScreen.tsx')!.code
    expect(screen).toMatch(/className="an-tickets"[\s\S]{0,400}<span className="an-mix-k">回数券<\/span>/)
  })

  it('§H/§I — the hover card and the card-band line promise only what actually happens', async () => {
    const p = await room({ store: STORE_A })
    const finished = p.trend!.chartMonths.filter((m) => !m.partial)
    expect(finished.length).toBeGreaterThan(0)
    // navigation is what a month click always does; the row-open is the desk
    // rung's extra, and the rule that does it lives inside a container query
    for (const m of finished) {
      expect(m.note).toBe('押すと下の表のその月へ移動します')
      expect(m.note).not.toContain('行を開きます')
    }
    // the partial month keeps its own honest note
    expect(p.trend!.chartMonths.find((m) => m.partial)!.note).toContain('月の途中です')
    // …and the ≤799 line names the CARD, because that is what a row is there
    const screen = ROOM_SRC.find((f) => f.name === 'AnalyticsScreen.tsx')!.code
    expect(screen).toContain('・カードをタップすると全項目が開きます')
    expect(screen).not.toContain('・行を押すと全項目が開きます')
  })

  it('§M — the 統計 label reads with ONE は, and no sentence carries a second copy of 12', async () => {
    const restore = pin('2026-09-03T04:00:00.000Z')
    try {
      const p = await room({ store: STORE_A })
      expect(p.trend!.statLabel).toBe(`統計（${LEDGER_MONTHS}か月・9月は1日〜3日の暫定値を含む）`)
      expect(p.trend!.statLabel.match(/は/g)).toHaveLength(1)
    } finally {
      restore()
    }
    // ⚠ the month window is ONE number. `analytics-props.ts:869` opened with the
    // templated `${LEDGER_MONTHS}か月` and closed with a literal 12か月 in the
    // SAME sentence, so a change to the window would make it disagree with
    // itself (L5-5).
    for (const { name, code } of ROOM_SRC) {
      expect([name, code.match(/12か月/g)]).toEqual([name, null])
      // 「ぶん」 in hiragana everywhere, including the aria-label 分 also reads ふん
      expect([name, code.match(/か月分/g)]).toEqual([name, null])
      // the file's own naka-guro convention: no space between ・ and the clause
      expect([name, code.match(/・ \$\{/g)]).toEqual([name, null])
    }
    // the loanword the same element's tour title never used (L5-6)
    expect(ROOM_SRC.find((f) => f.name === 'AnalyticsScreen.tsx')!.code).not.toContain('ビュー')
  })

  it('§Q — no 未接続 line names an internal system, and a count is not a remainder', () => {
    // 「core の回数券購入記録」 rendered verbatim in front of an owner, twice
    // (L5-1), and 「Google API」 was the one line naming an interface rather
    // than a business connection (L5-2).
    for (const e of UNCONNECTED_NUMBERS) {
      expect([e.id, /\bcore\b|API|SDK|endpoint/i.test(e.needs!)]).toEqual([e.id, false])
      expect(e.needs!.length).toBeGreaterThan(3)
    }
    expect(numberEntry('ticketPurchaseRate').needs).toBe('回数券の購入記録との接続')
    expect(numberEntry('googleReviews').needs).toBe('Googleの口コミ情報との接続')
    // 未消化残 is a COUNT of sessions priced up — its own label already carries
    // 残, so the scope word saying 残り again named the quantity twice.
    expect(SCOPE_WORD['as-of']).toBe('その時点の値')
  })
})

describe('the 画面の説明 tour', () => {
  const SCREEN = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/analytics/AnalyticsScreen.tsx'),
    'utf8',
  )

  it('every section DECLARES itself, and the census is the expected list', () => {
    // ⚖ Liam 8/23, both halves: at runtime the walker picks up anything
    // declared (the probe measures the walked census in a browser); at build
    // time every section declares itself the day it lands, and this is that
    // half. Remove one declaration and this goes red.
    const declared = [...SCREEN.matchAll(/data-guide-title="([^"]+)"|data-guide-title=\{([^}]+)\}/g)]
      .map((m) => m[1] ?? m[2])
    expect(declared).toEqual([
      '売上分析',
      'いちばん上の5つの数字',
      't.guide?.title',     // the 着地見込み tile — its own explanation
      '表示の切り替え',
      '月次推移',
      'グラフの読み取り',
      '店舗の月次内訳',
      '売上の内訳',
      '回数券',
      'スタッフランキング',
      '日報',
      '値の設定元',
    ])
    // every declaration carries TEXT as well as a title
    expect((SCREEN.match(/data-guide=/g) ?? []).length).toBe(declared.length)
  })

  it('every declared section has a native-JP sentence behind it', async () => {
    const p = await room({ store: STORE_A })
    const keys = ['head', 'kpis', 'landing', 'tabs', 'chart', 'decide', 'table', 'mix', 'tickets', 'ranking', 'daily', 'footnote']
    for (const k of keys) {
      expect(typeof p.guides![k]).toBe('string')
      expect(p.guides![k].length).toBeGreaterThan(20)
      expect(p.guides![k]).not.toContain('undefined')
      expect(p.guides![k]).not.toContain('NaN')
    }
  })

  it('the ? is a tour trigger, not a popover — and the engine is the shared one', () => {
    expect(SCREEN).toContain("from '@/business/lib/guide'")
    expect(SCREEN).toMatch(/aria-haspopup="dialog"[\s\S]{0,200}aria-expanded=\{tourOpen\}/)
    expect(SCREEN).toContain('onClick={() => setTourIdx(0)}')
  })
})

describe('回数券 language is a capability, not an assumption (registry ⑦)', () => {
  it('the chips render where the world shows a ticket signal', async () => {
    const p = await room({ store: STORE_A })
    expect(p.trend!.tickets).toHaveLength(2)
    expect(p.trend!.tickets[0].key).toContain(numberEntry('ticketOutstanding').label)
    expect(p.trend!.tickets[0].unit).toMatch(/回分$/)
  })

  it('a business that does not sell them gets NOTHING there — never a 「回数券なし」 chip', async () => {
    const p = await propsWorld({ store: STORE_A, world: { noTickets: true } })
    // the world really has no signal — proven, not assumed, so this pin cannot
    // be green for a second reason (⚖ HARNESS-TRUTH)
    expect(yenNumber(p.trend!.rows.find((r) => r.selected)!.cells[3])).toBe(0)
    expect(p.trend!.tickets).toEqual([])
    expect(JSON.stringify(p.trend!)).not.toContain('未消化残')
    // …and the provenance panel drops the 未消化残 row with them
    expect(p.provenance!.rows.map((r) => r.id)).not.toContain('ticketOutstanding')
    // the chips ARE there on the same store's real plane — the difference is
    // the data, not a switch
    expect((await room({ store: STORE_A })).trend!.tickets).toHaveLength(2)
  })
})

// ── 16. the calendar helpers ────────────────────────────────────────────────

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
