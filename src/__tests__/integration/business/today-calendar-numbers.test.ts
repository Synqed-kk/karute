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
 *
 * The ⚖ P1 suite at the foot DOES render the page (it is the only way to ask
 * the loop what it emits for a day the roster door has no answer for), so this
 * file carries the same three door stubs today-board.test.ts uses. No DOM is
 * needed even there: the page hands back an element tree and the props are read
 * off it, exactly as that suite does.
 */
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

/** THE ROSTER DOOR WITH HOLES IN IT. The fixture door answers for every day of
 *  the window (data.ts :284) — which is the one world this fix is not about.
 *  The real door returns only the days it actually holds, so a suite that wants
 *  that world names the day keys here and they are dropped on the way out.
 *  Everything else is the real module. */
const mockMissingRosterDays = new Set<number>()
jest.mock('@/business/lib/data', () => {
  const actual: typeof import('@/business/lib/data') = jest.requireActual('@/business/lib/data')
  return {
    ...actual,
    listShiftsByDay: async (...args: Parameters<typeof actual.listShiftsByDay>) => {
      const byDay = await actual.listShiftsByDay(...args)
      for (const key of mockMissingRosterDays) byDay.delete(key)
      return byDay
    },
  }
})

import { readFileSync } from 'node:fs'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import { jstDayKey, jstYmd } from '@/business/lib/clock'
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
  //
  // The pin is on the RULE, not on one spelling of it: the `monthCells` memo
  // alone (up to its own blank line), asserting where the month comes FROM and
  // what it must never fall back to. #891 rewrites the body of this same memo
  // and has to keep passing — a pin that breaks on a legitimate rewrite trains
  // people to edit the test.
  const SRC = readFileSync('src/app/[locale]/(business)/business/today/TodayScreen.tsx', 'utf8')
  const MEMO_AT = SRC.indexOf('const monthCells = useMemo(')
  const MEMO = SRC.slice(MEMO_AT, SRC.indexOf('\n\n', MEMO_AT))

  it('anchors on props.shownYm and never searches the calendar rows for it', () => {
    expect(MEMO_AT).toBeGreaterThan(-1)
    expect(MEMO).toContain('props.shownYm')
    // The two halves of the old fallback, each named so a revert says which.
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


describe('⚖ P1 (#890) — a day the roster door does not know is DATA, not an absent row', () => {
  // WHAT WENT WRONG: `listShiftsByDay` answers only for the days it holds, so a
  // day it has no roster for used to be dropped from the calendar array
  // entirely. Two surfaces then lied in different directions — the month grid
  // printed a September that began on the 22nd, and `?? []` (the other tempting
  // fix) would have painted 満, a capacity of zero nobody computed.
  //
  // THE RULE: the day still comes through, dated by the server's own clock read
  // and carrying `covered: false` — which is a row with NO `free` and NO
  // `closed` on it, so no surface can read a capacity off it by accident.
  const DAY_MS = 86_400_000
  const service = createServiceClient as jest.Mock
  const supabase = createClient as jest.Mock

  /** The props the screen is handed. The page returns an element tree and no
   *  renderer exists in territory, so the tree is walked for them. */
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

  const calendar = async () =>
    screenProps(
      await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE_A }) }),
    )!.calendar

  beforeEach(() => {
    mockMissingRosterDays.clear()
    supabase.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
    })
    service.mockReturnValue({
      from: (table: string) => {
        const row =
          table === 'business_workspace_grants'
            ? { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null }
            : table === 'profiles'
              ? { data: { customer_id: 'biz-1', is_management: false }, error: null }
              : { data: null, error: null }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain = (): any => ({ select: chain, eq: chain, maybeSingle: async () => row })
        return chain()
      },
    })
  })
  afterEach(() => mockMissingRosterDays.clear())

  it('the window keeps EVERY date — a missing roster shortens no month', async () => {
    const todayKey = jstDayKey(renderNow())
    mockMissingRosterDays.add(todayKey + 3).add(todayKey - 30)
    const rows = await calendar()
    expect(rows).toHaveLength(WINDOW * 2 + 1)
    expect(rows.map((c) => c.offset)).toEqual(Array.from({ length: WINDOW * 2 + 1 }, (_, i) => i - WINDOW))
  })

  it('the unknown day is DATED by the server, and carries no numbers at all', async () => {
    const todayKey = jstDayKey(renderNow())
    mockMissingRosterDays.add(todayKey + 3)
    const row = (await calendar()).find((c) => c.offset === 3)!
    // y/m/d/wd are the server's own, from the same clock read every other row
    // is dated from — the grid can lay the date out without asking the browser.
    expect(row).toEqual({ offset: 3, ...jstYmd(new Date(renderNow().getTime() + 3 * DAY_MS)), covered: false })
    // …and that is the whole row. 満 is a count, 定休 is a decision the store
    // made; neither is knowable here, so neither field exists to be read.
    expect('free' in row).toBe(false)
    expect('closed' in row).toBe(false)
  })

  it('its neighbours are untouched — one hole is one hole', async () => {
    const todayKey = jstDayKey(renderNow())
    mockMissingRosterDays.add(todayKey + 3)
    const rows = await calendar()
    for (const offset of [2, 4]) {
      const near = rows.find((c) => c.offset === offset)!
      expect(near.covered).not.toBe(false)
      if (near.covered === false) throw new Error('unreachable')
      expect(near.free).toBeGreaterThanOrEqual(0)
    }
  })

  it('the whole window is covered when the door answers for every day', async () => {
    const rows = await calendar()
    expect(rows.filter((c) => c.covered === false)).toEqual([])
  })

  // A SOURCE PIN for the cell, in the same spirit as the P1-2 pin above: the
  // rule is one branch inside the JSX, and #891 rewrites that JSX. So the pin is
  // on WHAT THE BRANCH MUST BE — a span, not a link, with nothing to press —
  // never on one spelling of the className or the sentence.
  const SCREEN_SRC = readFileSync('src/app/[locale]/(business)/business/today/TodayScreen.tsx', 'utf8')
  const CELLS_AT = SCREEN_SRC.indexOf('{monthCells.days.map(')
  const CELLS = SCREEN_SRC.slice(CELLS_AT, SCREEN_SRC.indexOf('</div>', CELLS_AT))

  // THE UNCOVERED BRANCH ITSELF — from `covered === false` down to the covered
  // day's <Link>, and nothing else. Slicing this narrowly is the point: the old
  // pin read both whole files, so it stayed green while the class was deleted
  // from the branch, as long as the words survived anywhere (a comment, another
  // cell). This one is red the moment THIS branch stops carrying them.
  const UNCOVERED = CELLS.slice(CELLS.indexOf('covered === false')).split('<Link')[0]

  // …and WHERE that branch authors its face. It either spells the class and the
  // sentence itself (#890) or hands the day to a helper and renders the answer
  // (#891 lifts them into `calendarCellFace`). Follow the ONE reference rather
  // than pin either spelling — but follow it to that helper's own uncovered
  // line, never to the whole file.
  const FACE_SRC = (() => {
    const via = UNCOVERED.match(/\{(\w+)\.className\}/)?.[1]
    if (!via) return UNCOVERED
    const fn = CELLS.match(new RegExp(`const ${via} = (\\w+)\\(`))?.[1] ?? ''
    const LIB = readFileSync('src/app/[locale]/(business)/business/today/today-interactions.ts', 'utf8')
    const at = LIB.indexOf(`export function ${fn}(`)
    const body = at < 0 ? '' : LIB.slice(at, LIB.indexOf('\nexport ', at + 1))
    return body.split('\n').find((l) => l.includes('covered === false')) ?? ''
  })()

  it('the uncovered day is drawn as a dated, unpressable cell — never a link', () => {
    expect(CELLS_AT).toBeGreaterThan(-1)
    expect(CELLS).toContain('d.covered === false')
    expect(UNCOVERED).toContain('<span')
    expect(UNCOVERED).not.toContain('href')
    expect(UNCOVERED).not.toContain('dayHref')
  })

  it('and THAT branch — not some other line — says 表示範囲外, in its own paint', () => {
    expect(FACE_SRC).not.toBe('')
    expect(FACE_SRC).toMatch(/\bunknown\b/)
    expect(FACE_SRC).toContain('表示範囲外')
  })

  it('the cell has a paint of its own, paler than 定休', () => {
    const CSS = readFileSync('src/app/[locale]/(business)/business/today/today.css', 'utf8')
    expect(CSS).toContain('.biz .cal-cell.unknown {')
  })
})
