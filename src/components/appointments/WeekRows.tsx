'use client'

// The week page's seven-row component (spec §3, packet W4) — an app-local
// replacement for @synqed-kk/ui's WeekDayCard. ISOLATED: nothing imports this
// yet (the wiring PR swaps it in after PR #921 merges).
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
export const VALUE_TONE_CLASS: Record<Cell['tone'], string> = {
  ink: 'text-[var(--color-text)]',
  'band-low': 'text-[var(--color-success)]',
  'band-mid': 'text-[var(--color-accent)]',
  'band-high': 'text-[var(--color-warning)]',
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

function GridCell({ cell, pending }: { cell: Cell; pending?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] font-bold leading-tight text-[var(--color-text-muted)]">
        {cell.label}
      </span>
      {pending ? (
        <ValuePill pending />
      ) : (
        <span
          className={cn(
            'inline-flex items-center gap-[3px] whitespace-nowrap text-[14.5px] font-semibold leading-tight',
            VALUE_TONE_CLASS[cell.tone],
          )}
        >
          {cell.value}
          {cell.tone === 'new' && <Sparkles aria-hidden className="size-3 shrink-0" />}
        </span>
      )}
    </div>
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

  // Pending: real staff read these numbers every day — a stale sum during a
  // refetch is a worse mistake than a blank one, so the summary line (which
  // has no per-number seam to shimmer without splitting the native-passed
  // final sentence) is skipped entirely while pending; the loading line
  // above the card says why. See BUILD-REPORT deviations.
  const showSummary = !pending && rows.length > 0
  const openRows = rows.filter((r) => !isClosedRow(r))
  const bookedSum = openRows.reduce((sum, r) => sum + r.count, 0)
  const newSum = openRows.reduce((sum, r) => sum + r.newCustomerCount, 0)
  const returningSum = openRows.reduce((sum, r) => sum + r.returningCount, 0)

  return (
    <div>
      {pending && <p className="mb-2 text-xs text-[var(--color-text-muted)]">{t('loading')}</p>}
      {showSummary && rows.length > 0 && (
        <div
          data-testid="week-summary"
          className="flex items-center gap-1.5 px-1 pb-[9px] text-[12.5px] font-semibold text-[var(--color-text-muted)]"
        >
          <span>
            {t('summary', {
              from: shortMonthDay(rows[0].dateIso),
              to: shortMonthDay(rows[rows.length - 1].dateIso),
              count: bookedSum,
            })}
            {typeSlot === 'new' && t('summaryNew', { n: newSum })}
            {typeSlot === 'returning' && t('summaryReturning', { n: returningSum })}
          </span>
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
              onClick={() => onPickDay(row.dateIso)}
              aria-label={t('rowAria', { date: dateLabel, n: row.count })}
              className={cn(
                'flex min-h-[76px] w-full items-center gap-2.5 border-b border-[var(--color-border)] px-3 text-left last:border-b-0',
                'hover:bg-[var(--color-bg-card-hover)] transition-colors',
                isToday && 'bg-primary/8',
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

              {closed ? (
                <div className="flex-1 text-[15px] text-[var(--color-text-muted)]">{t('closed')}</div>
              ) : (
                <div className="grid flex-1 grid-cols-[120px_100px] gap-x-2 gap-y-[7px]">
                  {cells.map((cell) => (
                    <GridCell key={cell.key} cell={cell} pending={pending} />
                  ))}
                </div>
              )}

              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
