/**
 * あと入る数 — `coursesFitForDay`, the month calendar's own count.
 *
 * ⚖ Liam 2026-09-12 00:5x 「I choose B」. The cell used to divide the day's
 * leftover minutes by 60 (`freeSlots`, deleted in the same round). This is the
 * replacement, pinned alone: per treating 担当, the contiguous free pockets the
 * engine already computes for スキマガード, each packed at the store's own
 * 標準セッション. The pieces it is built out of (`freePockets`, `kPackCount`,
 * `effectiveShift`, `treatsPatients`) have their own suites — what is proven
 * here is the ANSWER, and every input that is allowed to change it.
 *
 * THE DIFFERENCE IS THE WHOLE POINT, so the old formula is written out inline
 * wherever the two disagree: `Math.floor((available − booked) / 60)` is exactly
 * what `freeSlots` was, and a reader has to be able to see 1 and 0 side by side.
 *
 * The import fence for this folder allows react / next / node specifiers only
 * (today-screen-interactions.test.ts :1-10) — everything here is in-repo and no
 * DOM is needed, so it runs on jest's default `node` environment.
 */
import { coursesFitForDay } from '@/business/lib/today-board'
import type { FixtureAbsence, FixtureShift } from '@/business/lib/fixtures-today'

const OPEN = 10 * 60
const CLOSE = 19 * 60
/** The store's own 標準セッション (`opsConfig.standardSessionMin`). */
const SESSION = 60

const shift = (staff_id: string, start = OPEN, end = CLOSE, breaks: FixtureShift['breaks'] = []): FixtureShift => ({
  staff_id,
  start,
  end,
  breaks,
})
const absence = (staff_id: string, from: number): FixtureAbsence => ({
  staff_id,
  store_id: 'store-a',
  from,
  reason: '体調不良',
  intake_stopped: true,
})
/** 整体 = treats; 受付・会計 = does not (today-board's own `treatsPatients`). */
const TREATS = { 'p-01': ['整体'], 'p-02': ['整体'], 'p-03': ['整体'], 'p-09': ['受付', '会計'] }

const fits = (over: Partial<Parameters<typeof coursesFitForDay>[0]> = {}) =>
  coursesFitForDay({
    staff: [{ id: 'p-01' }],
    shifts: [shift('p-01')],
    qualifications: TREATS,
    absence: null,
    open: OPEN,
    close: CLOSE,
    bookings: [],
    blocks: [],
    sessionMin: SESSION,
    ...over,
  })

/** What the cell used to say — `freeSlots(availableMin, bookedMin)`, verbatim,
 *  so the tests below can show both numbers rather than assert one. */
const staffHours = (availableMin: number, bookedMin: number) => Math.max(Math.floor((availableMin - bookedMin) / 60), 0)

describe('coursesFitForDay — the pockets, packed', () => {
  it('an untouched 10:00–19:00 shift with a lunch break fits 8 courses', () => {
    // 600–720 is two courses, 780–1140 is six. The break is not idle capacity
    // and it is not one long 8-hour run either — both facts are in the 8.
    expect(fits({ shifts: [shift('p-01', OPEN, CLOSE, [{ start: 12 * 60, end: 13 * 60 }])] })).toBe(8)
  })

  it('and the same day at a 90-minute 標準セッション fits 5, not 5.33', () => {
    // floor(120/90) + floor(360/90) = 1 + 4. A course is placed whole or not at
    // all, so the two remainders (30 and 0) are simply not bookable.
    expect(
      fits({ shifts: [shift('p-01', OPEN, CLOSE, [{ start: 12 * 60, end: 13 * 60 }])], sessionMin: 90 }),
    ).toBe(5)
  })

  it('⚖ LIAM’S CASE — three 30-minute gaps on ONE lane fit nothing, while staff-hours said 1', () => {
    // 90 free minutes in three pieces. The old cell divided and printed 「空き1」,
    // and the receptionist went looking for an hour that is nowhere on the day.
    const day = fits({
      shifts: [shift('p-01', OPEN, 12 * 60 + 30)],
      bookings: [
        { staffId: 'p-01', start: 630, end: 660 },
        { staffId: 'p-01', start: 690, end: 720 },
      ],
    })
    // available 150 · booked 60 · free 90 → three gaps of 30 (600-630, 660-690, 720-750).
    expect(staffHours(150, 60)).toBe(1)
    expect(day).toBe(0)
  })

  it('⚖ LIAM’S CASE, SPREAD — one 30-minute gap each on three lanes is still nothing', () => {
    // The same 90 minutes, now across three people. Contiguity is per LANE, so
    // no amount of adding up across the roster makes an hour out of these.
    const day = fits({
      staff: [{ id: 'p-01' }, { id: 'p-02' }, { id: 'p-03' }],
      shifts: [shift('p-01', OPEN, 630), shift('p-02', OPEN, 630), shift('p-03', OPEN, 630)],
      bookings: [],
    })
    expect(staffHours(30 * 3, 0)).toBe(1)
    expect(day).toBe(0)
  })

  it('a 勤務不可 shortens that day’s count, and only that staff member’s lane', () => {
    const roster = { staff: [{ id: 'p-01' }, { id: 'p-02' }], shifts: [shift('p-01'), shift('p-02')] }
    expect(fits(roster)).toBe(18)
    // p-01 stops at 13:00: her 9 hours become 3. p-02 is untouched.
    expect(fits({ ...roster, absence: absence('p-01', 13 * 60) })).toBe(3 + 9)
    // An absence from before her shift starts leaves her nothing at all.
    expect(fits({ ...roster, absence: absence('p-01', 8 * 60) })).toBe(9)
    // …and an absence belonging to somebody who is not on today's roster
    // changes nothing, rather than quietly shortening the first lane it finds.
    expect(fits({ ...roster, absence: absence('p-99', 13 * 60) })).toBe(18)
  })

  it('a break that falls entirely past the 勤務不可 goes with it', () => {
    // 10:00–13:00 with a 15:00 break: the break is in hours nobody is working,
    // so it must not come off the three hours that are left.
    expect(
      fits({
        shifts: [shift('p-01', OPEN, CLOSE, [{ start: 15 * 60, end: 16 * 60 }])],
        absence: absence('p-01', 13 * 60),
      }),
    ).toBe(3)
  })

  it('a receptionist is NOT capacity — a full shift on 受付 fits nothing', () => {
    expect(fits({ staff: [{ id: 'p-09' }], shifts: [shift('p-09')] })).toBe(0)
    // …and adding her to a real roster adds nothing to the count.
    const treating = fits({ staff: [{ id: 'p-01' }], shifts: [shift('p-01')] })
    expect(fits({ staff: [{ id: 'p-01' }, { id: 'p-09' }], shifts: [shift('p-01'), shift('p-09')] })).toBe(treating)
    // A staff member with NO qualification row at all is not capacity either.
    expect(fits({ staff: [{ id: 'p-77' }], shifts: [shift('p-77')] })).toBe(0)
  })

  it('a day with no shifts at all fits nothing — and says so rather than assuming a roster', () => {
    expect(fits({ shifts: [] })).toBe(0)
    expect(fits({ staff: [], shifts: [] })).toBe(0)
    // A roster member the day has no shift row for contributes nothing.
    expect(fits({ staff: [{ id: 'p-01' }, { id: 'p-02' }], shifts: [shift('p-01')] })).toBe(9)
  })

  it('⚠ AN UNASSIGNED BOOKING COSTS ITS COURSES — it is on no lane and still eats the day', () => {
    const roster = { staff: [{ id: 'p-01' }], shifts: [shift('p-01')] }
    // 90 minutes with no 担当 at a 60-minute session: ceil(90/60) = 2.
    expect(fits({ ...roster, bookings: [{ staffId: null, start: 660, end: 750 }] })).toBe(9 - 2)
    // Exactly one session costs exactly one.
    expect(fits({ ...roster, bookings: [{ staffId: null, start: 660, end: 720 }] })).toBe(8)
    // …and it can never drive the count below zero.
    expect(
      fits({
        ...roster,
        bookings: Array.from({ length: 12 }, (_, i) => ({ staffId: null, start: 600 + i, end: 660 + i })),
      }),
    ).toBe(0)
  })

  it('sessionMin of 0 — or anything that is not a positive number — answers 0, never NaN', () => {
    // A cell printing 「あとNaN枠」 or 「あとInfinity枠」 is worse than a cell
    // printing nothing, and both are what a bare division hands back here.
    for (const sessionMin of [0, -30, Number.NaN, Number.POSITIVE_INFINITY]) {
      const answer = fits({ sessionMin })
      expect({ sessionMin: String(sessionMin), answer }).toEqual({ sessionMin: String(sessionMin), answer: 0 })
    }
  })

  it('bookings outside the shift window never create a negative pocket', () => {
    const roster = { staff: [{ id: 'p-01' }], shifts: [shift('p-01', 12 * 60, 16 * 60)] }
    expect(fits(roster)).toBe(4)
    // Before the shift, after the shift, and straddling each end — the count is
    // only ever cut by the part that actually lands inside her window.
    expect(fits({ ...roster, bookings: [{ staffId: 'p-01', start: 540, end: 660 }] })).toBe(4)
    expect(fits({ ...roster, bookings: [{ staffId: 'p-01', start: 17 * 60, end: 18 * 60 }] })).toBe(4)
    expect(fits({ ...roster, bookings: [{ staffId: 'p-01', start: 11 * 60, end: 13 * 60 }] })).toBe(3)
    expect(fits({ ...roster, bookings: [{ staffId: 'p-01', start: 15 * 60, end: 20 * 60 }] })).toBe(3)
    // A booking on SOMEBODY ELSE's lane never touches hers.
    expect(fits({ ...roster, bookings: [{ staffId: 'p-02', start: 12 * 60, end: 16 * 60 }] })).toBe(4)
  })

  it('F1 — the count is clamped to 営業時間, never just the shift', () => {
    // A roster running past 閉店 used to advertise courses sold after close:
    // 10:00–21:00 with close at 19:00 counts the same as 10:00–19:00.
    expect(fits({ shifts: [shift('p-01', OPEN, 21 * 60)] })).toBe(9)
    // …and the same clamp on the other wall — a shift starting before 開店
    // counts the same as one that starts exactly at open.
    expect(fits({ shifts: [shift('p-01', 8 * 60, CLOSE)] })).toBe(9)
    // A shift entirely outside 営業時間 fits nothing — never a negative pocket.
    expect(fits({ shifts: [shift('p-01', 20 * 60, 22 * 60)] })).toBe(0)
  })

  it('the whole day is counted, today included — the morning that has gone is not subtracted', () => {
    // ⚖ D-C2. `now: null` on every lane, so the answer is a fact about the DAY
    // and never about the minute the page happened to render at. The rider that
    // would subtract the past is a separate question and not this one.
    const morning = fits({ shifts: [shift('p-01', OPEN, CLOSE)] })
    expect(morning).toBe(9)
    // Same roster, two bookings filling the morning: the count drops by exactly
    // the two courses that are actually occupied, not by the whole morning.
    expect(
      fits({ shifts: [shift('p-01', OPEN, CLOSE)], bookings: [{ staffId: 'p-01', start: 600, end: 720 }] }),
    ).toBe(7)
  })

  describe('⚖ FIX ROUND 3 — P1, staff blocks are occupied time', () => {
    it('a 15-minute block inside a lane turns one 120-minute pocket into 45+60 — loses one course', () => {
      // Untouched: a single 120-minute pocket packs 2 courses of 60.
      const roster = { shifts: [shift('p-01', OPEN, OPEN + 120)] }
      expect(fits(roster)).toBe(2)
      // The block sits at +45..+60 (15 min), splitting the pocket into a
      // 45-minute piece (0 courses) and a 60-minute piece (1 course) — 1, not 2.
      expect(
        fits({ ...roster, blocks: [{ staffId: 'p-01', start: OPEN + 45, end: OPEN + 60 }] }),
      ).toBe(1)
    })

    it('a block on a non-treating staff member changes nothing', () => {
      const roster = { staff: [{ id: 'p-09' }], shifts: [shift('p-09')] }
      expect(fits(roster)).toBe(0)
      expect(fits({ ...roster, blocks: [{ staffId: 'p-09', start: OPEN, end: OPEN + 60 }] })).toBe(0)
    })

    it('a RESOURCE-ONLY block (staffId null) changes nothing — nobody’s day is spent on a blocked bed', () => {
      const roster = { shifts: [shift('p-01')] }
      const baseline = fits(roster)
      expect(fits({ ...roster, blocks: [{ staffId: null, start: OPEN + 60, end: OPEN + 120 }] })).toBe(baseline)
    })

    it('a block outside the shift changes nothing', () => {
      const roster = { shifts: [shift('p-01', 12 * 60, 16 * 60)] }
      const baseline = fits(roster)
      // Entirely before the shift, and entirely after it.
      expect(fits({ ...roster, blocks: [{ staffId: 'p-01', start: 8 * 60, end: 9 * 60 }] })).toBe(baseline)
      expect(fits({ ...roster, blocks: [{ staffId: 'p-01', start: 17 * 60, end: 18 * 60 }] })).toBe(baseline)
    })
  })

  describe('⚖ FIX ROUND 3 — P2, an unassigned booking outside 営業時間 costs nothing past the wall', () => {
    const roster = { shifts: [shift('p-01')] } // 10:00–19:00, untouched by the unassigned lane

    it('a 20:00–21:00 unassigned booking at a 10:00–19:00 store costs 0 — entirely past close', () => {
      const without = fits(roster)
      expect(fits({ ...roster, bookings: [{ staffId: null, start: 20 * 60, end: 21 * 60 }] })).toBe(without)
    })

    it('an 18:30–19:30 unassigned booking costs 1 — only the 30 minutes before close count (ceil = 1)', () => {
      expect(
        fits({ ...roster, bookings: [{ staffId: null, start: 18 * 60 + 30, end: 19 * 60 + 30 }] }),
      ).toBe(fits(roster) - 1)
    })

    it('a 9:00–11:00 unassigned booking costs 1 — only the hour after open counts', () => {
      expect(fits({ ...roster, bookings: [{ staffId: null, start: 9 * 60, end: 11 * 60 }] })).toBe(fits(roster) - 1)
    })
  })
})
