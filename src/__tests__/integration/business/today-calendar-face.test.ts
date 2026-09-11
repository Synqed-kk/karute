/**
 * 月カレンダー — the day cell's face, pinned.
 *
 * ⚖ Liam 2026-09-12 00:2x 「Let's use the studio version」. The popover's cells
 * used to compose their class, their 空き count and their aria-label as three
 * separate ternaries over the same three fields, inline in the JSX, and the
 * three could disagree — a day already behind us still advertised 「空き6」 and
 * still said 「空き枠6件」 out loud. `calendarCellFace` is that behaviour lifted
 * out whole, so the paint, the word and the sentence come from one answer.
 *
 * The import fence for this folder allows react / next / node specifiers only
 * (today-screen-interactions.test.ts :1-10) — this suite imports the pure
 * helper and nothing else, and needs no DOM at all, so it runs on jest's
 * default `node` environment.
 */
import { jstYmd } from '@/business/lib/clock'
import {
  CALENDAR_TIGHT_MAX,
  calendarCellFace,
  calendarLead,
  calendarMonth,
  calendarMonthAt,
  calendarMonthDays,
  nextCalendarIndex,
  type CalendarWindowDay,
} from '@/app/[locale]/(business)/business/today/today-interactions'

/** A day record shaped exactly as page.tsx's `calendar` array builds it. */
const day = (over: Partial<{ offset: number; m: number; d: number; closed: boolean; free: number }> = {}) => ({
  offset: 1,
  m: 9,
  d: 12,
  closed: false,
  free: 6,
  ...over,
})

describe('calendarCellFace — one answer for paint, word and sentence', () => {
  it('paints and speaks each of the five tones once', () => {
    expect(calendarCellFace(day({ free: 6 }))).toEqual({
      tone: 'open',
      className: 'cal-cell open',
      small: '空き6',
      aria: '9月12日、空き枠6件',
    })
    expect(calendarCellFace(day({ free: 2 }))).toEqual({
      tone: 'tight',
      className: 'cal-cell tight',
      small: '空き2',
      aria: '9月12日、空き枠2件',
    })
    expect(calendarCellFace(day({ free: 0 }))).toEqual({
      tone: 'full',
      className: 'cal-cell full',
      small: '満',
      aria: '9月12日、空きなし',
    })
    expect(calendarCellFace(day({ closed: true, free: 0 }))).toEqual({
      tone: 'closed',
      className: 'cal-cell closedday',
      small: '定休',
      aria: '9月12日、定休日',
    })
    expect(calendarCellFace(day({ offset: -5, d: 6, free: 6 }))).toEqual({
      tone: 'past',
      className: 'cal-cell open dim',
      small: null,
      aria: '9月6日',
    })
  })

  it('the 橙 boundary is INCLUSIVE — tightMax itself is still 残りわずか', () => {
    // The legend promises 「橙＝残り1〜2枠」, so 2 has to be orange and 3 green
    // (and 0 is 満, which is why the clause is a RANGE and not 「2枠以下」).
    // A `<` here would print a legend the board does not honour.
    expect(calendarCellFace(day({ free: CALENDAR_TIGHT_MAX })).tone).toBe('tight')
    expect(calendarCellFace(day({ free: CALENDAR_TIGHT_MAX + 1 })).tone).toBe('open')
    expect(calendarCellFace(day({ free: 1 })).tone).toBe('tight')
  })

  it('PAST WINS over every other tone, and takes the count with it', () => {
    // A day nobody can book has no availability to advertise. The paint stays,
    // dimmed, so 定休 and 満 still read as themselves in the month's shape.
    for (const over of [{ free: 6 }, { free: 2 }, { free: 0 }, { closed: true, free: 0 }]) {
      const face = calendarCellFace(day({ offset: -1, d: 10, ...over }))
      expect(face.tone).toBe('past')
      expect(face.small).toBeNull()
      expect(face.aria).toBe('9月10日')
      expect(face.className).toMatch(/^cal-cell (open|tight|full|closedday) dim$/)
    }
    // …and today itself is never past: offset 0 keeps its count.
    expect(calendarCellFace(day({ offset: 0, d: 11, free: 4 })).small).toBe('空き4')
  })

  it('LAYER OFF — tightMax 0 turns the 橙 tier off and changes nothing else', () => {
    // The store setting this default stands in for can be dialled to 0 — the
    // board then reads exactly as it did before this round, with no third tone.
    for (const free of [1, 2, 3, 9]) {
      expect(calendarCellFace(day({ free }), 0).tone).toBe('open')
      expect(calendarCellFace(day({ free }), 0).small).toBe(`空き${free}`)
    }
    expect(calendarCellFace(day({ free: 0 }), 0)).toEqual(calendarCellFace(day({ free: 0 })))
    expect(calendarCellFace(day({ closed: true, free: 0 }), 0)).toEqual(calendarCellFace(day({ closed: true, free: 0 })))
    expect(calendarCellFace(day({ offset: -1, d: 10, free: 2 }), 0).small).toBeNull()
  })

  it('定休 is read BEFORE the count, so a closed day with capacity still reads 定休', () => {
    // The helper's own comment says this is why the order is what it is: page.tsx
    // forces `free` to 0 on a closed day today, and if that ever stops being true
    // upstream the cell must still say 定休 rather than advertise 「空き5」.
    expect(calendarCellFace(day({ closed: true, free: 5 }))).toEqual({
      tone: 'closed',
      className: 'cal-cell closedday',
      small: '定休',
      aria: '9月12日、定休日',
    })
  })

  it('every count says WHAT it counts (⚖ 8/25) — never a bare number', () => {
    for (const free of [1, 2, 3, 12]) {
      expect(calendarCellFace(day({ free })).small).toBe(`空き${free}`)
    }
  })
})

describe('nextCalendarIndex — arrow keys inside the month grid', () => {
  const COUNT = 30

  it('moves a day sideways and a week vertically', () => {
    expect(nextCalendarIndex(10, 'ArrowLeft', COUNT)).toBe(9)
    expect(nextCalendarIndex(10, 'ArrowRight', COUNT)).toBe(11)
    expect(nextCalendarIndex(10, 'ArrowUp', COUNT)).toBe(3)
    expect(nextCalendarIndex(10, 'ArrowDown', COUNT)).toBe(17)
    expect(nextCalendarIndex(10, 'Home', COUNT)).toBe(0)
    expect(nextCalendarIndex(10, 'End', COUNT)).toBe(29)
  })

  it('stops at the month edge instead of wrapping, and lets every other key through', () => {
    expect(nextCalendarIndex(0, 'ArrowLeft', COUNT)).toBeNull()
    expect(nextCalendarIndex(0, 'ArrowUp', COUNT)).toBeNull()
    expect(nextCalendarIndex(29, 'ArrowRight', COUNT)).toBeNull()
    expect(nextCalendarIndex(29, 'ArrowDown', COUNT)).toBeNull()
    // Enter is the link's own navigation and Tab still leaves the grid —
    // returning null is what keeps the caller's hands off them.
    for (const key of ['Enter', ' ', 'Tab', 'Escape', 'a']) {
      expect(nextCalendarIndex(10, key, COUNT)).toBeNull()
    }
  })

  it('⚖ F6 — a key that names an OBJECT PROTOTYPE member is still not a move', () => {
    // `e.key` is a string the user supplies. Read off an object literal,
    // 「constructor」 came back as a FUNCTION and `10 + fn` made a string index;
    // the step table is a Map, which has no inherited keys at all.
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect(nextCalendarIndex(10, key, COUNT)).toBeNull()
    }
  })
})

describe('⚖ ADDENDUM V2 — a day the read window never reached says so', () => {
  it('renders as a dated blank with no count and no availability claim', () => {
    expect(calendarCellFace({ m: 10, d: 31, covered: false })).toEqual({
      tone: 'unknown',
      className: 'cal-cell unknown',
      small: null,
      aria: '10月31日、表示範囲外',
    })
  })

  it('never borrows another tone — not 満, not 定休, whatever tightMax says', () => {
    for (const tightMax of [0, 2, 99]) {
      const face = calendarCellFace({ m: 12, d: 1, covered: false }, tightMax)
      expect(face.tone).toBe('unknown')
      expect(face.small).toBeNull()
      expect(face.className).not.toMatch(/full|closedday|open|tight|dim/)
    }
  })
})

describe('the month the grid is standing on', () => {
  it('counts in whole months, so a 31-day month never skips the next one', () => {
    expect(calendarMonthAt(2026, 9, 0)).toEqual({ y: 2026, m: 9 })
    expect(calendarMonthAt(2026, 12, 1)).toEqual({ y: 2027, m: 1 })
    expect(calendarMonthAt(2026, 1, -1)).toEqual({ y: 2025, m: 12 })
    expect(calendarMonthAt(2026, 1, -13)).toEqual({ y: 2024, m: 12 })
    expect(calendarMonthAt(2026, 1, 23)).toEqual({ y: 2027, m: 12 })
    // 1月31日 + 1か月 through a Date lands on 3月3日; this must not.
    expect(calendarMonthAt(2026, 1, 1)).toEqual({ y: 2026, m: 2 })
  })

  it('knows how long each month is, leap year included', () => {
    expect(calendarMonthDays(2026, 2)).toBe(28)
    expect(calendarMonthDays(2028, 2)).toBe(29)
    expect(calendarMonthDays(2026, 9)).toBe(30)
    expect(calendarMonthDays(2026, 12)).toBe(31)
  })

  it('derives the lead blanks from a SERVER-dated day, from any day of the month', () => {
    // 2026年9月1日 is a Tuesday (wd 2), so the month opens with two blanks —
    // and every later day of that month has to give the same answer.
    for (let d = 1; d <= 30; d += 1) {
      expect(calendarLead({ d, wd: (2 + d - 1) % 7 })).toBe(2)
    }
    expect(calendarLead({ d: 1, wd: 0 })).toBe(0)
    expect(calendarLead({ d: 30, wd: 6 })).toBe(5)
  })
})

describe('⚖ ADDENDUM V3 — the grid is dated by the clock helper, not re-derived', () => {
  it('jstYmd’s wd IS the real JST weekday of the y/m/d it returns', () => {
    // JST is UTC+9 with no DST, so JST-noon of a calendar date is 03:00Z —
    // never near a UTC day boundary, whatever zone the runner is in.
    for (const iso of [
      '2026-09-11T04:00:00.000Z',
      '2026-08-31T15:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2028-02-29T10:00:00.000Z',
    ]) {
      const p = jstYmd(new Date(iso))
      expect(p.wd).toBe(new Date(Date.UTC(p.y, p.m - 1, p.d, 3)).getUTCDay())
      // …and the lead the grid computes from it agrees with the month's own 1st.
      const first = jstYmd(new Date(Date.UTC(p.y, p.m - 1, 1, 3)))
      expect(calendarLead(p)).toBe(first.wd)
    }
  })
})

describe('⚖ F4 — the month at the WINDOW EDGE: whole month, honest holes', () => {
  const DAY_MS = 86_400_000
  /** A `calendar` array shaped exactly as page.tsx builds it, for a ±half-day
   *  window around one day. The dates are this suite's own UTC arithmetic — it
   *  shares no code with `calendarMonth`, which is the point. */
  const windowAround = (iso: string, half: number): CalendarWindowDay[] =>
    Array.from({ length: half * 2 + 1 }, (_, i) => {
      const at = new Date(Date.parse(`${iso}T00:00:00Z`) + (i - half) * DAY_MS)
      return {
        y: at.getUTCFullYear(),
        m: at.getUTCMonth() + 1,
        d: at.getUTCDate(),
        wd: at.getUTCDay(),
        offset: i - half,
        closed: false,
        free: 6,
        booked: 0,
      }
    })
  const upto = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

  // 2026-09-11 ± 45 days covers 2026-07-28 … 2026-10-26, so BOTH edge months
  // are part-covered: July from the 28th, October to the 26th.
  const calendar = windowAround('2026-09-11', 45)
  const anchor = { y: 2026, m: 9 }

  it('the NEXT edge month is drawn whole, with its uncovered tail as dated blanks', () => {
    const oct = calendarMonth(calendar, anchor, 1)
    expect({ y: oct.y, m: oct.m }).toEqual({ y: 2026, m: 10 })
    // 2026年10月1日 is a Thursday, so the month opens with four blanks. A lead of
    // 0 here would put every date of October a column early.
    expect(oct.lead).toBe(new Date(Date.UTC(2026, 9, 1)).getUTCDay())
    expect(oct.lead).toBe(4)
    expect(oct.days).toHaveLength(31)
    expect(oct.days.filter((c) => c.covered !== false).map((c) => c.d)).toEqual(upto(1, 26))
    expect(oct.days.filter((c) => c.covered === false).map((c) => c.d)).toEqual(upto(27, 31))
    // A blank is DATED and says nothing about capacity.
    expect(calendarCellFace(oct.days[30]).aria).toBe('10月31日、表示範囲外')
    expect(calendarCellFace(oct.days[30]).small).toBeNull()
  })

  it('the PREVIOUS edge month too — the head is blank, the tail is real', () => {
    const jul = calendarMonth(calendar, anchor, -2)
    expect({ y: jul.y, m: jul.m }).toEqual({ y: 2026, m: 7 })
    expect(jul.lead).toBe(new Date(Date.UTC(2026, 6, 1)).getUTCDay())
    expect(jul.lead).toBe(3)
    expect(jul.days).toHaveLength(31)
    expect(jul.days.filter((c) => c.covered === false).map((c) => c.d)).toEqual(upto(1, 27))
    expect(jul.days.filter((c) => c.covered !== false).map((c) => c.d)).toEqual(upto(28, 31))
  })

  it('a FULLY covered month has no blanks at all, and still leads correctly', () => {
    const sep = calendarMonth(calendar, anchor, 0)
    expect(sep.days).toHaveLength(30)
    expect(sep.days.filter((c) => c.covered === false)).toEqual([])
    // 2026年9月1日 is a Tuesday.
    expect(sep.lead).toBe(new Date(Date.UTC(2026, 8, 1)).getUTCDay())
    expect(sep.lead).toBe(2)
  })

  it('a month the window never reached is ALL blanks — the ‹ › guard is what keeps it off screen', () => {
    const dec = calendarMonth(calendar, anchor, 3)
    expect(dec.days).toHaveLength(31)
    expect(dec.days.every((c) => c.covered === false)).toBe(true)
    // `lead` is 0 here because there is no server-dated day to derive it from —
    // a shape fallback, NOT a correct month. TodayScreen's `monthCovered`
    // disables ‹ › on exactly this case, which is why it is unreachable.
    expect(dec.lead).toBe(0)
  })

  // ⚖ #890 — THE TWO WAYS A DAY CAN HAVE NO NUMBERS MEET IN ONE CELL. The read
  // window falling short of a date and the roster door having no answer for it
  // are different upstream facts, and the operator has no use for the
  // difference: both are 「we cannot tell you about this day」. page.tsx now
  // sends the second kind as a real row (`covered: false`), so this pins that
  // it arrives at the SAME face as a blank calendarMonth filled in itself —
  // otherwise one of the two would drift into a count nobody computed.
  it('a covered:false ROW draws exactly like a gap-filled blank', () => {
    // 2026年10月10日, inside the window, but with no roster behind it.
    const holed = calendar.map((c) =>
      c.m === 10 && c.d === 10 ? { y: c.y, m: c.m, d: c.d, wd: c.wd, offset: c.offset, covered: false as const } : c,
    )
    const oct = calendarMonth(holed, anchor, 1)
    const fromRow = oct.days[9]
    const fromGap = oct.days[30] // the 31st: never covered, filled in by the grid
    expect(fromRow.covered).toBe(false)
    expect(fromGap.covered).toBe(false)
    expect(calendarCellFace(fromRow)).toEqual({ ...calendarCellFace(fromGap), aria: '10月10日、表示範囲外' })
    // …and the month is still whole, still led correctly: one unknown day does
    // not shorten October or move a column.
    expect(oct.days).toHaveLength(31)
    expect(oct.lead).toBe(4)
  })
})
