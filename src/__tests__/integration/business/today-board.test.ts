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
 * break outside its shift, two bookings on one bed, a card painted inside an
 * absence — every one of those would have the demo teaching Liam something
 * untrue about how the business runs. (⚖ flag 77 retired one of the originals:
 * "a bed turning over with no cleaning time" was on this list until Liam ruled
 * the turnover feature default-OFF. A store that reserves no cleaning time is
 * now the honest default, not an impossible state — see the flag 77 block at
 * the foot of this file for what took its place.)
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { jstDayKey, jstMinuteOfDay } from '@/business/lib/clock'
import { appointments, operator, reserveSync, STORE_A, STORE_B } from '@/business/lib/fixtures'
import {
  absence,
  bedSecuredProof,
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
import { allocateBed, applyMoves, sellLayerFor } from '@/app/[locale]/(business)/business/today/today-interactions'
import { money } from '@/business/lib/canon-logic/pricing'
import {
  availableMinutes,
  bookingCategory,
  buildLanes,
  dayBookings,
  cleanupBlocks,
  effectiveShift,
  freeSlots,
  openDecisions,
  minuteOf,
  place,
  suppressedByAbsence,
  utilization,
  type BoardLane,
  type BuildInput,
} from '@/business/lib/today-board'
import * as data from '@/business/lib/data'
import TodayPage, { bookingProofs } from '@/app/[locale]/(business)/business/today/page'
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

/** The MERGED board's lanes. Since ⚖ Liam 2026-08-20 すべての店舗 left the
 *  sidebar switcher and every screen opens on the operator's own store, no URL
 *  reaches the cross-store view any more — so it is assembled here exactly as
 *  the page assembles it, one field for one field, with the lens the page can
 *  no longer be given. The depth itself is kept, not deleted: reconnect
 *  restores the lens for a viewAll-capable actor, and until then this is what
 *  proves the cross-store labelling still holds. */
async function mergedLanes() {
  const lens = { viewAll: true } as const
  const [customers, appts, menus, staff, resources, planes, shell, storeOptions, staffStores] =
    await Promise.all([
      data.listCustomers(lens),
      data.listAppointments(lens),
      data.listMenus(lens),
      data.listStaff(lens),
      data.listResources(lens),
      data.readDayPlanes(lens, jstDayKey(new Date())),
      data.readShellIdentity(),
      data.listStoreOptions(),
      data.readStaffStores(lens),
    ])
  const input: BuildInput = {
    appointments: appts,
    customers,
    menus,
    staff,
    resources,
    shifts: planes.shifts,
    qualifications: planes.staffQualifications,
    staffListPrice: planes.staffListPrice,
    staffStores,
    absence: planes.absence,
    blocks: planes.blocks,
    sellSlots: planes.sellSlots,
    decisions: planes.decisions,
    hours: planes.operatingHours,
    dayKey: jstDayKey(new Date()),
    operatorStaffId: shell.operator.staff_id,
    storeNames: new Map(storeOptions.map((s) => [s.id, s.name])),
    crossStore: true,
  }
  return buildLanes(input, dayBookings(input))
}

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

  // ⚖ Liam flag 51 (2026-08-21) — the bed auto-allocator reads the ROOM CLASS
  // off the lane, so the lane has to carry what the store's resource row says.
  // A 個室 that reaches the board as an ordinary 施術室 makes every allocation
  // rule right about the wrong building.
  it('every bed lane carries its store row’s room class, and no staff lane has one', async () => {
    const lanes = await mergedLanes()
    const beds = lanes.filter((l) => l.group === 'beds')
    expect(beds.length).toBe(resources.length)
    for (const l of beds) {
      expect(l.roomClass).toBe(resources.find((r) => r.id === l.key)?.room_class)
    }
    expect(beds.filter((l) => l.roomClass === 'private').map((l) => l.key)).toEqual(['bed-03'])
    expect(lanes.filter((l) => l.group === 'staff').every((l) => l.roomClass === null)).toBe(true)
  })

  // ⚖ flag 77 — this store reserves NO turnover time, so the scene that proves
  // the mechanic has to come from a store that opted in. `OPTED_IN` is that
  // store: the same day, the same rooms, one dial turned up. Every 清掃 assertion
  // in this suite runs against it, so the mechanic stays covered by exercise
  // rather than by a fixture the product no longer has (packet §4).
  const OPTED_IN = resources.map((r) => ({ ...r, cleanup_minutes: 30 }))

  it('the derived 清掃 block never overlaps the next booking on the same bed', () => {
    let minted = 0
    for (const r of OPTED_IN) {
      const on = today()
        .filter((a) => a.resource_id === r.id && a.status !== 'cancelled')
        .map((a) => ({ id: a.id, start: minutesOf(a.starts_at), end: minutesOf(a.ends_at) }))
      const cleans = cleanupBlocks(on, r.cleanup_minutes, operatingHours)
      minted += cleans.length
      for (const c of cleans) {
        expect(c.end).toBeGreaterThan(c.start)
        expect(c.end).toBeLessThanOrEqual(operatingHours.close)
        for (const b of on) {
          expect(c.start >= b.end || c.end <= b.start).toBe(true)
        }
      }
    }
    // …and the scene is a real one: a dial at 0 would make every loop above
    // vacuous, which is exactly the hollow test this round had to avoid.
    expect(minted).toBeGreaterThan(0)
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

  it('every terminal-held transaction names a booking that is genuinely unsettled', () => {
    expect(register.terminal_held.length).toBeGreaterThan(0)
    for (const t of register.terminal_held) {
      const held = today().find((a) => a.id === t.appointment_id)!
      expect(held.settlement).toBe('awaiting')
      expect(held.booked_price).toBe(t.amount)
    }
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

  it('F — staff lanes and bed lanes both render, with cards, breaks and blocks', async () => {
    const p = await board(STORE_A)
    const staffLanes = p.lanes.filter((l) => l.group === 'staff')
    const bedLanes = p.lanes.filter((l) => l.group === 'beds')
    expect(staffLanes.length).toBeGreaterThanOrEqual(4)
    expect(bedLanes.length).toBeGreaterThanOrEqual(2)
    const kinds = new Set(p.lanes.flatMap((l) => l.items.map((i) => i.kind)))
    // ⚖ flag 77 — no 'cleanup': the store's dial is off, so the turnover the
    // board used to paint is not a thing the day has (C1 pins the emptiness).
    expect([...kinds].sort()).toEqual(['absence', 'block', 'booking', 'break'])
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

  // 公開中, the 運営影響 stat and the shelf's own header used to be three server
  // numbers that had to be kept equal by hand. They are now ONE derivation the
  // browser runs (canon-logic/availability), so the equality is structural and
  // the thing worth asserting is that the derivation answers to the board it
  // reads — including a lane the operator has locked.
  // ⚖ R8 T4 — the stat used to carry a SECOND name for that count (安全な空き);
  // it now prints the chip's own words, so this title names the surface rather
  // than a label that no longer exists.
  it('RECONCILES: 公開中 = the 運営影響 stat = the shelf, because all three read one derivation', async () => {
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
    const beds = (await mergedLanes()).filter((l) => l.group === 'beds')
    expect(beds.length).toBe(resources.length)
    // Two stores each own a 「ベッド1」; under viewAll the store name on the
    // sub-label is what keeps them apart, so no two rows read identically.
    expect(beds.filter((l) => l.label === 'ベッド1')).toHaveLength(2)
    expect(new Set(beds.map((l) => `${l.label} ${l.sub}`)).size).toBe(beds.length)
    expect(beds.every((l) => l.sub.includes('テスト'))).toBe(true)
  })

  it('a staff member with no shift today gets a lane that says so, rather than vanishing', async () => {
    // p-09 holds no store card, so only the merged board can carry her lane.
    const idle = (await mergedLanes()).find((l) => l.key === 'p-09')!
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

  it("a day being VIEWED carries none of today's operational state", async () => {
    // The board planes split two ways (data.ts readDayPlanes): shifts, hours
    // and blocks are the store's standing arrangement and belong to every open
    // day, but the decision queue, the 勤務不可 incident and the register
    // aggregates are TODAY's snapshot. Repeating them on ?day=1 showed today's
    // ¥1,100 refund as tomorrow's −¥1,100 純売上, and today's decisions and
    // absence band over tomorrow's bookings.
    const t = await board(STORE_A)
    const tomorrow = await board(STORE_A, '1')

    // Today still has all of it — the guard cannot pass by emptying the board.
    expect(t.ops.unresolved).toBeGreaterThan(0)
    expect(t.cards.length).toBeGreaterThan(0)
    expect(t.incident).not.toBeNull()

    expect(tomorrow.ops.unresolved).toBe(0)
    expect(tomorrow.ops.undelivered).toBe(0)
    expect(tomorrow.cards).toEqual([])
    expect(tomorrow.incident).toBeNull()
    // …and no refund is subtracted from a day that never took one. Tomorrow
    // settles nothing, so its 純売上 is ¥0 rather than the refund's negative.
    expect(register.refunds).toBeGreaterThan(0)
    expect(tomorrow.kpi.revenue).toBe('¥0')
    // 決済端末: today's held transaction is today's closing blocker. On a
    // viewed day the terminal holds nothing, so the checklist says so, the
    // 閉店阻害 list has no row for it, and the 照合 dialog those rows open has
    // nothing to show — no null arm anywhere, just an empty list.
    const terminalCheck = (p: TodayProps) => p.dialogs.closing.checks.find(([k]) => k === '決済端末')!
    expect(terminalCheck(t)[1]).toContain('端末保持 1件')
    expect(terminalCheck(t)[2]).toBe(true)
    expect(t.dialogs.blockers.map(([k]) => k)).toContain('決済端末')
    expect(t.dialogs.terminal.rows).toHaveLength(5)

    expect(terminalCheck(tomorrow)).toEqual(['決済端末', '端末保持 0件', false])
    expect(tomorrow.dialogs.blockers.map(([k]) => k)).not.toContain('決済端末')
    expect(tomorrow.dialogs.terminal.rows).toEqual([])

    // NOW belongs to today only. `boardNow` is the pinned board moment, so a
    // day being viewed must not wear 13:24 as its own current time anywhere:
    // the 閉店準備 stamp is dropped (the dialog is titled with its own date),
    // the now-line and the 販売可能枠 grid were already null, and 次のお客様
    // stops filtering a day against an hour that has not happened on it.
    expect(t.dialogs.closing.sub).toContain(`${t.nowLabel}現在`)
    expect(t.myDay!.next).toContain('様')
    expect(tomorrow.dialogs.closing.sub).not.toContain(tomorrow.nowLabel)
    expect(tomorrow.dialogs.closing.sub).not.toContain('現在')
    expect(tomorrow.dialogs.closing.title).not.toBe(t.dialogs.closing.title)
    expect(tomorrow.nowFraction).toBeNull()
    expect(tomorrow.sell.nowMinute).toBeNull()
    expect(tomorrow.myDay!.next).toBe('予約はありません')

    // The day itself is still a real board: the standing planes came through.
    expect(tomorrow.lanes.length).toBe(t.lanes.length)
    expect(tomorrow.hours).toEqual(t.hours)
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

// ═══════════════════════════════════════════════════════════════════════════
// ⚖ Liam flag 77 (2026-08-24) — 清掃 IS A DIAL, AND THIS STORE HAS IT OFF
//
// "I never asked for it. It's in the way… Have it turned off by default."
// The turnover feature is default-OFF and the demo store's opt-in is overturned,
// so the board carries no 清掃 anywhere and no copy claims cleaning time is
// being held. The MECHANIC is not deleted — a store that cleans opts in — so
// every pin below runs the bare store against `OPTED_IN`, the same day with the
// dial turned up, and the pair is what proves each half.
// ═══════════════════════════════════════════════════════════════════════════

describe('⚖ flag 77 — the store reserves no turnover time', () => {
  /** The same fixture day on a store that DID opt in — the control every pin
   *  below is read against, built through `buildLanes` exactly as the page does
   *  so the mechanic is exercised end to end rather than unit-poked. */
  const OPTED_IN = 30

  async function lanesAt(cleanupMinutes: number): Promise<BoardLane[]> {
    const lens = STORE_A
    const [custs, appts, menus, staff, beds, planes, shell, storeOptions, staffStores] = await Promise.all([
      data.listCustomers(lens), data.listAppointments(lens), data.listMenus(lens), data.listStaff(lens),
      data.listResources(lens), data.readDayPlanes(lens, jstDayKey(new Date())), data.readShellIdentity(),
      data.listStoreOptions(), data.readStaffStores(lens),
    ])
    const input: BuildInput = {
      appointments: appts, customers: custs, menus, staff,
      resources: beds.map((r) => ({ ...r, cleanup_minutes: cleanupMinutes })),
      shifts: planes.shifts, qualifications: planes.staffQualifications,
      staffListPrice: planes.staffListPrice, staffStores, absence: planes.absence,
      blocks: planes.blocks, sellSlots: planes.sellSlots, decisions: planes.decisions,
      hours: planes.operatingHours, dayKey: jstDayKey(new Date()),
      operatorStaffId: shell.operator.staff_id,
      storeNames: new Map(storeOptions.map((s) => [s.id, s.name])),
      crossStore: false,
    }
    return buildLanes(input, dayBookings(input))
  }

  // ── C1 — nothing 清掃-shaped reaches a lane ───────────────────────────────

  it('C1 — a dial at or below zero mints no block at all, which is why the data fix is the whole fix', () => {
    // today-board :102-103 — `end = min(bookingEnd + minutes, ceiling)`, pushed
    // only `if (end > bookingEnd)`. At 0 the sum IS the booking's end, so the
    // guard is false for every booking and the array comes back empty. This is
    // the REQUIRED SEMANTIC the packet named, asserted rather than reasoned
    // about, because `cleanupBlocks` lives in a file this round may not edit and
    // another lane has open — if that guard ever moves, this goes red first.
    const day = [{ id: 'a', start: 600, end: 660 }, { id: 'b', start: 700, end: 760 }]
    expect(cleanupBlocks(day, 0, operatingHours)).toEqual([])
    expect(cleanupBlocks(day, -30, operatingHours)).toEqual([])
    expect(cleanupBlocks(day, 30, operatingHours).length).toBe(2)
  })

  it('C1 — the served board mints no 清掃: no item, no `-cleanup` key, no label', async () => {
    for (const store of [STORE_A, STORE_B]) {
      const p = await board(store)
      const items = p.lanes.flatMap((l) => l.items)
      // The board is not empty — an empty board would pass every line below.
      expect(items.filter((i) => i.kind === 'booking').length).toBeGreaterThan(0)
      expect(items.filter((i) => i.kind === 'cleanup')).toEqual([])
      expect(items.filter((i) => i.key.endsWith('-cleanup'))).toEqual([])
      for (const i of items) {
        expect(i.title).not.toContain('清掃')
        expect(i.label).not.toContain('清掃')
      }
    }
  })

  it('C1 — and the CLIENT board re-derives none either: a dragged card grows no tail', async () => {
    const p = await board(STORE_A)
    const hours = { open: p.hours.open, close: p.hours.close }
    // `withTrailingCleanup` is the client's own re-derivation and it runs on
    // EVERY board, not only a dragged one — so a resting board and a staged move
    // both have to come back bare. It keys off the server's own `-cleanup` rows,
    // which is exactly why the data fix reaches it: there are none to key off.
    const held = p.lanes.flatMap((l) => l.items).find((i) => i.kind === 'booking' && i.caseId)!
    const lane = p.lanes.find((l) => l.items.includes(held))!
    const staged = applyMoves(
      p.lanes,
      { [held.caseId!]: { laneKey: lane.key, x: held.x + 5, w: held.w } },
      [], [], hours,
    )
    for (const board of [applyMoves(p.lanes, {}, [], [], hours), staged]) {
      const items = board.flatMap((l) => l.items)
      expect(items.filter((i) => i.kind === 'cleanup')).toEqual([])
      for (const i of items) expect(i.label).not.toContain('清掃')
    }
  })

  // ── C2 — the freed tail is sellable ───────────────────────────────────────

  it('C2 — the half hour the tail used to hold is offered to the wall', async () => {
    // ONE concrete scene: apt-12 runs 10:00–11:00 on ベッド1. Its turnaround used
    // to stand 11:00–11:30, so the earliest thing the 販売可能枠 layer could
    // offer on that bed began at 11:30. With the dial off the room is free at
    // 11:00 and the layer says so — the space came back as product, which is the
    // whole point of turning the feature off rather than just hiding the paint.
    const layerOn = (lanes: BoardLane[]) =>
      sellLayerFor(lanes, operatingHours, {
        gridMin: 30, nowMinute: null, locked: [], showPrice: true, hi: 9000, hqMin: 5000, depth: 9,
      })
    const bedOf = (lanes: BoardLane[]) => lanes.find((l) => l.key === 'bed-01')!
    const covers = (lanes: BoardLane[], at: number) =>
      bedOf(lanes).items.some((i) => i.startMin <= at && i.endMin > at)
    const offerAt = (lanes: BoardLane[], at: number) =>
      layerOn(lanes).bands.some((b) => b.group === 'beds' && b.resourceKey === 'bed-01' && b.hStart <= at && b.hEnd > at)

    const bare = await lanesAt(0)
    const cleaning = await lanesAt(OPTED_IN)
    // The control: with the dial up, 11:00 on ベッド1 is held and unsellable.
    expect(covers(cleaning, 11 * 60)).toBe(true)
    expect(offerAt(cleaning, 11 * 60)).toBe(false)
    // Shipped: nothing stands there and the layer offers it.
    expect(covers(bare, 11 * 60)).toBe(false)
    expect(offerAt(bare, 11 * 60)).toBe(true)
    // The booking itself is untouched — the room is free BECAUSE the tail is
    // gone, not because the session moved or vanished.
    expect(bedOf(bare).items.some((i) => i.kind === 'booking' && i.endMin === 11 * 60)).toBe(true)
  })

  // ── C3 — the sentence reads the dial ──────────────────────────────────────

  it('C3 — a confirmed booking says it holds the bed, and says 清掃N分 only when N exists', async () => {
    const p = await board(STORE_A)
    const withBed = Object.values(p.cases).filter((c) =>
      c.proofs.some((row) => row.includes('を確保') || row.includes('確保')),
    )
    expect(withBed.length).toBeGreaterThan(0)
    for (const c of withBed) {
      for (const row of c.proofs) expect(row).not.toContain('清掃')
    }
    // The 仮押さえ bar reads the same rows, so it cannot say something else.
    expect(p.hold!.checks.some((row) => row.includes('を確保'))).toBe(true)
    for (const row of p.hold!.checks) expect(row).not.toContain('清掃')
    // And the sentence is a FORMULA, not a stripped string: a store that cleans
    // gets its own minutes back — 30 here, 45 for a store that says 45.
    expect(bedSecuredProof(resources, 'bed-01')).toBe('ベッド1を確保')
    const opted = resources.map((r) => ({ ...r, cleanup_minutes: r.id === 'bed-01' ? 45 : 30 }))
    expect(bedSecuredProof(opted, 'bed-01')).toBe('ベッド1と清掃45分を確保')
    expect(bedSecuredProof(opted, 'bed-02')).toBe('ベッド2と清掃30分を確保')
    // …and the ベッド・設備 group's own note tells the truth about the same dial.
    expect(p.bedCleanupOn).toBe(false)
  })

  it('C3 — the ベッド・設備 group note reads the dial rather than asserting 清掃', () => {
    const screen = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
      'utf8',
    )
    // The one piece of copy that describes the CONVENTION rather than a block on
    // the board. Gated on the dial, so a store that cleans keeps its sentence
    // and a store that does not never promises 予約不可時間 it is not holding.
    expect(screen).toContain(
      "props.bedCleanupOn ? '清掃を予約不可時間として表示' : '予約と予定ブロックを表示'",
    )
  })

  // ── C4 — the mechanic still works for a store that opts in ────────────────

  it('C4 — an opted-in store still mints tails, and a booking never blocks itself with its own', async () => {
    const cleaning = await lanesAt(OPTED_IN)
    const tails = cleaning.flatMap((l) => l.items).filter((i) => i.kind === 'cleanup')
    expect(tails.length).toBeGreaterThan(0)
    for (const t of tails) {
      expect(t.key.endsWith('-cleanup')).toBe(true)
      expect(t.title).toBe('清掃')
      expect(t.label).toContain('清掃・予約不可')
    }
    // allocateBed's own-tail exclusion: apt-12 owns ベッド1 10:00–11:00 and its
    // turnaround stands 11:00–11:30. Nudged 30 minutes later it lands ON its own
    // tail, and the allocator must still hand it the room it is already in.
    const stores = [STORE_A]
    expect(
      allocateBed(cleaning, {
        id: 'apt-12', currentBed: 'bed-01', stores, requiresPrivate: false,
        start: 10 * 60 + 30, end: 11 * 60 + 30,
      }),
    ).toEqual({ laneKey: 'bed-01', refusal: null, blockers: [] })
    // …and someone ELSE'S tail is a genuine wall: the same span, without the
    // exclusion, is refused the room.
    expect(
      allocateBed(cleaning, {
        id: null, currentBed: 'bed-01', stores, requiresPrivate: false,
        start: 10 * 60 + 30, end: 11 * 60 + 30,
      }).laneKey,
    ).not.toBe('bed-01')
  })

  // ── C5 — no surface hardcodes the number ──────────────────────────────────

  it('C5 — no 今日の運営 surface writes 清掃30分 (or any fixed 清掃N分) into a string', () => {
    const SURFACES = [
      'src/app/[locale]/(business)/business/today/page.tsx',
      'src/app/[locale]/(business)/business/today/TodayScreen.tsx',
      'src/app/[locale]/(business)/business/today/today-interactions.ts',
      'src/business/lib/fixtures-today.ts',
      'src/business/lib/today-board.ts',
    ]
    for (const file of SURFACES) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      // The ONE legal spelling is the interpolation inside `bedSecuredProof`,
      // which reads the store's own number. A literal digit run between 清掃 and
      // 分 is the dead lever this round removed.
      expect({ file, hits: src.match(/清掃\s*\d+\s*分/g) ?? [] }).toEqual({ file, hits: [] })
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⚖ R8 T1 — 予約時価格を保持 IS A CLAIM ABOUT A PRICE THAT EXISTS
//
// apt-09 carries `booked_price: null` by documented fixture intent — a real,
// partially-filled booking the board has to be honest about. Its 予約時価格 fact
// already reads 記録なし; the 根拠 list underneath used to assert that the same
// missing number was being held.
// ═══════════════════════════════════════════════════════════════════════════

describe('⚖ R8 T1 — the 価格保持 根拠 follows the booking’s own price', () => {
  const PROOF = '予約時価格を保持'

  it('the scene is real: this store’s day holds a priced booking AND a price-less one', () => {
    const mine = today().filter((a) => a.store_id === STORE_A && a.status !== 'cancelled')
    expect(mine.some((a) => a.booked_price == null)).toBe(true)
    expect(mine.some((a) => a.booked_price != null)).toBe(true)
  })

  it('pricedIds is the server’s own record — every booking with a price, and no other', async () => {
    const p = await board(STORE_A)
    const priced = today().filter((a) => a.store_id === STORE_A && a.booked_price != null).map((a) => a.id)
    // Read off the fixture, not written down here: a fixture edit moves both
    // sides of this together or it goes red.
    expect([...p.pricedIds].sort()).toEqual([...new Set(priced)].sort())
    const priceless = today().find((a) => a.store_id === STORE_A && a.booked_price == null)!
    expect(p.pricedIds).not.toContain(priceless.id)
  })

  it('a case claims 価格保持 exactly when its booking has a price — walked over the whole day', async () => {
    const p = await board(STORE_A)
    const bookings = today().filter((a) => a.store_id === STORE_A && a.board_state !== null)
    expect(bookings.length).toBeGreaterThan(1)
    for (const a of bookings) {
      const c = p.cases[a.id]
      expect({ id: a.id, has: c != null }).toEqual({ id: a.id, has: true })
      expect({ id: a.id, claims: c.proofs.includes(PROOF) }).toEqual({ id: a.id, claims: a.booked_price != null })
      // …and the FACT line and the 根拠 line agree, which is the whole point:
      // no case says 記録なし above and 保持 below.
      const fact = c.facts.find(([k]) => k === '予約時価格' || k === '請求額')!
      expect({ id: a.id, silent: fact[1] === '記録なし' }).toEqual({ id: a.id, silent: !c.proofs.includes(PROOF) })
    }
  })

  /** ⚖ FIX ROUND 3 (BREAKER-828 F2) — BOTH ARMS OF THE CONDITION, WALKED.
   *
   *  The rule used to be spelled once per arm of `b.resourceId ? … : …`, and the
   *  board's only price-less booking (apt-09) has NO resource — so the
   *  with-resource arm was never walked with a price-less booking, and making it
   *  append the 保持 line unconditionally shipped green through all 1912 tests
   *  (M06). A booking with a bed and no recorded price would have claimed its
   *  price was held: the exact defect T1 exists to remove. One author now, and
   *  this is its whole table. */
  it('bookingProofs writes the same price rule down both arms — four combinations, exact lists', () => {
    // ⚖ BREAKER-828 DELTA G5 — EVERY ROW FEEDS A DIFFERENT SENTENCE. This table
    // used to hand `'ベッド1を確保'` in on every row and assert that same
    // literal back, so the pass-through was self-fulfilling: a helper that
    // IGNORED its first argument and printed bed 1's name for every bed shipped
    // green at 1920 + 1 with `tsc` exit 0, and apt-22 (bed-02), apt-25 and
    // apt-28 (bed-03) would each have read 「ベッド1を確保」 on their 根拠 list.
    // (PRE-EXISTING, said plainly: the same hardcode was equally invisible when
    // the sentence came from an inline call at the page's own call site.)
    expect(bookingProofs('A', true)).toEqual(['担当の勤務時間内', '休憩と重ならない', 'A', PROOF])
    expect(bookingProofs('B', false)).toEqual(['担当の勤務時間内', '休憩と重ならない', 'B'])
    expect(bookingProofs(null, true)).toEqual(['担当の勤務時間内', '設備の割当てが未確定', PROOF])
    expect(bookingProofs(null, false)).toEqual(['担当の勤務時間内', '設備の割当てが未確定'])
    // The sentence in the list IS the argument, reproduced — never a constant
    // that happens to match the fixture's first bed.
    expect(bookingProofs('X', true)[2]).toBe('X')
    for (const proof of ['ベッド2を確保', 'ベッド3を確保', '設備の名前']) {
      expect({ proof, row: bookingProofs(proof, false)[2] }).toEqual({ proof, row: proof })
    }
    // The bed's own sentence is used exactly as handed over — the helper writes
    // the rule, `bedSecuredProof` writes the room — and it lands in ITS slot.
    expect(bookingProofs(bedSecuredProof(resources, 'bed-01'), false)[2]).toBe(bedSecuredProof(resources, 'bed-01'))
    // …and the price line is the ONLY thing the second argument moves.
    for (const proof of ['ベッド1を確保', null]) {
      expect(bookingProofs(proof, false)).toEqual(bookingProofs(proof, true).filter((p) => p !== PROOF))
    }
  })

  /** ⚖ BREAKER-828 DELTA G4 — A FIXTURE-CONSISTENCY PIN, AND IT SAYS SO.
   *
   *  This walk CANNOT FAIL ON A CODE CHANGE, and fix round 3's title read as if
   *  it could. A 判断 card's 根拠 is the fixture's own `d.proofs`, spread into
   *  the case VERBATIM — `page.tsx` never meets it with `b.price` — so there is
   *  no product line here to break. The breaker proved it: `[...d.proofs,
   *  PRICE_HOLD_PROOF]`, every 判断 card claiming the row unconditionally, was
   *  GREEN at 1920 + 1 with `tsc` exit 0, because every decision on this board
   *  that names an appointment names a PRICED one (dec-recovery → apt-26,
   *  dec-checkout → apt-25, dec-absence → apt-27, dec-sms → apt-28, dec-noshow
   *  → apt-23).
   *
   *  What it IS, honestly: demo data is product truth, so this catches a FIXTURE
   *  edit that hangs 予約時価格を保持 on a decision card whose booking has no
   *  price — the same sentence T1 removes, printed three lines under its own
   *  予約時価格 記録なし. `claimed > 0` keeps it from passing vacuously. The
   *  CODE direction F6 named needs a synthetic decision this fixture does not
   *  hold; it is unreachable on this board and it is not claimed here. */
  it('the FIXTURE never hangs 価格保持 on a 判断 card whose booking has no price — a fixture guard, not a code pin', async () => {
    const p = await board(STORE_A)
    let walked = 0
    let claimed = 0
    for (const d of decisions) {
      const a = d.appointment_id ? today().find((x) => x.id === d.appointment_id) : undefined
      const c = a ? p.cases[d.id] : undefined
      if (!a || !c) continue
      walked += 1
      // ONE-DIRECTIONAL, and deliberately so: a 判断 card's 根拠 is the
      // fixture's own list about the DECISION, so a priced booking's card is
      // free to say nothing about the price (`dec-checkout` does exactly that).
      // What it may never do is CLAIM the row over a booking that has no price —
      // that is the sentence T1 removes, printed three lines under its own
      // 予約時価格 記録なし.
      if (!c.proofs.includes(PROOF)) continue
      claimed += 1
      expect({ id: d.id, over: a.id, priced: a.booked_price != null }).toEqual({ id: d.id, over: a.id, priced: true })
    }
    expect(walked).toBeGreaterThan(0)
    // …and the walk reaches a card that DOES carry the row, so it is measuring
    // something: `dec-recovery` over apt-26 (¥6,600).
    expect(claimed).toBeGreaterThan(0)
  })

  it('the two named cases, by name: apt-09 drops the row, apt-26 keeps it', async () => {
    const p = await board(STORE_A)
    expect(today().find((a) => a.id === 'apt-09')!.booked_price).toBeNull()
    expect(today().find((a) => a.id === 'apt-26')!.booked_price).not.toBeNull()
    expect(p.cases['apt-09'].proofs).not.toContain(PROOF)
    expect(p.cases['apt-26'].proofs).toContain(PROOF)
    // Only THAT row moved — the rest of the price-less case's 根拠 is canon's.
    expect(p.cases['apt-09'].proofs).toContain('担当の勤務時間内')
    // …and the 判断 card that points at apt-26 keeps the 根拠 the fixture wrote
    // for it, because apt-26 is priced.
    const dec = decisions.find((d) => d.appointment_id === 'apt-26')
    if (dec) expect(p.cases[dec.id].proofs).toContain(PROOF)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⚖ R8 T2 — ONE STORE'S BOARD NEVER SHOWS ANOTHER STORE'S TERMINAL HOLD
//
// `register.terminal_held` rows carry no `store_id`, so the door's `inLens`
// could not see them and the day clamp alone let 銀座's ¥6,600 stand on 代官山's
// board. Each row names a BOOKING, and the booking says whose terminal it is —
// the same reading `register.ts`'s `heldForLens` makes for the レジ room, whose
// JSDoc named this board as the unclamped second seam.
// ═══════════════════════════════════════════════════════════════════════════

describe('⚖ R8 T2 — the terminal hold is clamped at the door', () => {
  const todayKey = () => jstDayKey(new Date())

  it('the scene is real: the one held row names a booking that belongs to ONE store', () => {
    expect(register.terminal_held.length).toBe(1)
    const named = today().find((a) => a.id === register.terminal_held[0].appointment_id)!
    expect(named.store_id).toBe(STORE_A)
    // A second store exists and does NOT own it — otherwise the pins below
    // would pass on an empty world.
    expect(today().some((a) => a.store_id === STORE_B)).toBe(true)
  })

  it('the door answers per lens: the owning store sees it, the other store does not', async () => {
    const held = async (lens: data.StoreLens, day = todayKey()) =>
      (await data.readDayPlanes(lens, day)).register.terminal_held
    expect((await held(STORE_A)).map((h) => h.appointment_id)).toEqual(['apt-25'])
    expect(await held(STORE_B)).toEqual([])
    // viewAll is every store, so it holds everything the fixture holds.
    expect((await held({ viewAll: true })).map((h) => h.appointment_id)).toEqual(
      register.terminal_held.map((h) => h.appointment_id),
    )
    // The DAY clamp is unchanged and still outranks the store one: a day being
    // viewed holds nothing, under every lens.
    for (const lens of [STORE_A, STORE_B, { viewAll: true } as const]) {
      expect(await held(lens, todayKey() + 1)).toEqual([])
    }
    // …and the two money aggregates beside it are NOT store-clamped (no store
    // dimension exists on them) — this pins that the change stopped where it
    // was meant to.
    for (const lens of [STORE_A, STORE_B] as const) {
      const r = (await data.readDayPlanes(lens, todayKey())).register
      expect([r.refunds, r.cash_difference]).toEqual([register.refunds, register.cash_difference])
    }
  })

  it('the board says it: 端末保持 1件 in the owning store, 0件 and no blocker in the other', async () => {
    const a = await board(STORE_A)
    const b = await board(STORE_B)
    const terminalCheck = (p: TodayProps) => p.dialogs.closing.checks.find(([k]) => k === '決済端末')!
    expect(terminalCheck(a)[1]).toContain('端末保持 1件')
    expect(terminalCheck(a)[2]).toBe(true)
    expect(a.dialogs.blockers.map(([k]) => k)).toContain('決済端末')

    expect(terminalCheck(b)).toEqual(['決済端末', '端末保持 0件', false])
    expect(b.dialogs.blockers.map(([k]) => k)).not.toContain('決済端末')
    // The 照合 dialog those rows open has nothing to show either — no row
    // naming a booking this lens cannot even read.
    expect(b.dialogs.terminal.rows).toEqual([])
    // …and the owning store's dialog shows one BLOCK of rows per held row its
    // own door returned (page.tsx builds the block with `flatMap`), counted off
    // the door rather than typed here.
    const heldA = (await data.readDayPlanes(STORE_A, todayKey())).register.terminal_held
    expect(heldA.map((h) => h.appointment_id)).toEqual(['apt-25'])
    expect(a.dialogs.terminal.rows.filter(([k]) => k === '端末取引')).toHaveLength(heldA.length)
  })

  // ⚖ FIX ROUND 1 (blind round 1, L4 F6) — THE SIBLING DOOR ANSWERS THE SAME.
  // `readReservationPlanes` handed the register out to the 予約一覧 / 受信箱 /
  // レジ rooms with the list unclamped, so the plane had one answer at one door
  // and another at the other. Same helper, same reading, both doors.
  it('the reservations door clamps the same list', async () => {
    const held = async (lens: data.StoreLens) => (await data.readReservationPlanes(lens)).register.terminal_held
    expect((await held(STORE_A)).map((h) => h.appointment_id)).toEqual(['apt-25'])
    expect(await held(STORE_B)).toEqual([])
    expect((await held({ viewAll: true })).map((h) => h.appointment_id)).toEqual(
      register.terminal_held.map((h) => h.appointment_id),
    )
  })
})
