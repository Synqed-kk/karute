'use client'

// The day page's numbers line (spec §2 / mock §v9d, packet W5 + PKT-1b-WIRE
// W-B) — one flowing "value then word" line, ported rule-for-rule from
// DATE-JUMP-PICKER-MOCK.html's `.dayline` block (mock lines 134-142).
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

// mock `.dayline .it b` — 700, ink, tabular. The tone map (shared with the
// week rows) supplies the colour; 700 + tabular are the line's own.
const VALUE = 'font-bold tabular-nums'

// 予約 (count) carries its own unit in the value ("11件") and shows no word;
// every other cell is value-then-word ("5新規", "41%稼働", "4時間30分予約時間").
// mock `.dayline .it{display:inline-flex;align-items:baseline;gap:4px;
// color:var(--sub);font-weight:600}` — the wrapper is the WORD's styling.
function LineItem({ cell }: { cell: Cell }) {
  return (
    <span className="inline-flex items-baseline gap-1 font-semibold text-[var(--color-text-muted)]">
      {/* mock: the spark precedes the value (`SPARK + '<b>' + val`), and
       *  `.dayline .it.nw svg{align-self:center}` re-centres it against the
       *  baseline-aligned row. */}
      {cell.tone === 'new' && (
        <Sparkles
          aria-hidden
          className="size-[15px] shrink-0 self-center text-[var(--reservation-new-chip-bg)]"
        />
      )}
      <b className={cn(VALUE, VALUE_TONE_CLASS[cell.tone])}>{cell.value}</b>
      {cell.key !== 'count' && cell.label}
    </span>
  )
}

export function DayNumbersLine({ row, soloMode, typeSlot }: DayNumbersLineProps) {
  const t = useTranslations('reservation.weekRows')
  if (!row) return null

  const closed = isClosedRow(row)

  return (
    // mock `.dayline`: flex · align-items:center · gap 14 · padding 2px 0 ·
    // margin 0 0 8px · line-height 1.25 · 14px (13.5px ≤400px) · nowrap.
    // No separators, no pills, no dots (§v9d), everything left-aligned.
    <div
      data-day-line
      className="mb-2 flex items-center gap-[14px] whitespace-nowrap py-0.5 text-[14px] leading-[1.25] max-[400px]:text-[13.5px]"
    >
      {closed ? (
        // mock: `<span class="it"><b>0件</b></span><span class="it"><b>休</b>
        // </span>` — 休 is a VALUE (ink, 700), not a grey word.
        <>
          <span className="inline-flex items-baseline">
            <b className={cn(VALUE, VALUE_TONE_CLASS.ink)}>{t('countLine', { n: row.count })}</b>
          </span>
          <span className="inline-flex items-baseline">
            <b className={cn(VALUE, VALUE_TONE_CLASS.ink)}>{t('closed')}</b>
          </span>
        </>
      ) : (
        dayLineCells(row, { soloMode, typeSlot, t }).map((cell) => <LineItem key={cell.key} cell={cell} />)
      )}
    </div>
  )
}
