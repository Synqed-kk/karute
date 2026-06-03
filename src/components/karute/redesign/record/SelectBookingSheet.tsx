'use client'

// ============================================================
// SelectBookingSheet — pick a booking to record
// ============================================================
// LIFTED FROM SPIKE (visual + flow). Source:
//   /Users/liam/Documents/synqed-karute-design-spike/src/
//     components/record/SelectBookingSheet.tsx
//
// Opens from RecordingTargetCard's 「別の予約を選択」 button.
// Lists today's bookings; tapping a row swaps the recording
// target. Bottom sheet capped at max-h-[85vh]; the list below is a
// `min-h-0 flex-1 overflow-y-auto` child so it scrolls *within* the
// cap. min-h-0 is load-bearing — without it the flex child grows
// past the cap and the late bookings spill off-screen, unreachable
// (that was the reported bug: 20:00 rows couldn't be reached).
//
// EMPTY STATE — when nearbyBookings is empty, surface the same
// 対応予定 scaffolding copy the popover used (matches the karute
// project's existing pattern from PickerScaffold). Auto-degrades
// to the real list the moment the booking-list query returns
// rows.
//
// ANTHONY: when you wire the today's-bookings query end-to-end
// (see MERGE_NOTES_FOR_ANTHONY.md's schema-drift section + the
// nextAppointment query in sessions/page.tsx), this component
// needs zero changes — RecordingTargetCard already passes the
// fetched rows through via `nearbyBookings`. The empty-state
// branch simply stops rendering once that prop has entries.
// ============================================================

import { useTranslations } from 'next-intl'
import { Check, Clock } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'

import type { RecordTargetBooking } from './RecordingTargetCard'
import { BADGE_COLORS } from '@/lib/badge-styles'
import { getStaffColorByKey } from '@/lib/staff-colors'

interface SelectBookingSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookings: RecordTargetBooking[]
  /** Id of the currently-active booking — gets the blue ring +
   *  check pill so staff can see which row they're already on. */
  currentBookingId?: string | null
  onSelect: (booking: RecordTargetBooking) => void
}

// Booking-status pills derive from the shared BADGE_COLORS source — identical to
// the agenda + customer + dashboard badges. 予約済 booked = green, 新規 new = blue
// (the app-wide swap); 施術中 in-session = orange; 完了 done = slate.
const STATUS_TONE: Record<RecordTargetBooking['statusKey'], string> = {
  done: `${BADGE_COLORS.slate.bg} ${BADGE_COLORS.slate.text} ${BADGE_COLORS.slate.border}`,
  'in-session': `${BADGE_COLORS.orange.bg} ${BADGE_COLORS.orange.text} ${BADGE_COLORS.orange.border}`,
  booked: `${BADGE_COLORS.green.bg} ${BADGE_COLORS.green.text} ${BADGE_COLORS.green.border}`,
  new: `${BADGE_COLORS.blue.bg} ${BADGE_COLORS.blue.text} ${BADGE_COLORS.blue.border}`,
}

export function SelectBookingSheet({
  open,
  onOpenChange,
  bookings,
  currentBookingId = null,
  onSelect,
}: SelectBookingSheetProps) {
  const t = useTranslations('recording.target')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0"
      >
        <SheetHeader className="gap-1 border-b border-border/60 px-5 pb-3 pt-5">
          <SheetTitle className="flex items-center gap-2 text-[15px]">
            <Clock className="size-4 text-sky-500" aria-hidden />
            {t('sheetTitle')}
          </SheetTitle>
          <SheetDescription className="text-[12px]">
            {t('sheetDescription')}
          </SheetDescription>
        </SheetHeader>

        {bookings.length === 0 ? (
          // Empty state — 対応予定 scaffolding so staff + Anthony
          // see the contract for the populated path above.
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
            <div className="flex gap-2 rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 p-4 dark:border-blue-500/30 dark:bg-blue-500/[0.06]">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    {t('pickerScaffoldLabel')}
                  </span>
                </div>
                <p className="text-[13px] italic leading-relaxed text-muted-foreground">
                  {t('pickerScaffoldBody')}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <ul
            role="listbox"
            aria-label={t('sheetTitle')}
            className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3"
          >
            {bookings.map((b) => {
              const isCurrent = b.id === currentBookingId
              const staffColor = getStaffColorByKey(b.staffColorKey)
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    onClick={() => onSelect(b)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left ring-1 transition-colors',
                      isCurrent
                        ? 'bg-sky-50 ring-sky-300 dark:bg-sky-500/10 dark:ring-sky-500/30'
                        : 'bg-card ring-border hover:bg-muted/60',
                    )}
                  >
                    {/* Check lane — invisible spacer when not active so
                     *  rows stay left-aligned regardless. */}
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex size-5 shrink-0 items-center justify-center rounded-full',
                        isCurrent
                          ? 'bg-sky-600 text-white'
                          : 'text-transparent',
                      )}
                    >
                      {isCurrent && <Check className="size-3" aria-hidden />}
                    </span>
                    {/* Time + duration */}
                    <div className="w-[50px] shrink-0 text-[12px] font-semibold tabular-nums text-foreground/90">
                      {b.start}
                      <span className="mt-0.5 block text-[10px] font-normal tabular-nums text-muted-foreground">
                        {durationLabel(b.start, b.end, t)}
                      </span>
                    </div>
                    {/* Avatar — colored by the booking's staff (same as the
                     *  予約 agenda), neutral fallback when no staff. Subtle
                     *  tint + dark text from the shared staff palette. */}
                    <span
                      className={cn(
                        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                        staffColor.bg,
                        staffColor.text,
                      )}
                    >
                      {b.initials}
                    </span>
                    {/* Customer + karute # + service */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1">
                        <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
                          {b.customer}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {t('honorific')}
                        </span>
                        {b.karute && (
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                            {b.karute}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {b.service}
                      </div>
                    </div>
                    {/* Status pill */}
                    <span
                      className={cn(
                        'inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium',
                        STATUS_TONE[b.statusKey],
                      )}
                    >
                      {b.statusLabel}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  )
}

// Best-effort duration string from start/end HH:MM. Real booking
// rows already carry duration on the source `appointments` table —
// we don't have it on the picker shape, so derive it from the
// HH:MM range. Stable + no clock import needed.
function durationLabel(
  start: string,
  end: string,
  t: ReturnType<typeof useTranslations>,
): string {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return ''
  let minutes = eh * 60 + em - (sh * 60 + sm)
  if (minutes < 0) minutes += 24 * 60 // crossed midnight (rare)
  return t('durationMinutes', { n: minutes })
}
