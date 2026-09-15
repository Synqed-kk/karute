'use client'

// The week page's seven-row component (spec §3, packet W4 + PKT-1b-WIRE W-A)
// — the app-local replacement for @synqed-kk/ui's WeekDayCard, ported rule
// for rule from DATE-JUMP-PICKER-MOCK.html's `.wksum` / `.wkrow` / `.wkdate` /
// `.wkgrid` / `.wkcell` / `.wkchev` block (mock lines 144-179).
// The `data-week-*` markers exist so the port itself is testable: every one of
// those CSS rules is pinned by a named test, not left to a screenshot.
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
// `--blue` #2563eb · `.vl.am` #b45309), reached through the palette class that
// IS that hex, not a literal. Not the @synqed-kk/ui `--color-*` tokens the
// first draft used: under `data-theme="karute"` that package sets
// `--color-accent: #18181b`, so the 普通 band — the one most days land in —
// rendered NEAR-BLACK, which is both the wrong colour and a black-fill look
// the brand rule forbids. `--color-warning` (#f59e0b) was likewise a dot
// colour, too light to read as text. Dark pairs follow the Sunday-date
// precedent below.
export const VALUE_TONE_CLASS: Record<Cell['tone'], string> = {
  ink: 'text-[var(--color-text)]',
  'band-low': 'text-green-600 dark:text-green-400',
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
       *  color:var(--mute);line-height:1.2}` */}
      <span className="shrink-0 text-[11px] font-bold leading-[1.2] text-[var(--color-text-muted)]">
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
    return <p className="text-xs text-[var(--color-text-muted)]">{t('failed')}</p>
  }

  // The split keys (W-F) gave the line a per-number seam, so pending now does
  // what the mock's own `weekSumHTML(mon, pend)` does: the range and the words
  // stay, only the NUMBERS become shimmer pills. A stale sum during a refetch
  // would still be the worse mistake — no number is shown, just its shape.
  const showSummary = rows.length > 0
  const openRows = rows.filter((r) => !isClosedRow(r))
  const bookedSum = openRows.reduce((sum, r) => sum + r.count, 0)
  const newSum = openRows.reduce((sum, r) => sum + r.newCustomerCount, 0)
  const returningSum = openRows.reduce((sum, r) => sum + r.returningCount, 0)

  return (
    <div>
      {pending && <p className="mb-2 text-xs text-[var(--color-text-muted)]">{t('loading')}</p>}
      {showSummary && (
        // mock `.wksum{display:flex;align-items:center;gap:6px;
        //  padding:0 4px 9px;font-size:12.5px;font-weight:600;
        //  color:var(--sub);flex-wrap:wrap}`. The 6px gaps ARE the spaces
        // around the separators — the mock's own literal spaces sit at the
        // end of anonymous flex items, where they are stripped.
        <div
          data-testid="week-summary"
          className="flex flex-wrap items-center gap-1.5 px-1 pb-[9px] text-[12.5px] font-semibold text-[var(--color-text-muted)]"
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
                <b className={SUMMARY_NUMBER}>{typeSlot === 'new' ? newSum : returningSum}</b>
              )}
            </>
          )}
        </div>
      )}
      <div className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {rows.map((row) => {
          const closed = isClosedRow(row)
          const isToday = todayIso ? row.dateIso === todayIso : row.isToday === true
          const isSelected = row.dateIso === selectedDateIso
          const wd = weekdayIndex(row.dateIso)
          const isSat = wd === 6
          const isSun = wd === 0
          const cells = closed ? [] : weekRowCells(row, { soloMode, typeSlot, t })
          const dot = closed ? null : densityDotClass(row.count)
          const dateLabel = formatCompactDateJst(jstWallTimeToDate(row.dateIso, '00:00'), locale)

          return (
            <button
              key={row.dateIso}
              type="button"
              data-week-row
              onClick={() => onPickDay(row.dateIso)}
              aria-label={t('rowAria', { date: dateLabel, n: row.count })}
              className={cn(
                // mock `.wkrow{display:flex;align-items:center;gap:10px;
                //  width:100%;text-align:left;min-height:76px;
                //  padding:12px 10px 12px 12px;border-bottom:1px solid
                //  var(--hair);transition:background-color .12s ease}`
                'flex min-h-[76px] w-full items-center gap-2.5 border-b border-[var(--color-border)] py-3 pl-3 pr-2.5 text-left last:border-b-0',
                // MOTION (W-I), read off the mock's own cascade: `.wkrow`
                // (line 144) sets `transition:background-color .12s ease`, but
                // `[data-press]` (line 282) re-declares the same SHORTHAND at
                // equal specificity later in the sheet — so what a week row
                // actually computes in the mock is
                // `transition: transform .1s cubic-bezier(.23,1,.32,1)`, and
                // its background does not transition at all. The press curve
                // therefore wins here too; the background rides along on it so
                // the desktop hover keeps a fade instead of snapping. That is
                // this app's PRESS recipe verbatim (DateJumpPanel.tsx) — one
                // press feel on this page, pinned equal by a test rather than
                // shared through an import (that file is untouched by this PR).
                'transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]',
                // Reduced motion is a CSS variant, not a hook: seven plain DOM
                // rows need no JS to stop moving, and a variant also holds
                // through SSR's first paint.
                'motion-reduce:transition-none motion-reduce:active:scale-100',
                // Desktop affordance the phone mock has no use for — the week
                // page is a web door too, and a dead row there reads broken.
                'hover:bg-[var(--color-bg-card-hover)]',
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
                      'text-[11px] font-bold leading-none',
                      isSat
                        ? 'text-primary'
                        : isSun
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-[var(--color-text-muted)]',
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
               *  FIX-REPORT-1B-WIRE-R1). +10 px is invisible to the eye and
               *  keeps the collision impossible; every other number in this
               *  row — gap 8, row-gap 7, the padding, the 52 px date column,
               *  the `ml-auto` chevron — is the mock's, untouched. */}
              <div
                data-week-grid
                className="grid shrink-0 grid-cols-[130px_100px] gap-x-2 gap-y-[7px]"
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
               *  with a 14×14 glyph — the row, not the grid, pushes it right. */}
              <ChevronRight
                data-week-chevron
                aria-hidden
                className="ml-auto size-3.5 shrink-0 text-[var(--color-text-muted)]"
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
