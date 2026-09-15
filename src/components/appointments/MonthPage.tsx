'use client'

// The 月 page's own month line + calendar grid (spec §4, packet PKT-1b-month
// A1-A3) — the app-local replacement for @synqed-kk/ui's MonthGrid ON THE PAGE.
// Ported rule for rule from DATE-JUMP-PICKER-MOCK.html's `.dayline.monthline`,
// `.cal.pagecal`, `.cell` and `.legend` block (mock lines 134-142, 182-218).
//
// The pop-down panel keeps rendering through the package grid — it is approved
// and byte-frozen — so the two calendars deliberately do NOT share a component.
// What they DO share is the band colour (DENSITY_DOT_CLASS) and every string.
//
// Three things the package grid cannot do, which is why this file exists:
//   1. a SELECTED day (it has today, and nothing else),
//   2. a 休 cell,
//   3. day numbers that are right under a UTC runtime — the package reads
//      `cell.date.getDate()`, the runtime's local day; every number here comes
//      off `cell.id`, which is already the JST calendar day.
import { useTranslations } from 'next-intl'
import type { MonthDensityBucket } from '@synqed-kk/ui'
import { cn } from '@/lib/utils'
import { formatCompactDateJst, jstWallTimeToDate, partsInJst } from '@/lib/date/jst'
import type { MonthCell } from '@/lib/adapters/reservation'
import { BOOKING_SWITCHES } from '@/lib/appointments/booking-switches'
import { isClosedRow, type TypeSlot } from '@/lib/appointments/metric-menu'
import { DENSITY_DOT_CLASS, LinePill, VALUE_TONE_CLASS } from './WeekRows'
import { NewSpark } from './NewSpark'

interface MonthPageProps {
  cells: MonthCell[]
  /** The day the page is on, YYYY-MM-DD — the ring. */
  selectedDateIso: string
  /** Today in JST, YYYY-MM-DD. Absent → each cell's own `isToday`, which the
   *  server stamped (a bundle that sat through midnight would keep yesterday). */
  todayIso?: string
  /** Mon-first localized weekday headers — the SAME array the pop-down feeds
   *  the package grid, so the two calendars cannot label their columns
   *  differently. */
  weekdayLabels: [string, string, string, string, string, string, string]
  /** PKT-2 supplies 'new' | 'returning' from the business type; until then
   *  'off' and the month line is 予約 alone. */
  typeSlot: TypeSlot
  /** The people-count behind `typeSlot`. Null = no honest number yet, so the
   *  item is ABSENT — the month line is a LINE, not a grid of cells, and a
   *  substitute metric in that slot would be a different question answered in
   *  the same place. */
  typeCount?: number | null
  locale: string
  /** 先月同期間比 in 件: this month so far minus the same elapsed span of the
   *  month before. Null = no honest number (a future month, a truncated read,
   *  no base to compare with) and the clause is ABSENT — never a 0, never a
   *  dash. screen.ts owns the arithmetic (month-compare.ts). */
  monthCompareDelta?: number | null
  /** The router transition. The numbers on screen still describe the month
   *  being navigated AWAY from, so the line shows the mock's two shims
   *  (mock `monthLineInner`'s own pending branch) rather than a stale total. */
  pending?: boolean
  /** The window could not be read in full. Then the whole page says so — no
   *  grid numbers, no month line — exactly as the week does (spec §4). */
  failed?: boolean
  onPickDay: (dateIso: string) => void
  /** A LEADING/TRAILING cell's day. Its month is not this page's, so the page
   *  moves to that month with that day selected (the mock's own behaviour,
   *  R1-2) — a different destination from `onPickDay`, which opens a day. */
  onPickOtherMonthDay: (dateIso: string) => void
}

/** The dot's band, through ONE door. Named for the CELL it colours, not for
 *  the band: `metric-menu` has a module-private `bandTone(pct)` that answers a
 *  different question (a 稼働 percentage), and one word for two questions is a
 *  grep that lies (D-7).
 *
 *  `band` is the per-store 「混雑」 threshold (⚖ Liam 9/15 11:1x) and is NOT on
 *  the wire yet — 1c-B adds it, and this `??` is the whole seam it needs. The
 *  colours come from the week rows' map, never a second one. */
export function cellTone(cell: {
  density: MonthDensityBucket
  band?: MonthDensityBucket
}): string | null {
  return DENSITY_DOT_CLASS[cell.band ?? cell.density]
}

/** 予約 N件 for the month = the counted bookings of the days that BELONG to it.
 *  The adapter already zeroes an out-of-month cell's count; this filter is what
 *  keeps that true if it ever stops being. */
export function monthBookingTotal(cells: readonly MonthCell[]): number {
  return cells.reduce((sum, c) => (c.inMonth ? sum + c.count : sum), 0)
}

/** JST weekday index of a YYYY-MM-DD day (0 = Sunday), read the way WeekRows
 *  reads it — never `new Date(iso).getDay()`, which is the runtime's. */
function weekdayIndex(dateIso: string): number {
  return partsInJst(jstWallTimeToDate(dateIso, '00:00')).weekday
}

/** The day number, off the JST calendar day rather than a Date's local one. */
function dayNumber(dateIso: string): number {
  return Number(dateIso.slice(8, 10))
}

/** The comparison's sign, as the mock spells it: a plus, a typographic MINUS
 *  (U+2212, never a hyphen — a hyphen is not read aloud and would make ahead
 *  and behind announce identically) and 「±0」 for level, the same glyph the
 *  今月消化 delta already uses for level. */
function deltaSign(delta: number): string {
  return delta > 0 ? '+' : delta < 0 ? '−' : '±'
}

// mock `.dayline .it{display:inline-flex;align-items:baseline;gap:4px;
// color:var(--sub);font-weight:600}` with its `<b>` ink and tabular.
//
// LABEL FIRST on this line — 「予約 234件」, 「新規 80」 — the grammar the line's
// own first item already had (native pass 2 row C-2: the mock's 「80新規」 put
// one item's words in the opposite order to its neighbours on the same line).
// The spark stays glued to the NUMBER it decorates.
function LineItem({
  label,
  value,
  tone,
  spark,
}: {
  label: string
  value: string
  tone: keyof typeof VALUE_TONE_CLASS
  spark?: boolean
}) {
  return (
    <span className="inline-flex items-baseline gap-1 font-semibold text-zinc-500 dark:text-zinc-400">
      {label}
      <span className={cn('inline-flex items-baseline gap-[3px]', VALUE_TONE_CLASS[tone])}>
        {spark && <NewSpark className="shrink-0 self-center" />}
        {/* ⚖ TYPE (Liam 23:4x) — the month line's numbers are 600, not 700. */}
        <b className="font-semibold tabular-nums">{value}</b>
      </span>
    </span>
  )
}

export function MonthPage({
  cells,
  selectedDateIso,
  todayIso,
  weekdayLabels,
  typeSlot,
  typeCount = null,
  monthCompareDelta = null,
  locale,
  pending,
  failed,
  onPickDay,
  onPickOtherMonthDay,
}: MonthPageProps) {
  const t = useTranslations('reservation.weekRows')
  const tMonth = useTranslations('reservation.month')
  const tJump = useTranslations('reservation.dateJump')

  if (failed) {
    // The same line, the same role and the same words the week page uses: one
    // failed read, one sentence, wherever it happened.
    return (
      <p role="alert" className="text-xs text-[var(--color-text-muted)]">
        {t('failed')}
      </p>
    )
  }

  return (
    <div>
      {BOOKING_SWITCHES.monthLine && (
        // mock `.dayline.monthline`: flex · gap 14 · padding 2px 0 ·
        // margin 0 0 8px · 14px (13.5px ≤400px) · nowrap · no separators.
        // min-height is the loaded line's own block height, so the shims cannot
        // shrink it and drop the grid card by their difference (R3-18).
        <div
          data-month-line
          className="mb-2 flex min-h-[calc(1.25em+0.25rem)] items-center gap-[14px] whitespace-nowrap py-0.5 text-[14px] leading-[1.25] max-[400px]:text-[13.5px]"
        >
          {pending ? (
            <>
              <LinePill />
              <LinePill />
            </>
          ) : (
            <>
              <LineItem
                label={t('count')}
                value={t('countValue', { n: monthBookingTotal(cells) })}
                tone="ink"
              />
              {typeSlot !== 'off' && typeCount !== null && (
                <>
                  {/* The 14 px gap is the only thing separating these items,
                   *  and a screen reader does not read CSS gaps: the line came
                   *  out as one run-on string, 「予約6件新規80」. The app's own
                   *  idiom for speaking a row of these cells is 「、」 — the
                   *  week rows join theirs with `ariaSep`, and `rowAria` puts
                   *  the same mark after the date. `sr-only` is out of flow,
                   *  so it takes no slot in the flex row and the visible line
                   *  stays byte-identical. */}
                  <span className="sr-only">{t('ariaSep')}</span>
                  <LineItem
                    label={t(typeSlot === 'new' ? 'new' : 'returning')}
                    value={String(typeCount)}
                    tone={typeSlot === 'new' ? 'new' : 'ink'}
                    spark={typeSlot === 'new'}
                  />
                </>
              )}
              {/* 先月同期間比 — the mock's own last item on this line, with the
               *  app's established term for the concept (the 今月消化 strip's
               *  `burnDeltaAria*` already says 先月同期間比; the mock's 前月同期
               *  would have been a second word for one thing).
               *
               *  It is an ANNOTATION, not an alarm (spec §v10): ahead takes the
               *  少なめ green, behind and level take the mute grey, and NOTHING
               *  here is ever red — red means 無断/warnings in this product, and
               *  a quiet month is not a fault. Same colour rule the 今月消化
               *  delta follows, one product, one convention.
               *
               *  The sign is part of the number, not a decoration: + / − / ± read
               *  aloud, which is why this clause needs no hidden twin the way
               *  the strip's ▲▼ glyphs do. */}
              {BOOKING_SWITCHES.monthCompare && monthCompareDelta !== null && (
                <>
                  {/* Spoken as 「予約6件、先月同期間比+12件」 — two facts, the
                   *  app's own 「、」, no pixel moved. See the note above. */}
                  <span className="sr-only">{t('ariaSep')}</span>
                  <LineItem
                    label={t('lastMonthSamePeriod')}
                    value={`${deltaSign(monthCompareDelta)}${t('countValue', {
                      n: Math.abs(monthCompareDelta),
                    })}`}
                    tone={monthCompareDelta > 0 ? 'band-low' : 'muted'}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* mock `.cal{border:1px solid var(--line);border-radius:16px;
       *  overflow:hidden}` — byte-identical to `.listcard`, so the grid card
       *  and the week/day list card are the same card in the app's own tokens
       *  (WeekRows' chrome, verbatim). */}
      <div
        data-month-grid
        className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      >
        {/* mock `.pagecal .calhead span{height:26px;padding:0;font-size:12px}`
         *  + `.calhead{border-bottom:1px solid var(--hair)}`. 土 accent, 日 red
         *  — the week rows' own two colours. */}
        <div className="grid grid-cols-7 border-b border-zinc-200/70 dark:border-zinc-800">
          {weekdayLabels.map((label, i) => (
            <div
              key={label}
              className={cn(
                // ⚖ TYPE (Liam 23:4x) — a 12 px LABEL is medium, not bold.
                'flex h-[26px] items-center justify-center text-[12px] font-medium',
                i === 5
                  ? 'text-primary'
                  : i === 6
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-zinc-500 dark:text-zinc-400',
              )}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const number = dayNumber(cell.id)
            // mock `.cell.out`: a muted filler that is STILL A DAY you can tap
            // — `cellsHTML` gives every cell its `data-go`, and the delegated
            // handler makes no `out` check (MOCK 976, 1325-1329), so a trailing
            // 「1」 moves the page to the next month with that day selected.
            // R1-2 (D-1): 4a built these inert off the packet's sentence; the
            // mock is the order. Muted stays muted — the tap is the only thing
            // they gain, and it goes through onPickOtherMonthDay, never
            // onPickDay: the destination is a different MONTH, not a day page.
            //
            // The name is the DATE alone, which already carries the month
            // (「8/31(月)」): the count behind an out-of-month cell is zeroed by
            // the adapter, so 「予約 0件」 would be a claim about a day this
            // month's read never counted.
            if (!cell.inMonth) {
              return (
                <button
                  key={cell.id}
                  type="button"
                  data-month-cell
                  data-out
                  onClick={() => onPickOtherMonthDay(cell.id)}
                  aria-label={formatCompactDateJst(jstWallTimeToDate(cell.id, '00:00'), locale)}
                  className={cn(
                    MONTH_CELL,
                    'bg-[var(--color-bg-muted)]/40',
                    // The same one-property, named-curve transition the
                    // in-month cells carry (D-9) — one cell vocabulary.
                    'transition-[background-color] duration-[120ms] ease-[ease]',
                    'hover:bg-[var(--color-bg-card-hover)] active:bg-[var(--color-bg-card-hover)]',
                    'motion-reduce:transition-none',
                    'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                    '[&:nth-child(7n)]:border-r-0',
                  )}
                >
                  {/* R2-3 (LENS-1 #3 · LENS-3 #1) — this number is a control's
                   *  label now (R1-2 made these cells tappable), so it has to
                   *  clear 4.5:1 on the muted wash (~#fbfbfb light, #18181b
                   *  dark) it sits on. Measured: light zinc-300 1.42:1 → fail;
                   *  zinc-500 4.66:1 → pass. Dark zinc-600 2.29:1 → fail;
                   *  zinc-500 3.67:1 → STILL fails 4.5:1, so dark steps up one
                   *  further than light, to zinc-400 6.91:1 → pass. */}
                  <span
                    className={cn(DAY_NUMBER, 'font-medium text-zinc-500 dark:text-zinc-400')}
                  >
                    {number}
                  </span>
                  <span className={COUNT_ROW} />
                </button>
              )
            }

            const isToday = todayIso ? cell.id === todayIso : cell.isToday
            const isSelected = cell.id === selectedDateIso
            const wd = weekdayIndex(cell.id)
            // ⚖ lead ruling (spec §8): 休 replaces the count ONLY on a closed
            // day with nothing booked. A closed day that HAS bookings shows
            // them — a 休 mark over real bookings is the worst cell on the page.
            const closed = isClosedRow(cell)
            const dot = closed ? null : cellTone(cell)
            const dateLabel = formatCompactDateJst(jstWallTimeToDate(cell.id, '00:00'), locale)

            return (
              <button
                key={cell.id}
                type="button"
                data-month-cell
                onClick={() => onPickDay(cell.id)}
                // The name says the DAY and its number — 「9/16(水) 予約 3件」 —
                // built from the same strings the cell prints, so the two
                // cannot drift (the week row's R3-6 lesson).
                aria-label={t('rowAria', {
                  date: dateLabel,
                  cells: closed ? t('closed') : `${t('count')} ${t('countValue', { n: cell.count })}`,
                })}
                // R2-2 (LENS-1 #2) — `aria-current="date"` means "this IS
                // today", so it belongs on TODAY's cell, never the selection.
                // The selection is a pressed state on a button: `aria-pressed`.
                // A day that is both keeps both — the two facts are not the
                // same fact.
                aria-current={isToday ? 'date' : undefined}
                aria-pressed={isSelected ? 'true' : undefined}
                className={cn(
                  MONTH_CELL,
                  // mock `.cell{transition:background-color .12s ease}` — the
                  // page grid's cells carry NO press scale in the mock (only
                  // the rows and the door do), so neither do these.
                  //
                  // The curve is NAMED, and it is the mock's own plain `ease`
                  // (DateJumpPanel's level crossfade ported the same one the
                  // same way, R4). Unnamed, it would inherit Tailwind's default
                  // `cubic-bezier(.4,0,.2,1)` — an ease-in-out, which is
                  // exactly the defect R3-16 caught on the chip's chevron.
                  // `transition-[background-color]`, not `transition-colors`:
                  // the background is the only colour these states change, and
                  // the shorthand would quietly carry the day number's colour
                  // with it the day a state touches that too.
                  'transition-[background-color] duration-[120ms] ease-[ease]',
                  'hover:bg-[var(--color-bg-card-hover)] active:bg-[var(--color-bg-card-hover)]',
                  'motion-reduce:transition-none',
                  'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                  '[&:nth-child(7n)]:border-r-0',
                )}
              >
                {/* mock `.pagecal .cell .n{font-size:14px;width:24px;height:24px}`
                 *  · today = solid accent circle, white text
                 *  · selected = `box-shadow:inset 0 0 0 1.8px var(--blue)`,
                 *    accent text, NO fill — the two marks must never read as
                 *    one, which is why the ring is hollow. */}
                <span
                  className={cn(
                    DAY_NUMBER,
                    isToday
                      // ⚖ TYPE (Liam 23:4x) — the day number is 600 in every
                      // state; the solid fill and the hollow ring are what say
                      // today and selected, not a heavier weight.
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : isSelected
                        ? 'font-semibold text-primary ring-[1.8px] ring-inset ring-primary'
                        : wd === 6
                          ? 'font-semibold text-primary'
                          : wd === 0
                            ? 'font-semibold text-red-600 dark:text-red-400'
                            : 'font-semibold text-[var(--color-text)]',
                  )}
                >
                  {number}
                </span>
                {/* mock `.pagecal .cell .c{font-size:10.5px;gap:2px}` with a
                 *  6 px dot; `min-height:14px` keeps a countless day the same
                 *  height as its neighbours. */}
                <span className={COUNT_ROW}>
                  {closed ? (
                    // mock `.cell .c .rest{color:var(--mute);font-weight:600}`
                    <span className="font-medium text-[var(--color-text-muted)]">
                      {t('closed')}
                    </span>
                  ) : (
                    cell.count > 0 && (
                      <>
                        {dot && (
                          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dot)} />
                        )}
                        {/* ⚖ TYPE (Liam 23:4x) — the 10.5 px count is medium. */}
                        <span className="font-medium tabular-nums">{cell.count}</span>
                      </>
                    )
                  )}
                </span>
              </button>
            )
          })}
        </div>

        {/* mock `.legend` + `.pagecal .legend{padding:5px 10px;font-size:11.5px}`
         *  — ONE compact line. The three words are the pop-down's own keys, and
         *  the caption is the pop-down's own string: the two calendars explain
         *  their dots with the same sentence or one of them is wrong.
         *
         *  The joiner before the caption is the app's half-width 「·」 (the
         *  stat-line separator), not the mock's 「／」: in this app 「／」
         *  enumerates alternatives (LINE／SMS／メール) and never joins two
         *  independent clauses (native pass 2 row F). Between the three words
         *  there is no character at all — each carries its own dot, as the mock
         *  draws them. */}
        {/* ⚖ TYPE (Liam 23:4x) — the 11.5 px legend is medium. */}
        <div className="flex flex-wrap items-center gap-3 px-2.5 py-[5px] text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">
          <span className="flex items-center gap-[5px]">
            <LegendDot bucket="light" />
            {tMonth('legendLight')}
          </span>
          <span className="flex items-center gap-[5px]">
            <LegendDot bucket="medium" />
            {tMonth('legendMedium')}
          </span>
          <span className="flex items-center gap-[5px]">
            <LegendDot bucket="busy" />
            {tMonth('legendBusy')}
          </span>
          <span aria-hidden className="text-[var(--color-border-strong)]">
            {t('sep')}
          </span>
          <span>{tJump('legendCount')}</span>
        </div>
      </div>
    </div>
  )
}

// mock `.cell{height:46px;border-right/bottom:1px solid var(--hair);
// display:flex;flex-direction:column;align-items:center;padding-top:4px;
// gap:2px}` — the last column drops its right border at the call sites above
// (`:nth-child(7n)`), and the card's own `overflow-hidden` trims the last row's
// bottom hairline against the legend, exactly as the mock's does.
const MONTH_CELL =
  'flex h-[46px] flex-col items-center gap-0.5 border-b border-r border-zinc-200/70 pt-1 dark:border-zinc-800'

// mock `.pagecal .cell .n{font-size:14px;width:24px;height:24px;
// border-radius:999px}`
const DAY_NUMBER =
  'flex size-6 items-center justify-center rounded-full text-[14px] leading-none tabular-nums'

// mock `.cell .c{min-height:14px;gap:2px}` + `.pagecal .cell .c{font-size:10.5px}`
const COUNT_ROW =
  'flex min-h-[14px] items-center gap-0.5 text-[10.5px] leading-none text-zinc-600 dark:text-zinc-400'

/** mock `.legend i{width:8px;height:8px}` — the band's own colour, from the
 *  one map. */
function LegendDot({ bucket }: { bucket: MonthDensityBucket }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DENSITY_DOT_CLASS[bucket])} />
}
