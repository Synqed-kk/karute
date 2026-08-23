/**
 * 売上・レジ — the transplanted room's pins.
 *
 * THE ONE THING THIS SUITE IS FOR: MONEY IS DATA. Not one figure on this page is
 * written down anywhere — every total is a sum over the rows the ledger prints,
 * every row's tenders account for that row's total, and the day's aggregates
 * agree with the aggregates 今日の運営 already reads. A money desk that
 * disagrees with the booking desk about a refund, or with its own ledger about a
 * total, is worse than no money desk at all, so those are asserted as
 * EQUALITIES BETWEEN SURFACES rather than as spot checks.
 *
 * Second job: EVERY BUTTON HERE IS A WRITE and this room has none. Refund, cash
 * count, close, terminal re-check — all refused, all with their own reason on
 * their own accessible name, and the content canon hides behind a dialog for
 * them is shown as read-only evidence instead.
 *
 * Third job: ONE VERDICT. 閉店できるか is asked by five checklist rows, by the
 * close button's refusal and by a transaction's own 閉店への影響 line, and all
 * of them read `closingReadiness` once.
 *
 * Fourth job: the boundaries — the store isolation law on the ledger AND on the
 * terminal's held list in BOTH directions, the ⚖ page-scroll ruling on every
 * wrapper, the sibling-sheet fence derived from the neighbours' own sheets, and
 * the room at 120 transactions.
 *
 * NOTE ON RENDER SMOKES: react-dom is deliberately OFF territory's import
 * allowlist (business-isolation.test.ts), so a section is smoke-tested by
 * asserting the props the screen is handed for it — the technique every other
 * business suite uses. The pixels are proven by the room's Chromium probe.
 */

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { jstDayKey } from '@/business/lib/clock'
import { appointments, customers, menus, operator, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { auditTrail } from '@/business/lib/fixtures-reservations'
import { register as registerPlane } from '@/business/lib/fixtures-today'
import {
  cashTolerance,
  closing as closingPlane,
  MAX_CASH_TOLERANCE,
  transactions as txPlane,
  type FixtureTransaction,
} from '@/business/lib/fixtures-register'
import {
  accessFor,
  buildLedger,
  cashVariance,
  closingReadiness,
  COUNTER_FILTER,
  COUNTER_STATS,
  countBy,
  FILTERS,
  heldForLens,
  ledgerTotals,
  matchesFilter,
  NO_ACCESS,
  permissionNotice,
  rowBalances,
  SALES_ACCESS_BY_ROLE,
  signedYen,
  tenderReconciliation,
  transactionStore,
  varianceRequiresApproval,
  type LedgerInput,
  type TransactionModel,
} from '@/business/lib/register'
import { yen } from '@/business/lib/today-board'
import RegisterPage from '@/app/[locale]/(business)/business/register/page'
import { RegisterScreen, type RegisterProps } from '@/app/[locale]/(business)/business/register/RegisterScreen'
import { registerProps } from '@/app/[locale]/(business)/business/register/register-props'

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

const room = async (q: { store?: string } = {}) =>
  propsOf<RegisterProps>(
    await RegisterPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve(q) }),
    RegisterScreen,
  )!

/** Pin the render clock. Only the zero-argument construction is faked; the
 *  calendar arithmetic needs real `new Date(iso)` AND the statics. */
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

const ROOM_DIR = 'src/app/[locale]/(business)/business/register'
const SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/RegisterScreen.tsx`), 'utf8')
const CSS = readFileSync(join(process.cwd(), `${ROOM_DIR}/register.css`), 'utf8')
const PAGE_SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/page.tsx`), 'utf8')
const PROPS_SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/register-props.ts`), 'utf8')
const LIB = readFileSync(join(process.cwd(), 'src/business/lib/register.ts'), 'utf8')
const PLANE_SRC = readFileSync(join(process.cwd(), 'src/business/lib/fixtures-register.ts'), 'utf8')

/** Source pins read CODE, not prose. Every one of these files documents the rule
 *  it obeys in a comment that names the very thing the pin forbids ("no
 *  max-height", "never `overflow: hidden`"), so a pin that greps the raw file is
 *  true for the wrong reason. Comments come off first. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const SRC_CODE = codeOf(SRC)
const CSS_CODE = codeOf(CSS)
const PAGE_CODE = codeOf(PAGE_SRC)
const PROPS_CODE = codeOf(PROPS_SRC)
const LIB_CODE = codeOf(LIB)
const PLANE_CODE = codeOf(PLANE_SRC)

/** The room's input, rebuilt so the derivation can be driven directly at any
 *  lens and any scale without a render. */
function inputFor(store: string | null, override: Partial<LedgerInput> = {}): LedgerInput {
  const rows = appointments().filter((a) => store === null || a.store_id === store)
  const byId = new Map(rows.map((a) => [a.id, a]))
  return {
    transactions: txPlane,
    lensStoreId: store,
    appointments: rows,
    customers,
    menus: menus.filter((m) => store === null || m.store_id === null || m.store_id === store),
    terminalHeld: heldForLens(registerPlane.terminal_held, byId, store),
    auditTrail,
    ...override,
  }
}

const build = (store: string | null, override: Partial<LedgerInput> = {}) => buildLedger(inputFor(store, override))
const byTx = (rows: TransactionModel[], id: string) => rows.find((r) => r.id === id)!

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

// ── 1. the plane law: it states nothing the world already states ─────────────

describe('the money plane borrows and never restates', () => {
  it('a booking-backed sale carries NO total, NO customer and NO store of its own', () => {
    for (const tx of txPlane.filter((t) => t.appointment_id !== null)) {
      expect({ id: tx.id, amount: tx.amount, item: tx.item, store: tx.store_id, customer: tx.customer_id }).toEqual({
        id: tx.id,
        amount: null,
        item: null,
        store: null,
        customer: null,
      })
    }
  })

  it('a 店頭販売 carries its own store, because there is no booking to say which register took it', () => {
    for (const tx of txPlane.filter((t) => t.appointment_id === null)) {
      expect({ id: tx.id, store: typeof tx.store_id }).toEqual({ id: tx.id, store: 'string' })
      expect({ id: tx.id, amount: typeof tx.amount }).toEqual({ id: tx.id, amount: 'number' })
    }
  })

  it('the TOTAL of a booking-backed sale IS the booking’s own 受付価格', () => {
    const rows = build(STORE_A)
    for (const tx of txPlane.filter((t) => t.appointment_id !== null)) {
      const booking = appointments().find((a) => a.id === tx.appointment_id)!
      expect({ id: tx.id, total: byTx(rows, tx.id).total }).toEqual({ id: tx.id, total: booking.booked_price })
    }
  })

  it('the PENDING tender is derived from the world’s own terminal record, never restated here', () => {
    // The plane holds no pending line at all — `register.terminal_held` is where
    // the world says what the terminal is sitting on, and 今日の運営 counts the
    // same rows. Two homes for one held card is how two screens come to disagree
    // about whether the day can close.
    expect(txPlane.some((t) => t.tenders.some((x) => x.flag === 'pending'))).toBe(false)
    const held = registerPlane.terminal_held[0]
    const row = byTx(build(STORE_A), 'TX-4827')
    expect(row.tenders.filter((t) => t.flag === 'pending')).toEqual([
      { label: held.terminal, amount: held.amount, flag: 'pending', channel: 'card' },
    ])
    expect(row.state).toBe('held')
  })

  it('the day’s REVERSALS sum to the same ¥ 今日の運営 already subtracts', () => {
    // `register.refunds` is read by the board's own KPI. If this ledger's
    // reversals ever drifted from it, the two rooms would print two different
    // refund figures for one day.
    expect(ledgerTotals(build(STORE_A)).refunds).toBe(registerPlane.refunds)
  })

  it('the CASH DIFFERENCE derived here equals the one the world already states', () => {
    const totals = ledgerTotals(build(STORE_A))
    expect(cashVariance(closingPlane[STORE_A].cash_counted, totals.cash)).toBe(registerPlane.cash_difference)
  })

  it('a 監査行 that quotes a ¥ figure quotes a figure the row’s own tenders hold', () => {
    // Audit text is FROZEN history and canon writes amounts into it, so the
    // duplication is deliberate — but a frozen line that drifts from the tender
    // it describes is a lie in the record. Every figure the plane's audit rows
    // mention has to be one of that row's own tender amounts.
    const rows = build(STORE_A)
    let checked = 0
    for (const tx of txPlane) {
      const row = rows.find((r) => r.id === tx.id)
      if (!row) continue
      const legal = new Set(row.tenders.flatMap((t) => [yen(Math.abs(t.amount)), signedYen(t.amount)]))
      legal.add(yen(row.total))
      for (const [, , detail] of tx.audit) {
        for (const figure of detail.match(/[−-]?¥[\d,]+/g) ?? []) {
          checked += 1
          expect({ tx: tx.id, figure, known: legal.has(figure) }).toEqual({ tx: tx.id, figure, known: true })
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('the plane holds no verdict — no state, no label, no “ready” flag', () => {
    // Every judgement on this page is derived. A stored `state: "paid"` would be
    // a second home for a conclusion the tenders already reach.
    for (const key of ['state:', 'stateLabel', 'filter:', 'ready', 'blocked']) {
      expect({ key, inPlane: PLANE_CODE.includes(key) }).toEqual({ key, inPlane: false })
    }
  })
})

// ── 2. every figure derives from the rows ───────────────────────────────────

describe('totals derive from rows, and each row’s tenders account for its total', () => {
  it('EVERY row balances: 受領 + 未収 + 返金 = 総額', () => {
    const rows = build(STORE_A)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect({ id: r.id, balances: rowBalances(r) }).toEqual({ id: r.id, balances: true })
    }
  })

  it('the strip’s five figures are sums over the ledger it sits above', () => {
    const rows = build(STORE_A)
    const t = ledgerTotals(rows)
    expect(t).toEqual({
      gross: rows.reduce((n, r) => n + r.total, 0),
      refunds: rows.reduce((n, r) => n + r.reversed, 0),
      net: rows.reduce((n, r) => n + r.total, 0) - rows.reduce((n, r) => n + r.reversed, 0),
      collected: rows.reduce((n, r) => n + r.received, 0),
      outstanding: rows.reduce((n, r) => n + r.outstanding, 0),
      cash: t.cash,
    })
  })

  it('純売上 = 受領済み + 未収 — the identity that says the strip cannot lie', () => {
    // It follows from every row balancing, which is why the row invariant above
    // is the one that is actually load-bearing. Pinned here too because THIS is
    // the reading an owner does with their eyes.
    const t = ledgerTotals(build(STORE_A))
    expect(t.net).toBe(t.collected + t.outstanding)
  })

  it('the demo day’s figures, exactly', () => {
    expect(ledgerTotals(build(STORE_A))).toEqual({
      gross: 24200,
      refunds: 1100,
      net: 23100,
      collected: 21500,
      outstanding: 1600,
      cash: 8300,
    })
  })

  it('現金の期待額 counts the REFUND out again — a cash refund leaves the drawer', () => {
    const rows = build(STORE_A)
    const cashIn = rows.flatMap((r) => r.tenders).filter((t) => t.channel === 'cash')
    expect(cashIn.some((t) => t.amount < 0)).toBe(true)
    expect(ledgerTotals(rows).cash).toBe(cashIn.reduce((n, t) => n + t.amount, 0))
  })

  it('未収 is never counted as received', () => {
    const row = byTx(build(STORE_A), 'TX-5501')
    expect(row.outstanding).toBe(1600)
    expect(row.received).toBe(1700)
    expect(row.total).toBe(3300)
  })

  it('a refunded sale contributes to 総売上 and 返金 — and nothing to 受領済み', () => {
    const row = byTx(build(STORE_A), 'TX-5502')
    expect({ total: row.total, reversed: row.reversed, received: row.received, state: row.state }).toEqual({
      total: 1100,
      reversed: 1100,
      received: 0,
      state: 'refunded',
    })
  })

  it('the money formatter prints a MINUS SIGN, and never a negative zero', () => {
    expect(signedYen(-1100)).toBe('−¥1,100')
    expect(signedYen(1100)).toBe('¥1,100')
    // `-0 < 0` is false and `(-0).toLocaleString('ja-JP')` is 「-0」, so a day
    // with no refunds printed 「¥-0」 on the first render. Both spellings of zero
    // are pinned.
    expect(signedYen(0)).toBe('¥0')
    expect(signedYen(-0)).toBe('¥0')
  })

  it('NO literal money anywhere in the room’s code — every ¥ comes from ONE formatter', () => {
    for (const [name, code] of [
      ['RegisterScreen.tsx', SRC_CODE],
      ['register-props.ts', PROPS_CODE],
      ['register.ts', LIB_CODE],
    ] as const) {
      expect({ file: name, literalYen: /¥/.test(code) }).toEqual({ file: name, literalYen: false })
    }
    // …and the screen holds no arithmetic at all: every figure arrives formatted.
    expect(SRC_CODE).not.toMatch(/toLocaleString/)
  })
})

// ── 3. the counters ARE the filters ─────────────────────────────────────────

describe('a number that names a slice OPENS that slice', () => {
  it('every counter’s figure equals the row count of the filter it presses', () => {
    const rows = build(STORE_A)
    const counts = countBy(rows)
    for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
      const shown = rows.filter((r) => matchesFilter(r, COUNTER_FILTER[key])).length
      expect({ key, counted: counts[key], shown }).toEqual({ key, counted: counts[key], shown: counts[key] })
    }
  })

  it('a counter PRESS really moves the filter row — not just its own mark', () => {
    // ⚖ M10 discipline, caught by the battery: the equality above stays true
    // while the counter is a poster, because the map is right and the control is
    // dead. The wiring is pinned at source AND executed in the browser probe.
    expect(SRC_CODE).toContain('onClick={() => choose(COUNTER_FILTER[s.key])}')
    expect(SRC_CODE).toContain('onClick={() => choose(COUNTER_FILTER.all)}')
    expect(SRC_CODE).toContain('const choose = (next: RegisterFilter) => {')
    expect(SRC_CODE).toContain('setFilter(next)')
    // …and pressing one puts a phone reader back on the list it just narrowed.
    expect(SRC_CODE).toContain('setDetailOpen(false)')
  })

  it('the filter row and the counter strip name the SAME four slices', () => {
    expect(FILTERS.map((f) => f.key).sort()).toEqual(Object.values(COUNTER_FILTER).sort())
    expect(['all', ...COUNTER_STATS.map((s) => s.key)]).toEqual(Object.keys(countBy(build(STORE_A))))
  })

  it('the demo day’s counts, exactly — and every row lands in exactly one slice', () => {
    const rows = build(STORE_A)
    expect(countBy(rows)).toEqual({ all: 5, paid: 2, partial: 1, attention: 2 })
    for (const r of rows) {
      const hits = (['paid', 'partial', 'attention'] as const).filter((f) => matchesFilter(r, f))
      expect({ id: r.id, slices: hits.length }).toEqual({ id: r.id, slices: 1 })
    }
  })

  it('the ledger is newest-first, which is how a desk reads its own day back', () => {
    const rows = build(STORE_A)
    expect(rows.map((r) => r.id)).toEqual(['TX-5502', 'TX-5501', 'TX-4827', 'TX-4812', 'TX-4808'])
    expect([...rows].sort((a, b) => b.at - a.at).map((r) => r.id)).toEqual(rows.map((r) => r.id))
  })

  it('a filter that matches nothing is an honest empty state, never an invented row', () => {
    // The demo day genuinely has no 一部入金 in 代官山 — the room says so rather
    // than manufacturing one to fill the panel (⚖ 8/9, demo-data law).
    const rows = build(STORE_B)
    expect(rows).toHaveLength(0)
    expect(countBy(rows)).toEqual({ all: 0, paid: 0, partial: 0, attention: 0 })
  })
})

// ── 4. the terminal is a recorded fact with its consequence ─────────────────

describe('決済端末 — a recorded fact, and what it costs the day', () => {
  it('the band names the moment holding STARTED, so an earlier card line is not contradicted', async () => {
    const props = await room({ store: STORE_A })
    // ⚖ A10/A11: the ledger below shows a card payment that went through at
    // 11:38. A band that said 「カードは使えません」 flatly would be lying about
    // that row, so it says since WHEN records have been held.
    expect(props.terminal.copy).toContain('12:15以降')
    expect(props.terminal.copy).toContain('現金と受付価格には影響しません')
    expect(props.rows.some((r) => r.tenderSummary === 'カード' && r.state === 'paid')).toBe(true)
  })

  it('二重請求 is DERIVED from the idempotency ids the world carries, not asserted', async () => {
    const props = await room({ store: STORE_A })
    expect(props.terminal.stats.find((s) => s.label === '二重請求')!.value).toBe('0件')
    // Two held rows sharing an idempotency id is one duplicate — the derivation
    // has something to say rather than a hard-coded zero.
    const dup = registerPlane.terminal_held[0]
    const { props: doubled } = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { terminalHeld: [dup, { ...dup, appointment_id: dup.appointment_id }] },
    })
    expect(doubled.terminal.stats.find((s) => s.label === '二重請求')!.value).toBe('1件')
  })

  it('an EMPTY terminal says so, and stops blocking the close', async () => {
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { terminalHeld: [] } })
    expect(props.terminal.ok).toBe(true)
    expect(props.terminal.title).toContain('送信待ちの取引はありません')
    expect(props.close!.checks.find((c) => c.key === 'terminal')!.done).toBe(true)
    // …and the sale that was held is now simply settled — the state was never
    // stored, so removing the hold changes it.
    expect(props.rows.find((r) => r.id === 'TX-4827')!.state).toBe('paid')
  })
})

// ── 5. 現金, the difference, and the threshold DIAL ──────────────────────────

describe('現金差異 is derived, and its threshold is a named dial', () => {
  it('the difference is a count MINUS an expectation — neither is stored', () => {
    expect(cashVariance(8300, 8300)).toBe(0)
    expect(cashVariance(8200, 8300)).toBe(-100)
    // The plane records what was counted, and nothing about a difference.
    expect(PLANE_CODE).not.toMatch(/cash_difference|variance/)
  })

  it('the threshold is the dial, never a constant in the derivation', () => {
    expect(LIB_CODE).not.toMatch(/CASH_TOLERANCE\s*=|tolerance\s*=\s*\d/)
    expect(varianceRequiresApproval(true, 100, 0)).toBe(true)
    expect(varianceRequiresApproval(true, 100, 500)).toBe(false)
    // An UNSAVED count needs no approval — it is not a difference yet, it is a
    // draft (canon `varianceRequiresApproval`).
    expect(varianceRequiresApproval(false, 100, 0)).toBe(false)
  })

  it('the dial ships with a business-type default AND a guardrail ceiling', () => {
    // ⚖ mistake-proofing: a manager dial that could be set high enough to wave a
    // whole transaction through is a dial that harms the business that set it.
    expect(cashTolerance).toBe(0)
    expect(MAX_CASH_TOLERANCE).toBeGreaterThan(0)
    expect(PLANE_CODE).toMatch(/MAX_CASH_TOLERANCE/)
    expect(PLANE_SRC).toContain('⚠SETTINGS-BATCH')
  })

  it('a difference OVER the threshold blocks the close and says which reason is missing', async () => {
    const over = { ...closingPlane[STORE_A], cash_counted: 8300 + 700 }
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: over } })
    const cash = props.close!.checks.find((c) => c.key === 'cash')!
    expect({ done: cash.done, status: cash.status }).toEqual({ done: false, status: '差異承認待ち' })
    expect(cash.detail).toContain('差異 ¥700')
    expect(props.close!.cash.reason).toContain('理由が記録されていません')
    expect(props.close!.closeRefusal).toContain('現金計数と差異理由')
  })

  it('a difference UNDER the threshold does not', async () => {
    const inside = { ...closingPlane[STORE_A], cash_counted: 8300 + 300 }
    const { props } = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { closing: inside, tolerance: 500 },
    })
    expect(props.close!.checks.find((c) => c.key === 'cash')!.done).toBe(true)
    expect(props.close!.cash.variance).toBe('¥300')
  })
})

// ── 6. ONE VERDICT, rendered N times ────────────────────────────────────────

describe('閉店できるか is ONE call, rendered wherever the page asks it', () => {
  const verdictFor = (store: string) => {
    const rows = build(store)
    return closingReadiness({
      totals: ledgerTotals(rows),
      closing: closingPlane[store],
      tolerance: cashTolerance,
      heldCount: heldForLens(
        registerPlane.terminal_held,
        new Map(appointments().filter((a) => a.store_id === store).map((a) => [a.id, a])),
        store,
      ).length,
      heldAmount: 0,
      unsettledVisits: [],
    })
  }

  it('the five checks, and the open count is the count of the open ones', () => {
    const v = verdictFor(STORE_A)
    expect(v.checks.map((c) => c.key)).toEqual(['terminal', 'cash', 'outstanding', 'unsettled', 'signoff'])
    expect(v.openCount).toBe(v.checks.filter((c) => !c.done).length)
    expect(v.blockers).toEqual(v.checks.filter((c) => !c.done).map((c) => c.label))
  })

  it('prerequisites are the FOUR the shop can finish; the close also needs the confirmation', () => {
    const v = verdictFor(STORE_A)
    expect(v.prerequisitesReady).toBe(
      v.checks.filter((c) => c.key !== 'signoff').every((c) => c.done),
    )
    expect(v.closeReady).toBe(v.prerequisitesReady && v.managerSigned)
  })

  it('the close BUTTON’s refusal carries the checklist’s own blockers — not a second opinion', async () => {
    const props = await room({ store: STORE_A })
    const blockers = props.close!.checks.filter((c) => !c.done).map((c) => c.label)
    expect(blockers.length).toBeGreaterThan(0)
    for (const b of blockers) expect(props.close!.closeRefusal).toContain(b)
    expect(props.close!.headline).toBe(`${blockers.length}項目 未完了`)
  })

  it('a transaction’s 閉店への影響 reads the same verdict the panel below prints', async () => {
    const props = await room({ store: STORE_A })
    const held = props.rows.find((r) => r.id === 'TX-4827')!
    const partial = props.rows.find((r) => r.id === 'TX-5501')!
    expect(props.close!.checks.find((c) => c.key === 'terminal')!.done).toBe(false)
    expect(held.closingImpact).toContain('決済端末の送信')
    expect(props.close!.checks.find((c) => c.key === 'outstanding')!.done).toBe(false)
    expect(partial.closingImpact).toContain('未収の扱い')
    // …and a row that blocks nothing says so rather than staying silent.
    expect(props.rows.find((r) => r.id === 'TX-4808')!.closingImpact).toContain('妨げていません')
  })

  it('a fully-ready day says so in every place that asks', async () => {
    const ready = {
      ...closingPlane[STORE_A],
      outstanding_decision: '次回来店時に請求',
      manager_signed_at: 20 * 60 + 4,
    }
    const { props } = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { closing: ready, terminalHeld: [] },
    })
    expect(props.close!.openCount).toBe(0)
    expect(props.close!.headline).toBe('閉店の条件はすべて満たしています')
    // Still refused — the day being ready does not make a write buildable.
    expect(props.close!.closeRefusal).toContain('見本データ')
    expect(props.close!.closeRefusal).not.toContain('未完了:')
  })

  it('未精算の施術 is DERIVED — a completed visit with no register row appears by itself', async () => {
    // canon hard-codes one customer's carry-over row; the generalisation is what
    // a second shop would need. Drop the sale for a completed booking and the
    // check has something to say.
    const without = txPlane.filter((t) => t.appointment_id !== 'apt-12')
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { transactions: without } })
    const row = props.close!.checks.find((c) => c.key === 'unsettled')!
    expect(row.done).toBe(false)
    expect(row.detail).toContain('レジ取引未作成')
    expect(row.detail).toContain('見本 いつき')
  })

  it('未精算の施術 counts TODAY’s visits only — the ledger world is full of finished past ones', async () => {
    // The fixture calendar holds ten completed visits on other days and none of
    // them has a register row, so a check that forgot to scope to today would
    // open the close with a list of last month's appointments.
    const past = appointments().filter(
      (a) => a.store_id === STORE_A && a.status === 'done' && jstDayKey(a.starts_at) !== jstDayKey(new Date()),
    )
    expect(past.length).toBeGreaterThan(3)
    const props = await room({ store: STORE_A })
    const row = props.close!.checks.find((c) => c.key === 'unsettled')!
    expect({ done: row.done, detail: row.detail }).toEqual({
      done: true,
      detail: '完了した施術はすべてレジに記録済み',
    })
  })

  it('a store that has taken nothing still has an honest close', async () => {
    const props = await room({ store: STORE_B })
    expect(props.emptyDay).toBe(true)
    expect(props.close!.checks.find((c) => c.key === 'outstanding')!.detail).toBe('未収なし')
    expect(props.close!.checks.find((c) => c.key === 'cash')!.status).toBe('未保存')
  })
})

// ── 7. store isolation, both directions, leaving nothing behind ─────────────

describe('the ledger hides, it never shows-and-refuses', () => {
  it('a 店頭販売 taken in the other store is ABSENT — not greyed, not refused', () => {
    const walkIns = txPlane.filter((t) => t.store_id === STORE_A)
    expect(walkIns.length).toBeGreaterThan(0)
    const rows = build(STORE_B)
    for (const tx of walkIns) expect(rows.some((r) => r.id === tx.id)).toBe(false)
  })

  it('…and it leaves NOTHING behind: no count, no yen, no trace', () => {
    const rows = build(STORE_B)
    expect(countBy(rows)).toEqual({ all: 0, paid: 0, partial: 0, attention: 0 })
    expect(ledgerTotals(rows)).toEqual({ gross: 0, refunds: 0, net: 0, collected: 0, outstanding: 0, cash: 0 })
  })

  it('a booking-backed sale takes its store from the BOOKING, which the lens already clamped', () => {
    const byId = new Map(appointments().map((a) => [a.id, a]))
    for (const tx of txPlane.filter((t) => t.appointment_id !== null)) {
      const booking = byId.get(tx.appointment_id!)!
      expect(transactionStore(tx, byId)).toBe(booking.store_id)
    }
    // With the booking out of reach the row resolves to nothing at all.
    expect(transactionStore({ appointment_id: 'apt-12', store_id: null }, new Map())).toBeNull()
  })

  it('the TERMINAL’s held list is clamped through the bookings it names', () => {
    const all = new Map(appointments().map((a) => [a.id, a]))
    const b = new Map(appointments().filter((a) => a.store_id === STORE_B).map((a) => [a.id, a]))
    expect(heldForLens(registerPlane.terminal_held, all, STORE_A)).toHaveLength(1)
    expect(heldForLens(registerPlane.terminal_held, b, STORE_B)).toHaveLength(0)
    // The storeless lens reads every store, and says so by returning the list.
    expect(heldForLens(registerPlane.terminal_held, all, null)).toEqual(registerPlane.terminal_held)
  })

  it('the OTHER direction: 銀座 sees its own rows and every one of them', () => {
    const rows = build(STORE_A)
    expect(rows.map((r) => r.id).sort()).toEqual([...txPlane].map((t) => t.id).sort())
  })

  it('the view resets when the shop changes which store it is looking at', async () => {
    // `?store=` keeps the same component instance, so the filter and the open
    // transaction would otherwise survive onto a ledger that cannot contain them.
    expect(PAGE_CODE).toContain('key={storeKey}')
    const a = await registerProps({ locale: 'ja', store: STORE_A })
    const b = await registerProps({ locale: 'ja', store: STORE_B })
    expect(a.storeKey).not.toBe(b.storeKey)
  })

  it('a close belongs to ONE store — the drawer counts never merge', async () => {
    const a = await room({ store: STORE_A })
    const b = await room({ store: STORE_B })
    expect(a.close!.cash.counted).toBe('¥8,300')
    expect(b.close!.cash.counted).toBe('¥0')
    // …and the storeless lens gets a stated reason rather than a merged figure.
    expect(SRC_CODE).toContain('rg-noclose')
    expect(PROPS_CODE).toContain('closeUnavailable')
  })
})

// ── 8. capabilities — the gate seen from BOTH sides ─────────────────────────

describe('capabilities are read, never invented', () => {
  it('the demo operator is a 店舗管理者 and passes the gate', () => {
    expect(operator.role).toBe('店舗管理者')
    expect(accessFor(operator.role)).toEqual({ refund: true, close: true, redactSummary: false })
  })

  it('an UNKNOWN role gets nothing — the table fails closed', () => {
    expect(accessFor('まだ決めていない役割')).toEqual(NO_ACCESS)
    expect(NO_ACCESS).toEqual({ refund: false, close: false, redactSummary: true })
  })

  it('a role without the capability loses the CONTROLS, and the money it may not see', async () => {
    // A pin that only ever sees the passing case is not a pin: the room is
    // driven from the other side of its own gate.
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })
    expect(props.permissionNotice).toBe(permissionNotice(SALES_ACCESS_BY_ROLE['スタッフ']))
    expect(props.permissionNotice).toContain('総売上・純売上・受領済みを表示せず')
    expect(props.terminal.canRecheck).toBe(false)
    expect(props.close!.cash.canSave).toBe(false)
    expect(props.close!.canClose).toBe(false)
    for (const r of props.rows) expect(r.canRefund).toBe(false)
    // 権限がありません is a SENTENCE where a figure would be — not a blank, and
    // not a zero, which would read as a day with no takings.
    const redacted = props.money.filter((m) => m.redacted).map((m) => m.value)
    expect(redacted).toEqual(['権限がありません', '権限がありません', '権限がありません'])
    // …and the figures a redacted role IS allowed are still real.
    expect(props.money.find((m) => m.key === 'outstanding')!.value).toBe('¥1,600')
  })

  it('the operator who passes the gate sees no notice at all', async () => {
    const props = await room({ store: STORE_A })
    expect(props.permissionNotice).toBeNull()
  })

  it('the role table is DATA with a fail-closed default, never a `viewRoles` dial that admits everyone', () => {
    expect(Object.keys(SALES_ACCESS_BY_ROLE).sort()).toEqual(['オーナー', 'スタッフ', '店舗管理者'])
    expect(LIB_CODE).toContain('accessFor')
    expect(LIB_CODE).toContain('NO_ACCESS')
  })
})

// ── 9. every button here is a write, and every write is refused ─────────────

describe('reading is buildable; every button on a money desk is a write', () => {
  it('no <dialog> anywhere — canon’s four are not carried, and ⚖ 32 cannot bite', () => {
    expect(SRC_CODE).not.toMatch(/<dialog|showModal|::backdrop/)
    expect(CSS_CODE).not.toMatch(/dialog/)
  })

  it('no toast, no timer — a refusal changes nothing and stays readable (⚖ 47)', () => {
    expect(SRC_CODE).not.toMatch(/setTimeout|showToast|className="toast"/)
    expect(CSS_CODE).not.toMatch(/\.toast/)
  })

  it('every refused control carries its OWN reason on its OWN accessible name', async () => {
    const props = await room({ store: STORE_A })
    const row = props.rows.find((r) => r.id === 'TX-5501')!
    const reasons = [
      props.terminal.recheckRefusal,
      props.close!.cash.saveRefusal,
      props.close!.closeRefusal,
      props.close!.signoffRefusal,
      row.refundRefusal,
      row.outstandingRefusal,
    ]
    for (const r of reasons) expect(r.length).toBeGreaterThan(20)
    // …and they are DIFFERENT reasons: one sentence on six buttons tells the
    // reader nothing about which of them would have done what.
    expect(new Set(reasons).size).toBe(reasons.length)
    // The aria-label carries the reason, not `title` alone — a title-only
    // refusal is invisible to exactly the reader who cannot see it is dead.
    const labels = SRC_CODE.match(/aria-label=\{`[^`]*—[^`]*`\}/g) ?? []
    expect(labels.length).toBeGreaterThanOrEqual(6)
    expect((SRC_CODE.match(/aria-disabled="true"/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it('ONE standing footnote, on screen before anyone reaches for a control', async () => {
    const props = await room({ store: STORE_A })
    expect(props.actionFootnote).toContain('見本データ')
    expect((SRC_CODE.match(/props\.actionFootnote/g) ?? []).length).toBe(2) // the transaction band, and the close
  })

  it('what a refund WOULD reverse is SHOWN, then refused', async () => {
    const props = await room({ store: STORE_A })
    const paid = props.rows.find((r) => r.id === 'TX-4808')!
    expect(paid.refundPreview).toBe('現金 −¥6,600')
    expect(paid.refundNote).toContain('元の決済行は書き換えず')
    // …and a sale with nothing to give back says that instead of an empty box.
    const refunded = props.rows.find((r) => r.id === 'TX-5502')!
    expect(refunded.refundPreview).toBeNull()
    expect(refunded.refundNote).toContain('すでに返金済み')
  })

  it('what a CLOSE would record is shown too, and it is the same day’s figures', async () => {
    const props = await room({ store: STORE_A })
    const record = new Map(props.close!.record.map((r) => [r.label, r.value]))
    for (const m of props.money) expect(record.get(m.label)).toBe(m.value)
    expect(record.get('取引件数')).toBe('5件')
    expect(record.get('バージョン')).toBe('閉店 v1')
  })

  it('決済手段の内訳 balances against 受領済み, and says so', async () => {
    const props = await room({ store: STORE_A })
    expect(props.close!.reconciliationBalanced).toBe(true)
    expect(props.close!.reconciliationNote).toContain('¥21,500')
    const recon = tenderReconciliation(build(STORE_A), ledgerTotals(build(STORE_A)).collected)
    expect(recon.received + recon.reversed).toBe(recon.net)
    // 未収 is not a tender — nothing arrived on it.
    expect(recon.rows.some((r) => r.channel === 'unpaid')).toBe(false)
  })

  it('予約一覧で事実を確認 is a LINK where there is a booking, and a refusal where there is not', async () => {
    const props = await room({ store: STORE_A })
    const booked = props.rows.find((r) => r.id === 'TX-4808')!
    const walkIn = props.rows.find((r) => r.id === 'TX-5501')!
    expect(booked.bookingHref).toBe(`/ja/business/reservations?store=${encodeURIComponent(STORE_A)}`)
    expect(walkIn.bookingHref).toBeNull()
    expect(walkIn.bookingRefusal).toContain('予約がないため')
  })

  it('the room holds only VIEW state — nothing a refusal could write into', () => {
    const states = SRC_CODE.match(/useState[<(]/g) ?? []
    // filter · selected · detailOpen · tourIdx · tourTick · tourStep · tourPos ·
    // tourHover. All eight are browsing; none of them writes anything.
    expect(states).toHaveLength(8)
    expect(SRC_CODE).not.toMatch(/useState<[^>]*>\(\s*props\./)
  })
})

// ── 10. data states: empty · one · many · the edges ─────────────────────────

describe('empty · one · many · the longest strings · the far clocks', () => {
  it('ZERO transactions renders the designed day, not an empty panel', async () => {
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { transactions: [] } })
    expect(props.emptyDay).toBe(true)
    expect(props.counts).toEqual({ all: 0, paid: 0, partial: 0, attention: 0 })
    expect(props.money.every((m) => m.value === '¥0' || m.value === '権限がありません')).toBe(true)
  })

  it('ONE transaction renders like five', async () => {
    const one = [txPlane.find((t) => t.id === 'TX-4808')!]
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { transactions: one } })
    expect(props.emptyDay).toBe(false)
    expect(props.counts).toEqual({ all: 1, paid: 1, partial: 0, attention: 0 })
    expect(props.money.find((m) => m.key === 'gross')!.value).toBe('¥6,600')
  })

  it('the LONGEST strings do not lose their tail — the row ellipsises, the DOM keeps the value', async () => {
    const long: FixtureTransaction = {
      ...txPlane.find((t) => t.id === 'TX-5501')!,
      id: 'TX-9999',
      item: 'テスト'.repeat(40),
    }
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { transactions: [long] } })
    expect(props.rows[0].what).toBe(long.item)
    // Three fields in the row are deliberately one line; the sheet ellipsises
    // them and the full value is still in the DOM.
    for (const cls of ['rg-line1 strong', 'rg-what', 'rg-tender']) {
      expect(CSS_CODE).toMatch(new RegExp(`\\.${cls.split(' ')[0]}[^{]*\\{[^}]*text-overflow: ellipsis`))
    }
  })

  it('the room renders on ANY date — 2026-08-24, a year end, and a leap February', async () => {
    for (const iso of ['2026-08-24T04:00:00Z', '2026-12-31T04:00:00Z', '2028-02-29T04:00:00Z']) {
      const unpin = pin(iso)
      try {
        const props = await room({ store: STORE_A })
        expect(props.counts.all).toBe(5)
        expect(props.money.find((m) => m.key === 'gross')!.value).toBe('¥24,200')
        expect(props.dateline).toContain('サンプルデータ')
      } finally {
        unpin()
      }
    }
  })

  it('every figure on the page is a STRING by the time it crosses the boundary', async () => {
    const props = await room({ store: STORE_A })
    for (const m of props.money) expect(typeof m.value).toBe('string')
    for (const r of props.rows) {
      expect(typeof r.totalLabel).toBe('string')
      expect(typeof r.receivedLabel).toBe('string')
      for (const t of r.tenders) expect(typeof t.amount).toBe('string')
    }
    expect(typeof props.close!.cash.variance).toBe('string')
  })
})

// ── 11. the ledger at scale ────────────────────────────────────────────────

describe('⚖ ANY-ROSTER-SIZE — the ledger holds a busy day', () => {
  const synthetic = (count: number): FixtureTransaction[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `TX-9${String(i).padStart(3, '0')}`,
      appointment_id: null,
      store_id: STORE_A,
      customer_id: null,
      item: `合成物販 ${i}`,
      amount: 1000 + i,
      at: 10 * 60 + (i % 200),
      tenders:
        i % 3 === 0
          ? [{ label: '現金', amount: 1000 + i, flag: '' as const }]
          : i % 3 === 1
            ? [
                { label: 'カード', amount: 500, flag: '' as const },
                { label: '未収', amount: 500 + i, flag: 'unpaid' as const },
              ]
            : [
                { label: '現金', amount: 1000 + i, flag: '' as const },
                { label: '現金 返金', amount: -(1000 + i), flag: 'refund' as const },
              ],
      audit: [],
    }))

  it('120 transactions: the counts are exact and every row still balances', async () => {
    const world = synthetic(120)
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { transactions: world } })
    expect(props.counts.all).toBe(120)
    expect(props.counts.paid + props.counts.partial + props.counts.attention).toBe(120)
    expect(props.rows).toHaveLength(120)
    const rows = build(STORE_A, { transactions: world })
    for (const r of rows) expect({ id: r.id, ok: rowBalances(r) }).toEqual({ id: r.id, ok: true })
  })

  it('120 transactions: the strip still equals the sum of the rows it sits above', () => {
    const rows = build(STORE_A, { transactions: synthetic(120) })
    const t = ledgerTotals(rows)
    expect(t.net).toBe(t.collected + t.outstanding)
    expect(t.gross).toBe(rows.reduce((n, r) => n + r.total, 0))
  })

  it('the derivation is LINEAR in the number of rows, not quadratic', () => {
    // Counted, not timed: the ledger builds four Maps up front and every lookup
    // goes through one of them, so the row loop does no scanning. A `find` over
    // the customer ledger per row is the shape this pin forbids.
    expect(LIB_CODE).not.toMatch(/input\.customers\.find|input\.appointments\.find|input\.menus\.find/)
    for (const m of ['customerById', 'menuById', 'byId', 'heldBy']) expect(LIB_CODE).toContain(`${m} = new Map`)
  })

  it('⚖ PAGE-SCROLL — no wrapper in this room caps a height or owns an axis', () => {
    expect(CSS_CODE).not.toMatch(/max-height/)
    expect(CSS_CODE).not.toMatch(/overflow-y\s*:/)
    expect(CSS_CODE).not.toMatch(/overscroll-behavior/)
    // The ledger is a LIST, not a table: nothing here needs a horizontal pan, so
    // no container owns one and the sticky-column question never arises.
    expect(SRC_CODE).not.toMatch(/<table|<thead|<tbody/)
    // The only `overflow: hidden` allowed is on boxes that hold NO pressable —
    // a clipping container erases the shell's offset focus ring (room-3 F2).
    const clipped = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*overflow:\s*hidden/g)].map((m) => m[1].trim())
    for (const sel of clipped) {
      expect({ sel, holdsAPressable: /rg-counts|rg-money|rg-terminal|rg-panel\b|rg-list|rg-workspace/.test(sel) }).toEqual({
        sel,
        holdsAPressable: false,
      })
    }
  })
})

// ── 12. the sheet cannot reach another room, and no other room can reach it ─

describe('⚖ the sibling-sheet fence, derived FRESH from today’s sheets', () => {
  const BIZ = join(process.cwd(), 'src/app/[locale]/(business)')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectorsOf = (src: string) =>
    strip(src)
      .split('}')
      .flatMap((block) => {
        const i = block.indexOf('{')
        return i < 0 ? [] : block.slice(0, i).split(',').map((s) => s.trim()).filter(Boolean)
      })
      .filter((s) => !s.startsWith('@'))
  const classesIn = (sel: string) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((n) => n !== 'biz')

  const SIBLING_DIRS = readdirSync(join(BIZ, 'business')).filter((d) => {
    if (d === 'register') return false
    try {
      readFileSync(join(BIZ, 'business', d, `${d}.css`))
      return true
    } catch {
      return false
    }
  })

  /** Every class name this room's own sheet or markup uses. */
  const mine = new Set<string>(['pill', 'good', 'warn', 'alert', 'indigo', 'btn', 'primary', 'danger', 'page'])
  for (const sel of selectorsOf(CSS)) {
    if (!sel.includes('pg-register')) continue
    for (const c of classesIn(sel)) if (c !== 'pg-register') mine.add(c)
  }

  it('the neighbours are all here — the list is read from disk, never restated', () => {
    expect(SIBLING_DIRS.sort()).toEqual(['analytics', 'customers', 'inbox', 'reservations', 'shifts', 'today'])
  })

  it('every sibling rule that could reach this room is FENCED at four levels', () => {
    const collisions: string[] = []
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      for (const sel of selectorsOf(src)) {
        if (!sel.startsWith('.biz') || sel.includes('.pg-')) continue
        const names = classesIn(sel)
        if (names.length && names.every((n) => mine.has(n))) collisions.push(`${dir}::${sel}`)
      }
    }
    // Derived, not copied: if a neighbour ever states a bare rule on a name this
    // room renders, it appears here and the fence has to grow in the same pass.
    expect(collisions.sort()).toEqual([
      'customers::.biz .page .btn',
      'reservations::.biz .btn',
      'reservations::.biz .btn.primary',
    ])
    // …and this room states its own value for each of them, at FOUR levels, so a
    // sibling's three-level rule cannot win on insertion order.
    expect(CSS_CODE).toContain('.biz .page.pg-register .btn { font-weight: 500; }')
    expect(CSS_CODE).toContain('.biz .page.pg-register .btn.primary { font-weight: 600; }')
  })

  it('the room’s own PAGE rule is four levels — never three, which ties', () => {
    // ⚖ M10 discipline, caught by the battery: the `.btn` pins below are a
    // different line, so dropping the PAGE rule to three levels went unnoticed.
    // The base sheet must state the four-level spelling and must never state the
    // three-level one as a page rule of its own — a tie at three is decided by
    // whichever sheet App Router happened to insert last.
    const base = CSS_CODE.slice(0, CSS_CODE.indexOf('@media'))
    expect(base).toContain('.biz .page.pg-register { padding:')
    expect(base).not.toMatch(/\.biz \.pg-register \{/)
    expect(base).toContain('.biz .page.pg-register h1 {')
  })

  it('every class name the SCREEN renders is this room’s own, or one of the shell’s three', () => {
    // ⚖ M10 discipline, caught by the battery: the collision list above is
    // derived from the SHEET, so a class name that appears only in the MARKUP —
    // `fact-grid`, `summary`, `inspector` — was invisible to it while being
    // exactly the kind of shared name a neighbour states bare rules on.
    const rendered = new Set<string>()
    for (const m of SRC_CODE.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      // A template literal's `${…}` holes are EXPRESSIONS, not class names —
      // stripped before splitting, or `current` and `tone` read as classes.
      for (const name of (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (name && /^[a-z][\w-]*$/.test(name)) rendered.add(name)
      }
    }
    // The shell's own vocabulary this room deliberately reuses, plus its own
    // state classes. Everything else must carry the `rg-` prefix.
    const SHELL = new Set(['page', 'pg-register', 'btn', 'primary', 'danger', 'pill', 'good', 'warn', 'alert', 'indigo', 'bad', 'ok', 'attention', 'redacted', 'refund', 'unpaid', 'selected'])
    const strays = [...rendered].filter((n) => !n.startsWith('rg-') && !SHELL.has(n))
    expect(strays).toEqual([])
    expect([...rendered].filter((n) => n.startsWith('rg-')).length).toBeGreaterThan(30)
  })

  it('this room’s own names exist NOWHERE else in the family', () => {
    const own = [...mine].filter((n) => n.startsWith('rg-'))
    expect(own.length).toBeGreaterThan(30)
    for (const dir of SIBLING_DIRS) {
      const src = readFileSync(join(BIZ, 'business', dir, `${dir}.css`), 'utf8')
      for (const n of own) {
        expect({ dir, name: n, used: src.includes(`.${n}`) }).toEqual({ dir, name: n, used: false })
      }
    }
  })

  it('nothing this sheet says can escape `.pg-register`', () => {
    for (const sel of selectorsOf(CSS)) {
      expect({ sel, scoped: sel.includes('pg-register') }).toEqual({ sel, scoped: true })
    }
  })

  it('今日の運営 owns `.register-cell` — this room does not go near it', () => {
    const today = readFileSync(join(BIZ, 'business/today/today.css'), 'utf8')
    expect(today).toContain('.biz .register-cell')
    expect(CSS_CODE).not.toContain('register-cell')
    expect(SRC_CODE).not.toContain('register-cell')
  })
})

// ── 13. the ladder, R13, and the shell ─────────────────────────────────────

describe('⚖ ALL-SCREEN ADAPTIVITY, R13, and the shell that points here', () => {
  it('every band of the approved ladder is stated, in order', () => {
    const bands = [...CSS_CODE.matchAll(/@media ([^{]+)\{/g)].map((m) => m[1].trim())
    expect(bands).toEqual([
      '(min-width: 1400px)',
      '(max-width: 1279px)',
      '(max-width: 1099px)',
      '(max-width: 1023px)',
      '(min-width: 800px) and (max-width: 1023px)',
      '(max-width: 743px)',
      '(prefers-reduced-motion: reduce)',
    ])
  })

  it('800–1023 keeps the inner pair side by side; ≤1099 stacks it', () => {
    const foldable = CSS_CODE.slice(CSS_CODE.indexOf('@media (min-width: 800px) and (max-width: 1023px)'))
    expect(foldable).toMatch(/\.rg-grid \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/)
    const narrow = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 1099px)'), CSS_CODE.indexOf('@media (max-width: 1023px)'))
    expect(narrow).toMatch(/\.rg-grid \{ grid-template-columns: minmax\(0, 1fr\);/)
  })

  it('≤743 is list-is-the-page, with a way back and ≥44px targets', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(phone).toContain('.rg-detail { display: none; }')
    expect(phone).toContain('.pg-register.is-detail .rg-ledger { display: none; }')
    expect(phone).toMatch(/\.rg-back \{[^}]*min-height: 44px/)
    expect(phone).toMatch(/\.rg-help::after \{[^}]*width: 44px; height: 44px/)
    // …and the swap hands focus over in both directions rather than dropping the
    // reader at the top of the document. ⚖ M10 discipline, caught by the
    // battery: `toContain('backRef.current!.focus()')` stayed true with the call
    // wrapped in `if (false)`, so the CONDITION is pinned with it — and the
    // condition is the DOM's own band test, never a restated 743.
    expect(SRC_CODE).toContain('if (phoneSwap.current) backRef.current!.focus()')
    expect(SRC_CODE).toContain('phoneSwap.current = backRef.current !== null && backRef.current.offsetParent !== null')
    expect(SRC_CODE).toContain('if (row) document.getElementById(row)?.focus()')
  })

  it('R13 — no black-filled interactive element, and the selected state is a wash', () => {
    expect(CSS_CODE).not.toMatch(/background:\s*(#000|#18181b|black|var\(--ink\))/)
    expect(CSS_CODE).toContain('.rg-row.selected { background: var(--indigo-soft); box-shadow: inset 3px 0 0 var(--indigo); }')
    expect(CSS_CODE).toMatch(/\.rg-counts button\[aria-pressed="true"\] \{ background: var\(--indigo-soft\); \}/)
    // The one-way accent law: the quiet filter takes an accent LABEL and an
    // underline, never a fill.
    expect(CSS_CODE).toMatch(/\.rg-filter\[aria-pressed="true"\] \{ color: var\(--select-ink\)/)
  })

  it('the room states no focus rule of its own — the shell already owns it', () => {
    expect(CSS_CODE).not.toMatch(/outline/)
  })

  it('the shell knows this room is live, and the crumb names it', () => {
    const sidebar = readFileSync(join(BIZ_DIR, 'BusinessSidebar.tsx'), 'utf8')
    const topbar = readFileSync(join(BIZ_DIR, 'BusinessTopbar.tsx'), 'utf8')
    expect(sidebar).toContain("{ key: 'register', segment: 'register', label: '売上・レジ', mini: '売上', live: true }")
    expect(topbar).toContain("register: '売上・レジ',")
  })

  it('the loading state is Next’s own, and its string is the room’s', () => {
    const loading = readFileSync(join(process.cwd(), `${ROOM_DIR}/loading.tsx`), 'utf8')
    expect(loading).toContain('businessStrings.register.loading')
  })
})

const BIZ_DIR = join(process.cwd(), 'src/app/[locale]/(business)')

// ── 14. the reconnect seam ─────────────────────────────────────────────────

describe('⚖ RECONNECT-READINESS — one door, contract-shaped data only', () => {
  it('the room reads through the fixture door and nothing else', () => {
    // No client of any kind: every read is `@/business/lib/data`'s store-clamped
    // fixture door plus the room's own plane.
    expect(PROPS_CODE).not.toMatch(/supabase|createClient|fetch\(/)
    // The derivations import three modules and no door at all. That list is
    // pinned EXACTLY by `foundation.test.ts`'s sealed inventory rather than
    // grepped here — a suite that greps for import syntax writes import syntax
    // into its own source, and the territory isolation guard reads every file
    // in this folder including this one (caught on the first full run).
    expect(LIB_CODE).not.toMatch(/supabase|createClient|process\.env/)
  })

  it('the derivations are PURE — no clock, no Intl, no data access in the lib', () => {
    expect(LIB_CODE).not.toMatch(/new Date|Intl\.|Date\.now/)
  })

  it('ONE clock read per render feeds the whole page', () => {
    expect((PROPS_CODE.match(/renderNow\(\)/g) ?? []).length).toBe(1)
    expect(SRC_CODE).not.toMatch(/new Date|Date\.now/)
  })
})
