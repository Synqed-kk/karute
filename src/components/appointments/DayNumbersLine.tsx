'use client'

// The day page's numbers line (spec §2/§v9d, packet W5) — one flowing
// "value then word" line, replacing ReservationTotals once the wiring PR
// makes `row` non-null. ISOLATED: nothing imports this yet.
import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { WeekDayRowData } from '@/lib/adapters/reservation'
import { dayLineCells, isClosedRow, type Cell, type TypeSlot } from '@/lib/appointments/metric-menu'
import { VALUE_TONE_CLASS } from './WeekRows'

interface DayNumbersLineProps {
  row: WeekDayRowData | null
  soloMode: boolean
  typeSlot: TypeSlot
  /** Kept for prop-shape parity with the wiring PR's call site — every value
   *  on this line already arrives pre-localized through `t` /
   *  `formatHoursMinutes`; the line itself formats no dates. */
  locale: string
}

// 予約 (count) carries its own unit in the value ("11件") and shows no word;
// every other cell is value-then-word ("5新規", "41%稼働", "4時間30分予約時間").
function LineItem({ cell }: { cell: Cell }) {
  return (
    <span className="inline-flex items-baseline whitespace-nowrap">
      <b className={cn('font-semibold', VALUE_TONE_CLASS[cell.tone])}>{cell.value}</b>
      {cell.tone === 'new' && (
        <Sparkles aria-hidden className="ml-0.5 size-3 shrink-0 self-center text-[var(--reservation-new-chip-bg)]" />
      )}
      {cell.key !== 'count' && (
        <span className="text-[var(--color-text-muted)]">{cell.label}</span>
      )}
    </span>
  )
}

export function DayNumbersLine({ row, soloMode, typeSlot }: DayNumbersLineProps) {
  const t = useTranslations('reservation.weekRows')
  if (!row) return null

  const closed = isClosedRow(row)

  return (
    <div className="mb-2 flex items-baseline gap-[14px] whitespace-nowrap py-0.5 text-[14px] max-[400px]:text-[13.5px]">
      {closed ? (
        <>
          <b className={cn('font-semibold', VALUE_TONE_CLASS.ink)}>{t('countValue', { n: row.count })}</b>
          <span className="text-[var(--color-text-muted)]">{t('closed')}</span>
        </>
      ) : (
        dayLineCells(row, { soloMode, typeSlot, t }).map((cell) => <LineItem key={cell.key} cell={cell} />)
      )}
    </div>
  )
}
