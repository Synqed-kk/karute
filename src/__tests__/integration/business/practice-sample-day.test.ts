// ⚖ §v11 V11-8 · V11-9 (the board fix, PR-B) — sample-day.ts, the pure give-way: the sample day never contradicts a live row.
import { jstDayKey } from '@/business/lib/clock'
import { giveWay, liveSpans, ownHours, serveDay } from '@/business/lib/practice-door/sample-day'
import { weekFromPair } from '@/business/lib/practice-door/store-hours'

const hm = (h: number, m = 0) => h * 60 + m
const row = (start: number, end: number, id = `r${start}`) => ({ id, staff: 's', start, end })
const shift = (start: number, end: number, breaks: Array<{ start: number; end: number }> = []) => ({ staff_id: 's', start, end, breaks })
const away = (from: number) => ({ staff_id: 's', store_id: 'x', from, reason: '体調不良', intake_stopped: true })
const PAIR = { open: hm(10), close: hm(19) }

describe('giveWay — one person\'s day, in the contract\'s order (shift · absence · break)', () => {
  it.each([
    ['shift stretched both ends (07:00 class · 17:30 tail)', shift(hm(10), hm(17)), [row(hm(7), hm(7, 30)), row(hm(16, 30), hm(17, 30))], { start: hm(7), end: hm(17, 30) }],
    ['no shift, a row → the day\'s pair, stretched', null, [row(hm(19), hm(20))], { start: hm(10), end: hm(20) }],
    ['no shift, no row → none', null, [], null],
  ])('%s', (_, s, rows, want) => {
    const out = giveWay({ shift: s, absence: null }, PAIR, rows).shift
    expect(out && { start: out.start, end: out.end }).toEqual(want)
  })

  it('absence: moved to the end of the last row it covers; one reaching the shift end is dropped; a carried row it hides does not move it', () => {
    const day = { shift: shift(hm(10), hm(19)), absence: away(hm(13)) }
    expect(giveWay(day, PAIR, [row(hm(12, 30), hm(13, 30))]).absence?.from).toBe(hm(13, 30)) // a card the hatch would cut
    expect(giveWay(day, PAIR, [row(hm(11), hm(12)), row(hm(14), hm(15))]).absence?.from).toBe(hm(15))
    expect(giveWay(day, PAIR, [row(hm(11), hm(12))]).absence?.from).toBe(hm(13)) // covers nothing → untouched
    expect(giveWay(day, PAIR, [row(hm(18), hm(19))]).absence).toBeNull() // 19:00 ≥ the shift's end
    expect(giveWay(day, PAIR, [row(hm(16, 30), hm(17, 30), 'apt-27')], new Set(['apt-27'])).absence?.from).toBe(hm(13))
    expect(giveWay(day, PAIR, [row(hm(12, 30), hm(13, 30), 'c')], new Set(['c'])).absence?.from).toBe(hm(13, 30)) // carried but DRAWN: it moves it
  })

  it.each([
    ['moved forward past the rows', shift(hm(10), hm(19), [{ start: hm(13), end: hm(14) }]), [row(hm(13), hm(14, 15)), row(hm(14, 30), hm(15, 45))], [], [{ start: hm(16), end: hm(17) }]],
    ['wraps to the shift start', shift(hm(10), hm(15), [{ start: hm(13), end: hm(14) }]), [row(hm(13), hm(15))], [], [{ start: hm(10), end: hm(11) }]],
    ['dropped when nothing is free', shift(hm(10), hm(12), [{ start: hm(10, 30), end: hm(11) }]), [row(hm(10), hm(12))], [], []],
    ['a clear break stays as it is', shift(hm(10), hm(19), [{ start: hm(12), end: hm(12, 30) }]), [row(hm(13), hm(14))], [], [{ start: hm(12), end: hm(12, 30) }]],
    ['never onto the person\'s served sell slot', shift(hm(10), hm(19), [{ start: hm(13), end: hm(14) }]), [row(hm(13), hm(16))], [{ start: hm(16), end: hm(17) }], [{ start: hm(17), end: hm(18) }]],
    ['outside the shift → moved inside', shift(hm(7), hm(12), [{ start: hm(12, 30), end: hm(13, 30) }]), [], [], [{ start: hm(7), end: hm(8) }]],
  ])('break: %s', (_, s, rows, taken, want) => {
    expect(giveWay({ shift: s, absence: null }, PAIR, rows, new Set(), taken).shift?.breaks).toEqual(want)
  })

  it('the ORDER is the contract: the 勤務不可 moves before the break looks for its slot (break-first would drop it)', () => {
    const rows = [row(hm(10), hm(11)), row(hm(11), hm(12)), row(hm(13), hm(14))]
    const out = giveWay({ shift: shift(hm(10), hm(18), [{ start: hm(13), end: hm(14) }]), absence: away(hm(12)) }, PAIR, rows)
    expect(out.absence?.from).toBe(hm(14)) // past the 13:00 row it covered
    expect(out.shift?.breaks).toEqual([{ start: hm(12), end: hm(13) }]) // 13 row · 14+ 勤務不可 · wraps: 10 row · 11 row · 12 free
  })

  it('a break never moves into the 勤務不可', () => {
    const out = giveWay({ shift: shift(hm(10), hm(19), [{ start: hm(11), end: hm(12) }]), absence: away(hm(13)) }, PAIR, [row(hm(10), hm(11, 30)), row(hm(12), hm(13))])
    expect(out.shift?.breaks).toEqual([]) // 11–12 · 12–13 booked, 13:00 on is 勤務不可, 10–11 booked
  })
})

describe('ownHours + serveDay — a \'core\' store\'s own day (V11-9)', () => {
  const S = { open: hm(10), close: hm(19) }
  it('edges at the sample open/close move to the day\'s; interior edges stay, clamped', () => {
    const gym = { open: hm(7), close: hm(22) }
    expect([shift(hm(10), hm(19)), shift(hm(10), hm(17)), shift(hm(11), hm(19))].map((x) => ownHours(x, S, gym)).map((x) => [x.start, x.end])).toEqual([[hm(7), hm(22)], [hm(7), hm(17)], [hm(11), hm(22)]])
    expect(ownHours(shift(hm(10), hm(17)), S, { open: hm(12), close: hm(15) })).toMatchObject({ start: hm(12), end: hm(15) })
  })

  const NO_DAY = -1 // ⚖ S81 R7 — hours read for no day of these tests: every day answers by its weekday, as before
  const core = (week = weekFromPair({ open: hm(7), close: hm(22) }, [2])) => ({ operatingHours: { open: hm(7), close: hm(22) }, weeklyHours: week, closedWeekdays: week.flatMap((d, i) => (d ? [] : [i])), hoursSource: 'core' as const, shownDayKey: NO_DAY, shownDayClosed: null })
  const MON = jstDayKey(new Date('2026-09-14T04:24:00Z')), TUE = MON + 1 // the recorded today, a Monday
  const base = { absence: away(hm(13)), roster: ['s', 't'], rows: [], carried: new Set<string>(), taken: [], sample: S }
  it('an open day: the seated shifts cover the store\'s own window', () => {
    expect(serveDay({ ...base, shifts: [shift(hm(10), hm(19))], hours: core(), dayKey: MON }).shifts).toEqual([shift(hm(7), hm(22))])
  })
  it('a closed weekday: no shift and no 勤務不可 — but a person with a row that day is served the usual pair, stretched', () => {
    expect(serveDay({ ...base, shifts: [shift(hm(10), hm(19))], hours: core(), dayKey: TUE })).toEqual({ shifts: [], absence: null })
    const booked = serveDay({ ...base, shifts: [shift(hm(10), hm(19))], rows: [{ id: 'b', staff: 't', start: hm(21), end: hm(23) }], hours: core(), dayKey: TUE })
    expect(booked.shifts).toEqual([{ staff_id: 't', start: hm(7), end: hm(23), breaks: [] }])
  })
  it('a shift the day leaves empty is none (a rest day, shifts.ts cellFor)', () => {
    const early = weekFromPair({ open: hm(7), close: hm(9) }, [])
    expect(serveDay({ ...base, shifts: [shift(hm(11), hm(18))], hours: core(early), dayKey: MON }).shifts).toEqual([])
  })
  it('a \'sample\' store is untouched by V11-9 (its window is the sample one, closed weekday included)', () => {
    const sample = { ...core(weekFromPair(S, [1])), operatingHours: S, hoursSource: 'sample' as const }
    const seated = [shift(hm(10), hm(17), [{ start: hm(12, 30), end: hm(13, 30) }])]
    expect(serveDay({ ...base, shifts: seated, hours: sample, dayKey: MON }).shifts).toEqual(seated)
  })
  it('⚖ S81 R7 — the day the hours were read for answers for itself: a 臨時休業 closes it like a 定休日; a 臨時営業日 on a 定休日 opens it with its own window', () => {
    const closedDate = { ...core(), shownDayKey: MON, shownDayClosed: 'closed_date' as const }
    expect(serveDay({ ...base, shifts: [shift(hm(10), hm(19))], hours: closedDate, dayKey: MON })).toEqual({ shifts: [], absence: null })
    const special = { ...core(), operatingHours: { open: hm(11), close: hm(15) }, shownDayKey: TUE, shownDayClosed: null }
    expect(serveDay({ ...base, shifts: [shift(hm(10), hm(19))], hours: special, dayKey: TUE }).shifts).toEqual([shift(hm(11), hm(15))])
    // every OTHER day of the range keeps its weekday's answer
    expect(serveDay({ ...base, shifts: [shift(hm(10), hm(19))], hours: closedDate, dayKey: MON + 7 }).shifts).toEqual([shift(hm(7), hm(22))])
  })
  it('a roster person with no row and no shift gets no row; a row off the roster seats nobody', () => {
    const out = serveDay({ ...base, shifts: [], rows: [{ id: 'x', staff: 'nobody', start: hm(10), end: hm(11) }], hours: core(), dayKey: MON })
    expect(out.shifts).toEqual([])
  })
})

describe('liveSpans — the rows the board draws, in minutes', () => {
  const at = (iso: string) => new Date(`${iso}+09:00`).toISOString()
  const r = (id: string, starts: string, ends: string, extra: Partial<{ kind: string; status: string; staff_id: string | null }> = {}) =>
    ({ id, kind: 'BOOKING', status: 'SCHEDULED', staff_id: 's', starts_at: at(starts), ends_at: at(ends), ...extra })
  const DAY = jstDayKey(new Date(at('2026-09-14T12:00')))
  it('keeps every drawn status (NO_SHOW too), clips a row past midnight, ignores CANCELLED, BLOCK, no person, another day and a backwards row', () => {
    const rows = [
      r('a', '2026-09-14T10:00', '2026-09-14T11:00'), r('n', '2026-09-14T12:00', '2026-09-14T12:20', { status: 'NO_SHOW' }),
      r('m', '2026-09-14T23:30', '2026-09-15T00:30'), r('c', '2026-09-14T13:00', '2026-09-14T14:00', { status: 'CANCELLED' }),
      r('b', '2026-09-14T15:00', '2026-09-14T16:00', { kind: 'BLOCK' }), r('p', '2026-09-14T15:00', '2026-09-14T16:00', { staff_id: null }),
      r('y', '2026-09-13T23:30', '2026-09-14T00:30'), r('w', '2026-09-14T12:00', '2026-09-14T11:00'),
    ]
    expect(liveSpans(rows, DAY).map((x) => [x.id, x.start, x.end])).toEqual([['a', hm(10), hm(11)], ['n', hm(12), hm(12, 20)], ['m', hm(23, 30), 1440]])
  })
})
