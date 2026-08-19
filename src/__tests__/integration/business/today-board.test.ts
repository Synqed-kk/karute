/**
 * 今日の運営 board — display tier.
 *
 * THE ONE THING THIS SUITE IS FOR: the board's numbers have to agree. A day
 * board that says 未解決 4件 over three cards, or 稼働率 42% on a roster it also
 * calls fully booked, is worse than a blank screen — it teaches the reader to
 * distrust every number on it. So the assertions here are mostly equalities
 * BETWEEN surfaces, not spot-checks of single values.
 *
 * Second job: the fixture day has to stay operationally possible (⚖ 8/9). A
 * break outside its shift, a bed turning over with no cleaning time, a card
 * painted inside an absence — every one of those would have the demo teaching
 * Liam something untrue about how the business runs.
 *
 * NOTE ON RENDER SMOKES: react-dom is deliberately OFF territory's import
 * allowlist (business-isolation.test.ts), so a band is smoke-tested by
 * asserting the props the screen is handed for it — the same technique the 顧客
 * suite uses. The actual pixels are proven by the evidence folder's standalone
 * render and the side-by-side screenshots.
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
import { jstDayKey, jstMinuteOfDay } from '@/business/lib/clock'
import { appointments, operator, reserveSync, STORE_A, STORE_B } from '@/business/lib/fixtures'
import {
  absence,
  blocks,
  boardNow,
  decisions,
  operatingHours,
  opsConfig,
  register,
  resources,
  sellSlots,
  shifts,
  staffQualifications,
} from '@/business/lib/fixtures-today'
import { sellLayerFor } from '@/app/[locale]/(business)/business/today/today-interactions'
import { money } from '@/business/lib/canon-logic/pricing'
import {
  availableMinutes,
  bookingCategory,
  cleanupBlocks,
  effectiveShift,
  freeSlots,
  openDecisions,
  minuteOf,
  place,
  suppressedByAbsence,
  utilization,
} from '@/business/lib/today-board'
import * as data from '@/business/lib/data'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import { customers } from '@/business/lib/fixtures'

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

/** The props the screen is handed — the page returns an element tree, and no
 *  renderer is available in territory (see the header). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function screenProps(node: any): TodayProps | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === TodayScreen) return node.props
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
    const hit = screenProps(kid)
    if (hit) return hit
  }
  return null
}

const board = async (store?: string, day?: string) =>
  screenProps(
    await TodayPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({ ...(store ? { store } : {}), ...(day ? { day } : {}) }),
    }),
  )!

const today = () => appointments().filter((a) => jstDayKey(a.starts_at) === jstDayKey(new Date()))
const minutesOf = (iso: string) => jstMinuteOfDay(iso)

// ═══════════════════════════════════════════════════════════════════════════
// 1. The fixture day is operationally possible
// ═══════════════════════════════════════════════════════════════════════════

describe('the board day is operationally possible (⚖ 8/9 demo-data-product-truth)', () => {
  const shiftOf = (id: string) => shifts.find((s) => s.staff_id === id) ?? null

  it('every break sits inside its own shift', () => {
    for (const s of shifts) {
      for (const b of s.breaks) {
        expect(b.start).toBeGreaterThanOrEqual(s.start)
        expect(b.end).toBeLessThanOrEqual(s.end)
        expect(b.end).toBeGreaterThan(b.start)
      }
    }
  })

  it('every shift sits inside the store opening hours', () => {
    for (const s of shifts) {
      expect(s.start).toBeGreaterThanOrEqual(operatingHours.open)
      expect(s.end).toBeLessThanOrEqual(operatingHours.close)
    }
  })

  it("no booking runs outside its staff member's shift", () => {
    for (const a of today()) {
      if (!a.staff_id || a.status === 'cancelled') continue
      const s = shiftOf(a.staff_id)
      expect(s).not.toBeNull()
      expect(minutesOf(a.starts_at)).toBeGreaterThanOrEqual(s!.start)
      expect(minutesOf(a.ends_at)).toBeLessThanOrEqual(s!.end)
    }
  })

  it('no booking overlaps its own break', () => {
    for (const a of today()) {
      if (!a.staff_id || a.status === 'cancelled') continue
      for (const b of shiftOf(a.staff_id)?.breaks ?? []) {
        expect(minutesOf(a.starts_at) >= b.end || minutesOf(a.ends_at) <= b.start).toBe(true)
      }
    }
  })

  it('no non-booking block overlaps a booking on the same staff member', () => {
    for (const blk of blocks) {
      for (const a of today()) {
        if (a.staff_id !== blk.staff_id || a.status === 'cancelled') continue
        expect(minutesOf(a.starts_at) >= blk.end || minutesOf(a.ends_at) <= blk.start).toBe(true)
      }
    }
  })

  it('no bed holds two bookings at once', () => {
    const live = today().filter((a) => a.resource_id && a.status !== 'cancelled')
    for (const a of live) {
      for (const b of live) {
        if (a.id >= b.id || a.resource_id !== b.resource_id) continue
        expect(
          minutesOf(a.starts_at) >= minutesOf(b.ends_at) || minutesOf(b.starts_at) >= minutesOf(a.ends_at),
        ).toBe(true)
      }
    }
  })

  it('the derived 清掃 block never overlaps the next booking on the same bed', () => {
    for (const r of resources) {
      const on = today()
        .filter((a) => a.resource_id === r.id && a.status !== 'cancelled')
        .map((a) => ({ id: a.id, start: minutesOf(a.starts_at), end: minutesOf(a.ends_at) }))
      const cleans = cleanupBlocks(on, r.cleanup_minutes, operatingHours)
      for (const c of cleans) {
        expect(c.end).toBeGreaterThan(c.start)
        expect(c.end).toBeLessThanOrEqual(operatingHours.close)
        for (const b of on) {
          expect(c.start >= b.end || c.end <= b.start).toBe(true)
        }
      }
    }
  })

  it('a 販売可能枠 is genuinely free — staff, bed, shift and break all clear', () => {
    for (const slot of sellSlots) {
      const shift = shiftOf(slot.staff_id)!
      expect(slot.start).toBeGreaterThanOrEqual(shift.start)
      expect(slot.end).toBeLessThanOrEqual(shift.end)
      for (const b of shift.breaks) expect(slot.start >= b.end || slot.end <= b.start).toBe(true)
      for (const a of today()) {
        if (a.status === 'cancelled') continue
        const clash = a.staff_id === slot.staff_id || a.resource_id === slot.resource_id
        if (!clash) continue
        expect(slot.start >= minutesOf(a.ends_at) || slot.end <= minutesOf(a.starts_at)).toBe(true)
      }
    }
  })

  it('the incident is consistent with the absent lane: no card past the cut, and the booking that IS past it has a decision', () => {
    const stranded = today().filter(
      (a) => a.staff_id === absence.staff_id && minutesOf(a.starts_at) >= absence.from && a.status !== 'cancelled',
    )
    expect(stranded.length).toBeGreaterThan(0)
    for (const a of stranded) {
      // Never painted in her lane…
      expect(suppressedByAbsence({ staff_id: a.staff_id, startMinute: minutesOf(a.starts_at) }, absence)).toBe(true)
      // …and never silent either: it is a decision the operator can act on.
      expect(decisions.some((d) => d.appointment_id === a.id && d.state === 'open')).toBe(true)
    }
  })

  it('a cancelled booking carries no board state, so it can never paint', () => {
    for (const a of appointments()) {
      if (a.status === 'cancelled') expect(a.board_state).toBeNull()
    }
  })

  it('booking display numbers are human-shaped and unique (⚖ L-6, no UUID wrecks)', () => {
    const nos = appointments().map((a) => a.display_no)
    expect(new Set(nos).size).toBe(nos.length)
    for (const n of nos) expect(n).toMatch(/^R-\d{4}$/)
  })

  it('the 精算待ち deadline on the レジ card matches the clock it is measured against', () => {
    const dec = decisions.find((d) => d.kind === 'レジ')!
    const booking = today().find((a) => a.id === dec.appointment_id)!
    expect(dec.deadline).toBe(`${boardNow - minutesOf(booking.ends_at)}分経過`)
  })

  it('every decision points at a booking or a slot that exists', () => {
    for (const d of decisions) {
      expect(d.appointment_id != null || d.sell_slot_id != null).toBe(true)
      if (d.appointment_id) expect(appointments().some((a) => a.id === d.appointment_id)).toBe(true)
      if (d.sell_slot_id) expect(sellSlots.some((s) => s.id === d.sell_slot_id)).toBe(true)
    }
  })

  it('the terminal-held transaction names a booking that is genuinely unsettled', () => {
    const held = today().find((a) => a.id === register.terminal_held.appointment_id)!
    expect(held.settlement).toBe('awaiting')
    expect(held.booked_price).toBe(register.terminal_held.amount)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. The derivations
// ═══════════════════════════════════════════════════════════════════════════

describe('board derivations', () => {
  it('places a lane element as a share of the opening-hours window', () => {
    const h = { open: 600, close: 1140 } // 10:00–19:00, 540 minutes
    expect(place(600, 660, h)).toEqual({ x: 0, w: (60 / 540) * 100, startMin: 600, endMin: 660 })
    expect(place(1080, 1140, h)).toEqual({ x: (480 / 540) * 100, w: (60 / 540) * 100, startMin: 1080, endMin: 1140 })
    // Anything outside the window is clipped to it rather than drawn off-board —
    // and the minute pair is clipped identically, so the percent reading and the
    // minute reading of the same element can never disagree.
    expect(place(540, 660, h).x).toBe(0)
    expect(place(540, 660, h).startMin).toBe(600)
    expect(place(1100, 1260, h).w).toBe((40 / 540) * 100)
    expect(place(1100, 1260, h).endMin).toBe(1140)
    // minuteOf is place()'s inverse, on the same axis.
    expect(minuteOf(place(750, 810, h).x, h)).toBe(750)
  })

  it('reads カテゴリー strongest-first: VIP over 回数券 over 新規/再来', () => {
    const base = customers.find((c) => c.id === 'cus-02')!
    expect(bookingCategory({ ...base, vip: true, ticket_balance: 5 }, 9)).toBe('vip')
    expect(bookingCategory({ ...base, vip: false, ticket_balance: 5 }, 9)).toBe('ticket')
    expect(bookingCategory({ ...base, vip: false, ticket_balance: null }, 0)).toBe('new')
    expect(bookingCategory({ ...base, vip: false, ticket_balance: null }, 3)).toBe('repeat')
    // A zero balance is not a 回数券 holder.
    expect(bookingCategory({ ...base, vip: false, ticket_balance: 0 }, 2)).toBe('repeat')
  })

  it("cuts the absent staff member's shift at the absence, breaks included", () => {
    const raw = shifts.find((s) => s.staff_id === absence.staff_id)!
    const cut = effectiveShift(raw, absence)
    expect(cut.end).toBe(absence.from)
    for (const b of cut.breaks) expect(b.end).toBeLessThanOrEqual(absence.from)
    // Everyone else is untouched.
    const other = shifts.find((s) => s.staff_id !== absence.staff_id)!
    expect(effectiveShift(other, absence)).toBe(other)
  })

  it('turns a bed over for the full window when there is room, and stops at the next booking', () => {
    const h = { open: 600, close: 1140 }
    // Room to spare → the whole 30 minutes.
    expect(cleanupBlocks([{ id: 'a', start: 600, end: 660 }], 30, h)).toEqual([{ id: 'a-cleanup', start: 660, end: 690 }])
    // The next booking is 10 minutes later → 10 minutes of cleaning, not 30.
    expect(cleanupBlocks([{ id: 'a', start: 600, end: 660 }, { id: 'b', start: 670, end: 700 }], 30, h)[0]).toEqual({
      id: 'a-cleanup',
      start: 660,
      end: 670,
    })
    // Back-to-back leaves no room, so no block is drawn rather than a 0-minute one.
    expect(cleanupBlocks([{ id: 'a', start: 600, end: 660 }, { id: 'b', start: 660, end: 700 }], 30, h)).toHaveLength(1)
    // Closing time caps it.
    expect(cleanupBlocks([{ id: 'a', start: 1080, end: 1130 }], 30, h)[0].end).toBe(1140)
  })

  it('measures 稼働率 against treatment staff only, minus their breaks', () => {
    expect(availableMinutes({ staff_id: 'x', start: 600, end: 1140, breaks: [{ start: 720, end: 780 }] })).toBe(480)
    const u = utilization([
      { bookedMinutes: 120, availableMinutes: 480, treats: true },
      { bookedMinutes: 60, availableMinutes: 420, treats: true },
      // A receptionist is not idle treatment capacity — including her would
      // drag the number down and misreport the day.
      { bookedMinutes: 0, availableMinutes: 480, treats: false },
    ])
    expect(u).toEqual({ booked: 180, available: 900, percent: 20 })
    expect(utilization([]).percent).toBe(0)
  })

  it('counts free slots from the same minutes 稼働率 uses', () => {
    expect(freeSlots(480, 120)).toBe(6)
    expect(freeSlots(480, 480)).toBe(0)
    // A day booked past its roster reads 満, never a negative number of slots.
    expect(freeSlots(300, 480)).toBe(0)
  })

  it('suppresses only the absent lane, and only past the cut', () => {
    expect(suppressedByAbsence({ staff_id: absence.staff_id, startMinute: absence.from }, absence)).toBe(true)
    expect(suppressedByAbsence({ staff_id: absence.staff_id, startMinute: absence.from - 30 }, absence)).toBe(false)
    expect(suppressedByAbsence({ staff_id: 'p-04', startMinute: absence.from + 60 }, absence)).toBe(false)
    expect(suppressedByAbsence({ staff_id: absence.staff_id, startMinute: 900 }, null)).toBe(false)
  })

  it('counts only 対応中 decisions — history stays in the list, out of the badge', () => {
    expect(openDecisions(decisions).length).toBeLessThan(decisions.length)
    expect(openDecisions(decisions).every((d) => d.state === 'open')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. The screen: one band at a time, then the equalities
// ═══════════════════════════════════════════════════════════════════════════

describe('今日の運営 screen', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-08-19T00:00:00Z')))
  afterAll(() => jest.useRealTimers())
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

  it('gates itself: a denied session 404s the page, not just the layout', async () => {
    supabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } })
    await expect(board()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  // ── band by band ────────────────────────────────────────────────────────
  it('C — the ops strip carries every money and queue cell', async () => {
    const p = await board(STORE_A)
    expect(p.ops.total).toMatch(/^¥[\d,]+$/)
    expect(p.ops.settled).toMatch(/件$/)
    expect(p.ops.awaiting).toMatch(/件$/)
    expect(p.ops.cashDifference).toBe('¥0')
    expect(p.ops.syncLabel).toMatch(/^\d{2}:\d{2}$/)
  })

  it('ONE world clock — the shell stamp and the board chip are the same instant, and it is behind the now-line', async () => {
    // The play-phase world runs on the board's anchor. Two surfaces quote the
    // Reserve sync — the shell topbar (layout.tsx formats shell.reserveSyncedAt)
    // and the ops-strip chip (page.tsx formats the SAME field) — so the first
    // assertion is that they are one value, not two clocks that happen to agree.
    const shell = await data.readShellIdentity()
    const stamp = new Date(shell.reserveSyncedAt)
    const p = await board(STORE_A)
    const fmt = new Intl.DateTimeFormat('ja-JP', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
    })
    expect(p.ops.syncLabel).toBe(fmt.format(stamp))
    // …and that the one value sits BEFORE the board's own now — a sync stamped
    // after the moment the board is showing is the contradiction this fixes.
    expect(jstMinuteOfDay(stamp)).toBe(boardNow - reserveSync.minutes_ago)
    expect(jstMinuteOfDay(stamp)).toBeLessThan(boardNow)
    // The DAY is still the real one (⚖ L-6 — only the intra-day time is pinned).
    expect(jstDayKey(stamp)).toBe(jstDayKey(new Date()))
  })

  it('D — 自分の1日 renders for the operator, from her own roster row', async () => {
    const p = await board(STORE_A)
    expect(p.myDay).not.toBeNull()
    expect(p.myDay!.shift).toMatch(/^シフト \d{2}:\d{2}–\d{2}:\d{2}$/)
    expect(p.myDay!.break).toMatch(/^休憩 \d{2}:\d{2}–\d{2}:\d{2}$/)
    // 本日の担当 is HER bookings, not the store's.
    const mine = appointments().filter(
      (a) => a.staff_id === operator.staff_id && jstDayKey(a.starts_at) === jstDayKey(new Date()),
    )
    expect(p.myDay!.todayCount).toBe(`${mine.length}件`)
  })

  it('E — the board head has its hours ruler, its sell shelf and a day label', async () => {
    const p = await board(STORE_A)
    expect(p.hours.count).toBe((operatingHours.close - operatingHours.open) / 60)
    expect(p.hours.labels).toHaveLength(p.hours.count)
    expect(p.hours.labels[0]).toBe(String(operatingHours.open / 60))
    expect(p.sell.gridMin).toBe(opsConfig.reserveStartGridMin)
    expect(p.sell.nowMinute).toBe(boardNow)
    expect(p.dayLabel).toContain('2026年')
    expect(p.nowFraction).toBeGreaterThan(0)
    expect(p.nowLabel).toBe('13:24')
  })

  it('F — staff lanes and bed lanes both render, with cards, breaks, blocks and cleanup', async () => {
    const p = await board(STORE_A)
    const staffLanes = p.lanes.filter((l) => l.group === 'staff')
    const bedLanes = p.lanes.filter((l) => l.group === 'beds')
    expect(staffLanes.length).toBeGreaterThanOrEqual(4)
    expect(bedLanes.length).toBeGreaterThanOrEqual(2)
    const kinds = new Set(p.lanes.flatMap((l) => l.items.map((i) => i.kind)))
    expect([...kinds].sort()).toEqual(['absence', 'block', 'booking', 'break', 'cleanup'])
    // Every card is placed inside the board, with real width.
    for (const item of p.lanes.flatMap((l) => l.items)) {
      expect(item.x).toBeGreaterThanOrEqual(0)
      expect(item.x + item.w).toBeLessThanOrEqual(100.001)
      expect(item.w).toBeGreaterThan(0)
    }
    // The 設備 view has lanes to show — the toggle ships enabled, not broken.
    expect(bedLanes.some((l) => l.items.length > 0)).toBe(true)
  })

  it('F — the operator gets the 自分 lane and the absent staff member gets the wash', async () => {
    const p = await board(STORE_A)
    expect(p.lanes.filter((l) => l.mine)).toHaveLength(1)
    const absent = p.lanes.find((l) => l.key === absence.staff_id)!
    expect(absent.absentNote).toBe('13:00以降 勤務不可')
    expect(absent.items.some((i) => i.kind === 'absence')).toBe(true)
    // …and no card of hers sits inside the wash.
    for (const item of absent.items) {
      if (item.kind !== 'booking') continue
      expect(item.x).toBeLessThan(place(absence.from, absence.from, operatingHours).x)
    }
  })

  it('F — a card carries its category colour, its resource tag and its ticket chip', async () => {
    const p = await board(STORE_A)
    const cards = p.lanes.filter((l) => l.group === 'staff').flatMap((l) => l.items).filter((i) => i.kind === 'booking')
    expect(new Set(cards.map((c) => c.category)).size).toBeGreaterThanOrEqual(3)
    expect(cards.some((c) => c.ticketCat === '回数券' && /残り\d+回/.test(c.ticketCore ?? ''))).toBe(true)
    expect(cards.some((c) => c.ticketCat === 'VIP')).toBe(true)
    expect(cards.some((c) => c.tag === '【未定】')).toBe(true)
    expect(cards.some((c) => c.held)).toBe(true)
  })

  it('G — every card and every decision has an inspector case with facts and proof', async () => {
    const p = await board(STORE_A)
    const ids = p.lanes.flatMap((l) => l.items).map((i) => i.caseId).filter(Boolean) as string[]
    for (const id of ids) {
      const c = p.cases[id]
      expect(c).toBeDefined()
      expect(c.facts.length).toBeGreaterThanOrEqual(5)
      expect(c.proofs.length).toBeGreaterThan(0)
      expect(c.source).not.toBe('')
    }
    for (const card of p.cards) expect(p.cases[card.id]).toBeDefined()
  })

  it('H — the hold bar shows the one 仮押さえ on the board, with its checks', async () => {
    const p = await board(STORE_A)
    expect(p.hold).not.toBeNull()
    expect(p.hold!.checks.length).toBeGreaterThan(0)
    const heldCards = p.lanes.flatMap((l) => l.items).filter((i) => i.state === 'hold')
    expect(heldCards.length).toBeGreaterThan(0)
  })

  it('I — the incident band names the absent staff member and counts its own recovery', async () => {
    const p = await board(STORE_A)
    expect(p.incident).not.toBeNull()
    expect(p.incident!.from).toBe('13:00')
    expect(p.incident!.steps).toHaveLength(4)
    expect(p.incident!.intakeStopped).toBe(true)
    expect(p.incident!.undecided).toBeGreaterThan(0)
  })

  it('J — every open decision becomes a card with a deadline and evidence', async () => {
    const p = await board(STORE_A)
    const opened = p.cards.filter((c) => c.state === 'open')
    expect(opened).toHaveLength(openDecisions(decisions).length)
    for (const c of opened) {
      expect(c.title).not.toBe('')
      expect(c.deadline).not.toBe('')
      expect(c.evidence.length).toBe(2)
    }
    // The card names the customer the booking names — one source, not two.
    const recovery = p.cards.find((c) => c.kind === '担当変更' && c.state === 'open')!
    expect(recovery.title).toContain('見本 さくら')
  })

  it('K — the KPI strip derives its three numbers from the board under it', async () => {
    const p = await board(STORE_A)
    const live = appointments().filter(
      (a) => jstDayKey(a.starts_at) === jstDayKey(new Date()) && a.store_id === STORE_A && a.status !== 'cancelled',
    )
    expect(p.kpi.count).toBe(`${live.length}件`)
    expect(p.kpi.utilization).toMatch(/^\d+(\.\d)?%$/)
    expect(p.kpi.revenue).toMatch(/^¥[\d,]+$/)
  })

  it('L — every dialog gets the data its canon layout needs', async () => {
    const p = await board(STORE_A)
    expect(p.dialogs.recovery!.rows).toHaveLength(5)
    expect(p.dialogs.checkout!.rows).toHaveLength(3)
    expect(p.dialogs.pricing.slots).toHaveLength(sellSlots.length)
    expect(p.dialogs.terminal.rows).toHaveLength(5)
    expect(p.dialogs.closing.checks).toHaveLength(5)
    expect(p.dialogs.blockers).toHaveLength(2)
    expect(p.dialogs.create.staff.length).toBeGreaterThan(0)
    expect(p.dialogs.create.menus.length).toBeGreaterThan(0)
    expect(p.dialogs.create.customers.length).toBeGreaterThan(0)
    expect(p.dialogs.blocks.length).toBe(blocks.length)
  })

  // ── the equalities ──────────────────────────────────────────────────────
  it('RECONCILES: 未解決 = 次に決めること = the cards on screen = the nav badge', async () => {
    const p = await board(STORE_A)
    const shown = p.cards.filter((c) => c.state === 'open').length
    const badge = (await data.readUnresolvedCounts()).byStore[STORE_A]
    expect(p.ops.unresolved).toBe(shown)
    expect(badge).toBe(shown)
    // …and a lens with no decisions of its own shows none of them.
    expect((await data.readUnresolvedCounts()).byStore[STORE_B]).toBe(0)
    expect((await board(STORE_B)).ops.unresolved).toBe(0)
  })

  it('RECONCILES: the money band is summed from the cards, and the no-show is out of it', async () => {
    const p = await board(STORE_A)
    const live = appointments().filter(
      (a) => jstDayKey(a.starts_at) === jstDayKey(new Date()) && a.store_id === STORE_A && a.status !== 'cancelled',
    )
    const earning = live.filter((a) => a.board_state !== 'noshow')
    expect(p.ops.total).toBe(`¥${earning.reduce((n, a) => n + (a.booked_price ?? 0), 0).toLocaleString('ja-JP')}`)
    expect(p.ops.settled).toBe(`${live.filter((a) => a.settlement === 'settled').length}件`)
    expect(p.ops.awaiting).toBe(`${live.filter((a) => a.settlement === 'awaiting').length}件`)
    // 予約件数 counts the no-show; the money does not.
    expect(p.kpi.count).toBe(`${live.length}件`)
    expect(live.length).toBeGreaterThan(earning.length)
  })

  // 公開中, 安全な空き and the shelf's own header used to be three server
  // numbers that had to be kept equal by hand. They are now ONE derivation the
  // browser runs (canon-logic/availability), so the equality is structural and
  // the thing worth asserting is that the derivation answers to the board it
  // reads — including a lane the operator has locked.
  it('RECONCILES: 公開中 = 安全な空き = the shelf, because all three read one derivation', async () => {
    const p = await board(STORE_A)
    const layer = (locked: string[]) =>
      sellLayerFor(p.lanes, p.hours, {
        gridMin: p.sell.gridMin,
        nowMinute: p.sell.nowMinute,
        locked,
        showPrice: true,
        hi: p.dialogs.pricing.hqMax,
        hqMin: p.dialogs.pricing.hqMin,
        depth: 9,
      })
    const open = layer([])
    expect(open.staffBands.length).toBeGreaterThan(0)
    expect(open.chipLabel).toBe(`オンライン販売中 ${open.staffBands.length}窓 · ${open.min === open.max ? money(open.min) : `${money(open.min)}〜`}`)
    // A locked lane sells nothing of its own — canon's `deriveSellableCells`
    // skips it outright (:4898), so its windows leave the shelf even though the
    // beds they used are still free.
    const lockedLane = p.lanes.find((l) => l.group === 'staff' && open.staffBands.some((b) => b.laneKey === l.key))!
    expect(layer([lockedLane.key]).staffBands.some((b) => b.laneKey === lockedLane.key)).toBe(false)
    expect(open.staffBands.some((b) => b.laneKey === lockedLane.key)).toBe(true)
  })

  it('the store lens clamps the board: another store never reaches a lane or a card', async () => {
    const a = await board(STORE_A)
    const b = await board(STORE_B)
    expect(b.lanes.filter((l) => l.group === 'beds').map((l) => l.key)).toEqual(['bed-04'])
    expect(a.lanes.filter((l) => l.group === 'beds').map((l) => l.key)).not.toContain('bed-04')
    // A clamped lens never labels a lane with another store's name.
    for (const l of b.lanes) expect(l.sub).not.toContain('銀座')
    expect(b.cards).toHaveLength(0)
    expect(b.incident).toBeNull()
  })

  it('viewAll shows both stores, and labels the beds so two ベッド1 rows are telling apart', async () => {
    const p = await board()
    const beds = p.lanes.filter((l) => l.group === 'beds')
    expect(beds.length).toBe(resources.length)
    // Two stores each own a 「ベッド1」; under viewAll the store name on the
    // sub-label is what keeps them apart, so no two rows read identically.
    expect(beds.filter((l) => l.label === 'ベッド1')).toHaveLength(2)
    expect(new Set(beds.map((l) => `${l.label} ${l.sub}`)).size).toBe(beds.length)
    expect(beds.every((l) => l.sub.includes('テスト'))).toBe(true)
  })

  it('a staff member with no shift today gets a lane that says so, rather than vanishing', async () => {
    const p = await board()
    const idle = p.lanes.find((l) => l.key === 'p-09')!
    expect(idle.sub).toBe('本日シフトなし')
    // One block across the whole day, no bookings: the lane says "you cannot
    // place anything here" on the board itself, not only in the label.
    expect(idle.items).toHaveLength(1)
    expect(idle.items[0]).toMatchObject({ kind: 'absence', title: '本日勤務なし', x: 0, w: 100 })
  })

  it('the hours outside a shift are painted, so a lane never looks bookable past its end', async () => {
    const p = await board(STORE_A)
    // 見本 ごろう works to 17:00 in a store that closes at 19:00.
    const goro = p.lanes.find((l) => l.key === 'p-05')!
    expect(goro.items.some((i) => i.title === '終業')).toBe(true)
    // テスト さぶろう starts at 11:00 in a store that opens at 10:00.
    const saburo = p.lanes.find((l) => l.key === 'c-03')!
    expect(saburo.items.some((i) => i.title === '勤務前')).toBe(true)
    // The absent lane's tail is the 勤務不可 wash, never both.
    const absent = p.lanes.find((l) => l.key === absence.staff_id)!
    expect(absent.items.filter((i) => i.title === '終業')).toHaveLength(0)
    expect(absent.items.filter((i) => i.kind === 'absence')).toHaveLength(1)
  })

  // canon renderShiftEndBounds (fable-store-today.html :3941): the off-shift
  // hours are the SAME red `.event.absence` hatch as 勤務不可, never the beige
  // 予定ブロック wash — "there is no shop floor here" is one statement on this
  // board, and `kind` is what carries it to the paint and to the click.
  it('the off-shift hatches are the 勤務不可 red family, not a 予定ブロック card', async () => {
    const p = await board(STORE_A)
    const goro = p.lanes.find((l) => l.key === 'p-05')!
    expect(goro.items.find((i) => i.title === '終業')).toMatchObject({
      kind: 'absence',
      time: '17:00〜閉店',
      label: '見本 ごろう、17:00以降、終業のため予約不可',
    })
    const saburo = p.lanes.find((l) => l.key === 'c-03')!
    expect(saburo.items.find((i) => i.title === '勤務前')).toMatchObject({
      kind: 'absence',
      time: '開店〜11:00',
      label: 'テスト さぶろう、11:00開始のため、それより前は予約不可',
    })
    // 予定ブロック stays its own kind: the fix must not repaint real blocks red.
    expect(saburo.items.filter((i) => i.kind === 'block').map((i) => i.title)).toEqual(['指名予約'])
  })

  it('a lane sub-label carries the qualifications and the shift end', async () => {
    const p = await board(STORE_A)
    const lane = p.lanes.find((l) => l.key === 'p-04')!
    expect(lane.sub).toBe(`${staffQualifications['p-04'].join('・')} / 18:00まで`)
  })

  // ── the day nav and the calendar ────────────────────────────────────────
  it('moving a day changes the board and drops the now-line', async () => {
    const t = await board(STORE_A)
    const tomorrow = await board(STORE_A, '1')
    expect(tomorrow.dayOffset).toBe(1)
    expect(tomorrow.isToday).toBe(false)
    expect(tomorrow.nowFraction).toBeNull()
    expect(tomorrow.dayLabel).not.toBe(t.dayLabel)
    // Tomorrow's board is a different day of bookings, and still a real board.
    expect(tomorrow.lanes.length).toBe(t.lanes.length)
  })

  it('an out-of-range or unparseable ?day= is clamped, never an error', async () => {
    expect((await board(STORE_A, '9999')).dayOffset).toBe(45)
    expect((await board(STORE_A, 'tomorrow')).dayOffset).toBe(0)
  })

  it('the calendar covers a month either way and carries a free-slot count per day', async () => {
    const p = await board(STORE_A)
    expect(p.calendar.length).toBe(91)
    expect(p.calendar.some((c) => c.offset === 0)).toBe(true)
    for (const c of p.calendar) {
      expect(c.free).toBeGreaterThanOrEqual(0)
      expect(c.wd).toBeGreaterThanOrEqual(0)
      expect(c.wd).toBeLessThanOrEqual(6)
    }
    // The busiest day has fewer free slots than an empty one — the number moves.
    const empty = p.calendar.find((c) => c.booked === 0)!
    const busy = p.calendar.find((c) => c.offset === 0)!
    expect(busy.free).toBeLessThan(empty.free)
  })

  // ── the L-6 promise ─────────────────────────────────────────────────────
  it.each([30, 400])('the board is still a full day %i days from now', async (days) => {
    jest.setSystemTime(new Date(Date.now() + days * 86_400_000))
    const p = await board(STORE_A)
    const cards = p.lanes.flatMap((l) => l.items).filter((i) => i.kind === 'booking')
    expect(cards.length).toBeGreaterThanOrEqual(6)
    expect(p.cards.filter((c) => c.state === 'open').length).toBeGreaterThan(0)
    expect(p.incident).not.toBeNull()
    expect(p.hold).not.toBeNull()
    expect(p.kpi.utilization).not.toBe('0%')
    jest.setSystemTime(new Date('2026-08-19T00:00:00Z'))
  })
})
