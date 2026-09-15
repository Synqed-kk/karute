'use client'

// The week page's seven-row component (spec §3, packet W4 + PKT-1b-WIRE W-A)
// — the app-local replacement for @synqed-kk/ui's WeekDayCard, ported rule
// for rule from DATE-JUMP-PICKER-MOCK.html's `.wksum` / `.wkrow` / `.wkdate` /
// `.wkgrid` / `.wkcell` / `.wkchev` block (mock lines 144-179).
// The `data-week-*` markers exist so the port itself is testable: every one of
// those CSS rules is pinned by a named test, not left to a screenshot.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCompactDateJst, jstWallTimeToDate, partsInJst } from '@/lib/date/jst'
import type { WeekDayRowData } from '@/lib/adapters/reservation'
import { isClosedRow, weekRowCells, type Cell, type TypeSlot } from '@/lib/appointments/metric-menu'

interface WeekRowsProps {
  rows: WeekDayRowData[]
  /** Kept for prop-shape parity with the wiring PR's call site — this
   *  component derives every displayed date from each row's own `dateIso`
   *  (spec §3: "the range from the first/last row's dateIso"), never from
   *  weekStart + offset arithmetic. */
  weekStartIso: string
  selectedDateIso: string
  todayIso?: string
  soloMode: boolean
  typeSlot: TypeSlot
  locale: string
  pending?: boolean
  failed?: boolean
  onPickDay: (dateIso: string) => void
}

// R3-15's press doors. `currentTarget` is the row the listener is on, so a
// pointer that leaves mid-press clears that row and no other.
function pressOn(e: ReactPointerEvent<HTMLButtonElement>) {
  e.currentTarget.setAttribute('data-pressed', '')
}
function pressOff(e: ReactPointerEvent<HTMLButtonElement>) {
  e.currentTarget.removeAttribute('data-pressed')
}

function weekdayIndex(dateIso: string): number {
  return partsInJst(jstWallTimeToDate(dateIso, '00:00')).weekday
}

function shortMonthDay(dateIso: string): string {
  const p = partsInJst(jstWallTimeToDate(dateIso, '00:00'))
  return `${p.month}/${p.day}`
}

/** The app's ONE fixed density table (mirrors reservation.ts's private
 *  densityFor / @synqed-kk/ui's MonthDensityBucket thresholds — not
 *  exported, so reproduced here; pinned equal by a test). null = no dot. */
export function densityDotClass(count: number): string | null {
  if (count === 0) return null
  if (count <= 2) return 'bg-[var(--color-success)]'
  if (count <= 5) return 'bg-[var(--color-accent)]'
  return 'bg-[var(--color-warning)]'
}

// Shared with DayNumbersLine.tsx (W5) — one tone→class map for both cell
// surfaces, never a second copy.
//
// The three BAND tones are the mock's own three colours (`.vl.gn` #16a34a ·
// `--blue` #2563eb · `.vl.am` #b45309), reached through the palette class
// nearest that hex, not a literal.
//
// R3-11 — the reason this map does NOT use the @synqed-kk/ui `--color-*`
// tokens, corrected. The old note claimed the karute theme sets
// `--color-accent: #18181b`; it does not. On the installed 0.3.2,
// `tokens.css:27` sets `--color-accent: #2563eb` (light) / `:65` `#60a5fa`
// (dark), and `#18181b` is `--color-text` at `:33` — the near-black the first
// draft actually rendered came from a THEME-LESS page falling back to the
// `@theme inline` `--color-accent: var(--accent)`, which is near-white/ink,
// not from the karute values. So `--color-accent` would in fact serve the
// 普通 band correctly today (`densityDotClass` above uses it and renders
// blue).
//
// The reason to keep explicit palette classes is the other two bands: there
// is no token for them. `--color-success` is the calendar DOT green (#22c55e,
// 2.2:1 as text on white) and `--color-warning` the dot amber (#f59e0b,
// 2.1:1) — neither is a text colour, and pointing one band at a token while
// the other two stay on the zinc/green/amber scales would leave the three
// bands in different families, which is exactly what the band is for.
// One scale, three steps, dark pairs beside them.
//
// R3-9 — 少なめ was `green-600` (#00a63e, 3.22:1 on white at 14.5px/600 —
// under the 4.5:1 AA floor, and lower still on a today row's wash).
// `green-700` (#008236) measures 4.95:1 on white; the dark pair `green-400`
// measures 9.96:1 on #18181b. The DOT keeps its own green — the band it
// draws is a 6 px shape, not text.
export const VALUE_TONE_CLASS: Record<Cell['tone'], string> = {
  ink: 'text-[var(--color-text)]',
  'band-low': 'text-green-700 dark:text-green-400',
  'band-mid': 'text-primary',
  'band-high': 'text-amber-700 dark:text-amber-500',
  // The day list's own 新規 token (§v11c's --blue == this app's
  // --reservation-new-chip-bg, #2563eb) — reused, never a literal hex.
  new: 'text-[var(--reservation-new-chip-bg)]',
  muted: 'text-[var(--color-text-muted)]',
}

function ValuePill({ pending }: { pending?: boolean }) {
  if (!pending) return null
  return (
    <span
      aria-hidden
      className="inline-block h-[11px] w-[62px] translate-y-px animate-pulse rounded-full bg-muted"
    />
  )
}

// mock `.wksum b{color:var(--ink);font-weight:700;font-variant-numeric:
// tabular-nums}` — the LINE is grey 12.5/600, only the numbers are ink. The
// 新規 number is ink here on purpose: §v11c turned 新規 blue on four surfaces
// (day line · week rows · month line · selected-day card) and deliberately
// not on this one (spec §3).
const SUMMARY_NUMBER = 'font-bold tabular-nums text-[var(--color-text)]'

// mock `.wksum .shim{width:38px;height:11px;transform:translateY(1px)}` —
// narrower than the grid cells' 62px pill.
function SummaryPill() {
  return (
    <span
      aria-hidden
      className="inline-block h-[11px] w-[38px] translate-y-px animate-pulse rounded-full bg-muted"
    />
  )
}

// mock `.wkcell{display:flex;align-items:baseline;gap:5px;min-width:0}` —
// label LEFT of the value on a shared baseline, never stacked. The fixed
// column widths on `.wkgrid` are what stop a long value (33時間27分) moving
// its neighbour, so the cell itself needs no width of its own.
function GridCell({ cell, pending }: { cell: Cell; pending?: boolean }) {
  return (
    <div data-week-cell className="flex min-w-0 items-baseline gap-[5px]">
      {/* mock `.wkcell .lb{flex:0 0 auto;font-size:11px;font-weight:700;
       *  color:var(--mute);line-height:1.2}`
       *
       *  ⚖ R3-17 — the mock has THREE greys and the port had one. `--mute`
       *  (#9ca3af) is the lightest: the label is supposed to recede so the
       *  number is the only thing in the row with weight. At
       *  `--color-text-muted` (#71717a) it read almost as strongly as its own
       *  value. The app's own zinc scale supplies the hierarchy — hue family
       *  is the app's, hierarchy is the mock's — and zinc-400 (#9f9fa9) is
       *  the step that sits on #9ca3af. It measures 6.75:1 on the dark card,
       *  so the dark pair needs no override. */}
      <span className="shrink-0 text-[11px] font-bold leading-[1.2] text-zinc-400">
        {cell.label}
      </span>
      {pending ? (
        <ValuePill pending />
      ) : (
        <span
          data-week-value
          className={cn(
            // mock `.wkcell .vl{font-size:14.5px;font-weight:600;
            //  line-height:1.2;white-space:nowrap;tabular-nums}` +
            // `.vl.nw{display:inline-flex;align-items:center;gap:3px}`
            'inline-flex items-center gap-[3px] whitespace-nowrap text-[14.5px] font-semibold leading-[1.2] tabular-nums',
            VALUE_TONE_CLASS[cell.tone],
          )}
        >
          {/* mock: `cellHTML(c.lb, c.spark ? SPARK + c.val : c.val)` — the
           *  spark PRECEDES the value, and the SVG is 15×15. */}
          {cell.tone === 'new' && <Sparkles aria-hidden className="size-[15px] shrink-0" />}
          {cell.value}
        </span>
      )}
    </div>
  )
}

// mock `.wksum .sep{color:#cfd4da}` — a half-width 「·」 with the flex gap
// either side (spec §3: the app's stat-line convention, never the mock's
// full-width 「・」). aria-hidden: it is punctuation, not a word.
function Separator({ t }: { t: (key: string) => string }) {
  return (
    <span aria-hidden className="text-[var(--color-border-strong)]">
      {t('sep')}
    </span>
  )
}

export function WeekRows({
  rows,
  selectedDateIso,
  todayIso,
  soloMode,
  typeSlot,
  locale,
  pending,
  failed,
  onPickDay,
}: WeekRowsProps) {
  const t = useTranslations('reservation.weekRows')

  if (failed) {
    // R3-7 — a read that failed is news, and it arrives with no control to
    // press (this line renders alone, no rows). `alert` interrupts; `status`
    // below is polite, because a load that is merely in flight is not.
    return (
      <p role="alert" className="text-xs text-[var(--color-text-muted)]">
        {t('failed')}
      </p>
    )
  }

  // The split keys (W-F) gave the line a per-number seam, so pending now does
  // what the mock's own `weekSumHTML(mon, pend)` does: the range and the words
  // stay, only the NUMBERS become shimmer pills. A stale sum during a refetch
  // would still be the worse mistake — no number is shown, just its shape.
  const showSummary = rows.length > 0
  const openRows = rows.filter((r) => !isClosedRow(r))
  const bookedSum = openRows.reduce((sum, r) => sum + r.count, 0)

  return (
    <div>
      {pending && (
        <p role="status" className="mb-2 text-xs text-[var(--color-text-muted)]">
          {t('loading')}
        </p>
      )}
      {showSummary && (
        // mock `.wksum{display:flex;align-items:center;gap:6px;
        //  padding:0 4px 9px;font-size:12.5px;font-weight:600;
        //  color:var(--sub);flex-wrap:wrap}`. The 6px gaps ARE the spaces
        // around the separators — the mock's own literal spaces sit at the
        // end of anonymous flex items, where they are stripped.
        <div
          data-testid="week-summary"
          // R3-17 — mock `--sub` (#6b7280), the MIDDLE grey: words, not
          // labels. zinc-500 measures 4.83:1 on white; on the dark card it
          // drops to 3.67:1, under the 4.5:1 floor for words, so the dark pair
          // steps up to zinc-400 (6.75:1).
          className="flex flex-wrap items-center gap-1.5 px-1 pb-[9px] text-[12.5px] font-semibold text-zinc-500 dark:text-zinc-400"
        >
          <span>
            {t('summaryRange', {
              from: shortMonthDay(rows[0].dateIso),
              to: shortMonthDay(rows[rows.length - 1].dateIso),
            })}
          </span>
          <Separator t={t} />
          <span>{t('count')}</span>
          {pending ? <SummaryPill /> : (
            <b className={SUMMARY_NUMBER}>{t('countValue', { n: bookedSum })}</b>
          )}
          {typeSlot !== 'off' && (
            <>
              <Separator t={t} />
              <span>{t(typeSlot === 'new' ? 'new' : 'returning')}</span>
              {pending ? <SummaryPill /> : (
                // R3-4 — the sum is computed INSIDE the gate that prints it.
                // Hoisted above, `newCustomerCount` was read on every render
                // whatever the typeSlot, and today that field is the QR import
                // flag, not the 新規 count PKT-2 will produce (spec §8). Dead
                // compute one careless edit away from printing a wrong number.
                <b className={SUMMARY_NUMBER}>
                  {openRows.reduce(
                    (sum, r) => sum + (typeSlot === 'new' ? r.newCustomerCount : r.returningCount),
                    0,
                  )}
                </b>
              )}
            </>
          )}
        </div>
      )}
      {/* R3-17 — mock `.listcard{… overflow:hidden}`. Without it the today
       *  row's wash paints square into the card's 16 px corner (the first row
       *  IS today whenever the selected day is today, and the last row when it
       *  is selected). The card's OWN edge keeps `--color-border`; only the
       *  hairlines INSIDE it go lighter. */}
      <div className="flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {rows.map((row) => {
          const closed = isClosedRow(row)
          const isToday = todayIso ? row.dateIso === todayIso : row.isToday === true
          const isSelected = row.dateIso === selectedDateIso
          const wd = weekdayIndex(row.dateIso)
          const isSat = wd === 6
          const isSun = wd === 0
          const cells = closed ? [] : weekRowCells(row, { soloMode, typeSlot, t })
          const dot = closed || pending ? null : densityDotClass(row.count)
          const dateLabel = formatCompactDateJst(jstWallTimeToDate(row.dateIso, '00:00'), locale)
          // R3-6 — `aria-label` on a <button> IS the accessible name and
          // REPLACES everything inside it, so the old date+count name deleted
          // 稼働 / 空き / キャンセル from the only reading a screen-reader user
          // gets — three of the four numbers this page exists to ship, and on a
          // 休 row it also broke WCAG 2.5.3 (「休」 was the only thing on screen
          // and was not in the name). The name is now built from the SAME cells
          // the row renders, so the two cannot drift.
          //
          // While pending the row is honest instead of stale: the values are
          // shimmer pills, so the name says 読み込み中 and the density dot goes
          // away (the mock's own dotFor(d, pend) returns '' there) rather than
          // painting last week's band over this week's shimmer.
          const spoken = closed
            ? t('closed')
            : pending
              ? t('ariaLoading')
              : cells.map((cell) => `${cell.label} ${cell.value}`).join(t('ariaSep'))

          return (
            <button
              key={row.dateIso}
              type="button"
              data-week-row
              onClick={() => onPickDay(row.dateIso)}
              // ⚖ R3-15 — the press starts on POINTERDOWN, as the mock does
              // (its JS adds `.is-pressed` on pointerdown and clears it on
              // pointerup/pointercancel). Chromium and WKWebView hold the CSS
              // `:active` state back on touch while they decide whether the
              // gesture is a scroll: measured under a synthetic touch stream,
              // the row's scale stayed at rest until t=200 ms. `:active` is
              // kept beside it for the keyboard and the mouse — both doors
              // set the SAME 0.97, so they cannot fight.
              //
              // ponytail: the attribute is toggled on the node itself rather
              // than through state. A setState here would put a React render
              // between the finger and the frame the feedback has to land in,
              // which is the whole point of the change; seven rows also means
              // seven re-renders per press for a class flip that touches one.
              onPointerDown={pressOn}
              onPointerUp={pressOff}
              onPointerCancel={pressOff}
              onPointerLeave={pressOff}
              aria-label={t('rowAria', { date: dateLabel, cells: spoken })}
              className={cn(
                // mock `.wkrow{display:flex;align-items:center;gap:10px;
                //  width:100%;text-align:left;min-height:76px;
                //  padding:12px 10px 12px 12px;border-bottom:1px solid
                //  var(--hair);transition:background-color .12s ease}`
                // R3-17 — mock `--hair` (#eef0f2) for the row rule against
                // `--line` (#e6e8eb) for the card edge: two deliberately
                // different greys, so the block reads as a card with hairlines
                // inside it rather than a ruled table. Both pointed at
                // `--color-border`. zinc-100 is the lighter step; on dark the
                // zinc scale has nothing between the card's own background
                // (#18181b) and its edge (#27272a), so the dark pair keeps
                // today's relationship.
                'flex min-h-[76px] w-full items-center gap-2.5 border-b border-zinc-100 py-3 pl-3 pr-2.5 text-left last:border-b-0 dark:border-zinc-800',
                // MOTION (W-I), read off the mock's own cascade: `.wkrow`
                // (line 144) sets `transition:background-color .12s ease`, but
                // `[data-press]` (line 282) re-declares the same SHORTHAND at
                // equal specificity later in the sheet — so what a week row
                // actually computes in the mock is
                // `transition: transform .1s cubic-bezier(.23,1,.32,1)`, and
                // its background does not transition at all. The press curve
                // therefore wins here too; the background rides along on it so
                // the desktop hover keeps a fade instead of snapping.
                //
                // ⚖ R3-14 — the curve is spent on the property that MOVES.
                // Tailwind v4 emits `scale-*` as the standalone `scale`
                // property, not as `transform`, so the old
                // `transition-[background-color,transform]` list covered the
                // background and nothing else and the press SNAPPED: 52 frame
                // samples on a real press held zero intermediate scale values
                // (LENS-3 H-1). DateJumpPanel.tsx gets this right because
                // `transition-transform` expands in v4 to
                // `transform, translate, scale, rotate`; naming `scale`
                // outright is the same fix with nothing dead in the list.
                'transition-[background-color,scale] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] data-pressed:scale-[0.97]',
                // Reduced motion is a CSS variant, not a hook: seven plain DOM
                // rows need no JS to stop moving, and a variant also holds
                // through SSR's first paint. Both press doors are muted — the
                // variant rules land after their unmuted twins in the sheet,
                // at equal specificity, which is what makes them win.
                'motion-reduce:transition-none motion-reduce:active:scale-100 motion-reduce:data-pressed:scale-100',
                // Desktop affordance the phone mock has no use for — the week
                // page is a web door too, and a dead row there reads broken.
                'hover:bg-[var(--color-bg-card-hover)]',
                // R3-8 — these rows are hand-rolled buttons, so they never
                // picked up the shared recipe's focus ring and fell back to the
                // UA outline while every other pressable on the page showed the
                // app's. The four tokens below are @/components/ui/button's own
                // focus-visible spelling, verbatim — not a new style.
                'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                // mock `.wkrow.today{background:var(--wash)}` = rgba(37,99,235,.08)
                isToday && 'bg-primary/8',
                // mock `.wkrow.sel::after{border:1.5px solid var(--blue);
                //  border-radius:10px}` — today and selected are exclusive
                //  in the mock's own class builder.
                isSelected && !isToday && 'rounded-[10px] ring-[1.5px] ring-inset ring-primary',
              )}
            >
              <div className="flex w-[52px] shrink-0 flex-col items-center gap-0.5">
                <span
                  className={cn(
                    'flex size-[30px] items-center justify-center rounded-full text-[20px] font-bold leading-none tabular-nums',
                    isToday
                      ? 'bg-primary text-primary-foreground'
                      : isSat
                        ? 'text-primary'
                        : isSun
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-[var(--color-text)]',
                  )}
                >
                  {row.dateNumber}
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className={cn(
                      // R3-17 — mock `.wkdate i{color:var(--sub)}`, the middle
                      // grey; same dark pair as the summary line.
                      'text-[11px] font-bold leading-none',
                      isSat
                        ? 'text-primary'
                        : isSun
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-zinc-500 dark:text-zinc-400',
                    )}
                  >
                    {row.weekdayLabel}
                  </span>
                  {dot && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dot)} />}
                </span>
              </div>

              {/* mock `.wkgrid{flex:0 0 auto;display:grid;
               *  grid-template-columns:120px 100px;row-gap:7px;column-gap:8px}`
               *  — FIXED columns are the whole point (a long value can never
               *  move its neighbour), so the block must not flex.
               *
               *  ⚖ R2-2 — the wide column is 130 px here, the ONE recorded
               *  deviation from that rule. The mock's fixtures were whole
               *  hours (「12時間」); a real day carries minutes, and
               *  「予約時間 12時間30分」 measures 130.03 px (label 44 + gap 5 +
               *  value 81), so at 120 px it ran 2 px into 無断's box (D-2 of
               *  FIX-REPORT-1B-WIRE-R1).
               *
               *  ⚖ R3-12 — and +10 px was still a hand-tuned number, not a
               *  guard: the value is `whitespace-nowrap` inside a min-w-0 cell
               *  in a FIXED track, so it overflows rather than truncating, and
               *  「予約時間 12時間30分」 measures 130.03 px — 0.03 px over its
               *  own new column. `bookedMinutes` is the whole store's day
               *  (10 staff × 10 h = 100 h is reachable), and
               *  「予約時間 100時間30分」 measures 139.42 px. `minmax(130px,
               *  max-content)` makes the floor structural: the track can never
               *  be narrower than 130, and a longer string widens the track
               *  instead of walking into 無断's box. The narrow column stays a
               *  fixed 100 px, so a duration still must not sit there — that
               *  is placeForGrid's job, not this track's. Every other number
               *  in this row — gap 8, row-gap 7, the padding, the 52 px date
               *  column, the `ml-auto` chevron — is the mock's, untouched. */}
              <div
                data-week-grid
                className="grid shrink-0 grid-cols-[minmax(130px,max-content)_100px] gap-x-2 gap-y-[7px]"
              >
                {closed ? (
                  // mock `.wkgrid .closedcell{grid-column:1/-1}` +
                  // `.closedcell .vl{font-size:15px}` `.vl.mut`
                  <div className="col-span-full">
                    <span className={cn('text-[15px]', VALUE_TONE_CLASS.muted)}>{t('closed')}</span>
                  </div>
                ) : (
                  cells.map((cell) => <GridCell key={cell.key} cell={cell} pending={pending} />)
                )}
              </div>

              {/* mock `.wkchev{margin-left:auto;flex:0 0 12px;color:#c3c8cf}`
               *  with a 14×14 glyph — the row, not the grid, pushes it right.
               *
               *  R3-17 — the THIRD grey, lighter than the label: at
               *  `--color-text-muted` seven chevrons pulled the eye to the
               *  right edge of the card. zinc-300 (#d4d4d8) sits on #c3c8cf;
               *  it is decoration (aria-hidden), so its 1.48:1 is a shape
               *  contrast, not a text one, and the dark pair mirrors that
               *  faintness (zinc-700, 1.70:1 on the dark card) instead of
               *  inverting into the brightest thing in the row. */}
              <ChevronRight
                data-week-chevron
                aria-hidden
                className="ml-auto size-3.5 shrink-0 text-zinc-300 dark:text-zinc-700"
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
