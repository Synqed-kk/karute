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
  /** The router transition. R3-18: while it runs the numbers on screen still
   *  describe the OLD day, so the line shows the mock's two shims instead. */
  pending?: boolean
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
    // R3-17 — mock `.dayline .it{color:var(--sub)}`, the same middle grey the
    // week summary uses, with the same dark pair.
    <span className="inline-flex items-baseline gap-1 font-semibold text-zinc-500 dark:text-zinc-400">
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

export function DayNumbersLine({ row, soloMode, typeSlot, pending }: DayNumbersLineProps) {
  const t = useTranslations('reservation.weekRows')
  if (!pending && !row) return null

  const closed = row !== null && isClosedRow(row)

  return (
    // mock `.dayline`: flex · align-items:center · gap 14 · padding 2px 0 ·
    // margin 0 0 8px · line-height 1.25 · 14px (13.5px ≤400px) · nowrap.
    // No separators, no pills, no dots (§v9d), everything left-aligned.
    //
    // R3-18 — `min-h-[1.25em]` is the LINE's own content height expressed in
    // the font size it is currently at (16.875 px at 393's 13.5 px, 17.5 px at
    // 14 px), so the 12 px shims below cannot shrink the block and the list
    // card beneath keeps its 8 px seam instead of jumping. It changes nothing
    // in the loaded state, where the text already fills exactly that height.
    <div
      data-day-line
      className="mb-2 flex min-h-[1.25em] items-center gap-[14px] whitespace-nowrap py-0.5 text-[14px] leading-[1.25] max-[400px]:text-[13.5px]"
    >
      {pending || !row ? (
        // mock line 790: `numsHTML(d, pend)` returns TWO shims. The port
        // returned null, so the line vanished mid-fetch and the list jumped up
        // by its own block height — and before that it showed the previous
        // day's numbers as if they were this day's.
        <>
          <span aria-hidden className="reservation-shim inline-block h-[12px] w-[52px] rounded-full" />
          <span aria-hidden className="reservation-shim inline-block h-[12px] w-[52px] rounded-full" />
        </>
      ) : closed ? (
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
