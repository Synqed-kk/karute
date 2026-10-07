// 今日の運営 — the board's derivations, in one pure module.
//
// WHY THIS IS NOT IN THE PAGE: every number the board shows has to agree with
// every other number (the nav badge, the 未解決 cell, the 次に決めること cell
// and the cards themselves are ONE count; 稼働率 and the month calendar's
// 「あとN枠」 ask different questions — a ratio of minutes and a count of
// courses — but they ask them of ONE set of door reads: the same roster, the
// same shifts, the same 勤務不可, the same 予定ブロック, the same bookings — the
// fifth input joined 2026-09-12 fix round 3, when P1 found a block that could
// swallow a course the count still advertised). That discipline is only
// checkable if the arithmetic can be called on its own, so it lives here and
// the page composes.
//
// Everything is DERIVED wherever a derivation exists (⚖ 8/9, product truth):
//   · a bed's 清掃 blocks come from the bookings on it plus the resource's own
//     turnaround rule — never a hand-placed list that could drift into a booking
//   · a booking's カテゴリー comes from the customer's tier, 回数券 balance and
//     visit history — only VIP is stored, because only VIP has no signal (T-12)
//   · an absent staff member's shift is cut at the absence, and a booking that
//     falls past the cut gets NO lane card: painting one would show the business
//     double-booking itself against an absence
//   · the day's money is summed from the same bookings the cards render
//
// Times are JST minutes from midnight throughout (see fixtures-today.ts).

import { businessStrings } from '@/business/i18n'
import { freePockets, kPackCount } from './canon-logic/availability'
import type { BookingColors } from './booking-colors'
import { jstDayKey, jstMinuteOfDay } from './clock'
import type { FixtureAppointment, FixtureCustomer, FixtureMenu, FixtureStaff } from './fixtures'
import type {
  FixtureAbsence,
  FixtureBlock,
  FixtureDecision,
  FixtureResource,
  FixtureSellSlot,
  FixtureShift,
  RoomClass,
} from './fixtures-today'

export type { RoomClass }

export type BookingCategory = 'new' | 'repeat' | 'ticket' | 'vip'

export interface Hours {
  open: number
  close: number
}

/** Percent placement on the timeline. The window is the board's DRAWN window
 *  (`boardDay`), so the hour ruler and the cards are the same axis by
 *  construction — canon's own sheet drew a 15-column ruler under 11 hours of
 *  cards, and the lines and the cards did not line up.
 *  ⚖ §v11 V11-15(d) — TOTAL, FINITE, INSIDE THE BOARD: the INPUTS are clamped
 *  into the window and an end before the start becomes the start, so `0 ≤ x ≤ 100`,
 *  `0 ≤ w`, `x + w ≤ 100` (to float precision, 1e-9). The output is never
 *  re-rounded: `x` and `w` keep today's formulas bit for bit. A window that does
 *  not open before it closes places nothing, never NaN. */
export function place(start: number, end: number, hours: Hours): { x: number; w: number; startMin: number; endMin: number } {
  const span = hours.close - hours.open
  if (!(span > 0)) return { x: 0, w: 0, startMin: hours.open, endMin: hours.open }
  const from = Math.min(Math.max(start, hours.open), hours.close)
  const to = Math.max(Math.min(end, hours.close), from)
  return {
    x: ((from - hours.open) / span) * 100,
    w: (Math.max(to - from, 0) / span) * 100,
    startMin: from,
    endMin: to,
  }
}

/** Minutes in one hour: the ruler's unit and the day's rounding unit (a clock fact, not a duration setting). */
const HOUR_MIN = 60
/** Hours in one day: an hour at or past it belongs to the next calendar day (a clock fact). */
const HOURS_PER_DAY = 24
/** Minutes in one day (a clock fact): a split piece that covers 0 → DAY_MIN is a whole-day piece, and the board's day
 *  is bounded to one day either side of the store's hours (`boardDay`). */
const DAY_MIN = HOURS_PER_DAY * HOUR_MIN

/** ⚖ §v11 V11-15(a) + amendments A4/B1/B3 — THE BOARD'S DAY, the one axis the ruler, every card, the now-line, the
 *  60分配置 strip and the booth rows are placed on: the store's own hours, grown in whole hours FROM its own edges
 *  until every row fits. ⚖ 10/7 S25-2 (Liam) — EVERY DRAWN ROW widens the day (`boardRows`: bookings, shifts and
 *  their 休憩, 勤務不可, blocks, offers; the washes and turnovers end at the store's edges or a shift's by
 *  construction), never only bookings (V11-15(a)'s 「only bookings grow it」 was the lead's rule, DECISIONS S24-2).
 *  It never opens before 0 and MAY close past 1440 (whether settings accept such a day is Q-20), within one day.
 *  THE EXCEPTION, the lead's ruling S25-15 (3), confirmed by Liam S25-17 (1) (a whole-day block does not widen the day):
 *  a WHOLE-DAY split piece (start ≤ 0 and end ≥ DAY_MIN; door.ts:187–195 cuts a multi-day block into 0–1440 middle
 *  days) and a row lying wholly more than a day outside the hours (end ≤ open − DAY_MIN or start ≥ close + DAY_MIN)
 *  widen nothing; they still DRAW, clamped to the shown day by place() (buildLanes). Every other row widens, but the
 *  day is BOUNDED to [open − DAY_MIN, close + DAY_MIN], so bad data (a row ending at 99999) cannot draw thousands of
 *  cells. S25-15 (6): a row whose start or end is not finite is dropped from the widening, with one development
 *  warning per call (the count and the first bad row's index) — one bad row never blanks the board.
 *  One inside the hours or touching an edge grows nothing. A row whose end wrapped past midnight (end < start)
 *  grows it to its START. Anchored at the business edges, so a whole-hour pair gives whole hours and a fractional
 *  pair keeps today's left edge — the drag lattice (snapPct, drag-rules.ts) is unchanged. */
export function boardDay({ hours, rows }: { hours: Hours; rows: ReadonlyArray<{ start: number; end: number }> }): Hours {
  const finite = rows.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end))
  if (finite.length < rows.length && process.env.NODE_ENV !== 'production') {
    const first = rows.findIndex((r) => !(Number.isFinite(r.start) && Number.isFinite(r.end)))
    console.warn(`boardDay: ${rows.length - finite.length} row(s) with non-finite minutes left out of the day; first: rows[${first}] { start: ${rows[first].start}, end: ${rows[first].end} }`)
  }
  const floor = hours.open - DAY_MIN
  const ceiling = hours.close + DAY_MIN
  const widening = finite.filter((r) => !(r.start <= 0 && r.end >= DAY_MIN) && Math.max(r.start, r.end) > floor && r.start < ceiling)
  const earliest = Math.max(floor, Math.min(hours.open, ...widening.map((r) => r.start)))
  const latest = Math.min(ceiling, Math.max(hours.close, ...widening.map((r) => Math.max(r.start, r.end))))
  return {
    open: Math.max(0, hours.open - HOUR_MIN * Math.ceil((hours.open - earliest) / HOUR_MIN)),
    close: hours.close + HOUR_MIN * Math.ceil((latest - hours.close) / HOUR_MIN),
  }
}

/** Every row the board DRAWS, in minutes — `boardDay`'s rows, from the same inputs `buildLanes` draws from: the
 *  shown bookings, each drawn staff member's effective shift and its 休憩, the 勤務不可 start, and the blocks and
 *  offers that sit on a drawn lane. A row on no drawn lane is not drawn, so it widens nothing. */
export function boardRows(
  input: Pick<BuildInput, 'staff' | 'resources' | 'shifts' | 'absence' | 'blocks' | 'sellSlots'>,
  bookings: ReadonlyArray<Pick<BoardBooking, 'onBoard' | 'startMinute' | 'endMinute'>>,
): Array<{ start: number; end: number }> {
  const staff = new Set(input.staff.map((s) => s.id))
  const rooms = new Set(input.resources.map((r) => r.id))
  const onLane = (x: { staff_id: string | null; resource_id: string | null }) =>
    (x.staff_id != null && staff.has(x.staff_id)) || (x.resource_id != null && rooms.has(x.resource_id))
  return [
    ...bookings.filter((b) => b.onBoard).map((b) => ({ start: b.startMinute, end: b.endMinute })),
    ...input.shifts.filter((s) => staff.has(s.staff_id)).flatMap((s) => [effectiveShift(s, input.absence), ...s.breaks]),
    ...(input.absence && staff.has(input.absence.staff_id) ? [{ start: input.absence.from, end: input.absence.from }] : []),
    ...input.blocks.filter(onLane),
    ...input.sellSlots.filter(onLane),
  ].map((r) => ({ start: r.start, end: r.end }))
}

/** ⚖ §v11 V11-15 P20 — THE RULER: the AXIS may be fractional (B3); the RULER prints whole hours at their minute
 *  positions — one label per whole hour h with open ≤ h·60 < close, placed exactly as place() places a card
 *  (left = (h·60 − open)/span, width = min(60, close − h·60)/span). A whole-hour axis gives today's label set at
 *  today's equal columns (open/60 + i at i/count·100 %, width 100/count %).
 *  ⚖ 10/7 S25-2 (Liam; P20's 「never the closing hour」 was the lead's rule) — the closing edge is printed as an EDGE
 *  TICK (`edge`, at 100 %, no column) labelled with the closing hour, so 「is 21:30 inside the day?」 is on the screen.
 *  An hour past midnight reads 翌0, 翌1 … (`hourText`); the edge tick's word is `edgeText` (a 24:00 close reads 「24」). */
export function rulerLabels(axis: Hours): ReadonlyArray<RulerLabel> {
  const span = axis.close - axis.open
  if (!(span > 0)) return []
  const out: RulerLabel[] = []
  for (let h = Math.ceil(axis.open / HOUR_MIN); h * HOUR_MIN < axis.close; h++) out.push({ hour: h, text: hourText(h), leftPct: ((h * HOUR_MIN - axis.open) / span) * 100, widthPct: (Math.min(HOUR_MIN, axis.close - h * HOUR_MIN) / span) * 100 })
  out.push({ hour: axis.close / HOUR_MIN, text: edgeText(axis.close), leftPct: 100, widthPct: 0, edge: true })
  return out
}

export interface RulerLabel { hour: number; text: string; leftPct: number; widthPct: number; edge?: true }

/** ⚖ 10/7 S25-1 (Liam: 「we do compress it as far as we can, but when it just becomes impossible, we introduce
 *  scrolling」) — THE READABLE FLOOR, px per 30 minutes of the day (S25-15 (2): a time density whatever the grid
 *  step, `floorSlots`; it was per grid cell, one opsConfig.bookingStepMin, until then): the width at which a one-cell
 *  card still shows a two-kanji family name whole at the card's OWN type. RE-MEASURED 10/7 (the lead's ruling, round 2
 *  item 3) in Playwright's own headless Chromium 148: a blank page, no app code, `font-family` = today.css's stack byte
 *  for byte ("Hiragino Sans", "Hiragino Kaku Gothic ProN", … sans-serif; the computed family read back), at the card
 *  name's type `.biz .page-today .event[data-book] > strong` (13px / 700): 「山本」 26.00 px · 「山」 13.00 · 「佐々木」
 *  39.00 · 「ブラウン」 52.00 · 「ジョーンズ」 64.09 (a CJK ideograph is 1 em; round 1's 26 holds, so FAMILY_NAME_PX = 26);
 *  + the tightest padding + border the card allows (S0 「tight」: left 4 = the 3 px category stripe + 1, right 1,
 *  border 1 + 1 = 7 px) → 33 px. One number for every store and every type. A 3+-kanji family name (「佐々木」 39 px)
 *  ellipsises at the floor — a known limit, not a bug: the card carries NO `title` (flag 8, Liam 2026-08-20: the
 *  browser's tooltip fired mid-drag), so the full name is in the card's tap/hover detail and its aria-label. */
export const FAMILY_NAME_PX = 26
/** ⚖ 10/7 S25 round 3 (D5: NARROW = the family name ONLY) — the family name of a card's display name: the text before
 *  the first whitespace (a half-width space or the full-width 「　」; JS `\s` covers U+3000), trimmed. The card's name
 *  line splits on it so the MID and NARROW tiers can print the family name alone (round 2B measured the whole line, full name +
 *  room tag, ellipsising to one kanji at the floor). A name with no space returns the whole name; at the floor it
 *  ellipsises as the last resort, like any 3+-kanji family name. */
export function familyNameOf(displayName: string): string {
  const name = displayName.trim()
  const cut = name.search(/\s/)
  return cut < 0 ? name : name.slice(0, cut)
}
export const CARD_TIGHT_PAD_PX = 7
export const minPxPer30 = FAMILY_NAME_PX + CARD_TIGHT_PAD_PX

/** ⚖ 10/7 S25-2 (D5) + the lead's ruling, round 2 item 4 — LABEL TIERS by a card's drawn width (duration × px per
 *  hour / 60), at the card's own type. The four boundaries, low to high:
 *  · SLIVER below LABEL_TIER_PX.sliver = one character (FAMILY_NAME_PX / 2 = 13, 1 em) + CARD_TIGHT_PAD_PX 7 = 20 px:
 *    the coloured bar only; the full text stays in the card's hover/tap detail.
 *  · NARROW from 20 px: the family name only, tight padding; from the floor (minPxPer30 33) a two-kanji name is whole.
 *  THE LINES STACK (`.biz .event strong` / `small` are display: block, one line each), so a tier needs the WIDEST
 *  of its lines, not the sum of them (round 2B, the lead's D-3 ruling).
 *  · MID from LABEL_TIER_PX.mid = the width that fits the wider of the name and time lines = max(FAMILY_NAME_PX 26,
 *    CARD_TIME_PX 46) + CARD_TIGHT_PAD_PX 7 = 53 px: the FAMILY NAME · HH:MM〜 (no given name, no room tag), tight
 *    padding, the menu/price line dropped (a 60-minute card at the floor, 66 px, keeps its time line). MID prints the
 *    family name because any fixed boundary would chop some full names (⚖ round 4: a chopped name never beats a whole
 *    shorter one; round 3's full name 「渡辺 さやか」 67 px ellipsised in the 66 px card's 59 px), so 53 is true for what
 *    MID prints. CARD_TIME_PX = 「07:00〜」
 *    at `.e-time` (11.5px; no rule sets a weight on `.biz .event small`, so the inherited 400) measured 45.34 px in the
 *    same run (500: 46.22 · 600: 47.36 · 700: 48.89) → 46. Round 1's 37.70 was Chromium's default font, not the stack.
 *  · WIDE from LABEL_TIER_PX.wide = the WIDEST of the three lines at TODAY's padding (CARD_PAD_PX 18 = 10 + 6 +
 *    border 1 + 1). Measured on the real page (round 2B, the practice gym, headless Chromium 148, `.e-tkt` 11.5px /
 *    400): the menu/price line is the widest — 「単発 ¥11,000」 / 「単発 ¥13,750」 76.63 px (「単発 ¥6,600」 68.89),
 *    wider than the time line (45.34) and the longest sample full name (「木村 沙也加」 69.34 at 13px / 700) — so
 *    CARD_MENU_PX = 77 and WIDE = max(26, 46, 77) + 18 = 95 px: today's full card (the full name + the room tag + the
 *    menu/price line; the given name joins at WIDE only), the widest measured line whole. A longer menu
 *    line still ellipsises (the last resort).
 *  today.css mirrors these as @container rules in content-box px (px − CARD_PAD_PX: 77 · 35 · 2), pinned by test. */
export const CARD_TIME_PX = 46
export const CARD_PAD_PX = 18
export const CARD_MENU_PX = 77
export const LABEL_TIER_PX = {
  sliver: FAMILY_NAME_PX / 2 + CARD_TIGHT_PAD_PX,
  mid: Math.max(FAMILY_NAME_PX, CARD_TIME_PX) + CARD_TIGHT_PAD_PX,
  wide: Math.max(FAMILY_NAME_PX, CARD_TIME_PX, CARD_MENU_PX) + CARD_PAD_PX,
} as const
/** The offers' own padding + border (`.cell-price` / `.cell-packed` / `.cell-gapfill` 5 + 5; `.cell-held` 4 + 4 +
 *  border 1 + 1): today.css's offer @container rule measures the content box, so SLIVER there is below
 *  LABEL_TIER_PX.sliver − OFFER_PAD_PX = 10 px. */
export const OFFER_PAD_PX = 10
export type LabelTier = 'wide' | 'mid' | 'narrow' | 'sliver'
export function labelTier(px: number): LabelTier {
  return px < LABEL_TIER_PX.sliver ? 'sliver' : px < LABEL_TIER_PX.mid ? 'narrow' : px < LABEL_TIER_PX.wide ? 'mid' : 'wide'
}

/** The cells of the board's day on its grid unit — the strip's cell count (the CSS floor multiplies `floorSlots`). */
export function boardCells(day: Hours, stepMin: number): number {
  return stepMin > 0 && day.close > day.open ? Math.ceil((day.close - day.open) / stepMin) : 0
}

/** The minutes one `minPxPer30` floor covers (its name's 30): the floor's time unit, never the store's grid step. */
const FLOOR_SLOT_MIN = 30
/** S25-15 (2) — the floor is a time density — 33 px per 30 minutes of the day whatever the grid step; the strip's
 *  cells stay `boardCells` on the step. The CSS floor's multiplier (`--floor-slots`, today.css) and `trackOverflows`. */
export function floorSlots(day: Hours): number {
  return day.close > day.open ? Math.ceil((day.close - day.open) / FLOOR_SLOT_MIN) : 0
}

/** Whether a track `trackPx` wide must scroll sideways to keep the day at the floor (the CSS min-width's arithmetic). */
export function trackOverflows(day: Hours, trackPx: number): boolean {
  return trackPx < floorSlots(day) * minPxPer30
}

/** The ruler's word for an hour: the bare number, and 翌 + the hour for one past midnight (D2). */
export const hourText = (h: number): string => (h >= HOURS_PER_DAY ? `翌${h - HOURS_PER_DAY}` : String(h))

/** ⚖ 10/7 S25-2 (the lead's ruling, round 2 item 2) — A MIDNIGHT CLOSE READS 「24」: the closing EDGE of a day that closes
 *  at exactly 24:00 is labelled 24, the way the settings room prints a midnight close (特別営業日's 「24:00閉店」 and its
 *  read-only 24:00 box, SettingsScreen.tsx:2778; store-days-state.ts:92); 翌N starts only PAST it (25:00 → 翌1), for a
 *  day that truly crosses midnight. A fractional close prints its HH:MM. The edge tick's word only — an hour COLUMN at
 *  24 inside a day that runs on (a bar 18–26) is still 翌0 (`hourText`). */
export function edgeText(closeMin: number): string {
  if (closeMin % HOUR_MIN !== 0) return hhmm(closeMin)
  const h = closeMin / HOUR_MIN
  return h === HOURS_PER_DAY ? String(h) : hourText(h)
}

/** ⚖ §v11 V11-15 P20 — the track's gridlines take the ruler's lead: the share of the axis (percent) before its first
 *  whole hour, so the lines start where the first label does. 0 on a whole-hour axis (nothing is added to the DOM). */
export function rulerLead(axis: Hours): number {
  const span = axis.close - axis.open
  return span > 0 ? ((Math.ceil(axis.open / 60) * 60 - axis.open) / span) * 100 : 0
}

/** place()'s inverse for the drag layer: a percent offset back to the minute it
 *  names. canon `minutesOf` (:3743) — rounded, because a card's percent is
 *  three decimals and 30-minute steps must land on whole minutes. */
export function minuteOf(x: number, hours: Hours): number {
  return Math.round(hours.open + (x / 100) * (hours.close - hours.open))
}

/** 店舗カテゴリー (F13 / E9h). Precedence is canon's legend order read as
 *  strongest-first: a VIP with a 回数券 is shown as VIP, and 新規 means no
 *  completed visit BEFORE today — a customer's first booking is still 新規 on
 *  the day of it. */
export function bookingCategory(customer: FixtureCustomer, priorVisits: number): BookingCategory {
  if (customer.vip) return 'vip'
  if ((customer.ticket_balance ?? 0) > 0) return 'ticket'
  return priorVisits > 0 ? 'repeat' : 'new'
}

/** The shift the staff member is actually available for, once today's absence
 *  is applied. Breaks that fall entirely past the cut go with it — a break in
 *  hours nobody is working is not a break. */
export function effectiveShift(shift: FixtureShift, absence: FixtureAbsence | null): FixtureShift {
  if (!absence || absence.staff_id !== shift.staff_id || absence.from >= shift.end) return shift
  const end = Math.max(shift.start, absence.from)
  return {
    ...shift,
    end,
    breaks: shift.breaks.filter((b) => b.start < end).map((b) => ({ start: b.start, end: Math.min(b.end, end) })),
  }
}

/** 清掃 windows on one resource: the turnaround after each booking, cut short
 *  by whatever comes next on the same bed and by closing time. A zero-length
 *  result is dropped rather than drawn — the bed genuinely has no gap there,
 *  and a 0-minute cleanup block is the impossible state, not the honest one. */
export function cleanupBlocks(
  bookings: Array<{ id: string; start: number; end: number }>,
  cleanupMinutes: number,
  hours: Hours,
): Array<{ id: string; start: number; end: number }> {
  const sorted = [...bookings].sort((a, b) => a.start - b.start)
  const out: Array<{ id: string; start: number; end: number }> = []
  for (let i = 0; i < sorted.length; i += 1) {
    const next = sorted[i + 1]
    const ceiling = Math.min(next ? next.start : hours.close, hours.close)
    const end = Math.min(sorted[i].end + cleanupMinutes, ceiling)
    if (end > sorted[i].end) out.push({ id: `${sorted[i].id}-cleanup`, start: sorted[i].end, end })
  }
  return out
}

/** 稼働率（施術スタッフ）— booked minutes over available minutes, counting only
 *  staff who can actually take a treatment (a receptionist is not idle
 *  capacity) and only the minutes they are on shift and not on a break. The
 *  absence has already shortened the denominator via `effectiveShift`. */
export function utilization(
  lanes: Array<{ bookedMinutes: number; availableMinutes: number; treats: boolean }>,
): { booked: number; available: number; percent: number } {
  const treating = lanes.filter((l) => l.treats)
  const booked = treating.reduce((n, l) => n + l.bookedMinutes, 0)
  const available = treating.reduce((n, l) => n + l.availableMinutes, 0)
  return {
    booked,
    available,
    percent: available === 0 ? 0 : Math.round((booked / available) * 1000) / 10,
  }
}

/** The minutes a shift leaves for treatment: length minus its breaks. */
export function availableMinutes(shift: FixtureShift): number {
  return shift.breaks.reduce((n, b) => n - Math.max(b.end - b.start, 0), Math.max(shift.end - shift.start, 0))
}

/** The money band (C1–C3) and the revenue KPI (K2), summed from the same rows
 *  the cards render. A 来店なし produced no service, so it is out of the day's
 *  total — canon's own formula, and the reason its no-show is excluded there
 *  but still counted in 本日の予約件数. */
/** Did this booking become a VISIT that earned? A cancellation never happened
 *  and a 来店なし produced no service — canon's own formula for what is inside
 *  the day's money. Exported because 売上分析 sums the same rows into the same
 *  day, and two spellings of one predicate is how the board's 本日の売上 and the
 *  日報's 本日 row would drift apart. */
export function isEarningVisit(booking: Pick<FixtureAppointment, 'status' | 'board_state'>): boolean {
  return booking.status !== 'cancelled' && booking.board_state !== 'noshow'
}

/**
 * 顧客の店舗所属 — WHERE a customer belongs, derived from where she books.
 *
 * Customers carry no `store_id` (CM-9: real ones do not either), so every
 * screen that has to decide whether a customer-shaped row belongs to the store
 * being viewed answers it the same way: her MOST RECENT booking's store. This
 * used to be spelled inline inside 売上分析's `ticketLiability`; 受信トレイ needs
 * the same answer for a thread that has no booking behind it yet, and two
 * spellings of one affiliation is exactly the class the A8 rule forbids — so it
 * moved here, beside every other truth both rooms borrow.
 *
 * The rows handed in are already store-CLAMPED by `listAppointments(lens)`, so
 * under a branch lens this returns "the most recent booking she made HERE" and
 * a customer who has never booked here is simply absent from the map. That is
 * the isolation the callers want (hide, never show-and-refuse) and it is why no
 * caller needs an unclamped read to get it.
 */
export function customerStoreAffiliation(bookings: FixtureAppointment[]): Map<string, string> {
  const affiliation = new Map<string, string>()
  for (const a of [...bookings].sort((x, y) => y.starts_at.localeCompare(x.starts_at))) {
    if (a.store_id && !affiliation.has(a.customer_id)) affiliation.set(a.customer_id, a.store_id)
  }
  return affiliation
}

export function dayTotals(
  bookings: FixtureAppointment[],
  refunds: number,
): { total: number; settled: number; awaiting: number; revenue: number; count: number } {
  const live = bookings.filter((b) => b.status !== 'cancelled')
  const earning = live.filter(isEarningVisit)
  return {
    total: earning.reduce((n, b) => n + (b.booked_price ?? 0), 0),
    settled: live.filter((b) => b.settlement === 'settled').length,
    awaiting: live.filter((b) => b.settlement === 'awaiting').length,
    revenue:
      live.filter((b) => b.settlement === 'settled').reduce((n, b) => n + (b.booked_price ?? 0), 0) - refunds,
    // 本日の予約件数 counts every status the day actually held, no-shows
    // included — the day had that many appointments, whatever came of them.
    count: live.length,
  }
}

/** A booking is suppressed from its staff lane when it starts after that staff
 *  member stopped working. It is not hidden: it is the thing 次に決めること is
 *  about, and the decision card carries it. */
export function suppressedByAbsence(
  booking: { staff_id: string | null; startMinute: number },
  absence: FixtureAbsence | null,
): boolean {
  return absence != null && booking.staff_id === absence.staff_id && booking.startMinute >= absence.from
}

/** あと入る数 — HOW MANY STANDARD-LENGTH COURSES ONE DAY STILL HOLDS.
 *
 *  ⚖ Liam 2026-09-12 「I choose B」. The month calendar used to divide the day's
 *  leftover minutes by 60 (`freeSlots`, deleted with this round): three separate
 *  30-minute gaps read as 「空き1」 and sent a receptionist to book an hour that
 *  exists nowhere on that day. A course needs its minutes CONTIGUOUS, so the
 *  count is asked per staff lane, over the free pockets the engine already
 *  computes for スキマガード (`freePockets`) packed with the engine's own
 *  `kPackCount` — never a second pocket formula written here.
 *
 *  `now: null` ON EVERY DAY, TODAY INCLUDED. This is a whole-day count, the same
 *  question 稼働率 asks of the same day; subtracting the morning that has already
 *  gone would answer a second question at the same time (a rider, not this).
 *
 *  ⚠ A BOOKING WITH NO 担当 sits on nobody's lane and will still consume
 *  someone's day, so it is SUBTRACTED rather than ignored. Deliberately
 *  conservative: a calendar that overstates sends a receptionist to sell a slot
 *  that is not there, and understating by a course is the cheaper error.
 *
 *  稼働率 is NOT this number and is untouched — it is a ratio of minutes. What
 *  the two share is the INPUT (roster · shifts · 勤務不可 · bookings), which is
 *  where the one-home rule lives; a shared FORMULA is what they never had. */
export function coursesFitForDay(input: {
  staff: readonly { id: string }[]
  shifts: readonly FixtureShift[]
  qualifications: Record<string, string[] | undefined>
  absence: FixtureAbsence | null
  /** 開店. Paired with `close` below so every lane's pockets are clamped to
   *  the store's own day — see that comment for why. */
  open: number
  /** 閉店. The count never advertises a course the store is shut for: it is
   *  clamped to the store's own day the same way the placement rail (~:105)
   *  already refuses to place one there — a calendar that disagrees with the
   *  rail sends a receptionist to a slot that is not there. `freePockets`
   *  still reads this value on its own, to name a pocket's right-hand wall:
   *  the store's own close, or just this person's last workable minute.
   *  ⚠ NO QUOTED WALL NAMES IN THIS COMMENT. business-isolation.test.ts scans
   *  every Business file for the word `from` followed by a quoted string and
   *  reads the quote as an import specifier — prose included, because a block
   *  comment on one line is not a full-line comment to its stripper. The first
   *  spelling of this line named the two walls in quotes and planted a phantom
   *  package that failed the isolation lock. */
  close: number
  bookings: ReadonlyArray<{ staffId: string | null; start: number; end: number }>
  /** ⚖ FIX ROUND 3 (P1) — 予定ブロック (「準備」「記録」「レジ」「指名予約」…), the
   *  board's own 「予約不可」 cards (`kind: 'block'`). A block on a staff member
   *  IS occupied time on that member's lane, the same as a booking or a break —
   *  the board already refuses to place one there (`laneSpans()` counts every
   *  item whatever its `kind`), so a count that ignored them advertised a
   *  course the placement rail would refuse. A RESOURCE-ONLY block (`staffId`
   *  null — a bed-only 予定ブロック) is NOT lane occupancy: nobody's DAY is
   *  spent when a bed alone is blocked, so it is filtered out below and never
   *  subtracted the way an unassigned booking is. A block on a staff member
   *  with no shift that day (or outside her clamped window) changes nothing,
   *  same as a booking. */
  blocks: ReadonlyArray<{ staffId: string | null; start: number; end: number }>
  /** 標準セッション (`opsConfig.standardSessionMin`), the length being counted. */
  sessionMin: number
}): number {
  const { sessionMin } = input
  // A course with no length divides into nothing, so 0 is the honest answer.
  // NEVER NaN and never Infinity: both of those paint as a count on a cell.
  if (!(Number.isFinite(sessionMin) && sessionMin > 0)) return 0
  const shiftByStaff = new Map(input.shifts.map((s) => [s.staff_id, s]))
  let fits = 0
  for (const member of input.staff) {
    // A receptionist is not idle capacity — the same judgement, from the same
    // home (`treatsPatients`), that 稼働率 reads through `laneMinutes`.
    if (!treatsPatients(input.qualifications[member.id])) continue
    const shift = shiftByStaff.get(member.id)
    if (!shift) continue
    const eff = effectiveShift(shift, input.absence)
    // An absence that swallows the whole shift leaves no window to pocket.
    if (eff.end <= eff.start) continue
    const pockets = freePockets({
      // ⚖ D-C4 rider: 稼働率's own denominator (`shiftAvailableMinutes`) does
      // not clamp to 営業時間 either — same class of gap, deliberately left for
      // the reconnect round; this fix touches only the calendar's count.
      from: Math.max(eff.start, input.open),
      until: Math.min(eff.end, input.close),
      close: input.close,
      now: null,
      occupied: [
        ...eff.breaks.map((b) => ({ start: b.start, end: b.end, isBreak: true })),
        ...input.bookings.filter((b) => b.staffId === member.id),
        ...input.blocks.filter((b) => b.staffId === member.id),
      ],
    })
    for (const pocket of pockets) fits += kPackCount(pocket.s, pocket.e, sessionMin)
  }
  // ⚖ FIX ROUND 3 (P2) — an unassigned booking is on no lane and still eats
  // the day, but only for the part that actually lands inside 営業時間: an
  // assigned booking at that hour is already clamped by `freePockets` above,
  // and the unassigned rule must clip the same way or a night import (a
  // booking starting after close, say) paints the whole day 満.
  const unassigned = input.bookings
    .filter((b) => b.staffId === null)
    .reduce((n, b) => {
      const s = Math.max(b.start, input.open)
      const e = Math.min(b.end, input.close)
      return e <= s ? n : n + Math.ceil((e - s) / sessionMin)
    }, 0)
  return Math.max(0, fits - unassigned)
}

export function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

/** THE ONE MONEY FORMATTER, and it ROUNDS — canon's own `yen()` does
 *  (`"¥" + Math.round(n).toLocaleString("ja-JP")`) and the yen has no sub-unit,
 *  so ¥44,317.5 is not a smaller number, it is a broken one. Rounding lives
 *  here rather than at each caller because every derived figure that is an
 *  average (a 12か月平均 LTV, a money-weighted merge across two stores) reaches
 *  the screen through this function and would otherwise print a fraction from
 *  whichever seam nobody thought of. A caller that already holds an integer is
 *  unaffected.
 *
 *  IT IS ALSO SIGN-AWARE, IN CANON'S OWN SHAPE
 *  (fable-store-sales-register.html:1163-1166): the sign goes BEFORE the ¥ and
 *  it is the proper minus 「−」, never the ASCII hyphen `toLocaleString` buries
 *  inside the digits. 売上・レジ is the first room in the family whose figures go
 *  below zero (a 返金 line, a drawer counted short), and the family does not
 *  grow a second formatter for it: `¥-1,100` and `−¥1,100` are the same money in
 *  two spellings, and two spellings is how two rooms end up disagreeing about
 *  what a minus looks like.
 *
 *  `Math.abs` also normalises NEGATIVE ZERO, and it has to: a day with no
 *  refunds reaches this as `yen(-0)`, `-0 < 0` is false, and
 *  `(-0).toLocaleString('ja-JP')` is the string 「-0」 — so the tile would print
 *  「¥-0」. Both spellings of zero are pinned. */
export const yen = (n: number) => {
  const rounded = Math.round(n)
  return `${rounded < 0 ? '−' : ''}¥${Math.abs(rounded).toLocaleString('ja-JP')}`
}

// ── the board model ────────────────────────────────────────────────────────

export interface BoardItem {
  key: string
  kind: 'booking' | 'break' | 'absence' | 'block' | 'cleanup'
  state: 'confirmed' | 'attention' | 'hold' | 'noshow' | null
  category: BookingCategory | null
  /** ⚖ ROOM RULE (Liam 2026-09-05) — THIS BOOKING NEEDS THE PRIVATE ROOM, and
   *  it is a fact about the BOOKING, never about the customer. Every room reader
   *  asks this one field; `customer.vip` keeps the card colour, the chip and the
   *  保護対象 count and reaches no bed search at all. ABSENT on the items that
   *  are not bookings — a turnaround, a break or an absence has no room to need,
   *  the same reason `state` and `category` are null there — so every reader
   *  asks `=== true`. */
  requiresPrivateRoom?: boolean
  x: number
  w: number
  /** The same span in minutes. The board paints in percent, but the sell-layer
   *  derivation reasons in minutes, and inverting the percent back would fold a
   *  rounding error into every coursesFitForDay test. One value, both readings. */
  startMin: number
  endMin: number
  title: string
  /** 【ベッド2】 on a staff lane, 【見本 しろう】 on a resource lane, 【未定】
   *  when the booking has no resource — never a guess. */
  tag: string
  time: string
  ticketCat: string | null
  ticketCore: string | null
  /** 保持 — the price the booking was taken at survives a店都合 move. */
  held: boolean
  micro: boolean
  caseId: string | null
  label: string
}

export interface BoardLane {
  key: string
  group: 'staff' | 'beds'
  label: string
  sub: string
  absentNote: string | null
  mine: boolean
  items: BoardItem[]
  /** The window this lane can take work in today, after the absence has cut it
   *  — the sell layer's own bound and the 勤務時間内 check's. Null on a lane
   *  with no shift, and on resource lanes (a bed has no roster). */
  window: { from: number; until: number } | null
  /** canon's STAFF_UNTIL, as the clock string its check quotes. */
  untilLabel: string | null
  /** 定価 before the store's lever and the hour curve; 0 where the lane takes
   *  no treatments (reception) or is not a staff lane. */
  listPrice: number
  /** Which stores this lane belongs to. `null` = every store (a floating staff
   *  member). The sell layer will not pair a person with a bed outside their
   *  own stores — under viewAll that would advertise a window no store can
   *  actually run. */
  stores: string[] | null
  /** ⚖ Liam flag 51 — WHICH ROOMS ARE INTERCHANGEABLE, carried from the store's
   *  own resource row (`FixtureResource.room_class`). `null` on a staff lane: a
   *  person has no room class. The auto-allocator reads this and nothing else,
   *  so a bed renamed 「個室」 in its label does not silently change policy. */
  roomClass: RoomClass | null
}

/** ⚖ PR-3 — `AppointmentSource` (@synqed-kk/client dist/types.d.ts:448, six
 *  values) → the word staff read, ONE map (the Business string home). Business
 *  names no client path, so the union is restated here and pinned against the
 *  .d.ts by the suite. */
export type AppointmentSourceWord = 'MANUAL' | 'QUICKRESERVE' | 'SYNQED_RESERVE' | 'SALON_BOARD' | 'HOT_PEPPER' | 'OTHER'
export const SOURCE_WORD: Readonly<Record<AppointmentSourceWord, string>> = businessStrings.today.source

/** A source prints as its word; a value outside the six prints RAW — honest,
 *  never blank (switch OFF every fixture source is such a value, so it prints
 *  exactly as before). */
export function sourceWord(source: string): string {
  return Object.prototype.hasOwnProperty.call(SOURCE_WORD, source) ? SOURCE_WORD[source as AppointmentSourceWord] : source
}

/** The inspector's source line: the word, then the booking's own number — an
 *  empty number is omitted, never a dangling 「/」. */
export function sourceLine(source: string, displayNo: string): string {
  return displayNo ? `${sourceWord(source)} / ${displayNo}` : sourceWord(source)
}

/** ⚖ PR-3 — the decision card's title. With the card's live booking and its
 *  name: 「{name}様の…」; without one: the plain noun with ONE 様 — never
 *  「お客様様」. */
export function decisionTitle(kind: string, b: Pick<BoardBooking, 'customerName' | 'startMinute'> | undefined, slotStart: number | null): string {
  const t = businessStrings.today
  const name = b?.customerName
  if (kind === 'レジ') return name ? `${name}様の精算を完了する` : t.titleCheckout
  if (kind === 'Reserve販売') return `${slotStart == null ? '' : hhmm(slotStart)}の安全な1枠を販売する`
  // ⚖ §v3 V3-9 — the time and its space only when there is a booking: no leading space.
  const at = b ? `${hhmm(b.startMinute)} ` : ''
  if (kind === '担当不在') return at + (name ? `${name}様の担当不在に対応する` : t.titleAbsent)
  return at + (name ? `${name}様へ担当変更案を送る` : t.titleHandover)
}

export interface BoardBooking {
  id: string
  displayNo: string
  customerId: string
  customerName: string
  staffId: string | null
  staffName: string
  menuName: string
  resourceId: string | null
  resourceName: string
  startMinute: number
  endMinute: number
  timeRange: string
  price: number | null
  category: BookingCategory
  /** ⚖ ROOM RULE — the private-room requirement, straight off the appointment
   *  row. Core stamps it at CREATE from the menu's own room class and never
   *  re-derives it, so a staff member clearing it sticks and a menu edited later
   *  never retro-tags what is already booked. */
  requiresPrivateRoom: boolean
  state: 'confirmed' | 'attention' | 'hold' | 'noshow'
  settlement: 'settled' | 'awaiting' | null
  source: string
  reassignedFromName: string | null
  ticketBalance: number | null
  takenDaysAgo: number
  updatedMinute: number | null
  onBoard: boolean
}

/** ⚖ D-53 (ak)/(al) N2c-2 — the local pair Home B/C mint their sentences from;
 *  not exported (no test needs it), local so this file's import inventory
 *  stays what `foundation.test.ts` pins (the words table is never imported here). */
type BoardWords = { privateWord: string | null; turnoverWord: string | null }

export interface BuildInput {
  appointments: FixtureAppointment[]
  customers: FixtureCustomer[]
  menus: FixtureMenu[]
  staff: FixtureStaff[]
  resources: FixtureResource[]
  shifts: FixtureShift[]
  qualifications: Record<string, string[]>
  /** 定価 per staff member — the dynamic-pricing curve's input. */
  staffListPrice: Record<string, number>
  /** Which stores each staff member works in; `null` = floating. */
  staffStores: Record<string, string[] | null>
  absence: FixtureAbsence | null
  blocks: FixtureBlock[]
  sellSlots: FixtureSellSlot[]
  decisions: FixtureDecision[]
  /** The AXIS every item is placed on — the board's day (`boardDay`). */
  hours: Hours
  /** ⚖ §v11 V11-15(b) — the store's OWN hours, for the wash edges that mean 開店/閉店. Absent = `hours`. */
  businessHours?: Hours
  /** The day being shown, as a JST day index (clock.jstDayKey). */
  dayKey: number
  operatorStaffId: string
  storeNames: Map<string, string>
  /** true = viewAll; a clamped lens must not label lanes with a store name. */
  crossStore: boolean
  /** ⚖ D-53 (ak)/(al) N2c-2 — the store's own words for the two sentences
   *  this file composes (Home B's card label, Home C's cleanup row). */
  wordsByStore: Record<string, BoardWords>
  genericWords: BoardWords
}

/** ⚖ ONE WORD, ONE HOME. 顧客's lifecycle chip renders the SAME label off the
 *  SAME `bookingCategory`, so the word a customer is described by has exactly
 *  one source (a NAMED shared-seam touch, S14 §3.3). */
export const CATEGORY_LABEL: Record<BookingCategory, string> = {
  new: '新規',
  repeat: '再来',
  ticket: '回数券',
  vip: 'VIP',
}

/** 予約の色分け — ONE HOME for the four category colours, the closed palette and the per-store resolver:
 *  `./booking-colors` (import-free, so the practice door's writer checks a save against the same palette
 *  without reaching the fixtures — ⚖ PKT-S38 R2). page.tsx reads the business's colour keys (one
 *  `booking_colors:<storeId>` per store, the legacy `booking_colors` map as a fallback — ⚖ PKT-S41) and hands
 *  each store's result to TodayScreen; 設定's save writes the store's own key.
 *  Re-exported here so every existing import keeps its path. */
export { BOOKING_COLOR_DEFAULTS, BOOKING_PALETTE, bookingColorsFor, type BookingColors } from './booking-colors'
/** The ONE lookup the board paints with (TodayScreen's `catVar` wraps it in `--cat`): `map` = page.tsx's
 *  per-store map, a store with no entry takes `''`'s. No category / no entry / an unknown category → undefined. */
export function bookingColorHex(map: Record<string, BookingColors>, store: string | null | undefined, cat: string | null | undefined): string | undefined {
  if (!cat) return undefined
  const colors = map[store ?? ''] ?? map['']
  return colors !== undefined && Object.prototype.hasOwnProperty.call(colors, cat) ? colors[cat as BookingCategory] : undefined
}

/** Every booking on the day, with the joins the board needs and its category
 *  resolved. `onBoard` is the absence rule; the row itself always exists. */
export function dayBookings(input: BuildInput): BoardBooking[] {
  const customerById = new Map(input.customers.map((c) => [c.id, c]))
  const menuById = new Map(input.menus.map((m) => [m.id, m]))
  const staffById = new Map(input.staff.map((s) => [s.id, s]))
  const resourceById = new Map(input.resources.map((r) => [r.id, r]))

  // Visits BEFORE the day being shown — what makes a customer 新規 or 再来.
  const priorVisits = new Map<string, number>()
  for (const a of input.appointments) {
    if (a.status !== 'done' || jstDayKey(a.starts_at) >= input.dayKey) continue
    priorVisits.set(a.customer_id, (priorVisits.get(a.customer_id) ?? 0) + 1)
  }

  return input.appointments
    .filter((a) => jstDayKey(a.starts_at) === input.dayKey && a.board_state !== null)
    .map((a) => {
      const customer = customerById.get(a.customer_id)
      const startMinute = jstMinuteOfDay(a.starts_at)
      const endMinute = jstMinuteOfDay(a.ends_at)
      const resource = a.resource_id ? resourceById.get(a.resource_id) : undefined
      return {
        id: a.id,
        displayNo: a.display_no,
        customerId: a.customer_id,
        customerName: customer?.name ?? '顧客未登録',
        staffId: a.staff_id,
        staffName: a.staff_id ? (staffById.get(a.staff_id)?.full_name ?? '担当未定') : '担当未定',
        menuName: a.menu_id ? (menuById.get(a.menu_id)?.name ?? 'メニュー未設定') : 'メニュー未設定',
        resourceId: a.resource_id,
        resourceName: resource?.name ?? '未定',
        startMinute,
        endMinute,
        timeRange: `${hhmm(startMinute)}–${hhmm(endMinute)}`,
        price: a.booked_price,
        category: customer
          ? bookingCategory(customer, priorVisits.get(a.customer_id) ?? 0)
          : 'repeat',
        requiresPrivateRoom: a.requires_private_room === true,
        state: a.board_state!,
        settlement: a.settlement,
        source: a.source,
        reassignedFromName: a.reassigned_from
          ? (staffById.get(a.reassigned_from)?.full_name ?? '担当未定')
          : null,
        ticketBalance: customer?.ticket_balance ?? null,
        takenDaysAgo: a.taken_days_ago,
        updatedMinute: a.updated_minute,
        onBoard: !suppressedByAbsence({ staff_id: a.staff_id, startMinute }, input.absence),
      }
    })
    .sort((a, b) => a.startMinute - b.startMinute)
}

/** The ticket/price chip canon puts on every card (F12): the category word,
 *  then the fact that matters for that category. A 回数券 booking shows what is
 *  left, never a price it does not charge. */
function chip(b: BoardBooking): { cat: string | null; core: string | null } {
  if (b.category === 'ticket') return { cat: '回数券', core: b.ticketBalance == null ? '残数未記録' : `残り${b.ticketBalance}回` }
  if (b.category === 'vip') return { cat: 'VIP', core: '月額' }
  if (b.category === 'new') return { cat: null, core: b.price == null ? '新規 価格未記録' : `新規 ${yen(b.price)}` }
  return { cat: '単発', core: b.price == null ? '価格未記録' : yen(b.price) }
}

function bookingItem(b: BoardBooking, hours: Hours, tag: string, keySuffix: string, privateWord: string): BoardItem {
  const c = chip(b)
  return {
    key: `${b.id}-${keySuffix}`,
    kind: 'booking',
    state: b.state,
    category: b.category,
    requiresPrivateRoom: b.requiresPrivateRoom,
    ...place(b.startMinute, b.endMinute, hours),
    title: b.customerName,
    tag: `【${tag}】`,
    time: `${hhmm(b.startMinute)}〜`,
    ticketCat: c.cat,
    ticketCore: c.core,
    held: b.reassignedFromName != null,
    micro: false,
    caseId: b.id,
    // ⚖ FIX ROUND 1 (blind lens 3 F5) — THE TAG JOINS THE ACCESSIBLE NAME. The
    // badge was the only surface carrying it and it is the one surface a
    // keyboard or screen-reader operator never gets: they were refused by a fact
    // the board had never told them. It rides INSIDE the category segment, so
    // the five-segment skeleton `today-interactions`' room re-label depends on
    // (`parts.length === 5`) is untouched.
    label: `${b.timeRange} ${b.customerName}様 / ${b.requiresPrivateRoom ? `${privateWord}のみ・` : ''}${CATEGORY_LABEL[b.category]} / ${b.staffName} / ${b.resourceName} / ${STATE_LABEL[b.state]}`,
  }
}

export const STATE_LABEL: Record<NonNullable<BoardBooking['state']>, string> = {
  confirmed: '確定・施術',
  attention: '要対応',
  hold: '仮押さえ',
  noshow: '来店なし',
}

/** Staff lanes then resource lanes, in canon's two groups. Every item of the seven builders passes ONE gate: a box
 *  `place()` gives no width is not drawn (⚖ §v11 V11-15(d)) — EXCEPT a booking, which is always drawn (amendment B1:
 *  a zero-width card still shows as the card's minimum sliver, as it does today; nothing hidden). */
export function buildLanes(input: BuildInput, bookings: BoardBooking[]): BoardLane[] {
  const { hours, absence } = input
  const biz = input.businessHours ?? hours
  const shiftByStaff = new Map(input.shifts.map((s) => [s.staff_id, s]))
  const lanes: BoardLane[] = []
  const drawn = (items: BoardItem[]) => items.filter((i) => i.kind === 'booking' || i.w > 0)

  // ⚖ D-53 (ak)/(al) N2c-2 R-2 — Home B: the booking's own room word, resolved
  // ONCE per booking so the staff-lane copy and the resource-lane copy of one
  // card read the SAME sentence — one card, one description. The booking's
  // resource's store wins (the room the booking actually occupies); a
  // no-unit booking falls to its staff's first store; no store at all falls
  // to the generic row.
  const privateWordFor = (b: BoardBooking): string => {
    const resourceStoreId = b.resourceId ? input.resources.find((r) => r.id === b.resourceId)?.store_id : undefined
    const staffStoreId = b.staffId ? input.staffStores[b.staffId]?.[0] : undefined
    const storeId = resourceStoreId ?? staffStoreId
    return input.wordsByStore[storeId ?? '']?.privateWord ?? input.genericWords.privateWord!
  }

  for (const member of input.staff) {
    const raw = shiftByStaff.get(member.id) ?? null
    const shift = raw ? effectiveShift(raw, absence) : null
    const quals = input.qualifications[member.id] ?? []
    const mine = bookings.filter((b) => b.staffId === member.id)
    const items: BoardItem[] = []

    for (const b of mine) {
      if (!b.onBoard) continue
      items.push(bookingItem(b, hours, b.resourceName, 'staff', privateWordFor(b)))
    }
    for (const br of raw?.breaks ?? []) {
      items.push({
        key: `${member.id}-break-${br.start}`,
        kind: 'break', state: null, category: null,
        ...place(br.start, br.end, hours),
        title: '休憩', tag: '', time: `${hhmm(br.start)}〜${hhmm(br.end)}`,
        ticketCat: null, ticketCore: null, held: false, micro: false, caseId: null,
        label: `${member.full_name}、${hhmm(br.start)}から${hhmm(br.end)}、休憩`,
      })
    }
    for (const blk of input.blocks.filter((x) => x.staff_id === member.id)) {
      items.push({
        key: blk.id,
        kind: 'block', state: null, category: null,
        ...place(blk.start, blk.end, hours),
        title: blk.kind, tag: '', time: `${hhmm(blk.start)}〜${hhmm(blk.end)}`,
        ticketCat: null, ticketCore: null, held: false, micro: blk.micro, caseId: null,
        label: `${member.full_name}、${hhmm(blk.start)}から${hhmm(blk.end)}、${blk.kind}・予約不可`,
      })
    }
    if (absence && absence.staff_id === member.id) {
      items.push({
        key: `${member.id}-absence`,
        kind: 'absence', state: null, category: null,
        ...place(absence.from, biz.close, hours),
        title: '勤務不可', tag: '', time: `${hhmm(absence.from)}〜閉店`,
        ticketCat: null, ticketCore: null, held: false, micro: false, caseId: null,
        label: `${member.full_name}、${hhmm(absence.from)}以降 勤務不可`,
      })
    }
    // The hours OUTSIDE the shift are painted too (canon's 終業 block). Without
    // them a lane whose shift ends at 17:00 looks bookable until closing, and
    // the board's whole job is to show what can and cannot be placed. The
    // absence already paints its own tail, so it is not drawn twice.
    //
    // These are `absence`, not `block`: canon builds them out of the SAME hatch
    // grammar as 勤務不可 (fable-store-today.html renderShiftEndBounds — "reuses
    // the SAME hatch grammar .event.absence already uses for 勤務不可"), so they
    // read as the red "there is no shop floor here" wash, never the beige 予定
    // ブロック card. The kind also carries canon's interaction: a shift-derived
    // wash is a role="note" nobody can open, so it must not raise ブロック情報.
    // Occupancy is unaffected — laneSpans() reads every item whatever its kind.
    const offShift: Array<{ title: string; from: number; to: number; time: string; label: string }> = shift
      ? [
          ...(shift.start > biz.open
            ? [
                {
                  title: '勤務前', from: biz.open, to: shift.start,
                  time: `開店〜${hhmm(shift.start)}`,
                  label: `${member.full_name}、${hhmm(shift.start)}開始のため、それより前は予約不可`,
                },
              ]
            : []),
          ...(shift.end < biz.close && !(absence && absence.staff_id === member.id)
            ? [
                {
                  title: '終業', from: shift.end, to: biz.close,
                  time: `${hhmm(shift.end)}〜閉店`,
                  label: `${member.full_name}、${hhmm(shift.end)}以降、終業のため予約不可`,
                },
              ]
            : []),
        ]
      : [
          // ponytail: canon's fixture is fully staffed, so it has no no-shift lane
          // and no wording to copy. Built's own sentence stays; only the paint moves.
          {
            title: '本日勤務なし', from: biz.open, to: biz.close,
            time: `${hhmm(biz.open)}〜${hhmm(biz.close)}`,
            label: `${member.full_name}、${hhmm(biz.open)}から${hhmm(biz.close)}、本日勤務なし・予約不可`,
          },
        ]
    for (const off of offShift) {
      items.push({
        key: `${member.id}-off-${off.from}`,
        kind: 'absence', state: null, category: null,
        ...place(off.from, off.to, hours),
        title: off.title, tag: '', time: off.time,
        ticketCat: null, ticketCore: null, held: false, micro: false, caseId: null,
        label: off.label,
      })
    }

    lanes.push({
      key: member.id,
      group: 'staff',
      label: member.full_name,
      sub: shift
        ? `${quals.join('・') || '資格未登録'} / ${hhmm(shift.end)}まで`
        : '本日シフトなし',
      absentNote: absence && absence.staff_id === member.id ? `${hhmm(absence.from)}以降 勤務不可` : null,
      mine: member.id === input.operatorStaffId,
      items: drawn(items).sort((a, b) => a.x - b.x),
      window: shift ? { from: shift.start, until: shift.end } : null,
      untilLabel: shift ? hhmm(shift.end) : null,
      listPrice: input.staffListPrice[member.id] ?? 0,
      stores: input.staffStores[member.id] ?? null,
      roomClass: null,
    })
  }

  for (const resource of input.resources) {
    const on = bookings.filter((b) => b.resourceId === resource.id && b.onBoard)
    const items: BoardItem[] = on.map((b) => bookingItem(b, hours, b.staffName, 'bed', privateWordFor(b)))
    // ⚖ D-53 (ak)/(al) N2c-2 R-3 — Home C: resolved ONCE per resource, the
    // same store lookup Home B uses.
    const t = input.wordsByStore[resource.store_id]?.turnoverWord ?? input.genericWords.turnoverWord!
    // ⚖ §v11 V11-15 fix round 1 (P15) — a turnover is cut by the STORE's closing time, never by the axis.
    for (const c of cleanupBlocks(
      on.map((b) => ({ id: b.id, start: b.startMinute, end: b.endMinute })),
      resource.cleanup_minutes,
      biz,
    )) {
      items.push({
        key: c.id,
        kind: 'cleanup', state: null, category: null,
        ...place(c.start, c.end, hours),
        title: t, tag: '', time: `${hhmm(c.start)}〜`,
        ticketCat: null, ticketCore: null, held: false, micro: c.end - c.start <= 20, caseId: null,
        label: `${resource.name}、${hhmm(c.start)}から${hhmm(c.end)}、${t}・予約不可`,
      })
    }
    for (const blk of input.blocks.filter((x) => x.resource_id === resource.id)) {
      items.push({
        key: blk.id,
        kind: 'block', state: null, category: null,
        ...place(blk.start, blk.end, hours),
        title: blk.kind, tag: '', time: `${hhmm(blk.start)}〜${hhmm(blk.end)}`,
        ticketCat: null, ticketCore: null, held: false, micro: blk.micro, caseId: null,
        label: `${resource.name}、${hhmm(blk.start)}から${hhmm(blk.end)}、${blk.kind}・予約不可`,
      })
    }
    lanes.push({
      key: resource.id,
      group: 'beds',
      label: resource.name,
      // Under viewAll the store has to be on the label or two 「ベッド1」 rows
      // read as one bed; under a clamped lens no other store's name may appear.
      sub: input.crossStore
        ? `${resource.note} / ${input.storeNames.get(resource.store_id) ?? '店舗未設定'}`
        : resource.note,
      absentNote: null,
      mine: false,
      items: drawn(items).sort((a, b) => a.x - b.x),
      window: null,
      untilLabel: null,
      listPrice: 0,
      stores: [resource.store_id],
      roomClass: resource.room_class,
    })
  }

  return lanes
}

/** Does this roster member take treatments? The 稼働率 denominator asks it (a
 *  receptionist is not idle capacity) and so does 売上分析's staff ranking (a
 *  receptionist is never a candidate in a treatment-revenue ranking). ONE
 *  judgement, one home — reading it off 資格 in two places is how the board and
 *  the analytics room would end up disagreeing about who treats. */
export function treatsPatients(qualifications: string[] | undefined): boolean {
  return (qualifications ?? []).some((q) => q !== '受付' && q !== '会計')
}

/** The minutes ONE member's shift leaves for treatment on a day, after the
 *  day's 勤務不可 has shortened it. Zero when they are not on that roster.
 *
 *  One home for the term, so every per-day reading of a shift — the lane sums
 *  behind 稼働率, and the roster sum below — comes from one place. */
export function shiftAvailableMinutes(shift: FixtureShift | undefined, absence: FixtureAbsence | null): number {
  return shift ? availableMinutes(effectiveShift(shift, absence)) : 0
}

/** The 勤務不可 that shortens day K's roster: the door's answer FOR K, and
 *  nothing else. A day the door holds no incident for has none.
 *
 *  ONE HOME, and deliberately blind to which day is on screen. It used to read
 *  `dayKey === shownKey ? planes.absence : null` over the single plane
 *  `readDayPlanes` returns, and that made a calendar number depend on where the
 *  operator was STANDING: the door only hands the incident back when the day it
 *  was asked about is today, so viewing ANY other day left today's own cell
 *  computed from the full roster and advertising 空き it does not have. The
 *  absence now comes from `listAbsenceByDay`, which answers per day, so the
 *  shown day cannot enter this arithmetic at all. */
export function absenceForDay(
  dayKey: number,
  byDay: ReadonlyMap<number, FixtureAbsence | null>,
): FixtureAbsence | null {
  return byDay.get(dayKey) ?? null
}

/** ⚖ FIX ROUND 3 (P1) — the 予定ブロック that occupy day K's lanes: the door's
 *  answer FOR K, and nothing else — same one-home discipline as `absenceForDay`
 *  right above it. A day the door holds no block for has none, honestly.
 *  Returned already in `coursesFitForDay`'s own occupancy shape, so the
 *  caller hands the result straight through. */
export function blocksForDay(
  dayKey: number,
  byDay: ReadonlyMap<number, FixtureBlock[]>,
): ReadonlyArray<{ staffId: string | null; start: number; end: number }> {
  return (byDay.get(dayKey) ?? []).map((b) => ({ staffId: b.staff_id, start: b.start, end: b.end }))
}

/* ⚰ `rosterAvailableMinutes` LIVED HERE and was deleted 2026-09-12 (fix round 1).
 * It was #890's calendar denominator: the treatment minutes one day's roster
 * leaves, which the month divided by 60. ⚖ Liam 「I choose B」 replaced that
 * division with `coursesFitForDay` above, and the helper was left with no
 * product caller at all — only a test suite keeping it warm. Same ruling as
 * `freeSlots` in the same round: a formula nothing paints is a second formula
 * waiting to disagree with the one that does. A future reader wanting a day's
 * roster minutes should compose `shiftAvailableMinutes` (which 稼働率 already
 * reads through `laneMinutes`) rather than re-mint this.
 */

/** Per-lane minute sums — behind 稼働率 only now. The calendar's あと入る数
 *  count is `coursesFitForDay`'s own pocket-packing, not this sum: see that
 *  function's docblock — the two share the INPUT, never a FORMULA. */
export function laneMinutes(input: BuildInput, bookings: BoardBooking[]) {
  const shiftByStaff = new Map(input.shifts.map((s) => [s.staff_id, s]))
  return input.staff.map((member) => ({
    staffId: member.id,
    treats: treatsPatients(input.qualifications[member.id]),
    availableMinutes: shiftAvailableMinutes(shiftByStaff.get(member.id), input.absence),
    bookedMinutes: bookings
      .filter((b) => b.staffId === member.id && b.state !== 'noshow')
      .reduce((n, b) => n + (b.endMinute - b.startMinute), 0),
  }))
}

/** The count that has to be the same number in four places: the nav badge, the
 *  未解決 cell, the 次に決めること cell, and the cards on the board. Only
 *  `open` decisions count — the list dialog keeps the rest as history, exactly
 *  as canon's own guardrail says. */
export function openDecisions(decisions: FixtureDecision[]): FixtureDecision[] {
  return decisions.filter((d) => d.state === 'open')
}
