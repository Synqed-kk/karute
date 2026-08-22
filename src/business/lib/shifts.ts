// スタッフ・シフト — the room's derivations. PURE: no clock read, no data
// access, no React. Every function takes the day index or the row it needs, so
// the page can pin a clock and the suite can pin a day.
//
// ONE WORLD, BY CONSTRUCTION. The standing roster is `fixtures-today.shifts`
// (the same rows the 今日の運営 board draws its lanes from), the 勤務不可 is the
// board's own `absence` applied through the board's own `effectiveShift`, the
// 定休日 is the board's `closedWeekday`, and a day's 予約件数 is the board's own
// `dayTotals().count`. Nothing about a day is stated twice, so the week board,
// the month board and 今日の運営 cannot disagree about it.
//
// TIMES ARE MINUTES FROM JST MIDNIGHT, the board's coordinate. Dates are JST
// DAY INDICES (`jstDayKey`), the board's join key. Neither is a formatted
// string, so nothing here can drift on a timezone.

import { jstDayKey, jstMidnight, jstYmd } from './clock'
import type { FixtureAppointment, FixtureStaff } from './fixtures'
import type { FixtureAbsence, FixtureShift } from './fixtures-today'
import { availableMinutes, dayTotals, effectiveShift, hhmm } from './today-board'
import type { FixtureLeaveRequest } from './fixtures-shifts'

const DAY_MS = 86_400_000
const JST_OFFSET_MS = 9 * 3_600_000

// ── the calendar ────────────────────────────────────────────────────────────

export interface Ymd {
  y: number
  m: number
  d: number
  /** `Date#getDay` numbering — 0=日 … 6=土, the same numbers `closedWeekday` uses. */
  wd: number
}

/** The JST calendar coordinates of a JST day index — the SAME reader 売上分析
 *  uses (`jstYmd`), handed noon JST of the day in question. One calendar
 *  function in the codebase, so the server's own timezone cannot move a month
 *  boundary on one room and not the other. */
export function ymdOf(dayKey: number): Ymd {
  // NOON JST of that day index: a day index D is the JST day whose midnight is
  // `D·DAY − 9h`, so noon is `D·DAY − 9h + 12h`. Handing `jstYmd` any instant
  // inside the day is enough — noon keeps it clear of both edges.
  return jstYmd(new Date(dayKey * DAY_MS - JST_OFFSET_MS + 12 * 3_600_000))
}

/** The JST day index of a JST calendar date. Inverse of `ymdOf`. */
export function dayKeyOf(y: number, m: number, d: number): number {
  return Math.floor((Date.UTC(y, m - 1, d, 12) - JST_OFFSET_MS) / DAY_MS)
}

/** Today's JST day index, off the render anchor. THE only clock read this room
 *  makes, and the page makes it once. */
export function todayKeyOf(now: Date): number {
  return jstDayKey(new Date(jstMidnight(now)))
}

/** The month `offset` months from the month `todayKey` falls in. */
export function monthCoords(todayKey: number, offset: number): { y: number; m: number; days: number[] } {
  const t = ymdOf(todayKey)
  const y = t.y + Math.floor((t.m - 1 + offset) / 12)
  const m = ((((t.m - 1 + offset) % 12) + 12) % 12) + 1
  const first = dayKeyOf(y, m, 1)
  const next = dayKeyOf(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1)
  return { y, m, days: Array.from({ length: next - first }, (_, i) => first + i) }
}

/** The Monday on or before a day — the week board starts on Monday, canon's
 *  own `mondayOf`. */
export function mondayOf(dayKey: number): number {
  return dayKey - ((ymdOf(dayKey).wd + 6) % 7)
}

/** The seven days of the week `offset` weeks from the one holding today. */
export function weekCoords(todayKey: number, offset: number): number[] {
  const monday = mondayOf(todayKey) + offset * 7
  return Array.from({ length: 7 }, (_, i) => monday + i)
}

/** MONTH_WINDOW — the months this room can honestly draw: last month, this
 *  month, next month. The standing roster is true of every open day, so the
 *  limit is not the roster but the rest of the world the room joins to (the
 *  booking calendar runs −60…+6 days and the 勤務不可 is today's). Three months
 *  is what a manager reaches for and what the arrows can stop at out loud. */
export const MONTH_OFFSETS = [-1, 0, 1] as const

/** The week offsets whose Monday lands inside the month window, so the two
 *  navigations cover exactly the same calendar and neither can reach a day the
 *  other cannot. */
export function weekOffsetBounds(todayKey: number): { min: number; max: number } {
  const first = monthCoords(todayKey, MONTH_OFFSETS[0]).days[0]
  const lastMonth = monthCoords(todayKey, MONTH_OFFSETS[MONTH_OFFSETS.length - 1]).days
  const last = lastMonth[lastMonth.length - 1]
  const here = mondayOf(todayKey)
  return { min: Math.ceil((mondayOf(first) - here) / 7), max: Math.floor((mondayOf(last) - here) / 7) }
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// ── the roster ──────────────────────────────────────────────────────────────

/** A person on this store's shift board. `shift` is the STANDING row from the
 *  board's own plane; `restWd` is the one weekday they are off. */
export interface RosterMember {
  id: string
  name: string
  /** null = no shift plane at all (a roster member nobody has scheduled). */
  shift: FixtureShift | null
  restWd: number | null
  wage: number | null
  qualifications: string[]
}

/** WHICH WEEKDAY EACH PERSON IS OFF.
 *
 *  A person has ONE day off, so this may depend on nothing a lens can change:
 *  a rest day derived from the bookings a store happens to see would give 見本
 *  ごろう — who works both stores — a different day off on each board, which is
 *  two truths about one roster. It is therefore a function of the person's own
 *  `seat` (a stable number derived from their id, so two people rarely land on
 *  the same day and neither answer moves with the viewer), the store's 定休日
 *  (a rest day inside a closed week says nothing), and today (the board
 *  opposite this one has every one of these people working, and two surfaces
 *  may not disagree about that).
 *
 *  A BOOKING BEATS THE REST DAY — see `cellFor`. That is what keeps the
 *  impossible state (⚖ 8/9: a person off and the assigned 担当 on the same day)
 *  out, rather than choosing a weekday that dodges the bookings: dodging would
 *  put the lens back into the answer. */
export function restWeekday(seat: number, closedWd: number, todayWd: number): number {
  const base = [2, 3, 4, 5, 0, 6].filter((wd) => wd !== closedWd && wd !== todayWd)
  return base[seat % base.length]
}

/** A stable number per person, from their id — the same on every board. */
export function seatOf(staffId: string): number {
  let n = 0
  for (const ch of staffId) n = (n * 31 + ch.charCodeAt(0)) % 100_000
  return n
}

/** The store's shift board roster, in the door's own order. */
export function buildRoster(
  staff: FixtureStaff[],
  shifts: FixtureShift[],
  qualifications: Record<string, string[]>,
  wages: Record<string, number>,
  closedWd: number,
  todayKey: number,
): RosterMember[] {
  const byStaff = new Map(shifts.map((s) => [s.staff_id, s]))
  const todayWd = ymdOf(todayKey).wd
  return staff.map((m) => {
    const shift = byStaff.get(m.id) ?? null
    return {
      id: m.id,
      name: m.full_name,
      shift,
      restWd: shift ? restWeekday(seatOf(m.id), closedWd, todayWd) : null,
      wage: shift ? (wages[m.id] ?? null) : null,
      qualifications: qualifications[m.id] ?? [],
    }
  })
}

/** `staffId@dayKey` for every person who is the assigned 担当 of a live booking
 *  that day. Built the same way by the page and by the screen, so both sides
 *  answer "is this person working that day whatever their rota says" alike. */
export function bookedKeysOf(
  days: Array<{ dayKey: number; bookedBy: Record<string, unknown[]> }>,
): Set<string> {
  const out = new Set<string>()
  for (const d of days) {
    for (const [staffId, rows] of Object.entries(d.bookedBy)) {
      if (rows.length > 0) out.add(editKey(staffId, d.dayKey))
    }
  }
  return out
}

// ── the session's staged edits ──────────────────────────────────────────────

/** A shift the operator has staged in this session. The sealed world takes no
 *  writes, so an edit is exactly this: a row the screen lays over the plane
 *  until the tab closes, which is what the dialog says out loud.
 *
 *  KEYED BY (PERSON, DAY) AND NOT BY STORE. ⚖ 46 asks that session state
 *  survive a store switch and land only where it legitimately can; here the
 *  landing gate is the ROSTER CLAMP, not a stamp. An edit for somebody a lens
 *  cannot see never has a cell to appear in, and an edit for somebody both
 *  stores share (見本 ごろう, テスト さぶろう) must appear in both — one person
 *  has one shift on one day, and a stamp would let the two boards state
 *  different hours for it. Same reason a 希望休 answered on one board is
 *  answered: it is one request, not one per store. */
export interface StagedShift {
  staffId: string
  dayKey: number
  /** 'off' = 休みにする. */
  kind: 'work' | 'off'
  start: number
  end: number
}

/** An answer given to a 希望休 in this session. Same key, same reason. */
export interface StagedLeave {
  staffId: string
  dayKey: number
  answer: 'approved' | 'rejected'
}

export const editKey = (staffId: string, dayKey: number) => `${staffId}@${dayKey}`

// ── the day model ───────────────────────────────────────────────────────────

export type CellKind = 'closed' | 'work' | 'partial' | 'leave-pending' | 'rest' | 'none'

export interface Cell {
  kind: CellKind
  /** Minutes from JST midnight. Absent on the kinds that have no hours. */
  start: number | null
  end: number | null
  breaks: Array<{ start: number; end: number }>
  /** 「13:00〜 勤務不可」 — the partial cell's second half. */
  afterFrom: number | null
  /** Gross scheduled span, breaks included (canon's 勤務予定). */
  spanMinutes: number
  /** Span minus breaks — what the store actually pays for (人件費 概算). */
  workedMinutes: number
  /** True when this session staged it, so the board can say so. */
  staged: boolean
  /** A 希望休 answered in this session — the row still explains itself. */
  answered: 'approved' | 'rejected' | null
}

const EMPTY_CELL = (kind: CellKind): Cell => ({
  kind, start: null, end: null, breaks: [], afterFrom: null,
  spanMinutes: 0, workedMinutes: 0, staged: false, answered: null,
})

function workCell(shift: FixtureShift, staged: boolean, answered: Cell['answered']): Cell {
  return {
    kind: 'work',
    start: shift.start,
    end: shift.end,
    breaks: shift.breaks,
    afterFrom: null,
    spanMinutes: Math.max(shift.end - shift.start, 0),
    workedMinutes: availableMinutes(shift),
    staged,
    answered,
  }
}

export interface DayContext {
  closedWd: number
  todayKey: number
  absence: FixtureAbsence | null
  /** The days that hold a 希望休, as `editKey(staffId, dayKey)`. A set, because
   *  the cell only has to know that one is there — the request's own facts
   *  belong to the surface that answers it. */
  leaveKeys: ReadonlySet<string>
  /** `staffId@dayKey` for the days a person is the assigned 担当 of a booking.
   *  A booking beats the weekly rest day — see `restWeekday`. */
  bookedKeys: ReadonlySet<string>
  shiftEdits: Map<string, StagedShift>
  leaveAnswers: Map<string, StagedLeave>
}

/** ONE cell, and the whole precedence in one place so no two surfaces can
 *  resolve the same day differently. Order, strongest first: the store is shut ·
 *  nobody has scheduled this person at all · this session staged an edit · the
 *  勤務不可 recorded on the board (today only) · a 希望休 and its answer · the
 *  weekly day off · the standing shift. */
export function cellFor(member: RosterMember, dayKey: number, ctx: DayContext): Cell {
  const wd = ymdOf(dayKey).wd
  if (wd === ctx.closedWd) return EMPTY_CELL('closed')
  if (!member.shift) return EMPTY_CELL('none')

  const key = editKey(member.id, dayKey)
  const staged = ctx.shiftEdits.get(key)
  if (staged) {
    return staged.kind === 'off'
      ? { ...EMPTY_CELL('rest'), staged: true }
      : workCell({ staff_id: member.id, start: staged.start, end: staged.end, breaks: [] }, true, null)
  }

  // 勤務不可 — the board's own record, applied through the board's own rule, so
  // the two surfaces cut the same shift at the same minute.
  if (ctx.absence && ctx.absence.staff_id === member.id && dayKey === ctx.todayKey) {
    const cut = effectiveShift(member.shift, ctx.absence)
    if (cut.end <= cut.start) return { ...EMPTY_CELL('rest'), afterFrom: ctx.absence.from }
    return {
      ...workCell(cut, false, null),
      kind: 'partial',
      afterFrom: ctx.absence.from,
    }
  }

  if (ctx.leaveKeys.has(key)) {
    const answer = ctx.leaveAnswers.get(key)?.answer ?? null
    if (answer === 'approved') return { ...EMPTY_CELL('rest'), answered: 'approved' }
    if (answer === 'rejected') return workCell(member.shift, false, 'rejected')
    // UNANSWERED: THE ROSTER STILL STANDS. A request is not a day off until
    // somebody says yes, so the hours stay on the books and the 人件費 estimate
    // keeps costing them — which is also what makes APPROVING one visibly drop
    // both. Costing a pending request at zero would quietly assume every
    // request will be granted, and would make the approval a lever with no
    // effect on the two numbers it is about.
    return { ...workCell(member.shift, false, null), kind: 'leave-pending' }
  }

  // The weekly day off — UNLESS this person is the assigned 担当 of a booking
  // that day. A cell that said 休み over a booking its owner has to be at is
  // the impossible state ⚖ 8/9 forbids; the booking is the harder fact, so it
  // wins and the person is working.
  if (member.restWd !== null && wd === member.restWd && !ctx.bookedKeys.has(key)) return EMPTY_CELL('rest')
  return workCell(member.shift, false, null)
}

/** A booking whose assigned staff member is not on shift for it — the one
 *  staffing fault this world can actually hold, and the thing canon's coverage
 *  banner exists to name. Read against the SAME `effectiveShift` the board
 *  cuts its lanes with, so a booking the board suppresses is a booking this
 *  room warns about. */
export interface StaffingConflict {
  appointmentId: string
  staffName: string
  startMinute: number
  reason: string
}

export function conflictsOn(
  dayKey: number,
  bookings: FixtureAppointment[],
  roster: RosterMember[],
  ctx: DayContext,
): StaffingConflict[] {
  const byId = new Map(roster.map((m) => [m.id, m]))
  const closed = ymdOf(dayKey).wd === ctx.closedWd
  const out: StaffingConflict[] = []
  for (const a of bookings) {
    if (a.status === 'cancelled') continue
    const member = a.staff_id ? byId.get(a.staff_id) : undefined
    const name = member?.name ?? '担当者未定'
    const start = minuteOfDay(a.starts_at)
    if (closed) {
      out.push({ appointmentId: a.id, staffName: name, startMinute: start, reason: '定休日' })
      continue
    }
    if (!member || !member.shift) {
      out.push({ appointmentId: a.id, staffName: name, startMinute: start, reason: '勤務予定なし' })
      continue
    }
    const cell = cellFor(member, dayKey, ctx)
    if (cell.start === null || cell.end === null) {
      out.push({ appointmentId: a.id, staffName: name, startMinute: start, reason: '勤務予定なし' })
      continue
    }
    const end = minuteOfDay(a.ends_at)
    if (start < cell.start || end > cell.end) {
      out.push({ appointmentId: a.id, staffName: name, startMinute: start, reason: '勤務時間外' })
    }
  }
  return out.sort((x, y) => x.startMinute - y.startMinute)
}

/** JST minute-of-day of an instant. Local twin of the board's own
 *  `jstMinuteOfDay`, kept here so this module's import list stays its own. */
export function minuteOfDay(iso: string): number {
  const t = new Date(iso).getTime() + JST_OFFSET_MS
  return Math.floor((t - Math.floor(t / DAY_MS) * DAY_MS) / 60_000)
}

/** 予約 N件 for a day — the BOARD'S OWN count, not a second rule. `dayTotals`
 *  is what 今日の運営 prints as 本日の予約件数, so today's cell on this board
 *  and that KPI are the same number by construction. */
export function bookingCount(bookings: FixtureAppointment[]): number {
  return dayTotals(bookings, 0).count
}

// ── 希望休 ──────────────────────────────────────────────────────────────────

export interface ResolvedLeave {
  staffId: string
  staffName: string
  dayKey: number
  reason: string
  /** The bookings this person is already the 担当 for that day. Non-empty means
   *  the approval is refused with that reason — approving would leave the day
   *  short of the person its customers were promised. */
  conflicts: FixtureAppointment[]
}

/** Turn each request's day FLOOR into a real day (see fixtures-shifts). Walks
 *  forward to the first day that is open, is not the requester's own day off,
 *  and either does or does not already hold one of their bookings — whichever
 *  the request was written to demonstrate. A request with no such day inside
 *  the window simply does not exist; nothing is invented in its place. */
export function resolveLeaveRequests(
  requests: FixtureLeaveRequest[],
  roster: RosterMember[],
  todayKey: number,
  byDay: Map<number, FixtureAppointment[]>,
  closedWd: number,
  horizonDays = 45,
): ResolvedLeave[] {
  const byId = new Map(roster.map((m) => [m.id, m]))
  const out: ResolvedLeave[] = []
  for (const req of requests) {
    const member = byId.get(req.staff_id)
    if (!member || !member.shift) continue
    for (let offset = req.fromDayOffset; offset <= horizonDays; offset += 1) {
      const dayKey = todayKey + offset
      const wd = ymdOf(dayKey).wd
      if (wd === closedWd || wd === member.restWd) continue
      const mine = (byDay.get(dayKey) ?? []).filter(
        (a) => a.staff_id === req.staff_id && a.status !== 'cancelled',
      )
      if (mine.length > 0 !== req.overlapsBooking) continue
      out.push({
        staffId: member.id,
        staffName: member.name,
        dayKey,
        reason: req.reason,
        conflicts: mine,
      })
      break
    }
  }
  return out.sort((a, b) => a.dayKey - b.dayKey)
}

// ── 欠勤影響 ────────────────────────────────────────────────────────────────

/** The absence's own consequences, counted ONCE. The board's 次に決めること is
 *  where this world keeps them: a decision that points at a booking of the
 *  absent staff member IS an affected booking, and one whose booking is already
 *  a 仮押さえ is the one with a safe candidate. Every place this room prints a
 *  number about the absence — the chip, the three stats, the panel head, the
 *  month banner — reads this one object. */
export interface AbsenceImpact {
  affected: number
  withCandidate: number
  undecided: number
}

export function absenceImpact(
  decisions: Array<{ appointment_id: string | null; state: string }>,
  isAbsentStaffBooking: (appointmentId: string) => boolean,
  isHeld: (appointmentId: string) => boolean,
): AbsenceImpact {
  const rows = decisions.filter(
    (d) => d.state === 'open' && d.appointment_id !== null && isAbsentStaffBooking(d.appointment_id),
  )
  const withCandidate = rows.filter((d) => isHeld(d.appointment_id!)).length
  return { affected: rows.length, withCandidate, undecided: rows.length - withCandidate }
}

// ── 人件費 ──────────────────────────────────────────────────────────────────

/** 人件費 概算 — worked minutes (breaks excluded, the board's own
 *  `availableMinutes`) times the store's 時給. A person with no rate on file
 *  contributes NOTHING and is named, rather than being silently costed at zero
 *  inside a total that then reads as complete. */
export function laborCost(
  cells: Array<{ staffId: string; workedMinutes: number }>,
  roster: RosterMember[],
): { yen: number; missingRate: string[] } {
  const byId = new Map(roster.map((m) => [m.id, m]))
  let total = 0
  const missing = new Set<string>()
  for (const c of cells) {
    if (c.workedMinutes <= 0) continue
    const member = byId.get(c.staffId)
    if (!member || member.wage === null) {
      if (member) missing.add(member.name)
      continue
    }
    total += (c.workedMinutes / 60) * member.wage
  }
  return { yen: Math.round(total), missingRate: [...missing] }
}

/** 時間 as canon prints it: whole hours plain, halves to one decimal. */
export function hours(minutes: number): string {
  const h = minutes / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)}時間`
}

// ── the week bar's track, and dragging its ends ─────────────────────────────
//
// ⚖ LIAM 8/22 (E-1): 「slide each box left or right to shrink them, make them
// longer」. The week cell's shift gains a TIME-TRUE bar in a per-day track, and
// the bar's two ends are draggable. Everything the drag decides is decided
// here, as pure arithmetic on minutes — the screen writes geometry to a node
// and this file says what that geometry MEANS, so the frame in flight and the
// value that gets committed cannot come from two different rules.

/** ⚠SETTINGS-BATCH — シフトの調整単位. Every edge drag lands on a 30-minute
 *  lattice; a store that books in 15s or 20s will want its own step. Canon's
 *  own board steps in 30 too (`STEP`), so the two rooms agree today. */
export const SHIFT_STEP_MIN = 30

/** ⚠SETTINGS-BATCH — シフト調整の時間帯. The track is the store's open hours
 *  plus one hour either side: staff open up before the door and close after
 *  it, and a 10:00–19:00 person inside a 10:00–19:00 track would have a bar
 *  pinned to both ends with nowhere to grow — a control that can only shrink.
 *  The margin is a store judgement (some businesses give two hours, some
 *  none), so it is a dial, not a fact. */
export const TRACK_PAD_MIN = 60

export interface TrackWindow {
  from: number
  to: number
}

export function trackWindow(open: number, close: number): TrackWindow {
  return { from: open - TRACK_PAD_MIN, to: close + TRACK_PAD_MIN }
}

/** A minute as a percentage across the track, clamped to it. The bar, its
 *  break and the drag's live geometry all go through this one reader. */
export function trackPct(minute: number, win: TrackWindow): number {
  const span = win.to - win.from
  if (span <= 0) return 0
  return clamp(((minute - win.from) / span) * 100, 0, 100)
}

/** ⚖ LIAM 8/22 AMENDMENT — THE DRAG IS GEARED, AND THIS IS WHY.
 *
 *  A week cell is about 110px wide and the track spans eleven hours, so an
 *  edge that simply followed the pointer would buy a 30-minute step every ~5
 *  pixels. That is not a control anybody can hit; it is a lottery. So the
 *  pointer's TRAVEL buys steps at a fixed price instead — 18px of movement per
 *  30 minutes — and the bar redraws at the time it bought. The pointer and the
 *  edge therefore separate during a long drag, which is exactly why the live
 *  label is the single truth of what release will commit. */
export const DRAG_PX_PER_STEP = 18

/** The hit target each handle needs, and the narrowest day track this board is
 *  drawn in. Together they say how short a bar may be before its two handles
 *  would sit on top of each other — below that the cell keeps its dialog and
 *  drops the handles, rather than shipping two controls nobody can tell apart.
 *
 *  79px is measured, not guessed: at the shell's own 1180px floor the week
 *  table is at its 930px min-width, the staff column takes 165px, so a day
 *  column is (930−165)/7 = 109px, less 7px of cell padding each side and the
 *  8px the track is inset by on each side to keep a centred handle inside its
 *  own cell. */
export const GRIP_PX = 16
export const NARROW_TRACK_PX = 79

export function dragSafeMinutes(win: TrackWindow): number {
  const raw = ((win.to - win.from) * GRIP_PX) / NARROW_TRACK_PX
  return Math.ceil(raw / SHIFT_STEP_MIN) * SHIFT_STEP_MIN
}

/** Why an edge stopped where it did, when it was not the pointer that decided:
 *  the break it may not cross, the end of the track, or the one-step minimum a
 *  shift has to keep. The live label says it out loud — a bar that stops moving
 *  and does not explain itself reads as a broken control. */
export type EdgeClamp = 'break' | 'window' | 'min' | null

export interface EdgeSpan {
  start: number
  end: number
  clamp: EdgeClamp
}

/** ONE EDGE, MOVED. `steps` is what the geared pointer bought (negative =
 *  earlier). The other edge does not move, and NEITHER DOES THE BREAK: an edge
 *  drag is start/end only, so a break that the edge would swallow stops the
 *  edge at its boundary instead of being dragged along or silently eaten.
 *
 *  Stated on the cell's OWN minutes rather than on a snapped absolute, so a
 *  shift that genuinely starts at 10:20 steps to 10:50 — canon's own
 *  preserve-the-phase rule (`dragGeometry`'s dual lattice), which for a geared
 *  drag needs no second lattice: whole steps from where the edge stands can
 *  never land off its own phase. */
export function resizeShift(
  cell: { start: number; end: number; breaks: ReadonlyArray<{ start: number; end: number }> },
  edge: 'start' | 'end',
  steps: number,
  win: TrackWindow,
): EdgeSpan {
  const breaks = [...cell.breaks].sort((a, b) => a.start - b.start)
  if (edge === 'start') {
    const raw = cell.start + steps * SHIFT_STEP_MIN
    const byMin = cell.end - SHIFT_STEP_MIN
    const byBreak = breaks.length > 0 ? breaks[0].start : Infinity
    const hi = Math.min(byMin, byBreak)
    if (raw > hi) return { start: hi, end: cell.end, clamp: hi === byBreak ? 'break' : 'min' }
    if (raw < win.from) return { start: win.from, end: cell.end, clamp: 'window' }
    return { start: raw, end: cell.end, clamp: null }
  }
  const raw = cell.end + steps * SHIFT_STEP_MIN
  const byMin = cell.start + SHIFT_STEP_MIN
  const byBreak = breaks.length > 0 ? breaks[breaks.length - 1].end : -Infinity
  const lo = Math.max(byMin, byBreak)
  if (raw < lo) return { start: cell.start, end: lo, clamp: lo === byBreak ? 'break' : 'min' }
  if (raw > win.to) return { start: cell.start, end: win.to, clamp: 'window' }
  return { start: cell.start, end: raw, clamp: null }
}

/** WHAT THE DRAG SAYS OUT LOUD, and the single truth of what release will
 *  commit — the geared bar moves less than the pointer does, so the numbers,
 *  not the pixels, are the contract. A clamped edge names what stopped it. */
export function edgeLabel(span: EdgeSpan): string {
  const reason =
    span.clamp === 'break' ? '（休憩まで）'
      : span.clamp === 'window' ? '（営業時間まで）'
        : span.clamp === 'min' ? '（最短30分）'
          : ''
  return `${hhmm(span.start)}–${hhmm(span.end)}${reason}`
}
