'use client'

// The 月 page's SELECTED-DAY CARD (spec §S1 / mock §v10-§v11b, packet
// PKT-1b-month B2-B4) — ported from DATE-JUMP-PICKER-MOCK.html's
// `.listcard.selcard` / `.selfade` / `.selempty` / `.selmore` / `.seldoor`
// block (mock 221-227) and its builder `seldayHTML` (mock 918-935).
//
// Tapping a day on the month page STAYS on the month page; this card is what
// the tap is FOR. It answers 「what is on that day?」 without spending the
// month view, and its door spends it deliberately.
//
// NO DATE HEADER (§v11b, and the spec's §0 dead-round list): the chip at the
// top of the page already names the selected day, so a date line inside the
// card is the same fact printed twice. The card opens on the day's numbers.
//
// The rows are the DAY LIST's own compact row (`CompactRowContent`), imported
// rather than rebuilt — this page must not invent a third row style.
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { WeekDayRowData } from '@/lib/adapters/reservation'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import { isClosedRow } from '@/lib/appointments/metric-menu'
import { BADGE_COLORS } from '@/lib/badge-styles'
import {
  COMPACT_ROW,
  COMPACT_ROW_TAG,
  CompactRowContent,
} from '@/components/karute/spike-lifted/reservation/ReservationMobileAgenda'
import { DayNumbersLine } from './DayNumbersLine'

/** mock `seldayHTML`: `rows.slice(0,5)` — §v11 point 4, five rows freed by the
 *  compressed grid above. Everything past it is counted into 他N件. */
const MAX_ROWS = 5

interface SelectedDayCardProps {
  /** The day the card describes, YYYY-MM-DD. During a move this is the day the
   *  finger picked, not the one the server has yet answered for — the door and
   *  the ring must point at the same day the whole time. */
  dateIso: string
  /** The selected day's bookings — the SAME `reservationViews` the 日 page
   *  renders, already scope-filtered server-side. Both doors re-read the whole
   *  screen for a new `?date=`, so these arrive in the same payload as the
   *  month cells: no second action, no second fetch (B1). */
  rows: ReservationView[]
  /** The selected day's four numbers, from the adapter the week rows and the
   *  day line both come from. Null = a server or a baked bundle that predates
   *  the field; the line then renders nothing rather than a guess. */
  dayTotals: WeekDayRowData | null
  soloMode: boolean
  locale: string
  /** The answer for `dateIso` is still in flight (the web transition, or the
   *  phone's DTO refetch). The content on screen still describes the day being
   *  moved away from, so it fades out and the numbers show their shims. */
  pending?: boolean
  onOpenDay: (dateIso: string) => void
  className?: string
}

export function SelectedDayCard({
  dateIso,
  rows,
  dayTotals,
  soloMode,
  locale,
  pending,
  onOpenDay,
  className,
}: SelectedDayCardProps) {
  const t = useTranslations('reservation.weekRows')

  // ⚖ lead ruling (spec §8), through the ONE predicate every 予約 surface
  // calls: 休 stands only on a closed day with nothing booked. A closed day
  // that HAS bookings is an open day as far as this card is concerned.
  const closed = dayTotals !== null && isClosedRow(dayTotals)
  // The day page sorts by start time and lists terminal rows in their own
  // slot; the first five here are the first five THERE, so 他N件 and the day
  // page can never disagree about what the sixth row is.
  const sorted = [...rows].sort((a, b) => a.startTimeHm.localeCompare(b.startTimeHm))
  const top = closed ? [] : sorted.slice(0, MAX_ROWS)
  const extra = closed ? 0 : sorted.length - top.length

  return (
    // mock `.listcard` — the app's own card chrome, byte-identical to the
    // month grid's card above it, so the page reads as two cards and not two
    // designs.
    <div
      data-selected-day-card
      className={cn(
        'overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
        className,
      )}
    >
      {/* mock `.selfade{transition:opacity .12s ease}` — B3. The mock swaps its
       *  content behind a local 120 ms timer; here the swap is a server round
       *  trip, so the SAME sequence falls out of the pending flag: fade out
       *  (120 ms) → the content changes while it is invisible → fade in. Never
       *  two contents at once, and opacity is the only property that moves, so
       *  the whole thing stays on the compositor.
       *
       *  `motion-reduce:transition-none` = the mock's REDUCE branch, which
       *  swaps with no fade at all. */}
      <div
        data-sel-fade
        className={cn(
          'transition-opacity duration-[120ms] ease-[ease] motion-reduce:transition-none',
          pending ? 'opacity-0' : 'opacity-100',
        )}
      >
        {/* mock `.listcard .statline{padding:12px 14px 2px}` — §v11b: the
         *  numbers line is the card's first element and carries the top
         *  breathing room the removed date header used to give. The 14 px
         *  becomes the row's own 16 px so the line, the rows and 他N件 share
         *  one left edge.
         *
         *  Its OWN pending branch is the mock's two shims, and its min-height
         *  is fixed — so a move never changes this line's height and the card
         *  cannot jump while the answer is in flight. A closed day renders
         *  「0件」「休」 here and the card stops. */}
        <DayNumbersLine
          row={dayTotals}
          pending={pending}
          soloMode={soloMode}
          // PKT-2 owns the strict 新規/再来 producer; today's newCustomerCount
          // is the QR import flag and must not print (spec §8).
          typeSlot="off"
          locale={locale}
          className="px-4 pb-0.5 pt-3"
        />

        {/* mock `.row` + `.row{border-bottom:1px solid var(--hair)}` — the
         *  hairline stays on the LAST row too, because something always
         *  follows it inside this card (他N件, or the door). */}
        {top.map((r) => (
          <div
            key={r.id}
            className={cn(COMPACT_ROW, 'border-b border-zinc-200/70 dark:border-zinc-800')}
          >
            <CompactRowContent reservation={r} tag={<RowTag reservation={r} />} />
          </div>
        ))}

        {/* mock `.selempty{padding:10px 14px 2px;font-size:13.5px}` — a day with
         *  nothing on it SAYS so, and still offers its door: an empty day is
         *  where a booking gets made. */}
        {!closed && top.length === 0 && (
          <p className="m-0 px-4 pb-0.5 pt-2.5 text-[13.5px] text-zinc-500 dark:text-zinc-400">
            {t('noBookings')}
          </p>
        )}

        {/* mock `.selmore{padding:8px 14px 0;font-size:12.5px;font-weight:600}`.
         *  The wording is the app's own 「他{n}件」 pattern (native pass 2 row
         *  D-3); the mock's 「+N 他」 is dead wording. */}
        {extra > 0 && (
          <div className="px-4 pt-2 text-[12.5px] font-semibold text-zinc-500 dark:text-zinc-400">
            {t('moreRows', { n: extra })}
          </div>
        )}

        {/* mock `.seldoor{height:44px;margin:10px;border-radius:12px;
         *  background:var(--wash);color:var(--blue);font-size:14px;
         *  font-weight:700}` — `--wash` is rgba(37,99,235,.08), which is the
         *  app's `bg-primary/8`: the R13 selected/pressed recipe, never a black
         *  or solid fill (CLAUDE.md). A closed, empty day has no day to open,
         *  so it gets no door.
         *
         *  The press is the week rows' own spelling — `scale` named outright
         *  because Tailwind v4 emits it as a standalone property (R3-14), and
         *  cancelled by a variant at equal specificity under reduced motion. */}
        {!closed && (
          <button
            type="button"
            onClick={() => onOpenDay(dateIso)}
            className={cn(
              'm-2.5 flex h-11 w-[calc(100%-20px)] items-center justify-center gap-[5px] rounded-xl',
              'bg-primary/8 text-[14px] font-bold text-primary',
              'transition-[scale] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]',
              'motion-reduce:transition-none motion-reduce:active:scale-100',
              'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
            )}
          >
            {t('openDay')}
          </button>
        )}
      </div>
    </div>
  )
}

/** mock `rowHTML`'s tag slot. EXCEPTIONS ONLY (Liam, the agenda's own rule):
 *  予約済 and 完了 are the default states and the row's stripe already says
 *  them quietly — a pill on every row is a pill that says nothing. */
function RowTag({ reservation: r }: { reservation: ReservationView }) {
  const tCard = useTranslations('reservation.card')
  const tStatus = useTranslations('reservation.status')

  if (r.isNoShow) {
    return (
      <span className={cn(COMPACT_ROW_TAG, BADGE_COLORS.amber.bg, BADGE_COLORS.amber.text, BADGE_COLORS.amber.border)}>
        {tCard('noShow')}
      </span>
    )
  }
  if (r.isCancelled) {
    return (
      <span className={cn(COMPACT_ROW_TAG, 'border-border/70 text-muted-foreground')}>
        {tCard('cancelled')}
      </span>
    )
  }
  if (r.displayStatus !== 'new' && r.displayStatus !== 'in_session') return null
  const tone = r.displayStatus === 'new' ? BADGE_COLORS.blue : BADGE_COLORS.orange
  return (
    <span className={cn(COMPACT_ROW_TAG, tone.bg, tone.text, tone.border)}>
      {tStatus(r.displayStatus)}
    </span>
  )
}
