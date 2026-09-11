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
import { jstDayKey } from '@/business/lib/clock'
import { STORE_A } from '@/business/lib/fixtures'
import {
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

describe('⚖ V5 — 勤務不可 shortens its OWN day and no other', () => {
  /** The absence each of the 91 cells is built with, for a given shown day —
   *  the door's answer and the page's selection together, because the rule
   *  only holds if BOTH halves hold. */
  const absencesAcrossTheMonth = async (shownOffset: number) => {
    const todayKey = jstDayKey(renderNow())
    const shownKey = todayKey + shownOffset
    const planes = await readDayPlanes(STORE_A, shownKey)
    return Array.from({ length: WINDOW * 2 + 1 }, (_, i) => ({
      offset: i - WINDOW,
      absence: absenceForDay(todayKey + i - WINDOW, shownKey, planes.absence),
    }))
  }

  it('shown = today: exactly one cell — today’s own — carries the absence', async () => {
    const cells = await absencesAcrossTheMonth(0)
    const carrying = cells.filter((c) => c.absence != null)
    expect(carrying.map((c) => c.offset)).toEqual([0])
  })

  it('shown = +3: no cell carries one, because the door has none to give', async () => {
    const cells = await absencesAcrossTheMonth(3)
    expect(cells.filter((c) => c.absence != null)).toEqual([])
    // The door's half of the rule, stated so a regression names itself.
    expect((await readDayPlanes(STORE_A, jstDayKey(renderNow()) + 3)).absence).toBeNull()
  })

  it('a shortened roster is shorter than the same day’s unshortened one', async () => {
    // Without this the two tests above would still pass if the absence stopped
    // shortening anything at all.
    const todayKey = jstDayKey(renderNow())
    const planes = await readDayPlanes(STORE_A, todayKey)
    const [staff, shiftsByDay] = await Promise.all([
      listStaff(STORE_A),
      listShiftsByDay(STORE_A, { from: todayKey, to: todayKey }),
    ])
    const shifts = shiftsByDay.get(todayKey) ?? []
    const withAbsence = rosterAvailableMinutes(staff, shifts, planes.staffQualifications, planes.absence)
    const without = rosterAvailableMinutes(staff, shifts, planes.staffQualifications, null)
    expect(withAbsence).toBeLessThan(without)
  })
})
