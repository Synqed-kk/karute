/**
 * 月カレンダー — the NUMBERS the month grid is drawn from, pinned.
 *
 * The cells' FACE (paint, word, sentence) is pinned next door in
 * today-calendar-face.test.ts. This suite is the other half: the door read the
 * capacity comes from, the arithmetic that turns a day's roster into 「空き」,
 * and the one-home rule that keeps 稼働率 and the calendar count from becoming
 * two formulas that drift.
 *
 * The import fence for this folder allows react / next / node specifiers only
 * (today-screen-interactions.test.ts :1-10) — everything here is in-repo, and
 * no DOM is needed, so it runs on jest's default `node` environment.
 */
import { readFileSync } from 'node:fs'

import { jstDayKey } from '@/business/lib/clock'
import { STORE_A, STORE_B } from '@/business/lib/fixtures'
import {
  listAbsenceByDay,
  listAppointments,
  listCustomers,
  listMenus,
  listResources,
  listShiftsByDay,
  listStaff,
  listStoreOptions,
  readDayPlanes,
  readShellIdentity,
  readStaffStores,
  renderNow,
} from '@/business/lib/data'
import {
  absenceForDay,
  dayBookings,
  laneMinutes,
  rosterAvailableMinutes,
  utilization,
  type BuildInput,
} from '@/business/lib/today-board'

/** page.tsx's own read window (`WINDOW`), stated here rather than imported so a
 *  change to the page has to be a deliberate change to this pin too. */
const WINDOW = 45

/** The BuildInput page.tsx assembles for the day on screen (page.tsx :154-173),
 *  field for field, from the same door reads in the same order. */
async function pageWorld(shownOffset = 0) {
  const lens = STORE_A
  const shownKey = jstDayKey(renderNow()) + shownOffset
  const [customers, appointments, menus, staff, resources, planes, shell, storeOptions] =
    await Promise.all([
      listCustomers(lens),
      listAppointments(lens),
      listMenus(lens),
      listStaff(lens),
      listResources(lens),
      readDayPlanes(lens, shownKey),
      readShellIdentity(),
      listStoreOptions(),
    ])
  const staffStores = await readStaffStores(lens)
  const input: BuildInput = {
    appointments,
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
    dayKey: shownKey,
    operatorStaffId: shell.operator.staff_id,
    storeNames: new Map(storeOptions.map((s) => [s.id, s.name])),
    crossStore: false,
  }
  return { input, staff, planes, shownKey }
}

describe('⚖ ONE HOME — 稼働率 and the calendar count are the SAME sum', () => {
  it('rosterAvailableMinutes(day) === utilization(laneMinutes).available, on the fixture world', async () => {
    // The board's 稼働率 denominator and the month calendar's capacity ask the
    // same question about the same day. They reach it by two routes — the board
    // through per-lane sums, the calendar through the per-day roster read — and
    // the whole point of `shiftAvailableMinutes` having one home is that the two
    // routes cannot answer differently. Anything that makes them disagree (a
    // receptionist counted as capacity on one side, an absence applied on one
    // side) lands here.
    const { input, staff, planes } = await pageWorld(0)
    const board = utilization(laneMinutes(input, dayBookings(input))).available
    const calendar = rosterAvailableMinutes(staff, planes.shifts, planes.staffQualifications, planes.absence)
    expect(calendar).toBe(board)
    // …and not a vacuous 0 === 0: the fixture day has a working roster.
    expect(calendar).toBeGreaterThan(0)
  })

  it('holds on a day that is NOT today, where the absence is gone from both sides', async () => {
    const { input, staff, planes } = await pageWorld(3)
    expect(rosterAvailableMinutes(staff, planes.shifts, planes.staffQualifications, planes.absence)).toBe(
      utilization(laneMinutes(input, dayBookings(input))).available,
    )
  })
})

describe('rosterAvailableMinutes — who is capacity and who is not', () => {
  const shift = (staff_id: string) => ({ staff_id, start: 10 * 60, end: 18 * 60, breaks: [] })

  it('a member who takes no treatments is NOT idle capacity', () => {
    // 稼働率 has always read it this way (「a receptionist is not idle capacity」);
    // the calendar reads the same judgement from the same helper. Dropping the
    // check here would quietly hand the month a reception desk's worth of 空き.
    const staff = [{ id: 'p-01' }, { id: 'p-09' }]
    const quals = { 'p-01': ['整体'], 'p-09': ['受付', '会計'] }
    const both = rosterAvailableMinutes(staff, [shift('p-01'), shift('p-09')], quals, null)
    const treatingOnly = rosterAvailableMinutes([{ id: 'p-01' }], [shift('p-01')], quals, null)
    expect(both).toBe(treatingOnly)
    expect(both).toBe(8 * 60)
    // The receptionist's own shift is 8 hours — so the two sums above are only
    // equal because she was excluded, not because she had nothing to give.
    expect(rosterAvailableMinutes([{ id: 'p-09' }], [shift('p-09')], quals, null)).toBe(0)
  })

  it('a roster member with no shift row contributes nothing, and breaks come off', () => {
    const staff = [{ id: 'p-01' }, { id: 'p-04' }]
    const quals = { 'p-01': ['整体'], 'p-04': ['整体'] }
    const withBreak = [{ staff_id: 'p-01', start: 10 * 60, end: 18 * 60, breaks: [{ start: 12 * 60, end: 13 * 60 }] }]
    expect(rosterAvailableMinutes(staff, withBreak, quals, null)).toBe(7 * 60)
  })
})

describe('listShiftsByDay — the door answers for EVERY day in the range', () => {
  it('serves the whole window, with the real roster, and nothing outside it', async () => {
    // The page asks once for [today-45, today+45] and reads one answer per day.
    // A door that answered for only the first day would leave 90 of the 91 cells
    // with no roster at all — and page.tsx drops those days from the grid, so a
    // whole month would go 表示範囲外 without one error being raised.
    const todayKey = jstDayKey(renderNow())
    const range = { from: todayKey - WINDOW, to: todayKey + WINDOW }
    const [byDay, planes] = await Promise.all([
      listShiftsByDay(STORE_A, range),
      readDayPlanes(STORE_A, todayKey),
    ])
    expect(byDay.size).toBe(WINDOW * 2 + 1)
    const keys = [...byDay.keys()].sort((a, b) => a - b)
    expect(keys[0]).toBe(range.from)
    expect(keys[keys.length - 1]).toBe(range.to)
    expect(planes.shifts.length).toBeGreaterThan(0)
    for (let key = range.from; key <= range.to; key += 1) {
      expect(byDay.get(key)).toEqual(planes.shifts)
    }
    // Inclusive on both ends and NOT one day wider.
    expect(byDay.has(range.from - 1)).toBe(false)
    expect(byDay.has(range.to + 1)).toBe(false)
  })

  it('a one-day range is one day — the loop is a range, not a whole-window sweep', async () => {
    const todayKey = jstDayKey(renderNow())
    const byDay = await listShiftsByDay(STORE_A, { from: todayKey, to: todayKey })
    expect([...byDay.keys()]).toEqual([todayKey])
  })
})

describe('⚖ V5 — 勤務不可 shortens its OWN day, on EVERY shown day', () => {
  /** The absence each of the 91 cells is built with, for a given shown day —
   *  the door's answer and the page's lookup together, because the rule only
   *  holds if BOTH halves hold. */
  const absencesAcrossTheMonth = async (shownOffset: number) => {
    const todayKey = jstDayKey(renderNow())
    // BOTH reads the page holds for a shown day: the board's own planes, which
    // legitimately depend on it, and the calendar's absence door, which asks for
    // the WINDOW and so cannot.
    const [planes, byDay] = await Promise.all([
      readDayPlanes(STORE_A, todayKey + shownOffset),
      listAbsenceByDay(STORE_A, { from: todayKey - WINDOW, to: todayKey + WINDOW }),
    ])
    const cells = Array.from({ length: WINDOW * 2 + 1 }, (_, i) => ({
      offset: i - WINDOW,
      absence: absenceForDay(todayKey + i - WINDOW, byDay),
    }))
    return { planesAbsence: planes.absence, cells }
  }

  it.each([0, 3, -3, 45])('shown = %s: today’s own cell carries the absence, and no other cell does', async (shown) => {
    // THE BUG THIS PINS: the absence used to arrive on `readDayPlanes(shownKey)`,
    // which hands it back only when the day asked for is today — so standing on
    // any other date left today's cell computed from the FULL roster and
    // advertising 空き for hours p-01 is not working. A calendar number cannot
    // depend on which day is being looked at.
    const { planesAbsence, cells } = await absencesAcrossTheMonth(shown)
    expect(cells.filter((c) => c.absence != null).map((c) => c.offset)).toEqual([0])
    // The board plane is UNCHANGED by this fix and still today-only — which is
    // exactly why the calendar could not keep reading it.
    expect(planesAbsence != null).toBe(shown === 0)
  })

  it('the door answers under TODAY’s key only, and only when today is in range', async () => {
    const todayKey = jstDayKey(renderNow())
    const inRange = await listAbsenceByDay(STORE_A, { from: todayKey - WINDOW, to: todayKey + WINDOW })
    expect([...inRange.keys()]).toEqual([todayKey])
    expect(inRange.get(todayKey)).not.toBeNull()
    // …and it is the same incident the board's own planes hand the lanes, so
    // the calendar cell and the band under it cannot describe two absences.
    expect(inRange.get(todayKey)).toEqual((await readDayPlanes(STORE_A, todayKey)).absence)
    // A window that does not contain today holds nothing at all — the door
    // never invents a day, and `absenceForDay` reads 「missing」 as 「none」.
    const future = await listAbsenceByDay(STORE_A, { from: todayKey + 1, to: todayKey + WINDOW })
    expect([...future.keys()]).toEqual([])
    expect(absenceForDay(todayKey, future)).toBeNull()
  })

  it('the store clamp still applies — another store’s lens sees no incident', async () => {
    // `readDayPlanes` clamps the 勤務不可 by store; a second door that forgot to
    // would leak STORE_A's absence into STORE_B's month.
    const todayKey = jstDayKey(renderNow())
    const byDay = await listAbsenceByDay(STORE_B, { from: todayKey - WINDOW, to: todayKey + WINDOW })
    expect(absenceForDay(todayKey, byDay)).toBeNull()
    expect((await readDayPlanes(STORE_B, todayKey)).absence).toBeNull()
  })

  it('a shortened roster is shorter than the same day’s unshortened one', async () => {
    // Without this the tests above would still pass if the absence stopped
    // shortening anything at all.
    const todayKey = jstDayKey(renderNow())
    const [staff, quals, shiftsByDay, absenceByDay] = await Promise.all([
      listStaff(STORE_A),
      readDayPlanes(STORE_A, todayKey).then((p) => p.staffQualifications),
      listShiftsByDay(STORE_A, { from: todayKey, to: todayKey }),
      listAbsenceByDay(STORE_A, { from: todayKey, to: todayKey }),
    ])
    const shifts = shiftsByDay.get(todayKey) ?? []
    const withAbsence = rosterAvailableMinutes(staff, shifts, quals, absenceForDay(todayKey, absenceByDay))
    const without = rosterAvailableMinutes(staff, shifts, quals, null)
    expect(withAbsence).toBeLessThan(without)
    // …and TOMORROW's cell keeps the full roster on the very same read.
    expect(rosterAvailableMinutes(staff, shifts, quals, absenceForDay(todayKey + 1, absenceByDay))).toBe(without)
  })
})

describe('⚖ P1-2 — the month the calendar opens on is the SHOWN day’s month', () => {
  // A SOURCE PIN, not a behaviour test, and deliberately: the rule is one
  // expression inside TodayScreen's `monthCells` memo, and lifting it into a
  // `calendarAnchor(shownYm)` helper would be an identity function with one
  // caller — an abstraction to keep alive forever so a test can call it. The
  // line itself is the smallest honest thing to pin.
  //
  // THE BUG: the anchor was `props.calendar.find((c) => c.offset === dayOffset)
  // ?? props.calendar[0]`. A shown day the roster door has no row for is not in
  // `calendar` at all (page.tsx drops it), so the find missed and the popover
  // opened on the FIRST month of the ±45-day window — the wrong month, silently.
  const SRC = readFileSync('src/app/[locale]/(business)/business/today/TodayScreen.tsx', 'utf8')
  const MEMO = SRC.slice(SRC.indexOf('const monthCells = useMemo('), SRC.indexOf('const timelineClasses'))

  it('anchors on props.shownYm and never searches the calendar rows for it', () => {
    expect(MEMO).toContain('const anchor = props.shownYm')
    expect(MEMO).not.toContain('props.calendar[0]')
    expect(MEMO).not.toContain('c.offset === props.dayOffset')
  })

  it('the server sends the shown day’s own JST year/month, from its one clock read', () => {
    const PAGE = readFileSync('src/app/[locale]/(business)/business/today/page.tsx', 'utf8')
    expect(PAGE).toContain('const shownYmd = jstYmd(shownAt)')
    expect(PAGE).toContain('shownYm: { y: shownYmd.y, m: shownYmd.m }')
  })

  it('the shown month is therefore the same whether that day has a roster row or not', () => {
    // The rule the two pins above add up to, stated as arithmetic so a reader
    // can see what「anchored on shownYm」 buys: the month on screen is a
    // function of the shown day and the ‹ › steps ONLY, never of the rows.
    const monthOf = (shownYm: { y: number; m: number }, calMonth: number) => {
      let y = shownYm.y
      let m = shownYm.m + calMonth
      while (m > 12) { m -= 12; y += 1 }
      while (m < 1) { m += 12; y -= 1 }
      return { y, m }
    }
    expect(monthOf({ y: 2026, m: 9 }, 0)).toEqual({ y: 2026, m: 9 })
    expect(monthOf({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 })
    expect(monthOf({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 })
  })
})
