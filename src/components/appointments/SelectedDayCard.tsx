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
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { formatCompactDateJst, jstWallTimeToDate } from '@/lib/date/jst'
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

/** mock `.selfade{transition:opacity .12s ease}` + `selectMonthDay` (mock
 *  936-951). R1-6: the fade is a property of the GESTURE, not of the network —
 *  the mock drops opacity to 0, REPLACES the content inside this timer, and
 *  brings it back, so the swap is never seen and a tap that resolves instantly
 *  still plays the whole sequence. */
const FADE_MS = 120

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
  pending = false,
  onOpenDay,
  className,
}: SelectedDayCardProps) {
  const t = useTranslations('reservation.weekRows')

  // R1-6 (LENS-3 #1 + #2) — what the card is PAINTING. Hanging the fade on
  // `pending` made ONE gesture play three different motions: a warm tap answered
  // from the router cache in ~22 ms and hard-cut at full opacity with no fade at
  // all (back-and-forth between two days, the likeliest scanning pattern here,
  // had no motion whatsoever), while a cold one held an EMPTY bordered box for
  // the whole round trip — the shims that exist to fill that gap were rendered
  // inside the very element the flag faded to zero.
  //
  // So the props become the painted content only at the END of a 120 ms window,
  // which is the mock's own machine: fade out → swap behind the zero → fade in,
  // every time. The window is opened by whatever CHANGES the card — the tap
  // (`handlePickMonthDay` moves the day this card describes before any answer
  // exists) and the answer arriving on a card that is showing shims. It is
  // self-clearing, so the network can neither skip it nor extend it.
  const [painted, setPainted] = useState({ dateIso, rows, dayTotals, pending })
  const [fading, setFading] = useState(false)
  // A swap the card must HIDE: the day it describes changed, or it is crossing
  // between the answer and the shims. A same-day refresh (a booking created, a
  // revalidate) is not one — those rows just land.
  const swapping = painted.dateIso !== dateIso || painted.pending !== pending

  useEffect(() => {
    if (!swapping) {
      setPainted((p) =>
        p.rows === rows && p.dayTotals === dayTotals ? p : { ...p, rows, dayTotals },
      )
      return
    }
    // The mock's REDUCE branch replaces the content and never touches opacity
    // (mock 946), so there is no window at all: the swap is instant and the card
    // is never dark. Read here rather than at render — the server has no media
    // query and a hydration mismatch would be a worse bug than the one below.
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setPainted({ dateIso, rows, dayTotals, pending })
      return
    }
    setFading(true)
    const timer = setTimeout(() => {
      setPainted({ dateIso, rows, dayTotals, pending })
      setFading(false)
    }, FADE_MS)
    return () => clearTimeout(timer)
  }, [swapping, dateIso, rows, dayTotals, pending])

  // Everything below reads the PAINTED content, never the live props: during
  // the window the card is still the day it is fading out of, right down to
  // which day its door opens.
  const shownRows = painted.rows
  const shownTotals = painted.dayTotals
  const shownPending = painted.pending

  // ⚖ lead ruling (spec §8), through the ONE predicate every 予約 surface
  // calls: 休 stands only on a closed day with nothing booked. A closed day
  // that HAS bookings is an open day as far as this card is concerned.
  const closed = shownTotals !== null && isClosedRow(shownTotals)
  // R1-3 (LENS-1 #3) — ONE 件 definition on one card (spec §10). 予約N件 on the
  // line above is the day's COUNTED bookings (`isCountedBooking` — a real
  // booking, with somebody in it, that is not a tombstone). `rows` is the day
  // agenda's read, which is `includeCancelled: true` by design: the agenda is
  // the LEDGER and draws cancellations as tombstones. This card is the SUMMARY
  // of the number beside it, so it counts what that number counts — through the
  // app's own spelling of the predicate on a view row, the same filter the
  // desktop grid and the phone list already use. Without it a day with 3
  // bookings and 4 cancellations printed 「3件 … 他2件」, and a day whose six
  // bookings were all cancelled printed 「0件」 above five キャンセル済み rows.
  const counted = shownRows.filter((r) => !r.isCancelled && !r.isNoShow)
  // The day page sorts by start time and lists terminal rows in their own
  // slot; the first five here are the first five THERE, so 他N件 and the day
  // page can never disagree about what the sixth row is.
  const sorted = [...counted].sort((a, b) => a.startTimeHm.localeCompare(b.startTimeHm))
  const top = closed ? [] : sorted.slice(0, MAX_ROWS)
  const extra = closed ? 0 : sorted.length - top.length

  return (
    // mock `.listcard` — the app's own card chrome, byte-identical to the
    // month grid's card above it, so the page reads as two cards and not two
    // designs.
    <div
      data-selected-day-card
      // R1-4 (LENS-1 #4) — the card has NO date header by design (§v11b: the
      // chip names the day), and since 4b a month-cell tap no longer changes
      // route, so nothing announces the region the tap was FOR. A screen reader
      // heard 「17日 選択済み」 on the cell and then silence, and reached
      // 「この日を開く →」 with no *this* anywhere in the region. The region is
      // named with the same compact JST date the chip prints — one formatter,
      // so the name and the chip can never drift.
      role="region"
      aria-label={formatCompactDateJst(jstWallTimeToDate(painted.dateIso, '00:00'), locale)}
      className={cn(
        'overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
        // R1-5 (LENS-1 #6) — the CARD owns its top breathing room, not the line
        // inside it. `DayNumbersLine` renders nothing at all when it has no row
        // and is not pending (a baked bundle older than the dayTotals DTO
        // field, which is the case its own prop comment names), and the card's
        // first booking row then sat 8 px from the card edge instead of 12.
        'pt-3',
        className,
      )}
    >
      {/* mock `.selfade{transition:opacity .12s ease}` — B3, driven by the
       *  WINDOW above and never by the network flag. Opacity is the only
       *  property that moves, so the whole thing stays on the compositor, and
       *  the content underneath changes only while this is at zero: never two
       *  contents at once, never a swap at full opacity.
       *
       *  `inert` while it is invisible closes LENS-1 #5 for the window too: an
       *  `opacity: 0` subtree keeps its tab order and its hit-testing, so the
       *  outgoing door was reachable by Tab and by touch mid-fade.
       *
       *  REDUCED MOTION is the mock's own REDUCE branch — `fade.innerHTML =
       *  seldayHTML(d)` with the opacity never touched at all. So it is not
       *  enough to drop the transition: the card must not go dark either, or a
       *  reduced-motion user gets the one thing the setting exists to prevent,
       *  a panel blinking out and back. `motion-reduce:opacity-100` keeps it
       *  lit (the variant wins at equal specificity by landing after
       *  `opacity-0` in the BUILT sheet), and the window above never opens for
       *  them, so what it keeps lit is the truth and not the previous day. */}
      <div
        data-sel-fade
        inert={fading}
        className={cn(
          'transition-opacity duration-[120ms] ease-[ease]',
          'motion-reduce:transition-none motion-reduce:opacity-100',
          fading ? 'opacity-0' : 'opacity-100',
        )}
      >
        {/* mock `.listcard .statline{padding:12px 14px 2px}` — §v11b: the
         *  numbers line is the card's first element, under the 12 px the CARD
         *  now owns (R1-5), so the breathing room the removed date header used
         *  to give survives a line that renders nothing. The 14 px becomes the
         *  row's own 16 px so the line, the rows and 他N件 share one left edge.
         *
         *  Its OWN pending branch is the mock's two shims, and its min-height
         *  is fixed — so a move never changes this line's height and the card
         *  cannot jump while the answer is in flight. A closed day renders
         *  「0件」「休」 here and the card stops. */}
        <DayNumbersLine
          row={shownTotals}
          pending={shownPending}
          soloMode={soloMode}
          // PKT-2 owns the strict 新規/再来 producer; today's newCustomerCount
          // is the QR import flag and must not print (spec §8).
          typeSlot="off"
          locale={locale}
          className="px-4 pb-0.5 pt-0"
        />

        {/* R1-2 (LENS-1 #2/#5, LENS-3 #2) — while the answer is in flight the
         *  card is the day line's two shims and NOTHING ELSE. The first port
         *  left the rows, 他N件 and the door mounted underneath and leaned on
         *  the wrapper's opacity to hide them, which is not hiding: under
         *  Reduce Motion the wrapper stays lit (the `motion-reduce` variant
         *  wins at equal specificity) and the card showed the PREVIOUS day's
         *  bookings under a chip already naming the new one, and in every mode
         *  the invisible 44 px door stayed focusable and hit-testable and
         *  opened the day the page had left. Spec §4's 「pending → two
         *  shimmers, nothing else」 is a DOM rule, not an opacity one. */}
        {!shownPending && (
          <>
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

            {/* mock `.selempty{padding:10px 14px 2px;font-size:13.5px}` — a day
             *  with nothing on it SAYS so, and still offers its door: an empty
             *  day is where a booking gets made. */}
            {!closed && top.length === 0 && (
              <p className="m-0 px-4 pb-0.5 pt-2.5 text-[13.5px] text-zinc-500 dark:text-zinc-400">
                {t('noBookings')}
              </p>
            )}

            {/* mock `.selmore{padding:8px 14px 0;font-size:12.5px;
             *  font-weight:600}`. The wording is the app's own 「他{n}件」
             *  pattern (native pass 2 row D-3); the mock's 「+N 他」 is dead
             *  wording. */}
            {extra > 0 && (
              <div className="px-4 pt-2 text-[12.5px] font-semibold text-zinc-500 dark:text-zinc-400">
                {t('moreRows', { n: extra })}
              </div>
            )}

            {/* mock `.seldoor{height:44px;margin:10px;border-radius:12px;
             *  background:var(--wash);color:var(--blue);font-size:14px;
             *  font-weight:700}` — `--wash` is rgba(37,99,235,.08), which is the
             *  app's `bg-primary/8`: the R13 selected/pressed recipe, never a
             *  black or solid fill (CLAUDE.md). A closed, empty day has no day
             *  to open, so it gets no door.
             *
             *  The press is the week rows' own spelling — `scale` named outright
             *  because Tailwind v4 emits it as a standalone property (R3-14),
             *  and cancelled by a variant at equal specificity under reduced
             *  motion. */}
            {!closed && (
              <button
                type="button"
                onClick={() => onOpenDay(painted.dateIso)}
                className={cn(
                  // R1-6 (LENS-3 #6) — no `gap-[5px]`: the arrow lives inside
                  // the string (「この日を開く →」), so the flex container has a
                  // single text child and the mock's own gap never applied.
                  'm-2.5 flex h-11 w-[calc(100%-20px)] items-center justify-center rounded-[12px]',
                  'bg-primary/8 text-[14px] font-bold text-primary',
                  'transition-[scale] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]',
                  'motion-reduce:transition-none motion-reduce:active:scale-100',
                  'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                )}
              >
                {t('openDay')}
              </button>
            )}
          </>
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
