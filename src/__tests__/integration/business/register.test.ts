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
  type FixtureClosing,
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
  cashReasonLine,
  countedCash,
  DENOMINATION_LABEL,
  denominationTotal,
  expectedCash,
  FILTERS,
  heldForLens,
  ledgerTotals,
  matchesFilter,
  NO_ACCESS,
  permissionNotice,
  cashClosingReady,
  refundPreview,
  REFUND_MISMATCH,
  resolveTolerance,
  rowBalances,
  SALES_ACCESS_BY_ROLE,
  STATE_LABEL,
  STATE_PILL,
  tenderReconciliation,
  transactionStore,
  varianceRequiresApproval,
  type LedgerInput,
  type TransactionModel,
  type TransactionState,
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

/** ⚖ A DRAWER IS OUT BY NOTES AND COINS, NEVER BY A FIELD. 実査額 is what the count
 *  sheet adds up to (`countedCash`), so a world where the drawer is ¥700 over is a
 *  world holding one more ¥500 and two more ¥100 — the only way a real till is
 *  ever out. These worlds used to be built by adding a number to `cash_counted`
 *  while the sheet underneath stayed where it was, which is exactly the drift
 *  F-R2 made unrepresentable. The stored field moves WITH the sheet here, because
 *  a fixture world is product truth (⚖ 8/9); the one world where they disagree is
 *  written out by hand, in the pin that exists to prove which of them wins. */
const withCoins = (base: FixtureClosing, add: Array<[number, number]>): FixtureClosing => {
  const sheet = base.cash_count_sheet.map((d) => {
    const bump = add.find(([denomination]) => denomination === d.denomination)
    return bump ? { ...d, count: d.count + bump[1] } : d
  })
  return { ...base, cash_count_sheet: sheet, cash_counted: denominationTotal(sheet) }
}
/** The drawer somebody emptied — every count zero. The only representable way a
 *  till is tens of thousands short. */
const emptyDrawer = (base: FixtureClosing): FixtureClosing => {
  const sheet = base.cash_count_sheet.map((d) => ({ ...d, count: 0 }))
  return { ...base, cash_count_sheet: sheet, cash_counted: 0 }
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
    const c = closingPlane[STORE_A]
    // ⚠ AND THE EXPECTATION INCLUDES THE FLOAT. A drawer that opened with
    // 釣銭準備金 in it holds that money at closing time too; expecting only the
    // day's takings would report the float as a difference every evening.
    const expected = expectedCash(
      { float: c.cash_float, paidIn: c.cash_paid_in, paidOut: c.cash_paid_out, bankDeposit: c.cash_bank_deposit },
      totals.cash,
    )
    expect(cashVariance(c.cash_counted, expected)).toBe(registerPlane.cash_difference)
  })

  it('⑩ THE COUNT SHEET IS THE COUNT — 金種 adds up to 実査額, machine-checked', () => {
    // The whole point of counting by denomination is that nobody adds a column
    // up by hand. A sheet that disagreed with the figure it produces would be
    // the mis-addition the feature exists to prevent, printed as evidence.
    for (const [store, c] of Object.entries(closingPlane)) {
      expect({ store, sheet: denominationTotal(c.cash_count_sheet) }).toEqual({ store, sheet: c.cash_counted })
    }
  })

  it('⑩ every note and coin the sheet names has a label, and the sheet names them all', () => {
    const sheet = closingPlane[STORE_A].cash_count_sheet
    expect(sheet.length).toBe(9)
    for (const d of sheet) {
      expect({ d: d.denomination, label: DENOMINATION_LABEL[d.denomination] ?? null }).not.toEqual({
        d: d.denomination,
        label: null,
      })
    }
  })

  it('⚠ 期待額 CARRIES THE MOVEMENT TERMS, so connecting the entry screens is not a re-derivation', () => {
    // ZERO in this world, present in the arithmetic: a shop tops its change up
    // from the safe and banks its notes before closing, and each one moves the
    // drawer without moving a sale (registry ⑭).
    expect(expectedCash({ float: 30000, paidIn: 0, paidOut: 0, bankDeposit: 0 }, 9620)).toBe(39620)
    expect(expectedCash({ float: 30000, paidIn: 5000, paidOut: 2000, bankDeposit: 20000 }, 9620)).toBe(22620)
    for (const c of Object.values(closingPlane)) {
      expect([c.cash_paid_in, c.cash_paid_out, c.cash_bank_deposit]).toEqual([0, 0, 0])
    }
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
      const legal = new Set(row.tenders.flatMap((t) => [yen(Math.abs(t.amount)), yen(t.amount)]))
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
    // ⚠ RE-DERIVED for the nameless ¥1,320 counter sale the world gained: five
    // rows became six, and every figure below moved with it. The neighbouring
    // pin proves the same numbers are sums over the rows; this one is the
    // reading an owner does with their eyes.
    expect(ledgerTotals(build(STORE_A))).toEqual({
      gross: 25520,
      refunds: 1100,
      net: 24420,
      collected: 22820,
      outstanding: 1600,
      cash: 9620,
    })
  })

  it('⚖ A ROW WITH NOBODY ON IT IS COMPACT, and the headline is what was sold', () => {
    // The most common row in a 物販 business, and the shape a treatment-only
    // fixture world never produced: no booking, no customer, no name.
    const row = byTx(build(STORE_A), 'TX-5503')
    expect(row.nameless).toBe(true)
    expect(row.bookingNo).toBeNull()
    expect(row.what).toBe('ヘアバーム（店頭販売）')
    // …and every OTHER row still has its person.
    for (const r of build(STORE_A).filter((r) => r.id !== 'TX-5503')) {
      expect({ id: r.id, nameless: r.nameless }).toEqual({ id: r.id, nameless: false })
    }
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

  it('THE FAMILY’S ONE formatter prints a MINUS SIGN, and never a negative zero', () => {
    // ⚖ ONE FORMATTER, ONE MINUS. The room used to wrap `yen` in a `signedYen`
    // of its own, which left the family with two spellings of a negative and
    // seven call sites still on the unsigned one — every one of them a
    // 「¥-1,100」 waiting for the first negative figure to reach it. The sign rule
    // is canon's own (:1163-1166) and it now lives in the family's formatter, so
    // there is nothing left to forget to call.
    expect(yen(-1100)).toBe('−¥1,100')
    expect(yen(1100)).toBe('¥1,100')
    // The minus is the PROPER one, never the ASCII hyphen `toLocaleString`
    // buries inside the digits — and it sits BEFORE the ¥, not inside the number.
    expect(yen(-1100).startsWith('−¥')).toBe(true)
    expect(yen(-1100)).not.toContain('-')
    // `-0 < 0` is false and `(-0).toLocaleString('ja-JP')` is 「-0」, so a day
    // with no refunds printed 「¥-0」 on the first render. Both spellings of zero
    // are pinned.
    expect(yen(0)).toBe('¥0')
    expect(yen(-0)).toBe('¥0')
    // The rounding the family already had is untouched by the sign rule, in
    // both directions.
    expect(yen(-0.4)).toBe('¥0')
    expect(yen(-1100.6)).toBe('−¥1,101')
  })

  it('THE ROOM HAS NO SECOND FORMATTER — every ¥ on the page is the family’s', () => {
    // The wrapper is gone rather than deprecated: a second spelling that still
    // compiles is a second spelling somebody reaches for.
    expect(LIB_CODE).not.toMatch(/signedYen/)
    expect(PROPS_CODE).not.toMatch(/signedYen/)
    // …and the props layer imports the formatter it uses from the board, not a
    // local of its own.
    expect(PROPS_CODE).toContain("import { hhmm, yen } from '@/business/lib/today-board'")
  })

  it('EVERY negative figure the room can print goes through it — no unsigned call site left', async () => {
    // The seven call sites the wrapper never covered. Driven through a world
    // where each one is genuinely negative, so a site still on an unsigned
    // formatter prints an ASCII hyphen and this goes red.
    const over: FixtureTransaction[] = [
      {
        id: 'TX-OVER',
        appointment_id: null,
        store_id: STORE_A,
        customer_id: 'cus-05',
        item: '過返金の検証',
        amount: 1100,
        at: 13 * 60,
        tenders: [
          { label: '現金', amount: 1100, flag: '' },
          { label: '現金 返金', amount: -1100, flag: 'refund' },
          { label: '現金 返金', amount: -400, flag: 'refund' },
        ],
        audit: [],
      },
    ]
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { transactions: over } })
    const row = props.rows[0]
    const printed = [
      row.receivedLabel,
      row.subAmount?.value ?? '',
      ...row.facts.map((f) => f.value),
      ...row.tenders.map((t) => t.amount),
      ...props.money.map((m) => m.value),
      props.close!.cash.variance,
      ...props.close!.record.map((r) => r.value),
      ...props.close!.reconciliation.flatMap((r) => [r.received, r.reversed, r.net]),
    ]
    // Not one ASCII hyphen anywhere a yen figure is printed, and at least one
    // real negative in the set — a pin that saw only positives would pass for
    // the wrong reason.
    expect(printed.filter((p) => p.includes('−¥')).length).toBeGreaterThan(0)
    for (const p of printed) expect({ p, ascii: /¥-|-¥\d/.test(p) }).toEqual({ p, ascii: false })
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

// ── 2b. the state machine covers MONEY GIVEN BACK ───────────────────────────

/** One walk-in, built to order, so each shape can be driven through the REAL
 *  derivations rather than argued about. */
const walkIn = (id: string, amount: number, tenders: FixtureTransaction['tenders']): FixtureTransaction => ({
  id,
  appointment_id: null,
  store_id: STORE_A,
  customer_id: 'cus-05',
  item: '状態の検証',
  amount,
  at: 13 * 60,
  tenders,
  audit: [],
})

describe('⚖ money that moved back is never 精算済み', () => {
  const shapes: Array<[string, FixtureTransaction, TransactionState]> = [
    ['settled in cash', walkIn('TX-S1', 1100, [{ label: '現金', amount: 1100, flag: '' }]), 'paid'],
    [
      'part-paid, the rest owed',
      walkIn('TX-S2', 1100, [
        { label: '現金', amount: 700, flag: '' },
        { label: '未収', amount: 400, flag: 'unpaid' },
      ]),
      'partial',
    ],
    [
      'reversed in FULL — canon’s 返金',
      walkIn('TX-S3', 1100, [
        { label: '現金', amount: 1100, flag: '' },
        { label: '現金 返金', amount: -1100, flag: 'refund' },
      ]),
      'refunded',
    ],
    [
      'reversed in FULL as a 取消 — canon’s other kind',
      walkIn('TX-S4', 1100, [
        { label: '現金', amount: 1100, flag: '' },
        { label: '現金 取消', amount: -1100, flag: 'refund' },
      ]),
      'voided',
    ],
    [
      'PART of the money went back and part of it stayed',
      walkIn('TX-S5', 1100, [
        { label: '現金', amount: 1100, flag: '' },
        { label: '現金 返金', amount: -400, flag: 'refund' },
      ]),
      'partial-refund',
    ],
  ]

  it.each(shapes)('%s → %s', (_what, tx, state) => {
    const row = build(STORE_A, { transactions: [tx] })[0]
    expect({ id: tx.id, state: row.state, label: row.stateLabel }).toEqual({
      id: tx.id,
      state,
      label: STATE_LABEL[state],
    })
  })

  it('一部返金 is its own state, its own pill and its own place under 要確認', () => {
    // The shape the first cut called 精算済み: the drawer is short by the
    // reversal, the close has to re-count, and the ledger said "nothing left to
    // do" over it.
    expect(STATE_LABEL['partial-refund']).toBe('一部返金')
    expect(STATE_PILL['partial-refund']).not.toBe(STATE_PILL.paid)
    expect(STATE_PILL['partial-refund']).not.toBe(STATE_PILL.refunded)
    const row = build(STORE_A, { transactions: [shapes[4][1]] })[0]
    expect(row.filter).toBe('attention')
    expect({ received: row.received, reversed: row.reversed }).toEqual({ received: 700, reversed: 400 })
  })

  it('要確認 catches EVERY row with money moved back — none of them counts as 精算済み', () => {
    const world = shapes.map(([, tx]) => tx)
    const rows = build(STORE_A, { transactions: world })
    const counts = countBy(rows)
    expect(counts).toEqual({ all: 5, paid: 1, partial: 1, attention: 3 })
    // Not one row with a reversal on it may sit in 精算済み — and each of them
    // lands in 要確認 rather than merely somewhere else.
    for (const r of rows.filter((x) => x.reversed > 0)) {
      expect({ id: r.id, filter: r.filter }).toEqual({ id: r.id, filter: 'attention' })
    }
    expect(rows.filter((r) => r.reversed > 0)).toHaveLength(3)
  })

  it('返金 and 取消 stay TOLD APART, all the way to the screen', async () => {
    const { props } = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { transactions: [shapes[2][1], shapes[3][1]] },
    })
    const label = (id: string) => props.rows.find((r) => r.id === id)!.stateLabel
    expect({ refund: label('TX-S3'), voided: label('TX-S4') }).toEqual({ refund: '返金済み', voided: '取消済み' })
    const impact = (id: string) => props.rows.find((r) => r.id === id)!.closingImpact
    expect(impact('TX-S3')).toContain('返金済み')
    expect(impact('TX-S4')).toContain('取消済み')
  })

  it('閉店への影響 tells a 一部返金 row what canon says a reversal costs the day', async () => {
    const { props } = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { transactions: [shapes[4][1]] },
    })
    // canon's own consequence line, on the row that carries the consequence.
    expect(props.rows[0].closingImpact).toContain('現金の返金は期待額を減らし、再計数の対象になります')
    expect(props.rows[0].closingImpact).toContain('一部が返金されている')
  })

  it('⚖ A11 — an OVER-refund says so out loud, and is never silent', async () => {
    const over = walkIn('TX-OVER', 1100, [
      { label: '現金', amount: 1100, flag: '' },
      { label: '現金 返金', amount: -1500, flag: 'refund' },
    ])
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { transactions: [over] } })
    const row = props.rows[0]
    const fact = row.facts.find((f) => f.label === '過返金')
    expect(fact).toBeDefined()
    expect(fact!.value).toContain('受領額を超える返金')
    expect(fact!.tone).toBe('bad')
    // …it lands under 要確認, and the close is told.
    expect(row.filter).toBe('attention')
    expect(row.closingImpact).toContain('受領額を超える返金')
    // …and the received figure itself is printed NEGATIVE rather than hidden.
    expect(row.receivedLabel).toBe('−¥400')
  })

  it('a row that is BOTH held and part-refunded keeps both facts', async () => {
    // One state word can only say one thing, so the headline goes to the money
    // that moved back — and the terminal is named off the row's own pending
    // LINE rather than off that word, which is what keeps the second fact.
    const held = registerPlane.terminal_held
    const tx: FixtureTransaction = {
      id: 'TX-4827',
      appointment_id: 'apt-25',
      store_id: null,
      customer_id: null,
      item: null,
      amount: null,
      at: 12 * 60 + 15,
      tenders: [{ label: '現金 返金', amount: -600, flag: 'refund' }],
      audit: [],
    }
    const { props } = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { transactions: [tx], terminalHeld: held },
    })
    const row = props.rows[0]
    expect(row.state).toBe('partial-refund')
    expect(row.closingImpact).toContain('決済端末の送信')
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
    expect(countBy(rows)).toEqual({ all: 6, paid: 3, partial: 1, attention: 2 })
    for (const r of rows) {
      const hits = (['paid', 'partial', 'attention'] as const).filter((f) => matchesFilter(r, f))
      expect({ id: r.id, slices: hits.length }).toEqual({ id: r.id, slices: 1 })
    }
  })

  it('the ledger is newest-first, which is how a desk reads its own day back', () => {
    const rows = build(STORE_A)
    expect(rows.map((r) => r.id)).toEqual(['TX-5502', 'TX-5503', 'TX-5501', 'TX-4827', 'TX-4812', 'TX-4808'])
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
    expect(props.terminal!.copy).toContain('12:15以降')
    expect(props.terminal!.copy).toContain('現金と受付価格には影響しません')
    expect(props.rows.some((r) => r.tenderSummary === 'カード' && r.state === 'paid')).toBe(true)
  })

  it('二重請求 is DERIVED from the idempotency ids the world carries, not asserted', async () => {
    const props = await room({ store: STORE_A })
    expect(props.terminal!.stats.find((s) => s.label === '二重請求')!.value).toBe('0件')
    // Two held rows sharing an idempotency id is one duplicate — the derivation
    // has something to say rather than a hard-coded zero.
    const dup = registerPlane.terminal_held[0]
    const { props: doubled } = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { terminalHeld: [dup, { ...dup, appointment_id: dup.appointment_id }] },
    })
    expect(doubled.terminal!.stats.find((s) => s.label === '二重請求')!.value).toBe('1件')
  })

  it('⧉ AN EMPTY TERMINAL HAS NO BAND AT ALL — presence is the data, never a business type', () => {
    // The band used to be a permanent slot that said 「異常なし」 on a good day.
    // A band whose whole job is to be alarming, printed 364 evenings out of 365
    // saying nothing happened, is how a reader learns to skip the one evening it
    // matters — and it is the 26業種 lever too: a shop with no card terminal
    // never holds a record, so it never sees the band, with no type branch.
    expect(SRC_CODE).toContain('{props.terminal && (')
    expect(SRC_CODE).toContain('terminal: RegisterTerminalProps | null')
    expect(PROPS_CODE).toContain('terminalHeld.length === 0\n        ? null')
  })

  it('an EMPTY terminal drops the band, and stops blocking the close', async () => {
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { terminalHeld: [] } })
    expect(props.terminal).toBeNull()
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
    // The plane records what was counted, and nothing about a difference. It
    // DOES record `variance_approved` — that is a decision somebody made about a
    // difference, not the difference itself — so the pin names the quantity
    // rather than the word.
    expect(PLANE_CODE).not.toMatch(/cash_difference|variance_amount|cash_variance/)
    expect(PLANE_CODE).not.toMatch(/variance(?!_approved)/)
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
    const over = withCoins(closingPlane[STORE_A], [[500, 1], [100, 2]])
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: over } })
    const cash = props.close!.checks.find((c) => c.key === 'cash')!
    expect({ done: cash.done, status: cash.status }).toEqual({ done: false, status: '差異承認待ち' })
    expect(cash.detail).toContain('差異 ¥700')
    expect(props.close!.cash.reason).toContain('理由が記録されていません')
    expect(props.close!.closeRefusal).toContain('現金計数と差異理由')
  })

  it('a difference UNDER the threshold does not', async () => {
    const inside = withCoins(closingPlane[STORE_A], [[100, 3]])
    const { props } = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { closing: inside, tolerance: 500 },
    })
    expect(props.close!.checks.find((c) => c.key === 'cash')!.done).toBe(true)
    expect(props.close!.cash.variance).toBe('¥300')
  })

  it('⚖ THE DIAL IS CLAMPED AT THE READ — a ceiling a store cannot raise past', async () => {
    expect(resolveTolerance(0, MAX_CASH_TOLERANCE)).toBe(0)
    expect(resolveTolerance(500, MAX_CASH_TOLERANCE)).toBe(500)
    expect(resolveTolerance(50_000, MAX_CASH_TOLERANCE)).toBe(MAX_CASH_TOLERANCE)
    // …and the clamp is where the ROOM reads the dial, so a world (or a settings
    // control after reconnect) that sets an absurd allowance gets the ceiling.
    // Without it, a drawer ¥40,000 short would close the day without a word —
    // which is the exact self-harm the guardrail law forbids a dial to permit.
    const short = emptyDrawer(closingPlane[STORE_A])
    const { props } = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { closing: short, tolerance: 50_000 },
    })
    expect(props.close!.cash.tolerance).toContain(yen(MAX_CASH_TOLERANCE))
    expect(props.close!.cash.varianceBad).toBe(true)
    expect(props.close!.checks.find((c) => c.key === 'cash')!.status).toBe('差異承認待ち')
  })

  it('⚖ ONE VERDICT ON THE DIFFERENCE — the tone and the words read the SAME threshold', async () => {
    // The tone used to key on `variance !== 0` while the status keyed on the
    // tolerance, so inside an allowance the page painted a red difference beside
    // 「保存済み」 — two answers to one question (canon `renderSummary` :1323).
    const inside = { ...withCoins(closingPlane[STORE_A], [[100, 3]]), cash_reason: '' }
    const ok = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: inside, tolerance: 500 } })
    expect({ bad: ok.props.close!.cash.varianceBad, status: ok.props.close!.cash.status })
      .toEqual({ bad: false, status: '保存済み' })

    // …and outside it, both say so.
    const out = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: inside, tolerance: 100 } })
    expect({ bad: out.props.close!.cash.varianceBad, status: out.props.close!.cash.status })
      .toEqual({ bad: true, status: '差異承認待ち' })
  })

  it('⚖ NEVER 「差異なし」 OVER A PRINTED DIFFERENCE — and a draft is not a verdict', async () => {
    // The L1 scene: a ¥700 difference inside a large allowance printed
    // 「差異なし — 理由の記録は不要です」 beside 「差異 ¥700」, because the fallback
    // keyed on whether an APPROVAL was needed rather than on whether there WAS a
    // difference.
    const seven = { ...withCoins(closingPlane[STORE_A], [[500, 1], [100, 2]]), cash_reason: '' }
    const wide = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: seven, tolerance: 1000 } })
    expect(wide.props.close!.cash.variance).toBe('¥700')
    expect(wide.props.close!.cash.reason).not.toContain('差異なし')
    expect(wide.props.close!.cash.reason).toContain('理由が記録されていません')

    // A REAL zero, saved, is the only thing that may say 差異なし.
    const zero = await room({ store: STORE_A })
    expect(zero.close!.cash.variance).toBe('¥0')
    expect(zero.close!.cash.reason).toContain('差異なし')

    // A DRAFT count says 未保存 — it is not a verdict at all. 代官山 has counted
    // nothing, so its drawer reads 「期待 ¥0 / 実査 ¥0」 with no judgement on it.
    const draft = await room({ store: STORE_B })
    expect(draft.close!.cash.status).toBe('未保存')
    expect(draft.close!.cash.reason).toContain('未保存')
    expect(draft.close!.cash.reason).not.toContain('差異なし')
  })

  it('⚖ F9 — canon’s APPROVAL arm is carried, and the control that writes it is not built', async () => {
    // canon `cashClosingReady` (:1356-1358) has two arms and the room shipped
    // one: an over-threshold difference could never close the day, however many
    // people signed for it.
    expect(cashClosingReady(true, false, false)).toBe(true)
    expect(cashClosingReady(true, true, false)).toBe(false)
    expect(cashClosingReady(true, true, true)).toBe(true)
    expect(cashClosingReady(false, false, true)).toBe(false)

    const over = withCoins(closingPlane[STORE_A], [[500, 1], [100, 2]])
    const unapproved = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: over } })
    expect(unapproved.props.close!.checks.find((c) => c.key === 'cash')!.status).toBe('差異承認待ち')

    const approved = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { closing: { ...over, variance_approved: true } },
    })
    const cash = approved.props.close!.checks.find((c) => c.key === 'cash')!
    expect({ done: cash.done, status: cash.status }).toEqual({ done: true, status: '差異承認済み' })
    expect(approved.props.close!.closeRefusal).not.toContain('現金計数と差異理由')

    // The default is FALSE — nothing has been approved — and the APPROVE control
    // itself is not in this slice (registry ④ names the write).
    for (const store of [STORE_A, STORE_B]) expect(closingPlane[store].variance_approved).toBe(false)
    expect(SRC_CODE).not.toMatch(/差異を承認|varianceApproval/)
  })
})

// ── 6. ONE VERDICT, rendered N times ────────────────────────────────────────

describe('閉店できるか is ONE call, rendered wherever the page asks it', () => {
  const verdictFor = (store: string, over: Partial<Parameters<typeof closingReadiness>[0]> = {}) => {
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
      terminalTx: rows.find((r) => r.tenders.some((t) => t.flag === 'pending'))?.id ?? null,
      // ⚖ F-S2 — the balance row travels WITH the verdict that paints its pill,
      // because the gate narrows the ledger through that very predicate.
      outstandingTx: (() => {
        const owed = rows.find((r) => r.outstanding > 0)
        return owed ? { id: owed.id, filter: owed.filter } : null
      })(),
      // ⚖ THE PRESENCE FACTS, read off the same world rather than assumed: this
      // store's day has card payments, and it finished visits.
      hasCardTender: rows.some((r) => r.tenders.some((t) => t.channel === 'card')),
      completedVisits: appointments().filter(
        (a) => a.store_id === store && a.status === 'done' && jstDayKey(a.starts_at) === jstDayKey(new Date()),
      ).length,
      ...over,
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
      manager_signed_by: '見本 ごろう',
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

  it('⑨ EVERY UNFINISHED GATE IS A DOORWAY, and every settled one is not a control at all', async () => {
    const props = await room({ store: STORE_A })
    const by = (key: string) => props.close!.checks.find((c) => c.key === key)!
    // Pressability is DERIVED from the verdict: a row has somewhere to go
    // exactly when it is still open, and the destination is where the fix
    // happens rather than a category.
    expect(by('terminal').jump).toEqual({ kind: 'ledger', filter: 'all', tx: 'TX-4827' })
    expect(by('outstanding').jump).toEqual({ kind: 'ledger', filter: 'partial', tx: 'TX-5501' })
    expect(by('signoff').jump).toEqual({ kind: 'here', target: 'signoff' })
    // A SETTLED gate has nowhere to send anyone, so it loses its chevron with
    // its destination — no state branch, just the absence of a jump.
    expect(by('cash').done).toBe(true)
    expect(by('cash').jump).toBeNull()
    expect(by('unsettled').jump).toBeNull()
    // …and on a day that balanced badly, the drawer row becomes a doorway that
    // points at the count box on this very page rather than travelling.
    const over = withCoins(closingPlane[STORE_A], [[500, 1], [100, 2]])
    const variance = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: over } })
    expect(variance.props.close!.checks.find((c) => c.key === 'cash')!.jump).toEqual({ kind: 'here', target: 'cash' })

    // ⚖ 閉店できる状態 HAS NO CHEVRONS AT ALL, and nothing in the code says so.
    const ready = {
      ...closingPlane[STORE_A],
      outstanding_decision: '次回来店時に請求',
      manager_signed_at: 20 * 60 + 4,
      manager_signed_by: '見本 ごろう',
    }
    const done = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: ready, terminalHeld: [] } })
    for (const c of done.props.close!.checks) {
      expect({ key: c.key, jump: c.jump }).toEqual({ key: c.key, jump: null })
    }
    // The screen reads the jump, never the pill's text — a row that parsed its
    // own chip would be a second home for the verdict.
    expect(SRC_CODE).toContain('return c.jump ? (')
    expect(SRC_CODE).not.toMatch(/textContent|\.pill.*match/)
  })

  it('⚖ F-S2 — the 未収 gate lands on a list that CONTAINS the row it points at', async () => {
    // A gate must never advertise a trip it does not take. The balance is not
    // always carried by a 一部入金 row: a sale that was PART-REFUNDED and is
    // still owed is classed 要確認 by the very predicate the ledger narrows
    // through, and a jump that named 「一部入金」 landed the closer on an empty
    // list with the counter lit at 0件 and the fix nowhere in sight.
    const owedAndRefunded = txPlane.map((t) =>
      t.id === 'TX-5501'
        ? {
            ...t,
            tenders: [
              { label: '現金', amount: 1700, flag: '' as const },
              { label: '現金 返金', amount: -400, flag: 'refund' as const },
              { label: '未収', amount: 1600, flag: 'unpaid' as const },
            ],
          }
        : t,
    ) as FixtureTransaction[]
    const { props } = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: { transactions: owedAndRefunded },
    })
    const row = props.rows.find((r) => r.id === 'TX-5501')!
    // The row's OWN verdict — the one its pill reads.
    expect(row.state).toBe('partial-refund')
    expect(row.filter).toBe('attention')
    // …and the doorway reads that same verdict rather than a category written
    // into the checklist.
    expect(props.close!.checks.find((c) => c.key === 'outstanding')!.jump).toEqual({
      kind: 'ledger',
      filter: 'attention',
      tx: 'TX-5501',
    })
    // THE LANDING LIST HOLDS THE ROW, counted through the same predicate the
    // counter strip counts through — so the counter the press lights cannot
    // read 0件 over a list that was supposed to contain the fix.
    const landed = props.rows.filter((r) => matchesFilter(r, 'attention'))
    expect(landed.map((r) => r.id)).toContain('TX-5501')
    expect(props.counts.attention).toBe(landed.length)
    expect(props.counts.attention).toBeGreaterThan(0)
    // …and the plain day is untouched: there the owed row IS a 一部入金 row.
    const plain = await room({ store: STORE_A })
    expect(plain.close!.checks.find((c) => c.key === 'outstanding')!.jump).toEqual({
      kind: 'ledger',
      filter: 'partial',
      tx: 'TX-5501',
    })
    // The filter is DERIVED, never written down beside the row it points at.
    expect(LIB_CODE).not.toContain("filter: 'partial', tx: input.outstandingTx")
    expect(LIB_CODE).toContain("filter: input.outstandingTx?.filter ?? 'all'")
  })

  it('⚖ F-S13 — a gate row’s accessible name CARRIES the row, it never replaces it', async () => {
    // The row prints three things a closer acts on — what the gate is, the
    // EVIDENCE under it, and its status chip. An `aria-label` naming only the
    // gate and its destination deleted the other two for anyone listening.
    expect(SRC_CODE).toContain('aria-label={`${c.label} — ${c.detail} — ${c.status} — ${jumpLabelOf(c.jump)}`}')
    const props = await room({ store: STORE_A })
    const open = props.close!.checks.find((c) => !c.done && c.jump !== null)!
    // Every composed part is a real sentence on a real row, so the name is not
    // three empty strings joined by dashes.
    for (const part of [open.label, open.detail, open.status]) {
      expect({ key: open.key, part, empty: part.trim() === '' }).toEqual({ key: open.key, part, empty: false })
    }
    expect(open.detail).not.toBe(open.label)
    // A SETTLED gate is not a control at all, so it carries no name of its own —
    // its own content is what a reader hears.
    expect(SRC_CODE).toContain('<div className="rg-check" key={c.key}>')
    const doneBranch = SRC_CODE.slice(SRC_CODE.indexOf('<div className="rg-check" key={c.key}>'))
    expect(doneBranch.slice(0, 120)).not.toContain('aria-label')
  })

  it('⑤/⑨ 承認者名 rides the approval — a time stamp cannot say WHO', async () => {
    const ready = {
      ...closingPlane[STORE_A],
      outstanding_decision: '次回来店時に請求',
      manager_signed_at: 18 * 60 + 42,
      manager_signed_by: '見本 ごろう',
    }
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: ready, terminalHeld: [] } })
    const signoff = props.close!.checks.find((c) => c.key === 'signoff')!
    expect(signoff.detail).toContain('見本 ごろう')
    expect(signoff.detail).toContain('18:42')
    // …and the close RECORD carries it, because 本部 reads these back weeks later
    // (registry ⑨/⑬) and an approval with no name on it is not an approval.
    expect(props.close!.record.find((r) => r.label === '承認者')!.value).toBe('見本 ごろう')
    // DATA PRESENCE: an unsigned day has no 承認者 cell rather than an empty one.
    const open = await room({ store: STORE_A })
    expect(open.close!.record.some((r) => r.label === '承認者')).toBe(false)
    expect(open.close!.record).toHaveLength(8)
    expect(props.close!.record).toHaveLength(9)
    // …and the strip's column count follows the record rather than a hard 8.
    expect(CSS_CODE).toContain('repeat(auto-fit, minmax(84px, .62fr))')
  })

  it('⑤ 未収の扱い — the landing point OFFERS the carry-forward decision', async () => {
    // A clinic or a salon with an account customer meets this check every
    // evening, and 「次回来店時に請求」 is the answer they give. The control that
    // records it says which decision it records.
    const props = await room({ store: STORE_A })
    const partial = props.rows.find((r) => r.id === 'TX-5501')!
    expect(partial.outstandingLabel).toBe('次回来店時に請求として記録')
    expect(partial.showOutstanding).toBe(true)
    expect(partial.canOutstanding).toBe(true)
    // …and once it is recorded, the gate is closed and says what was decided.
    const decided = { ...closingPlane[STORE_A], outstanding_decision: '次回来店時に請求' }
    const after = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: decided } })
    const row = after.props.close!.checks.find((c) => c.key === 'outstanding')!
    expect({ done: row.done, status: row.status }).toEqual({ done: true, status: '記録済み' })
    expect(row.detail).toBe('¥1,600 / 次回来店時に請求')
  })

  it('⚖ 実査額 IS THE COUNT SHEET — a sheet that says something else WINS, everywhere', async () => {
    // The L1 scene, and the reason the identity is now structural: the band read
    // the stored field while the disclosure 200px below added the notes up, so a
    // world with one more 千円札 in the drawer printed ¥40,620 under
    // 「この合計がそのまま実査額になります」 and ¥39,620 in the stat above it — with
    // 差異 ¥0 over both, which is precisely the difference that never existed the
    // count sheet exists to prevent. The stored field is left BEHIND here on
    // purpose: it is the losing read.
    const base = closingPlane[STORE_A]
    const drifted: FixtureClosing = {
      ...base,
      cash_count_sheet: base.cash_count_sheet.map((d) =>
        d.denomination === 1000 ? { ...d, count: d.count + 1 } : d,
      ),
    }
    expect(drifted.cash_counted).toBe(39_620)
    expect(countedCash(drifted)).toBe(40_620)

    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: drifted } })
    const cash = props.close!.cash
    expect(cash.counted).toBe(yen(40_620))
    expect(cash.denominations!.totalValue).toBe(cash.counted)
    expect(cash.variance).toBe(yen(1_000))
    expect(props.close!.checks.find((c) => c.key === 'cash')!.detail)
      .toBe(`期待 ${yen(39_620)} / 実査 ${yen(40_620)} / 差異 ${yen(1_000)}`)
    // …and the room's close RECORD carries the same difference it printed.
    expect(props.close!.record.find((r) => r.label === '現金差異')!.value).toBe(yen(1_000))
    // ONE read: the props layer never reaches for the stored field itself.
    expect(PROPS_CODE).not.toContain('closing.cash_counted')
  })

  it('…and a closing with NO sheet keeps the figure somebody typed', async () => {
    // A shop that counts its drawer on paper and types the total has nothing to
    // derive from — so the entered figure stands, and the disclosure that would
    // have claimed to produce it is not offered at all.
    const sheetless: FixtureClosing = { ...closingPlane[STORE_A], cash_count_sheet: [] }
    expect(countedCash(sheetless)).toBe(39_620)
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { closing: sheetless } })
    expect(props.close!.cash.counted).toBe(yen(39_620))
    expect(props.close!.cash.variance).toBe('¥0')
    expect(props.close!.cash.denominations).toBeNull()
  })

  it('⑥ しきい値 names its settings home, refused with the reason', async () => {
    const props = await room({ store: STORE_A })
    expect(props.close!.cash.toleranceLinkLabel).toBe('店舗設定で変更')
    expect(props.close!.cash.toleranceLinkRefusal).toContain('店舗設定')
    expect(props.close!.cash.toleranceLinkRefusal).toContain('準備中')
    // The DIAL itself stays registry ④ — the room reads it, never hardcodes it.
    expect(props.close!.cash.tolerance).toContain(yen(cashTolerance))
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

  // ── ⚖ A ROW RENDERS ONLY WHEN ITS SUBJECT EXISTS IN THE DAY ────────────────
  // The sheet has stated this law since the rebuild (register.css:446) and the
  // array was a fixed five. Every row is driven BOTH WAYS here, on worlds that
  // differ only in the fact that decides it.
  describe('the checklist is presence-gated, row by row', () => {
    // A day on which nothing happened at all: no float, no drawer counted, no
    // card, no balance, no finished visit — 代官山's evening, driven directly.
    const nothing = {
      totals: { gross: 0, refunds: 0, net: 0, collected: 0, outstanding: 0, cash: 0 },
      closing: {
        ...emptyDrawer(closingPlane[STORE_A]),
        cash_float: 0,
        cash_saved: false,
        outstanding_decision: null,
      },
      heldCount: 0,
      hasCardTender: false,
      completedVisits: 0,
    }
    const keys = (over: Partial<Parameters<typeof closingReadiness>[0]> = {}) =>
      verdictFor(STORE_A, { ...nothing, ...over }).checks.map((c) => c.key)

    it('決済端末の送信 — the store has a terminal, or it has never had one', () => {
      expect(keys()).not.toContain('terminal')
      // It is holding records right now…
      expect(keys({ heldCount: 1 })).toContain('terminal')
      // …or the day contains a card payment, which only a terminal can take.
      expect(keys({ hasCardTender: true })).toContain('terminal')
    })

    it('現金計数と差異理由 — the store closes a DRAWER, or it is cashless', () => {
      expect(keys()).not.toContain('cash')
      // A float was put in this morning…
      expect(keys({ closing: { ...nothing.closing, cash_float: 30_000 } })).toContain('cash')
      // …or cash crossed the counter today.
      expect(keys({ totals: { ...nothing.totals, cash: 1_100 } })).toContain('cash')
      // ⚖ A11 — …or somebody has already COUNTED a drawer. ¥5,000 in a till the
      // day says should not exist is a ¥5,000 difference, and dropping the row
      // would take it off the page without a word.
      const counted = keys({ closing: withCoins(nothing.closing, [[1000, 5]]) })
      expect(counted).toContain('cash')
      expect(verdictFor(STORE_A, { ...nothing, closing: withCoins(nothing.closing, [[1000, 5]]) }).variance)
        .toBe(5_000)
    })

    it('未収の扱い — the day holds a balance, or one has already been decided', () => {
      expect(keys()).not.toContain('outstanding')
      expect(keys({ totals: { ...nothing.totals, outstanding: 1_600 } })).toContain('outstanding')
      // A DECIDED balance keeps its row: the evening has to show what was decided.
      expect(keys({ closing: { ...nothing.closing, outstanding_decision: '次回来店時に請求' } }))
        .toContain('outstanding')
    })

    it('未精算の施術 — the day finished a visit at all', () => {
      expect(keys()).not.toContain('unsettled')
      expect(keys({ completedVisits: 1 })).toContain('unsettled')
    })

    it('閉店承認 is ALWAYS asked — every close is signed, in every business', () => {
      expect(keys()).toEqual(['signoff'])
      expect(keys({ heldCount: 1, hasCardTender: true, completedVisits: 3, totals: { ...nothing.totals, cash: 1, outstanding: 1 } }))
        .toEqual(['terminal', 'cash', 'outstanding', 'unsettled', 'signoff'])
    })

    it('…and the chip, the blockers and the prerequisite gate read THAT array', () => {
      // ⚖ A8 — one verdict home, now a presence-filtered one: a subject the day
      // does not have can never block a close it was never part of.
      const v = verdictFor(STORE_A, nothing)
      expect(v.checks).toHaveLength(1)
      expect(v.openCount).toBe(v.checks.filter((c) => !c.done).length)
      expect(v.blockers).toEqual(v.checks.filter((c) => !c.done).map((c) => c.label))
      expect(v.prerequisitesReady).toBe(true)
      // The drawer was never counted and the day still closes once it is signed:
      // an unopened drawer is not an unfinished count.
      expect(nothing.closing.cash_saved).toBe(false)
      expect(v.closeReady).toBe(false)
      expect(verdictFor(STORE_A, {
        ...nothing,
        closing: { ...nothing.closing, manager_signed_at: 20 * 60 + 4, manager_signed_by: '見本 ごろう' },
      }).closeReady).toBe(true)
    })

    it('the drawer BAND still knows its own status without the row', async () => {
      // The band used to read the checklist row with a non-null assertion, which
      // a presence-gated array turns into a crash the day a cashless shop opens
      // the evening. Both read `cashStatus` — one home, no lookup.
      expect(verdictFor(STORE_A, nothing).cashStatus).toBe('未保存')
      const props = await room({ store: STORE_B })
      expect(props.close!.cash.status).toBe('未保存')
      expect(PROPS_CODE).not.toContain("checks.find((c) => c.key === 'cash')!")
    })
  })

  it('a store that has taken nothing still has an honest close — and is asked about NOTHING it does not have', async () => {
    // ⚖ A ROW RENDERS ONLY WHEN ITS SUBJECT EXISTS. 代官山 put no float in, took
    // no cash and no card, carries no balance and finished no visit today, so its
    // evening is ONE line: the manager's confirmation. The other four were
    // questions about subjects that do not exist — and two of them (a drawer
    // nobody opened, a terminal nobody has) could never have been answered, which
    // is a close that can never happen rather than a close that is not ready.
    const props = await room({ store: STORE_B })
    expect(props.emptyDay).toBe(true)
    expect(props.close!.checks.map((c) => c.key)).toEqual(['signoff'])
    // …and the chip, the button's list and the prerequisite gate all read THAT
    // array — one verdict home, now a presence-filtered one.
    expect(props.close!.openCount).toBe(1)
    expect(props.close!.headline).toBe('1項目 未完了')
    expect(props.close!.closeRefusal).toContain('未完了: 閉店承認')
    expect(props.close!.closeRefusal).not.toContain('現金計数')
    // The drawer BAND obeys the same law as its row, reading the very same row.
    expect(SRC_CODE).toContain("close.checks.some((c) => c.key === 'cash')")
  })

  it('⚖ F-S5 — 決済手段の内訳 obeys the SAME law: no money arrived, no panel', async () => {
    // The band splits the money that CAME IN by the手段 it came in on. On a day
    // that took nothing, and on a day whose every sale is still owed, no money
    // came in at all — and the panel was rendering an empty bordered box under
    // its heading and then reassuring the closer that 「決済手段の内訳は受領済み ¥0
    // と一致しています」: a verdict about a subject that does not exist.
    const zero = await room({ store: STORE_B })
    expect(zero.close!.reconciliation).toHaveLength(0)

    // …and the same on a day that sold plenty and collected none of it — 未収 is
    // not a tender, so nothing arrived on any channel.
    const allOwed = await registerProps({
      locale: 'ja',
      store: STORE_A,
      world: {
        terminalHeld: [],
        transactions: [
          {
            id: 'TX-8001', appointment_id: null, store_id: STORE_A, customer_id: 'cus-05',
            item: '施術料金', amount: 6600, at: 11 * 60,
            tenders: [{ label: '未収', amount: 6600, flag: 'unpaid' as const }], audit: [],
          },
          {
            id: 'TX-8002', appointment_id: null, store_id: STORE_A, customer_id: 'cus-06',
            item: '物販', amount: 3300, at: 12 * 60,
            tenders: [{ label: '未収', amount: 3300, flag: 'unpaid' as const }], audit: [],
          },
        ],
        closing: emptyDrawer({ ...closingPlane[STORE_A], cash_float: 0, cash_saved: false }),
      },
    })
    expect(allOwed.props.rows).toHaveLength(2)
    expect(allOwed.props.close!.reconciliation).toHaveLength(0)

    // The heading, the box and the sentence go together — one condition, on the
    // whole panel, exactly like the drawer band above it.
    expect(SRC_CODE).toContain('{close.reconciliation.length > 0 && (')
    // …and an ordinary day still has it, so the law did not delete the band.
    const day = await room({ store: STORE_A })
    expect(day.close!.reconciliation.length).toBeGreaterThan(0)
    expect(day.close!.reconciliationNote).toContain('一致しています')
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
    const booked = txPlane.find((t) => t.appointment_id !== null)!
    expect(transactionStore(booked, new Map())).toBeNull()
  })

  it('⚖ A STORELESS WALK-IN IS AN IMPOSSIBLE STATE, and the TYPE says so', () => {
    // The plane used to type `store_id` as `string | null` on every row, so a
    // 店頭販売 with no store compiled — and the ledger answered it by silently
    // dropping the row at render time. That is a display deciding what to do
    // about broken data (⚖ 8/9). The plane now splits the two shapes: a booking
    // sale carries `store_id: null` because the BOOKING says where it happened,
    // and a walk-in carries a store because nothing else can.
    expect(PLANE_CODE).toContain('export interface FixtureWalkInTransaction')
    expect(PLANE_CODE).toMatch(/FixtureWalkInTransaction extends FixtureTransactionBase \{\s*appointment_id: null\s*store_id: string\s*\}/)
    expect(PLANE_CODE).toMatch(/FixtureBookingTransaction extends FixtureTransactionBase \{\s*appointment_id: string\s*store_id: null\s*\}/)
    expect(PLANE_CODE).toContain('export type FixtureTransaction = FixtureBookingTransaction | FixtureWalkInTransaction')
    // …and every row in the demo plane really is one of the two shapes.
    for (const tx of txPlane) {
      expect({ id: tx.id, shaped: tx.appointment_id === null ? typeof tx.store_id === 'string' : tx.store_id === null })
        .toEqual({ id: tx.id, shaped: true })
    }
    // So `transactionStore` returning null now means EXACTLY ONE thing: the
    // booking is out of this lens's reach. The walk-in arm cannot produce it.
    const byId = new Map(appointments().map((a) => [a.id, a]))
    for (const tx of txPlane.filter((t) => t.appointment_id === null)) {
      expect({ id: tx.id, store: transactionStore(tx, byId) }).toEqual({ id: tx.id, store: tx.store_id })
    }
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
    expect(a.close!.cash.counted).toBe(yen(closingPlane[STORE_A].cash_counted))
    expect(b.close!.cash.counted).toBe('¥0')
    // …and each store's own float goes with its own drawer: 代官山 never opened
    // one today, so it expects nothing rather than inheriting 銀座's ¥30,000.
    expect(a.close!.cash.floatValue).toBe(yen(closingPlane[STORE_A].cash_float))
    expect(b.close!.cash.floatValue).toBe('¥0')
    expect(b.close!.cash.expected).toBe('¥0')
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
    expect(props.terminal!.canRecheck).toBe(false)
    for (const r of props.rows) expect(r.canRefund).toBe(false)
    // 権限がありません is a SENTENCE where a figure would be — not a blank, and
    // not a zero, which would read as a day with no takings.
    const redacted = props.money.filter((m) => m.redacted).map((m) => m.value)
    expect(redacted).toEqual(['権限がありません', '権限がありません', '権限がありません'])
    // …and the figures a redacted role IS allowed are still real.
    expect(props.money.find((m) => m.key === 'outstanding')!.value).toBe('¥1,600')
  })

  it('⚖ RULING (a) — a role that may not close gets NO 閉店 VIEW AT ALL, not a room of greyed gates', async () => {
    // Redacting the closing desk figure by figure still handed a スタッフ two and
    // a half screens of checklist they can neither complete nor approve. The gate
    // moves one level up, from the sixteen controls to the VIEW that holds them —
    // ⚖ 8/17's own shape (hide, never show-and-refuse) applied to a room instead
    // of a button. What they lose is a room they could not act in.
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })
    expect(props.close).toBeNull()
    // …and they are told nothing about it: an explanation of a missing room is
    // only owed to a reader who can DO something about it (pick a store).
    expect(props.closeUnavailable).toBeNull()
    // The transaction desk they DO work at is untouched.
    expect(props.rows).toHaveLength(6)
    expect(props.counts.all).toBe(6)
    expect(props.sellLabel).toBe('店頭販売を記録')
    // NO TAB ROW: the tabs render only where there are two views to switch
    // between — not a lone tab, not a hidden second tab.
    expect(SRC_CODE).toContain('{close && (\n        <div\n          className="rg-modes"')
    expect(PROPS_CODE).toContain('closing && verdict && access.close')
  })

  it('⚖ THE STORELESS LENS IS A DIFFERENT SILENCE — it can be fixed, so it is explained', () => {
    // TWO reasons the closing view can be missing, and they are not owed the
    // same words: a role that may not close is told nothing (it is not their
    // room), while a reader with no store selected is told how to get one,
    // because that is a thing they can fix in one press.
    // ⚠ The storeless `{viewAll:true}` lens is only reachable for a business with
    // NO stores at all (`defaultStoreId` opens on the operator's own store
    // otherwise), so this pin reads the branch rather than driving it.
    expect(PROPS_CODE).toContain('access.close && !clamped')
    expect(PROPS_CODE).toContain('サイドバーで店舗を選ぶと')
    expect(SRC_CODE).toContain('{props.closeUnavailable && (')
    expect(SRC_CODE).toContain('rg-noclose')
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

  it('⚖ F6 — the ENUMERATION: every write on this page is gated, 未収として記録 included', async () => {
    // canon gates SIXTEEN controls on `close` and three on `refund`. This room
    // carries five, and one of them shipped ungated: 未収として記録 records a
    // decision against the day's close — an executor and a reason — and any role
    // could reach it. The census is the pin, so a sixth control cannot land
    // ungated either.
    const staff = await registerProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })
    const manager = await room({ store: STORE_A })
    const partial = (p: RegisterProps) => p.rows.find((r) => r.id === 'TX-5501')!

    // ⚠ THE CENSUS MOVED WITH THE RULING. 計数を保存 and 閉店を確定 no longer carry
    // their own `can…` flags, because the VIEW that holds them is the gate now —
    // a role without the capability never reaches a control to refuse. So the
    // census asks the question that survives: which of the five writes this role
    // can see at all.
    const gates = (p: RegisterProps) => ({
      refund: partial(p).canRefund,
      outstanding: partial(p).canOutstanding,
      terminal: p.terminal!.canRecheck,
      cash: p.close !== null,
      close: p.close !== null,
    })
    expect(gates(manager)).toEqual({ refund: true, outstanding: true, terminal: true, cash: true, close: true })
    expect(gates(staff.props)).toEqual({
      refund: false,
      outstanding: false,
      terminal: false,
      cash: false,
      close: false,
    })
    // canon :1305 — 未収として記録 reads the CLOSE capability, like its siblings,
    // and the control is absent rather than present-and-dead.
    expect(PROPS_CODE).toContain('canOutstanding: access.close,')
    expect(SRC_CODE).toContain('{current.canOutstanding && current.showOutstanding && (')
    // The row still KNOWS it has 未収 — the gate is about who may act, never
    // about what is true.
    expect(partial(staff.props).showOutstanding).toBe(true)
  })

  it('⚖ F5/F12 — the CLOSING FIGURES ARE OUT OF REACH for a redacted role, gate and all', async () => {
    // The leak F5 and F12 closed was the 決済手段の内訳 and the 現金ドロア printing,
    // channel by channel, the money the strip had just hidden. Ruling (a) closes
    // it a level higher: the only role that redacts is also the only role that
    // may not close, and it no longer HAS the closing view — so not one of those
    // figures is assembled for it, let alone rendered.
    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })
    expect(props.close).toBeNull()
    // ⚠ AND THE PLUMBING STAYS, because the role table is DATA: the day a role
    // arrives with `close: true, redactSummary: true`, every closing figure must
    // already be routed through the ONE gate rather than needing this fix again.
    const cashBlock = PROPS_CODE.slice(PROPS_CODE.indexOf('            cash: {'), PROPS_CODE.indexOf('            checks:'))
    for (const field of ['expected:', 'counted:', 'variance:', 'floatValue:', 'dayCashValue:', 'tolerance:']) {
      const line = cashBlock.split('\n').find((l) => l.trim().startsWith(field))
      expect({ field, gated: (line ?? '').includes('redactMoney(') }).toEqual({ field, gated: true })
    }
    // …and the 内訳, which is 受領済み again split by the手段 it arrived on. Its
    // rows and its SENTENCE (which names the total in words) obey the same gate.
    const reconBlock = PROPS_CODE.slice(
      PROPS_CODE.indexOf('            reconciliation: reconciliation.rows.map'),
      PROPS_CODE.indexOf('            reconciliationBalanced:'),
    )
    for (const field of ['received:', 'reversed:', 'net:']) {
      const line = reconBlock.split('\n').find((l) => l.trim().startsWith(field))
      expect({ field, gated: (line ?? '').includes('redactMoney(') }).toEqual({ field, gated: true })
    }
    expect(reconBlock).toContain('reconciliationNote: access.redactSummary')
    expect(PROPS_CODE).toContain('const redactMoney = (value: string) =>')
    expect(PROPS_CODE).not.toMatch(/redactSummary \? REDACTED : yen\(/)

    // …and the operator who passes the gate still sees all of it.
    const open = await room({ store: STORE_A })
    expect(open.close!.reconciliationNote).toContain(yen(ledgerTotals(build(STORE_A)).collected))
    for (const r of open.close!.reconciliation) expect(r.received).not.toBe('権限がありません')
  })

  it('⚖ R-23 — a VERDICT ABOUT A HIDDEN FIGURE IS THE FIGURE: 差異理由 carries workflow only', () => {
    // 「差異なし」 told to a role whose 差異 reads 「権限がありません」 says the
    // difference is ZERO, in words, one line under the redaction that was
    // supposed to hide it. Driven directly, because the only role that redacts
    // today cannot reach this row — and the rule has to hold for the next one.
    const hidden = { redactSummary: true }
    const open = { redactSummary: false }
    const saved = { cash_reason: '', cash_saved: true }
    expect(cashReasonLine(hidden, saved, 0)).toBe('未記録')
    expect(cashReasonLine(hidden, saved, -700)).toBe('未記録')
    expect(cashReasonLine(hidden, { cash_reason: '両替ミス', cash_saved: true }, -700)).toBe('記録済み')
    // …and NONE of the redacted readings leaks the verdict or a figure.
    for (const v of [0, -700, 12_000]) {
      const line = cashReasonLine(hidden, saved, v)
      expect({ v, leaks: /差異なし|¥|\d/.test(line) }).toEqual({ v, leaks: false })
    }
    // The open reading is unchanged, both ways.
    expect(cashReasonLine(open, saved, 0)).toContain('差異なし')
    expect(cashReasonLine(open, saved, -700)).toContain('理由が記録されていません')
    // A draft is not a verdict for anybody.
    expect(cashReasonLine(open, { cash_reason: '', cash_saved: false }, 0)).toContain('未保存')
    expect(cashReasonLine(hidden, { cash_reason: '', cash_saved: false }, 0)).toContain('未保存')
    // ONE HOME — the props file reads the rule, it does not restate it. F-S7
    // gave the sentence a SECOND READER (the read-only reason box) and the read
    // is still made exactly once, above the props object, gate and all.
    expect(PROPS_CODE).toContain('const cashReason = closing && verdict ? cashReasonLine(access, closing, verdict.variance) : \'\'')
    expect(PROPS_CODE.match(/cashReasonLine\(/g) ?? []).toHaveLength(1)
    expect(PROPS_CODE).toContain('reason: cashReason,')
    expect(PROPS_CODE).toContain("value: closing.cash_reason !== '' ? closing.cash_reason : cashReason,")
  })

  it('⚠ 期待額 EXPLAINS ITSELF — the float and the day’s cash are the two halves that make it', async () => {
    // A closer who cannot tell a wrong EXPECTATION from a wrong DRAWER learns to
    // ignore 差異, which is the one number the whole ritual produces. So the
    // drawer prints the opening float and the day's own cash as labelled facts,
    // and the two of them add up to the figure above them.
    const props = await room({ store: STORE_A })
    const cash = props.close!.cash
    const totals = ledgerTotals(build(STORE_A))
    const plane = closingPlane[STORE_A]

    expect(cash.floatValue).toBe(yen(plane.cash_float))
    expect(cash.dayCashValue).toBe(`${yen(totals.cash)}（受領 − 返金）`)
    expect(cash.expected).toBe(yen(plane.cash_float + totals.cash))
    expect(cash.counted).toBe(yen(plane.cash_counted))
    expect(cash.variance).toBe('¥0')
    expect(cash.tolerance).toContain('許容額')
    // Every label says WHAT it counts (⚖ 8/25) — no bare figure anywhere.
    expect(cash.floatLabel).toContain('釣銭準備金')
    expect(cash.dayCashLabel).toContain('現金')
    // …and the checklist row one panel down reads the SAME expectation.
    expect(props.close!.checks.find((c) => c.key === 'cash')!.detail)
      .toBe(`期待 ${yen(plane.cash_float + totals.cash)} / 実査 ${yen(plane.cash_counted)} / 差異 ¥0`)
    // ⑩ and the count sheet the disclosure prints adds up to the count itself.
    expect(cash.denominations!.totalValue).toBe(yen(plane.cash_counted))
    expect(cash.denominations!.rows).toHaveLength(9)
    expect(cash.denominations!.rows.find((r) => r.key === '10000')).toEqual({
      key: '10000',
      label: '¥10,000',
      name: '1万円札',
      count: '3',
    })
    expect(cash.denominations!.unit).toBe('枚')
  })
})

// ── 9. every button here is a write, and every write is refused ─────────────

describe('reading is buildable; every button on a money desk is a write', () => {
  it('no <dialog> anywhere — canon’s four are not carried, and ⚖ 32 cannot bite', () => {
    expect(SRC_CODE).not.toMatch(/<dialog|showModal|::backdrop/)
    expect(CSS_CODE).not.toMatch(/dialog/)
  })

  it('no toast — a refusal changes nothing and stays readable (⚖ 47)', () => {
    expect(SRC_CODE).not.toMatch(/showToast|className="toast"/)
    expect(CSS_CODE).not.toMatch(/\.toast/)
    // ⚠ THE ONE TIMER IN THE ROOM IS A GESTURE, NOT A MESSAGE. ⑨'s landing mark
    // fades because a point that stayed would become decoration on the next
    // render — it carries no words, and nothing a reader has to READ is behind
    // it. Every refusal is still printed on screen before anyone reaches for the
    // control it refuses, with nothing to outrun.
    const timers = SRC_CODE.match(/setTimeout\(/g) ?? []
    expect(timers).toHaveLength(1)
    expect(SRC_CODE).toContain('const t = setTimeout(() => setPointingAt(null), 2600)')
    expect(SRC_CODE).toContain('return () => clearTimeout(t)')
  })

  it('every refused control carries its OWN reason on its OWN accessible name', async () => {
    const props = await room({ store: STORE_A })
    const row = props.rows.find((r) => r.id === 'TX-5501')!
    const reasons = [
      props.terminal!.recheckRefusal,
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
    // ⑫ ONE SOURCE, RENDERED TWICE. The reason rides the control's accessible
    // name (never `title` alone — a title-only refusal is invisible to exactly
    // the reader who cannot see the button is dead) AND a quiet line under it
    // that register.css shows where there is no hover. There is no way to give
    // the button one sentence and the line another: both read `reason`.
    expect(SRC_CODE).toContain('aria-label={`${label} — ${reason}`}')
    expect(SRC_CODE).toContain('<span className="rg-refusal" aria-hidden="true">{reason}</span>')
    // …and every refused control in the room goes through it.
    const refused = SRC_CODE.match(/<Refused\b/g) ?? []
    expect(refused.length).toBeGreaterThanOrEqual(8)
    // The two READ-ONLY FIELDS cannot use the component (they are inputs, not
    // buttons), so they are pinned to the same shape by hand: one string on the
    // accessible name and on the title.
    for (const field of ['cash.saveRefusal', 'cash.reasonInput.refusal']) {
      expect({ field, titled: SRC_CODE.includes(`title={${field}}`) }).toEqual({ field, titled: true })
    }
    // ⚖ …AND THE TOUCH LINE PRINTS ONCE PER PANEL PER REASON. 差異理由 is the
    // only refused FIELD that carries one, because its sentence is its own; the
    // 実査額 field's refusal is the identical paragraph 計数を保存 already prints
    // at the top of the same panel, and the room deleted a duplicated verdict
    // once already. The one-source rule is untouched — the field still names the
    // very same string above.
    expect(SRC_CODE).toContain('<span className="rg-refusal" aria-hidden="true">{cash.reasonInput.refusal}</span>')
    expect(SRC_CODE).not.toContain('<span className="rg-refusal" aria-hidden="true">{cash.saveRefusal}</span>')
    expect((SRC_CODE.match(/aria-disabled="true"/g) ?? []).length).toBeGreaterThanOrEqual(2)
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
    expect(refunded.refundNote).toContain('すでに全額戻しています')
  })

  it('⚖ THE PREVIEW IS THE NET REMAINING, AND canon’s GUARD DECIDES WHETHER IT SHOWS AT ALL', async () => {
    // (a) a part-refunded sale: the preview is what is STILL there, not the
    // original line. The first cut listed the original lines, so a row that had
    // already had ¥400 back advertised a ¥1,100 reversal the product refuses.
    const partial: FixtureTransaction[] = [
      {
        id: 'TX-PART',
        appointment_id: null,
        store_id: STORE_A,
        customer_id: 'cus-05',
        item: '一部返金の検証',
        amount: 1100,
        at: 13 * 60,
        tenders: [
          { label: '現金', amount: 1100, flag: '' },
          { label: '現金 返金', amount: -400, flag: 'refund' },
        ],
        audit: [],
      },
    ]
    const row = build(STORE_A, { transactions: partial })[0]
    expect(refundPreview(row)).toEqual({ lines: [{ label: '現金', amount: 700 }], refusal: null })

    // (b) canon's own guard (:1593-1596): a part-PAID sale's original lines do
    // not account for its 受領額, so canon refuses to write the refund — and the
    // preview prints that refusal rather than a list of lines.
    const partPaid = byTx(build(STORE_A), 'TX-5501')
    expect(refundPreview(partPaid)).toEqual({ lines: [], refusal: REFUND_MISMATCH })
    const props = await room({ store: STORE_A })
    const shown = props.rows.find((r) => r.id === 'TX-5501')!
    expect(shown.refundPreview).toContain(REFUND_MISMATCH)
    expect(shown.refundNote).toContain('一致していません')

    // (c) canon `renderInspector` (:1301): 返金・取消 is offered on `paid`, and on
    // nothing else — never on the part-paid row whose own preview is a refusal.
    expect(props.rows.find((r) => r.id === 'TX-4808')!.showRefund).toBe(true)
    for (const id of ['TX-4827', 'TX-5501', 'TX-5502']) {
      expect({ id, offered: props.rows.find((r) => r.id === id)!.showRefund }).toEqual({ id, offered: false })
    }
    expect(PROPS_CODE).toContain("showRefund: m.state === 'paid',")
  })

  it('what a CLOSE would record is shown too, and it is the same day’s figures', async () => {
    const props = await room({ store: STORE_A })
    const record = new Map(props.close!.record.map((r) => [r.label, r.value]))
    for (const m of props.money) expect(record.get(m.label)).toBe(m.value)
    expect(record.get('取引件数')).toBe(`${props.counts.all}件`)
    expect(record.get('バージョン')).toBe('閉店 v1')
  })

  it('決済手段の内訳 balances against 受領済み, and says so', async () => {
    const props = await room({ store: STORE_A })
    expect(props.close!.reconciliationBalanced).toBe(true)
    expect(props.close!.reconciliationNote).toContain(yen(ledgerTotals(build(STORE_A)).collected))
    const recon = tenderReconciliation(build(STORE_A))
    expect(recon.received + recon.reversed).toBe(recon.net)
    // 未収 is not a tender — nothing arrived on it.
    expect(recon.rows.some((r) => r.channel === 'unpaid')).toBe(false)
  })

  it('⚖ THE TWO SIDES ARE DERIVED INDEPENDENTLY — 「一致しません」 is REACHABLE', async () => {
    // The first cut compared the grouped tenders against 受領済み, which is the
    // same sum of the same lines by a different route: the sentence could not
    // fail, so it reassured about nothing. Side B now reads each row's own 総額
    // — 総額 − 未収 − 返金 — which comes from the booking's 受付価格 rather than
    // from the tender lines.
    const clean = tenderReconciliation(build(STORE_A))
    expect({ net: clean.net, fromRows: clean.fromRows, balanced: clean.balanced })
      .toEqual({ net: 22820, fromRows: 22820, balanced: true })

    // A CORRUPT WORLD: a walk-in whose 総額 does not match the lines under it.
    // Side A sees ¥1,000 of tenders, side B sees a ¥3,000 sale with nothing owed
    // and nothing reversed, and the page says so.
    const corrupt: FixtureTransaction[] = [
      {
        id: 'TX-BAD',
        appointment_id: null,
        store_id: STORE_A,
        customer_id: null,
        item: '不整合の検証',
        amount: 3000,
        at: 12 * 60,
        tenders: [{ label: '現金', amount: 1000, flag: '' }],
        audit: [],
      },
    ]
    const rows = build(STORE_A, { transactions: corrupt })
    const broken = tenderReconciliation(rows)
    expect({ net: broken.net, fromRows: broken.fromRows, balanced: broken.balanced })
      .toEqual({ net: 1000, fromRows: 3000, balanced: false })
    // …and the row itself is invalid, which is the fact underneath the sentence.
    expect(rowBalances(rows[0])).toBe(false)

    const { props } = await registerProps({ locale: 'ja', store: STORE_A, world: { transactions: corrupt } })
    expect(props.close!.reconciliationBalanced).toBe(false)
    expect(props.close!.reconciliationNote).toContain('一致しません')
  })

  it('⚖ A CHANNEL MAY ONLY GIVE BACK WHAT IT TOOK IN — the over-refund world is INVALID', () => {
    // The addition alone cannot see this: 現金 ¥1,100 in and 現金 ¥1,500 back out
    // still satisfies 受領 + 未収 + 返金 = 総額, and it is still an impossible
    // drawer. canon applies the same per-channel identity before it will WRITE a
    // refund (:1591-1593); the room applies it before it will RENDER one.
    const over: FixtureTransaction[] = [
      {
        id: 'TX-OVER',
        appointment_id: null,
        store_id: STORE_A,
        customer_id: null,
        item: '過返金の検証',
        amount: 1100,
        at: 13 * 60,
        tenders: [
          { label: '現金', amount: 1100, flag: '' },
          { label: '現金 返金', amount: -1500, flag: 'refund' },
        ],
        audit: [],
      },
    ]
    const row = build(STORE_A, { transactions: over })[0]
    // The sum half PASSES — which is exactly why the reversal half has to exist.
    expect(row.received + row.outstanding + row.reversed).toBe(row.total)
    expect(rowBalances(row)).toBe(false)
    // …and a reversal on a channel that took money in, within its own amount,
    // is fine.
    expect(rowBalances(byTx(build(STORE_A), 'TX-5502'))).toBe(true)
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
    // mode · filter · selected · detailOpen · folds · denOpen · pointingAt ·
    // tourIdx · tourTick · tourStep · tourPos · tourHover. All twelve are
    // browsing: which view, which slice, which row, which fold, whether the
    // count sheet is open, what a jump is pointing at, and where the walk is.
    // None of them writes anything.
    expect(states).toHaveLength(12)
    expect(SRC_CODE).not.toMatch(/useState<[^>]*>\(\s*props\./)
  })
})

// ── 9b. ⧉ ONE PAGE, TWO MODES — the restructure itself ──────────────────────

describe('⧉ the restructure: one page, two modes, one day', () => {
  it('THE TABS ARE VIEWS OVER ONE OBJECT — not navigation, and not a filter', async () => {
    const props = await room({ store: STORE_A })
    // Tab grammar, from the family's own vocabulary for "which view am I in".
    expect(SRC_CODE).toContain('role="tablist"')
    expect((SRC_CODE.match(/role="tab"/g) ?? [])).toHaveLength(2)
    expect((SRC_CODE.match(/role="tabpanel"/g) ?? []).length).toBeGreaterThanOrEqual(1)
    // ⚖ F-S12 — AND THE NAME IS TRUE OF THE PAGE. Only the open mode's panel is
    // mounted, so only the selected tab may name one: an `aria-controls` on an
    // id that is not in the document promises a screen reader a region that is
    // not there. The pair is also ONE tab stop, which is what makes the arrow
    // keys already wired here the way between them.
    expect(SRC_CODE).toContain("aria-controls={mode === 'ledger' ? 'rgPanelLedger' : undefined}")
    expect(SRC_CODE).toContain("aria-controls={mode === 'close' ? 'rgPanelClose' : undefined}")
    expect(SRC_CODE).toContain("tabIndex={mode === 'ledger' ? 0 : -1}")
    expect(SRC_CODE).toContain("tabIndex={mode === 'close' ? 0 : -1}")
    // NOT NAVIGATION: no route, no href, nothing that leaves the page.
    const tabRow = SRC_CODE.slice(SRC_CODE.indexOf('className="rg-modes"'), SRC_CODE.indexOf('id="rgPanelLedger"'))
    expect(tabRow).not.toMatch(/href|Link|router|useSearchParams/)
    // NOT A FILTER: the filter row is a different control on a different band,
    // and the tabs never touch it.
    expect(tabRow).not.toContain('setFilter')
    expect(SRC_CODE).toContain("onClick={() => setMode('ledger')}")
    expect(SRC_CODE).toContain("onClick={() => setMode('close')}")
    // ⑥ THE 閉店 TAB CARRIES ITS STATE, read off the SAME verdict the checklist
    // prints — so a cashier at the transaction desk knows the day is blocked
    // without leaving it to find out.
    expect(props.close!.headline).toBe(`${props.close!.openCount}項目 未完了`)
    expect(SRC_CODE).toContain('{close.headline}</span>')
    // ⚖ SAME DAY, SAME SCOPE: one counts object, one row list, both modes.
    expect(SRC_CODE).toContain('取引 <span className="rg-mode-n">{props.counts.all}件</span>')
  })

  it('⑤ the counters stay live in 閉店, and pressing one RETURNS to 取引 with its filter', () => {
    // A filter needs its list, so the press carries the reader to where the list
    // is. The counter strip sits ABOVE the tab row — always visible, both modes.
    expect(SRC_CODE.indexOf('className="rg-counts')).toBeLessThan(SRC_CODE.indexOf('className="rg-modes"'))
    expect(SRC_CODE).toContain('const choose = (next: RegisterFilter) => {\n    setFilter(next)\n    setMode(\'ledger\')\n    setDetailOpen(false)\n  }')
  })

  it('⧉ THE RECORD SITS DIRECTLY ABOVE THE BUTTON IT PERMITS', () => {
    // The reader used to sign first and read what they signed afterwards: the
    // evidence was a tall two-up table BELOW the pair with the confirm button
    // somewhere above it. Source order is DOM order is reading order.
    const record = SRC_CODE.indexOf('className={`rg-record')
    const actions = SRC_CODE.indexOf('className="rg-close-actions"')
    const closeBtn = SRC_CODE.indexOf('{close.closeLabel}')
    expect(record).toBeGreaterThan(0)
    expect(record).toBeLessThan(actions)
    expect(actions).toBeLessThan(closeBtn)
  })

  it('⚑ the closing footnote renders WITH the buttons it explains', () => {
    // A role with no controls was being told why the controls it cannot see are
    // disabled. Both live inside the 閉店 panel now, which only renders for a role
    // that has the view at all.
    const panel = SRC_CODE.slice(SRC_CODE.indexOf("{close && cash && mode === 'close' && ("))
    expect(panel).toContain('className="rg-close-actions"')
    expect(panel).toContain('id="rgClosingFootnote"')
  })

  it('⑲ a レジ that cannot ring a sale is a ledger — the button is here, refused', async () => {
    const props = await room({ store: STORE_A })
    expect(props.sellLabel).toBe('店頭販売を記録')
    expect(props.sellRefusal).toContain('在庫と決済')
    // It sits in the ledger's own head, where the row it would add goes.
    const head = SRC_CODE.slice(SRC_CODE.indexOf('id="rgLedgerTitle"'), SRC_CODE.indexOf('className="rg-filters"'))
    expect(head).toContain('<Refused className="btn primary" label={props.sellLabel} reason={props.sellRefusal} />')
    // …and every role that works the desk keeps it — the sale is not a close.
    const staff = await registerProps({ locale: 'ja', store: STORE_A, world: { role: 'スタッフ' } })
    expect(staff.props.sellLabel).toBe('店頭販売を記録')
  })

  it('⚖ 8/25 SELF-EXPLAINING NUMBERS — no bare figure anywhere on the page', async () => {
    const props = await room({ store: STORE_A })
    // Every counted thing says WHAT it counts, in the string itself.
    expect(props.moneyScope).toContain('取引')
    expect(props.moneyFold).toMatch(/純売上 ¥[\d,]+ \/ 未収 ¥[\d,]+/)
    expect(props.countsFold).toMatch(/^全\d+件 \/ 要確認 \d+件$/)
    expect(props.terminal!.stats.map((s) => s.value)).toEqual(['1件', '¥6,600', '0件'])
    for (const s of props.terminal!.stats) expect(s.label.length).toBeGreaterThan(1)
    // The record strip and the money strip are label+value pairs by construction.
    for (const r of [...props.close!.record, ...props.money]) {
      expect({ label: r.label, named: r.label.trim().length > 0 }).toEqual({ label: r.label, named: true })
    }
    // The counters print their unit rather than a bare integer beside a word.
    expect(SRC_CODE).toContain('{props.counts[s.key]}件')
    // …and the denomination sheet's counts carry 枚.
    expect(props.close!.cash.denominations!.unit).toBe('枚')
    expect(CSS_CODE).toContain('.rg-den-u')
    // The fold that hides eight facts says how many it is hiding.
    expect(SRC_CODE).toContain('記録される{close.record.length}項目を確認')
  })

  it('⚖ A ROW WITH NOBODY ON IT RENDERS COMPACT — no placeholder where a person goes', async () => {
    const props = await room({ store: STORE_A })
    const nameless = props.rows.find((r) => r.id === 'TX-5503')!
    const named = props.rows.find((r) => r.id === 'TX-4808')!
    expect({ title: nameless.title, nameless: nameless.nameless }).toEqual({
      title: 'ヘアバーム（店頭販売）',
      nameless: true,
    })
    expect({ title: named.title, nameless: named.nameless }).toEqual({ title: named.who, nameless: false })
    // The middle line is what goes: what was sold is the headline, so the state
    // chip rides the top line and the row is one line shorter.
    expect(SRC_CODE).toContain('{!r.nameless && (\n                            <span className="rg-line2">')
    expect(SRC_CODE).toContain('{r.nameless && <span className={r.pill}>{r.stateLabel}</span>}')
    expect(CSS_CODE).toContain('.rg-copy-compact .rg-line1 .pill')
    // …and the detail heading is the same headline, never 「店頭販売（予約なし）」
    // pretending to be a customer.
    expect(SRC_CODE).toContain('<h2 id="rgDetailTitle">{current.title}</h2>')
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
        expect(props.counts.all).toBe(6)
        expect(props.money.find((m) => m.key === 'gross')!.value).toBe(yen(ledgerTotals(build(STORE_A)).gross))
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

  it('⧉ THE TWO PAIRS ARE NOT THE SAME SHAPE, and the sheet stops pretending they are', () => {
    // ⚠ THIS SUPERSEDES F12's SECOND HALF, by measurement rather than by taste
    // (the approved mock's own comment, adjudicated 8/24). The INSPECTOR's pair
    // lives inside the 取引 workspace beside a 300px ledger: at 1024 it has ~600px
    // to split, and two 290px halves stop holding a sentence — so it stacks from
    // 1099 down. The CLOSING desk has no queue column beside it: at 1024 its pair
    // splits the whole content width, ~450px a side, which is WIDER than the
    // 800–1023 pair this same sheet already calls comfortable. Stacking it at
    // 1024–1099 made an iPad-landscape closing desk worse than a foldable's
    // interior four inches smaller. Both rules are read out of the shipped sheet.
    const band = (query: string) => {
      const at = CSS_CODE.indexOf(query)
      expect({ query, stated: at >= 0 }).toEqual({ query, stated: true })
      return CSS_CODE.slice(at, CSS_CODE.indexOf('\n}', at))
    }
    const columns = (rules: string, selector: string) => {
      const m = new RegExp(`\\.biz \\.pg-register \\.${selector} \\{[^}]*grid-template-columns:([^;]+);`).exec(rules)
      return m === null ? null : m[1].trim().split(/\s+(?![^(]*\))/).length
    }
    // The base sheet pairs both.
    expect(columns(CSS_CODE.slice(0, CSS_CODE.indexOf('@media')), 'rg-closing')).toBe(2)
    // ≤1099 stacks the INSPECTOR's pair and says nothing about the closing desk.
    const stack = band('@media (max-width: 1099px)')
    expect({ grid: columns(stack, 'rg-grid'), closing: columns(stack, 'rg-closing') })
      .toEqual({ grid: 1, closing: null })
    // ≤1023 — the ledger is gone and the page is one column — stacks the closing
    // desk, which is the FIRST time it stacks.
    const tablet = band('@media (max-width: 1023px)')
    expect(columns(tablet, 'rg-closing')).toBe(1)
    // 800–1023 re-pairs BOTH: a near-square canvas has width to spend.
    const pair = band('@media (min-width: 800px) and (max-width: 1023px)')
    expect({ grid: columns(pair, 'rg-grid'), closing: columns(pair, 'rg-closing') }).toEqual({ grid: 2, closing: 2 })
    // …and the measured columns at 1100 / 1024 / 940 / 820 are in the probe.
  })

  it('⧉ THE STICKY COLUMNS ARE NOT SCROLLERS — sticky, and nothing else', () => {
    // ⑭ At sixty rows the ledger is four viewports tall and the selected
    // transaction's evidence has long since scrolled off the top. The right
    // column therefore stops rising past the topbar — WITHOUT capping a height or
    // owning an axis, which is what would have broken ⚖ page-scroll.
    expect(CSS_CODE).toContain('.biz .pg-register .rg-detail,\n.biz .pg-register .rg-right { position: sticky; top: 74px; }')
    const sticky = CSS_CODE.slice(CSS_CODE.indexOf('.rg-detail,'), CSS_CODE.indexOf('.rg-panel {'))
    expect(sticky).not.toMatch(/max-height|overflow/)
  })

  it('⚖ F-R4 — the shell’s 1180px FLOOR IS OFF for this room, and the SHELL is what says so', () => {
    // The family default pans below 1180 and a room leaves it only by proving a
    // narrow ladder (business-shell.css's own opt-in-by-proof note). This room's
    // ladder was real and unreachable: it laid itself out correctly at 390 while
    // the reader got 790px of horizontal panning. The selector is SHELL-owned —
    // a route sheet may never lift its own floor — so the contract is pinned
    // HERE, against the shell's file, and the measured proof is in the probe.
    const shell = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business-shell.css'), 'utf8')
    expect(shell).toMatch(/\.biz \.app:has\([^)]*\.page\.pg-register[^)]*\)\s*\{\s*min-width:\s*0/)
    // …and this room's own sheet never reaches up to the shell to do it itself.
    expect(CSS_CODE).not.toContain('.app')
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

  it('⚖ F-S1 — the mode row WRAPS, so a good evening’s status never pushes the page sideways', () => {
    // The 閉店 tab carries the day's status, and the status of a successful close
    // is a whole sentence: 「閉店の条件はすべて満たしています」. Two nowrap tabs on one
    // nowrap line wanted 322px on a 284px screen, so the WHOLE PAGE panned at
    // 360/375/390 in both modes — on the most ordinary evening a shop has.
    expect(CSS_CODE).toContain('display: flex; flex-wrap: wrap; align-items: stretch; gap: 2px 24px;')
    // A row that does not wrap has no row gap, so the approved arrangement is
    // unchanged to the pixel wherever the pair still fits.
    const band = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(band).toContain('.biz .pg-register .rg-modes { gap: 2px 18px; }')
    // Nothing is truncated to buy the room: the tab and its chip stay nowrap and
    // the SENTENCE is what gets the line below.
    expect(CSS_CODE).toMatch(/\.rg-mode \{[^}]*white-space: nowrap;/)
  })

  it('⚖ F-S6 — every box on the money desk is at least as wide as the figure in it', () => {
    // ① the drawer's stats: the 124px basis still decides how many sit across on
    // an ordinary evening, but a cell may no longer shrink BELOW its own content,
    // so the row wraps instead of clipping the one figure a human types.
    expect(CSS_CODE).toContain('.biz .pg-register .rg-cash-stat { flex: 1 1 124px; padding: 10px 11px; background: #fff; }')
    expect(CSS_CODE).not.toMatch(/\.rg-cash-stat \{[^}]*min-width: 0/)
    // …and the FIELD is measured by its own FIGURE, because a field is the one
    // box with no content width a layout can read: its intrinsic size comes from
    // `size`, an estimate in average characters. The figure is handed to the box
    // as text and laid out at zero height in the type the field uses.
    expect(SRC_CODE).toContain('<span className="rg-count-box" data-count={cash.counted}>')
    expect(CSS_CODE).toContain('content: attr(data-count); display: block; height: 0; visibility: hidden;')
    // ⚠ AND THE SIZER MUST NOT CLIP ITSELF. A box that hides its own overflow is a
    // scroll container, and a scroll container's automatic minimum size is ZERO —
    // it would measure the figure and then tell the layout it needed nothing.
    expect(CSS_CODE).not.toMatch(/rg-count-box::before \{[^}]*overflow/)
    // ⚠ AND IT MUST OUT-SPECIFY `.rg-cash-stat span`, which this very sheet states
    // at three classes AND a type. At three classes the box lost, and the one
    // figure a human types rendered at label size in grey.
    expect(CSS_CODE).toContain('.biz .pg-register .rg-cash-stat .rg-count-box {')
    expect(CSS_CODE).not.toMatch(/^\.biz \.pg-register \.rg-count-box \{/m)
    // ONE VALUE, READ TWICE BY ONE EXPRESSION — the sizer is generated content
    // (`visibility: hidden`, no node of its own), so no screen reader hears the
    // count twice and no second string can drift from the first.
    expect(SRC_CODE.match(/data-count=/g) ?? []).toHaveLength(1)
    expect(SRC_CODE).toContain('value={cash.counted}')
    expect(CSS_CODE).toContain('visibility: hidden;')
    expect(CSS_CODE).toContain('.biz .pg-register .rg-cash-stat .rg-count-box { font-size: 16px; }')
    // ③ the money strip sizes from the PANEL, not the window — one viewport width
    // is two page widths, and the six cells were keyed to the viewport.
    expect(CSS_CODE).toContain('.biz .pg-register .rg-money {\n  display: flex; flex-wrap: wrap; gap: 1px;')
    expect(CSS_CODE).not.toMatch(/\.rg-money \{[^}]*repeat\(5, minmax\(96px/)
    expect(CSS_CODE).toContain('.biz .pg-register .rg-money-cell { flex: 1 1 96px;')
    // The approved arrangement is still STATED, band by band — what the bands no
    // longer decide is whether a figure fits.
    expect(CSS_CODE).toContain('.biz .pg-register .rg-money-cell { flex-basis: calc(50% - 1px); }')
    expect(CSS_CODE).toContain('.biz .pg-register .rg-money-cell:last-child { flex-basis: 100%; border-radius: 0 0 10px 10px; }')
    // ② the 内訳 row wraps instead of being clipped by its own radius — at EVERY
    // width, because the base band held three fixed tracks too.
    expect(CSS_CODE).toContain('.biz .pg-register .rg-recon-row { display: flex; flex-wrap: wrap; gap: 4px 14px;')
    expect(CSS_CODE).not.toContain('repeat(3, minmax(84px, auto))')
    expect(CSS_CODE).toContain('.biz .pg-register .rg-recon-cell { flex: 0 0 auto; display: block; text-align: right; }')
    const band = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(band).toContain('.biz .pg-register .rg-recon-cell { flex: 1 1 auto; text-align: left; }')
  })

  it('⚖ F-S7/F-S8/F-S9 — words wrap, names break, and the corner children carry the radius', () => {
    // F-S7 — a reason is a SENTENCE. readOnly, it is text: it grows down rather
    // than running off the side of a field that clips without saying so.
    expect(SRC_CODE).toContain('<p className="rg-reason-in" title={cash.reasonInput.refusal}>')
    expect(SRC_CODE).not.toMatch(/className="rg-reason-in"\s*\n\s*type="text"/)
    expect(CSS_CODE).not.toMatch(/\.rg-reason-in \{[^}]*cursor: not-allowed/)
    // F-S8 — most Japanese names have no space to break at, so `keep-all` alone
    // told the browser never to break them and 承認者 painted over its neighbour.
    expect(CSS_CODE).toContain('.biz .pg-register .rg-rec-cell b.wrap { white-space: normal; word-break: keep-all; overflow-wrap: anywhere; }')
    // F-S9 — the corner children carry the box's radius, this sheet's own pattern
    // (`.rg-checks` two blocks up), because this box may never clip.
    expect(CSS_CODE).toContain('.biz .pg-register .rg-cash-stats > :first-child { border-top-left-radius: 8px; }')
    expect(CSS_CODE).toContain('.biz .pg-register .rg-cash-stats > :last-child { border-radius: 0 0 8px 8px; }')
    const band = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(band).toContain('.biz .pg-register .rg-cash-stats > :first-child { border-radius: 8px 8px 0 0; }')
    // …and the box still never clips, which is why the children carry it at all.
    expect(CSS_CODE).not.toMatch(/\.rg-cash-stats \{[^}]*overflow/)
  })

  it('⚖ F-S3/F-S4 — the tour is a real modal, and the walk re-measures on any render that changes it', () => {
    // F-S3 — a scrim that only stops the MOUSE is not a modal. Tab walked
    // straight through it into the dimmed page and could operate it.
    expect(SRC_CODE).toContain('aria-modal="true"')
    expect(SRC_CODE).toContain("if (e.key === 'Tab') {")
    expect(SRC_CODE).toContain("const stops = [...card.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]")
    expect(SRC_CODE).toContain('e.preventDefault()')
    // F-S4 — the census is read off the DOM, so the deps are the state the DOM is
    // a function of; and the INDEX is clamped in state, not only in the card.
    expect(SRC_CODE).toContain('}, [tourIdx, tourTick, tourStep, mode, detailOpen, filter, folds, denOpen, props])')
    expect(SRC_CODE).toContain('if (i !== tourIdx) { setTourIdx(i); return }')
    // F-S11 — ≤743 the card is pinned to the bottom and the step is scrolled into
    // the free zone above it, because a phone has no free SIDE.
    expect(SRC_CODE).toContain('const narrow = window.innerWidth <= 743')
    expect(SRC_CODE).toContain('const freeBottom = narrow ? window.innerHeight - size.height - 20 : window.innerHeight - 40')
    expect(SRC_CODE).toContain('if (narrow) window.scrollBy(0, r.top - 60)')
    // …and the shared engine is untouched: the override lives in the room.
    expect(SRC_CODE).toContain('spotCardAt(boxOf(r), size, { width: window.innerWidth, height: window.innerHeight })')
  })

  it('⚖ F-S10/F-S12 — the count sheet survives a mode round trip, and every fold’s aria is true', () => {
    // F-S10 — a native <details> keeps its open flag in a node the mode switch
    // unmounts, so the closer's own counting was thrown away while every fold
    // beside it survived.
    expect(SRC_CODE).toContain('const [denOpen, setDenOpen] = useState(false)')
    expect(SRC_CODE).toContain('open={denOpen}')
    expect(SRC_CODE).toContain('onToggle={(e) => setDenOpen(e.currentTarget.open)}')
    // F-S12 — a fold NAMES the region it opens, and all three regions render at
    // every width (the phone band folds them with `display`, it does not unmount
    // them), so the id is always in the document.
    for (const id of ['rgMoney', 'rgCounts', 'rgRecord']) {
      expect({ id, named: SRC_CODE.includes(`aria-controls="${id}"`) }).toEqual({ id, named: true })
      expect({ id, exists: SRC_CODE.includes(`id="${id}"`) }).toEqual({ id, exists: true })
    }
    // …and the terminal fold's NAME says which way it goes, because one button
    // doing two jobs cannot call itself 「開く」 while it is open.
    expect(SRC_CODE).toContain('aria-label={folds.terminal ? props.terminal.foldCloseLabel : props.terminal.foldLabel}')
    expect(PROPS_CODE).toContain("foldCloseLabel: '決済端末の詳細を閉じる',")
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
