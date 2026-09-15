'use client'

// The day page's numbers line (spec §2 / mock §v9d, packet W5 + PKT-1b-WIRE
// W-B) — one flowing "value then word" line, ported rule-for-rule from
// DATE-JUMP-PICKER-MOCK.html's `.dayline` block (mock lines 134-142).
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { WeekDayRowData } from '@/lib/adapters/reservation'
import { dayLineCells, isClosedRow, type Cell, type TypeSlot } from '@/lib/appointments/metric-menu'
import { VALUE_TONE_CLASS } from './WeekRows'
import { NewSpark } from './NewSpark'

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
  /** Padding/margin overrides for a host that owns the line's seams — the 月
   *  page's selected-day card, where the mock puts this same line INSIDE the
   *  card (`.listcard .statline{padding:12px 14px 2px}`) instead of above it.
   *  Every other rule below stays exactly as it is on the 日 page: one line,
   *  one set of numbers, one set of type sizes. */
  className?: string
}

// mock `.dayline .it b` — ink, tabular. The tone map (shared with the week
// rows) supplies the colour. Weight is the APP's type scale (2026-09-15,
// feedback_design_system_type_not_mock_type.md), not the mock's own 700: it
// matches the reservation agenda's value weight (ReservationMobileAgenda.tsx
// :316) — 600, never 700, on a value at this size.
const VALUE = 'font-semibold tabular-nums'

// 予約 (count) carries its own unit in the value ("11件") and shows no word;
// every other cell is value-then-word ("5新規", "41%稼働", "4時間30分予約時間").
// mock `.dayline .it{display:inline-flex;align-items:baseline;gap:4px;
// color:var(--sub);font-weight:600}` — the wrapper is the WORD's styling.
function LineItem({ cell }: { cell: Cell }) {
  return (
    // R3-17 — mock `.dayline .it{color:var(--sub)}`, the same middle grey the
    // week summary uses, with the same dark pair. Weight 500 (2026-09-15
    // type-system fix): a word/label on this screen is 500, never the mock's
    // own 600 — the agenda's meta labels (:291, :451) are the reference.
    <span className="inline-flex items-baseline gap-1 font-medium text-zinc-500 dark:text-zinc-400">
      {/* mock: the spark precedes the value (`SPARK + '<b>' + val`), and
       *  `.dayline .it.nw svg{align-self:center}` re-centres it against the
       *  baseline-aligned row. */}
      {/* ⚖ R1-4 — the colour comes off the shared tone map, never a second
       *  spelling of the token. NewSpark inherits `currentColor`, and here the
       *  wrapper is the WORD's middle grey, so the spark has to be told —
       *  unlike the week cell, which sits inside the toned value itself. */}
      {cell.tone === 'new' && (
        <NewSpark className={cn('shrink-0 self-center', VALUE_TONE_CLASS[cell.tone])} />
      )}
      <b className={cn(VALUE, VALUE_TONE_CLASS[cell.tone])}>{cell.value}</b>
      {cell.key !== 'count' && cell.label}
    </span>
  )
}

export function DayNumbersLine({ row, soloMode, typeSlot, pending, className }: DayNumbersLineProps) {
  const t = useTranslations('reservation.weekRows')
  if (!pending && !row) return null

  const closed = row !== null && isClosedRow(row)

  return (
    // mock `.dayline`: flex · align-items:center · gap 14 · padding 2px 0 ·
    // margin 0 0 8px · line-height 1.25 · nowrap. No separators, no pills, no
    // dots (§v9d), everything left-aligned — LAYOUT untouched.
    //
    // Font size is the APP's, not the mock's (2026-09-15 type-system fix):
    // one flat 13px, matching the reservation agenda's value size
    // (ReservationMobileAgenda.tsx :316) — the mock's own 14px (13.5px
    // ≤400px) and its breakpoint step are dropped.
    //
    // R3-18 — the floor is the LINE's own loaded block height: 1.25em of
    // content (16.25 px at the line's 13 px) PLUS the 0.25rem the py-0.5
    // adds, because `min-height` is border-box here — 20.25 px, measured
    // both loaded and pending at 393 (T-5 proof). So the 11 px shims cannot
    // shrink the block and the list card beneath keeps its own seam instead
    // of jumping.
    <div
      data-day-line
      className={cn(
        'mb-2 flex min-h-[calc(1.25em+0.25rem)] items-center gap-[14px] whitespace-nowrap py-0.5 text-[13px] leading-[1.25]',
        className,
      )}
    >
      {pending || !row ? (
        // mock line 790: `numsHTML(d, pend)` returns TWO shims. The port
        // returned null, so the line vanished mid-fetch and the list jumped up
        // by its own block height — and before that it showed the previous
        // day's numbers as if they were this day's.
        //
        // Shim height 11px (2026-09-15): matches WeekRows' own pill height
        // for a same-size (13px) value — the two surfaces now shimmer the
        // same proportion.
        <>
          <span aria-hidden className="reservation-shim inline-block h-[11px] w-[52px] rounded-full" />
          <span aria-hidden className="reservation-shim inline-block h-[11px] w-[52px] rounded-full" />
        </>
      ) : closed ? (
        // mock: `<span class="it"><b>0件</b></span><span class="it"><b>休</b>
        // </span>` — 休 is a VALUE (ink, 600), not a grey word.
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
