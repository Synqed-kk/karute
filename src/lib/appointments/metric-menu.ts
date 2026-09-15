// The pure cell logic for the week rows' grid and the day-numbers line
// (spec §8, packet W3). NO React here — WeekRows.tsx / DayNumbersLine.tsx
// render whatever these functions return.
import type { WeekDayRowData } from '@/lib/adapters/reservation'
import { BOOKING_SWITCHES } from './booking-switches'
import { formatHoursMinutes, type Translate } from './format-duration'

/** PKT-2 supplies 'new'|'returning' from the business type; until then every
 *  caller passes 'off'. */
export type TypeSlot = 'new' | 'returning' | 'off'

export type CellKey =
  | 'count'
  | 'utilization'
  | 'free'
  | 'bookedTime'
  | 'new'
  | 'returning'
  | 'cancelled'
  | 'noShow'
  | 'unset'

export type CellTone = 'ink' | 'band-low' | 'band-mid' | 'band-high' | 'new' | 'muted'

export interface Cell {
  key: CellKey
  label: string
  value: string
  tone: CellTone
}

export interface MetricMenuCtx {
  soloMode: boolean
  typeSlot: TypeSlot
  t: Translate
}

// ---------------------------------------------------------------------------
// Individual metric cells (no branching — one metric, one rendering).
// ---------------------------------------------------------------------------

/** R3-5 — the 予約 count carries its unit INSIDE the value, because the day
 *  line prints no label for it (mock: 「11件」, no word). JA's 「{n}件」 says
 *  what it counts on its own; EN's grid template 「{n}」 does not, and on the
 *  line it rendered as a naked "11". So the two surfaces read different value
 *  keys: the GRID cell keeps `countValue` next to its own 予約 / Bookings
 *  label, the LINE takes `countLine`, which carries the unit in every locale
 *  (JA byte-identical to countValue, EN 「{n} bookings」). */
function countCell(
  row: WeekDayRowData,
  ctx: MetricMenuCtx,
  valueKey: 'countValue' | 'countLine',
): Cell {
  return { key: 'count', label: ctx.t('count'), value: ctx.t(valueKey, { n: row.count }), tone: 'ink' }
}

function bookedTimeCell(row: WeekDayRowData, ctx: MetricMenuCtx): Cell {
  return {
    key: 'bookedTime',
    label: ctx.t('bookedTime'),
    value: formatHoursMinutes(row.bookedMinutes, ctx.t),
    tone: 'ink',
  }
}

function freeCell(row: WeekDayRowData, ctx: MetricMenuCtx): Cell {
  const free = Math.max(0, row.availableMinutes - row.bookedMinutes)
  return { key: 'free', label: ctx.t('free'), value: formatHoursMinutes(free, ctx.t), tone: 'ink' }
}

function newCell(row: WeekDayRowData, ctx: MetricMenuCtx): Cell {
  // People, not 件 (LEAD RULING, spec §3/§12) — bare number, never string-
  // concatenated with a unit.
  return { key: 'new', label: ctx.t('new'), value: String(row.newCustomerCount), tone: 'new' }
}

function returningCell(row: WeekDayRowData, ctx: MetricMenuCtx): Cell {
  return { key: 'returning', label: ctx.t('returning'), value: String(row.returningCount), tone: 'ink' }
}

function cancelledCell(row: WeekDayRowData, ctx: MetricMenuCtx): Cell {
  return { key: 'cancelled', label: ctx.t('cancelled'), value: String(row.cancelledCount), tone: 'ink' }
}

function noShowCell(row: WeekDayRowData, ctx: MetricMenuCtx): Cell {
  return { key: 'noShow', label: ctx.t('noShow'), value: String(row.noShowDayCount), tone: 'ink' }
}

function unsetCell(ctx: MetricMenuCtx): Cell {
  // Heading position unchanged, only the value swaps (native pass 1: 「見出し
  // ＋値の位置は変えず、値だけを差し替え」) — label stays 稼働, value = 未設定.
  return { key: 'unset', label: ctx.t('utilization'), value: ctx.t('unset'), tone: 'muted' }
}

/** <35 low · 35–65 mid · >65 high (spec §2/§3). */
function bandTone(pct: number): 'band-low' | 'band-mid' | 'band-high' {
  if (pct < 35) return 'band-low'
  if (pct <= 65) return 'band-mid'
  return 'band-high'
}

const NEXT_BUILDERS: Record<string, (row: WeekDayRowData, ctx: MetricMenuCtx) => Cell> = {
  bookedTime: bookedTimeCell,
  cancelled: cancelledCell,
  noShow: noShowCell,
  new: newCell,
  returning: returningCell,
}

/** The shared fallback order (spec §8's "Metric menu + fill order"): 予約時間
 *  · キャンセル · 無断 · (再来 if typeSlot is 'new' else 新規 — only when
 *  typeSlot isn't 'off', since 'off' shows no PKT-2 slot at all). */
function nextMetricChain(typeSlot: TypeSlot): CellKey[] {
  const base: CellKey[] = ['bookedTime', 'cancelled', 'noShow']
  if (typeSlot === 'off') return base
  return [...base, typeSlot === 'new' ? 'returning' : 'new']
}

/** The first metric in the fill order not already on the line. Shared by
 *  every slot that falls back — 稼働 (when not 未設定-eligible) and 空き
 *  (when its own 予約時間 fallback is already taken) both route through
 *  here, which is what keeps a line from ever repeating a cell. */
function pickNext(row: WeekDayRowData, ctx: MetricMenuCtx, used: Set<CellKey>): Cell {
  for (const key of nextMetricChain(ctx.typeSlot)) {
    if (used.has(key)) continue
    // ⚖ R2-1 (lead, 2026-09-15), re-worded under R3-2 — the rule is about the
    // NUMBERS, not the labels: a percentage and the minutes it was computed
    // from never share a line. `utilization` divides the day's booked minutes
    // by its available ones; `bookedTime` prints those same booked minutes.
    // A line carrying both spent a cell saying nothing new, so when 稼働% is on
    // it the fill order skips that duration and takes キャンセル → 無断 → the
    // type's other people-count (PKT-2). The labels moved from 稼働時間 to
    // 予約時間 in R3-2 and the rule did not move with them.
    // 未設定 is NOT 稼働%: it prints no number, so its key is 'unset' and the
    // duration still follows it. Both surfaces route through here, which is
    // why this is the only guard.
    if (key === 'bookedTime' && used.has('utilization')) continue
    return NEXT_BUILDERS[key](row, ctx)
  }
  // Cannot happen with 8 metrics on a 4-cell line — pinned by a test, not
  // silently swallowed.
  throw new Error('metric menu ran dry — should be unreachable with 8 metrics')
}

/** ⚖ R3-1 (lead, 2026-09-15) — ONE predicate, read by BOTH capacity slots.
 *  稼働% and 空き are the same saved capacity wearing two dresses: either the
 *  day's capacity is worth showing or it is not, and that has to be decided
 *  ONCE. It was decided twice, and the two answers disagreed the moment a day
 *  ran over its capacity: 稼働 saw pct > 100, called the day indefensible and
 *  fell through to 予約時間, while 空き still read `capacityDefensible` alone
 *  and printed 空き 0分 — two durations on one line, one of them stranded in
 *  the 100 px column (the repo's own 700/480 fixture; the R2-1 "at most one
 *  duration" comment below was false for exactly that branch).
 *
 *  Spec §14: over capacity is NOT defensible, so the overrun belongs in the
 *  predicate, not in a percentage guard downstream of it. `availableMinutes >
 *  0` stays a conjunct — it is what makes the percentage divisible at all,
 *  and a 0-capacity day has no 空き to report either. */
function capacityShown(row: WeekDayRowData): boolean {
  return (
    row.capacityDefensible &&
    row.availableMinutes > 0 &&
    row.bookedMinutes <= row.availableMinutes
  )
}

/** ⚖ S3b (PKT-1c-B) — 未設定 reads the FACT, not a guess about the store.
 *
 *  未設定 says exactly one thing: 「this day's hours are not set — set them and
 *  a number appears here」. That promise is only honest when hours are the ONLY
 *  thing missing, which used to be approximated by `soloMode && !hoursSaved`:
 *  it read 未設定 to a solo store whose roster was unreadable (where saving
 *  hours changes nothing), and withheld it from a multi-staff store whose only
 *  gap was its hours (where saving them is the whole fix).
 *
 *  The capacity module answers it directly. It checks lane kind → roster →
 *  hours IN THAT ORDER, so an hours reason PROVES the store is not class-bound
 *  and its roster was known. 'hours-not-saved' = the day fell to the
 *  10:00–24:00 default; 'hours-unresolved' = no hours reached this day at all.
 *  A closed day carries its own reason and is never 未設定 (⚖ 休 is a fact,
 *  not a missing setting), and a null reason — an older server across a bundle
 *  skew — falls through to the next metric rather than inventing one. */
function unsetShown(row: WeekDayRowData): boolean {
  return row.capacityReason === 'hours-not-saved' || row.capacityReason === 'hours-unresolved'
}

/** 稼働: the defensible percentage → 未設定 (hours are the only thing missing)
 *  → next unused metric. */
function utilizationSlot(row: WeekDayRowData, ctx: MetricMenuCtx, used: Set<CellKey>): Cell {
  if (capacityShown(row)) {
    const pct = Math.round((row.bookedMinutes / row.availableMinutes) * 100)
    return { key: 'utilization', label: ctx.t('utilization'), value: `${pct}%`, tone: bandTone(pct) }
  }
  if (unsetShown(row)) return unsetCell(ctx)
  return pickNext(row, ctx, used)
}

/** 空き when the switch is ON and the SAME predicate 稼働 used says yes, else
 *  its own designated fallback 予約時間 — which itself routes through the
 *  shared fill order if 予約時間 is already taken (never a repeat). */
function freeOrBookedTimeSlot(row: WeekDayRowData, ctx: MetricMenuCtx, used: Set<CellKey>): Cell {
  if (BOOKING_SWITCHES.freeTimeCell && capacityShown(row)) {
    return freeCell(row, ctx)
  }
  return pickNext(row, ctx, used)
}

/** A closed day WITH bookings still shows its numbers (⚖ lead ruling) — only
 *  a truly empty closed day collapses to 「休」. */
export function isClosedRow(row: WeekDayRowData): boolean {
  return row.closed && row.count === 0 && BOOKING_SWITCHES.closedDays
}

/** A duration value — 予約時間 / 空き, both `H時間M分`. The only cells whose
 *  value is long enough to matter to the grid below. */
function isDuration(cell: Cell): boolean {
  return cell.key === 'bookedTime' || cell.key === 'free'
}

/** The week grid is `130px 100px` (WeekRows.tsx `.wkgrid`, R2-2) and fills
 *  row-major, so cells 1+3 sit in the WIDE column and cells 2+4 in the narrow
 *  one. A duration does not fit 100 px: on a store whose capacity is not
 *  defensible — every store today, Dev Salon included — the fill order put
 *  「予約時間 6時間30分」 in cell 2 and its text overflowed its box (D10).
 *
 *  So, as the LAST step of the week row only: 予約 keeps cell 1, and a
 *  duration takes the one movable wide slot (cell 3) from a non-duration. The
 *  SET is untouched — only positions move. Since R2-1 a line carries AT MOST
 *  ONE duration (稼働% and 予約時間 are one measure), so the one movable wide
 *  slot is always enough and no duration is ever left narrow.
 *
 *  The DAY LINE is NOT re-placed: it is one flowing line with no columns. */
function placeForGrid(cells: Cell[]): Cell[] {
  if (isDuration(cells[2])) return cells
  const narrow = [1, 3].find((i) => isDuration(cells[i]))
  if (narrow === undefined) return cells
  const out = [...cells]
  out[2] = cells[narrow]
  out[narrow] = cells[2]
  return out
}

/** Exactly 4 cells, week-row grid order, after `placeForGrid`:
 *  'new' → [予約, 稼働, 空き|予約時間, 新規] · 'returning' → [予約, 再来,
 *  予約時間, キャンセル] · 'off' → [予約, 稼働, 空き|予約時間, next]. */
export function weekRowCells(row: WeekDayRowData, ctx: MetricMenuCtx): Cell[] {
  const used = new Set<CellKey>()
  const take = (cell: Cell): Cell => {
    used.add(cell.key)
    return cell
  }

  if (ctx.typeSlot === 'returning') {
    return placeForGrid([
      take(countCell(row, ctx, 'countValue')),
      take(returningCell(row, ctx)),
      take(bookedTimeCell(row, ctx)),
      take(cancelledCell(row, ctx)),
    ])
  }

  const count = take(countCell(row, ctx, 'countValue'))
  const utilization = take(utilizationSlot(row, ctx, used))
  const freeOrBooked = take(freeOrBookedTimeSlot(row, ctx, used))
  const fourth = ctx.typeSlot === 'new' ? take(newCell(row, ctx)) : take(pickNext(row, ctx, used))
  return placeForGrid([count, utilization, freeOrBooked, fourth])
}

/** Exactly 4 cells, day-line order:
 *  'new' → [予約, 新規, 稼働, 空き|予約時間] · 'returning' → [予約, 再来,
 *  予約時間, キャンセル] · 'off' → [予約, 稼働, 空き|予約時間, next]. */
export function dayLineCells(row: WeekDayRowData, ctx: MetricMenuCtx): Cell[] {
  const used = new Set<CellKey>()
  const take = (cell: Cell): Cell => {
    used.add(cell.key)
    return cell
  }

  if (ctx.typeSlot === 'returning') {
    return [
      take(countCell(row, ctx, 'countLine')),
      take(returningCell(row, ctx)),
      take(bookedTimeCell(row, ctx)),
      take(cancelledCell(row, ctx)),
    ]
  }

  const count = take(countCell(row, ctx, 'countLine'))
  if (ctx.typeSlot === 'new') {
    const newC = take(newCell(row, ctx))
    const utilization = take(utilizationSlot(row, ctx, used))
    const freeOrBooked = take(freeOrBookedTimeSlot(row, ctx, used))
    return [count, newC, utilization, freeOrBooked]
  }

  const utilization = take(utilizationSlot(row, ctx, used))
  const freeOrBooked = take(freeOrBookedTimeSlot(row, ctx, used))
  const fourth = take(pickNext(row, ctx, used))
  return [count, utilization, freeOrBooked, fourth]
}
