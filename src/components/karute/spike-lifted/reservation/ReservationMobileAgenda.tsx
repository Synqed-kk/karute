'use client'

// LIFTED FROM SPIKE (visual: verbatim)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/reservation/MobileReservationAgenda.tsx
//
// Rich row layout for the 予約 tab on mobile. Each row shows:
//   - 3px left status stripe (green = 予約済, orange = 施術中,
//     blue = 新規, grey = 完了)
//   - Time + duration in the left gutter (HH:MM big, NN分 small)
//   - Family-initial avatar (5x5) + customer name + 様 honorific
//   - 施術中: animated pulsing Radio icon next to the name (live indicator)
//   - Service line (e.g. フェイシャル・保湿強化) — hidden when title is empty
//   - 担当 + staff name with a 1.5x1.5 colored dot
//   - Status pill on the right (filled tinted bg + border, from the shared
//     BADGE_COLORS source — matches the customer-record badge style)
//   - Completed rows render at opacity-60 to fade out finished sessions
//
// Replaces the old card-style agenda (per-row tinted bg, larger avatar,
// dot-as-live-indicator) which Liam called out as too far from the spike.
//
// ANTHONY: real-time refresh (so the 施術中 pill flips automatically when
// the clock crosses a start_time) is not wired — the page is server-rendered
// and only updates on navigation/refresh. A 60s revalidate or a client-side
// `useEffect` interval would handle the live transition; out of scope for
// this UI pass.

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Radio } from 'lucide-react'
import { PackPill } from '@/components/reservation/AppointmentCard'
import { useLongPress } from '@/hooks/use-long-press'

import type { DisplayStatus, ReservationView } from '@/lib/adapters/reservation-view'
import { getStaffColorByKey } from '@/lib/staff-colors'
import { BADGE_COLORS } from '@/lib/badge-styles'
import { cn } from '@/lib/utils'

// Mid-day 残りN件・次… bar — built and working (bottom-pinned), but Liam
// parked it as unnecessary for now (2026-06-12). Flip to true to bring it
// back; the spacer + bar are gated together so re-enabling is one line.
const SHOW_MIDDAY_BAR = false

interface Props {
  reservations: ReservationView[]
  onSelect?: (view: ReservationView) => void
  /** Long-press (450ms) on an ACTIVE row — opens the staff cancel sheet. A
   *  gesture rather than an action-sheet row because the shared
   *  BookingActionSheet (@synqed-kk/ui) has no extra-action slot yet; a menu
   *  entry joins once it does. */
  onLongPress?: (view: ReservationView) => void
  /** Tap on a greyed キャンセル済み row — opens the cancelled sheet (details +
   *  元に戻す). Separate from onSelect so a cancelled slot can never open the
   *  record/karute action sheet. */
  onSelectCancelled?: (view: ReservationView) => void
  /** JST yyyy-mm-dd of the day being viewed — the timeline's live elements
   *  (now-line/次/sticky bar) render only when it equals the client's today. */
  selectedDateYmd?: string
}

// Each booking status → a color from the shared BADGE_COLORS source, so these
// pills match the customer-record badges exactly. Colors (Liam, 2026-06-03):
//   予約済 booked = green · 施術中 in_session = orange · 完了 completed = slate ·
//   新規 new = blue  (新規 is blue everywhere — matches the customer record).
interface StatusVisuals {
  /** Solid color for the 3px left stripe. */
  stripe: string
  /** Filled pill: bg + text + border — the canonical badge look. */
  bg: string
  text: string
  border: string
}

const STATUS_VISUALS: Record<DisplayStatus, StatusVisuals> = {
  booked: {
    stripe: BADGE_COLORS.green.solid,
    bg: BADGE_COLORS.green.bg,
    text: BADGE_COLORS.green.text,
    border: BADGE_COLORS.green.border,
  },
  in_session: {
    stripe: BADGE_COLORS.orange.solid,
    bg: BADGE_COLORS.orange.bg,
    text: BADGE_COLORS.orange.text,
    border: BADGE_COLORS.orange.border,
  },
  completed: {
    stripe: BADGE_COLORS.slate.solid,
    bg: BADGE_COLORS.slate.bg,
    text: BADGE_COLORS.slate.text,
    border: BADGE_COLORS.slate.border,
  },
  new: {
    stripe: BADGE_COLORS.blue.solid,
    bg: BADGE_COLORS.blue.bg,
    text: BADGE_COLORS.blue.text,
    border: BADGE_COLORS.blue.border,
  },
}

export function ReservationMobileAgenda({
  reservations,
  onSelect,
  onLongPress,
  onSelectCancelled,
  selectedDateYmd,
}: Props) {
  const t = useTranslations('reservation')
  const sorted = [...reservations].sort((a, b) =>
    a.startTimeHm.localeCompare(b.startTimeHm),
  )

  // Timeline (B+C hybrid): the red now-line, 次 marker and sticky bar are
  // CLIENT-CLOCK elements — they appear only on today's view and only after
  // mount (the server can't know the viewer's clock; null = render nothing,
  // so hydration always matches).
  const [nowHm, setNowHm] = useState<string | null>(null)
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const ymdFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' })
    const tick = () => {
      const today = ymdFmt.format(new Date())
      setNowHm(
        !selectedDateYmd || selectedDateYmd === today
          ? fmt.format(new Date())
          : null,
      )
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [selectedDateYmd])

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        {t('mobile.empty')}
      </div>
    )
  }

  // Where the now-line slots in + who is 次 (first future booked/new row).
  const nowIdx = nowHm ? sorted.findIndex((r) => r.startTimeHm > nowHm) : -1
  const next = nowHm
    ? sorted.find(
        (r) =>
          (r.displayStatus === 'booked' || r.displayStatus === 'new') &&
          r.startTimeHm >= nowHm,
      )
    : undefined
  const remaining = sorted.filter((r) => r.displayStatus !== 'completed').length

  const nowLine = (
    <div className="flex items-center gap-3 px-4 py-1" aria-hidden>
      <span className="w-12 shrink-0 text-[10px] font-bold tabular-nums text-red-500">
        {nowHm}
      </span>
      <span className="size-2 shrink-0 rounded-full bg-red-500" />
      <span className="h-px flex-1 bg-red-500/60" />
    </div>
  )

  return (
    <>
      <div className="overflow-hidden rounded-xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/5 dark:ring-white/5">
        <div className="divide-y divide-black/5 dark:divide-white/5">
          {sorted.map((r, i) => (
            <div key={r.id}>
              {i === nowIdx && nowLine}
              <AgendaRow
                reservation={r}
                onSelect={onSelect}
                onLongPress={onLongPress}
                onSelectCancelled={onSelectCancelled}
                isNext={next?.id === r.id}
              />
            </div>
          ))}
          {nowIdx === -1 && nowHm !== null && sorted.length > 0 && nowLine}
        </div>
      </div>
      {/* Bottom-pinned mid-day bar — the two numbers staff glance for
       *  between sessions. Today only; hidden once the day is done.
       *  position:fixed (NOT sticky) so it stays pinned to the viewport
       *  bottom instead of riding up with the list on scroll: the scroll
       *  container is <main> and the tab bar is a flex sibling below it
       *  (h-16 + safe-area), which the bottom offset clears. The in-flow
       *  spacer lets the last card scroll clear of the now-floating bar. */}
      {SHOW_MIDDAY_BAR && nowHm && remaining > 0 && (
        <>
          <div aria-hidden className="h-20" />
          <div className="fixed inset-x-4 bottom-[calc(4rem_+_env(safe-area-inset-bottom)_+_0.5rem)] z-30 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card/95 px-3.5 py-2 text-xs shadow-lg backdrop-blur tabular-nums">
            <span className="font-semibold text-foreground">
              {t('mobile.stickyRemaining', { n: remaining })}
            </span>
            {next && (
              <span className="text-muted-foreground">
                {t('mobile.stickyNext', {
                  time: next.startTimeHm,
                  name: next.customerName,
                })}
              </span>
            )}
          </div>
        </>
      )}
    </>
  )
}

function AgendaRow({
  reservation: r,
  onSelect,
  onLongPress,
  onSelectCancelled,
  isNext = false,
}: {
  reservation: ReservationView
  onSelect?: (view: ReservationView) => void
  onLongPress?: (view: ReservationView) => void
  onSelectCancelled?: (view: ReservationView) => void
  isNext?: boolean
}) {
  const t = useTranslations('reservation.card')
  const tStatus = useTranslations('reservation.status')
  const visuals = STATUS_VISUALS[r.displayStatus]
  const isLive = r.displayStatus === 'in_session'
  const isCompleted = r.displayStatus === 'completed'
  const honorific = t('customerSuffix')
  const interactive = !!onSelect
  const staff = getStaffColorByKey(r.staffColorKey)
  // Press-and-hold on an ACTIVE row = cancel. The hook separates hold from
  // tap, so a regular tap still opens the action sheet; hooks run
  // unconditionally, gating happens where the handlers are spread.
  const holdHandlers = useLongPress({
    onLongPress: () => onLongPress?.(r),
    onShortTap: () => onSelect?.(r),
  })
  // Past rows collapse to a single line (timeline density) — first tap
  // expands to the full card; the expanded card's tap opens the action sheet
  // as before. Liam's keeps: the stripe AND the avatar survive even here.
  const [expanded, setExpanded] = useState(false)

  if (r.isCancelled || r.isNoShow) {
    // キャンセル済み / 無断キャンセル tombstone — thin, in its original slot so
    // staff see the opening. Same rendering whether QuickReserve auto-cancelled
    // it or staff hold-cancelled/no-showed it (one rule). Tap opens the sheet
    // in restore mode (details + 元に戻す) — never the record action sheet.
    // NO_SHOW gets a warning (amber) tint instead of grey — a customer no-show
    // is an exception staff should notice, not just a freed slot.
    return (
      <button
        type="button"
        onClick={() => onSelectCancelled?.(r)}
        disabled={!onSelectCancelled}
        className={cn(
          'relative flex w-full items-center gap-2.5 px-4 py-2 text-left transition-opacity active:opacity-80',
          r.isNoShow ? 'opacity-90' : 'opacity-55',
        )}
      >
        <span
          className={cn(
            'w-12 shrink-0 text-[13px] font-semibold tabular-nums line-through',
            r.isNoShow ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {r.startTimeHm}
        </span>
        <span
          className={cn(
            'min-w-0 truncate text-[13px] line-through',
            r.isNoShow ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {r.customerName}
          {honorific && <span className="ml-0.5 text-[11px]">{honorific}</span>}
        </span>
        {r.karuteNumber && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/80">
            {r.karuteNumber}
          </span>
        )}
        <span
          className={cn(
            'ml-auto inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-medium',
            r.isNoShow
              ? `${BADGE_COLORS.amber.bg} ${BADGE_COLORS.amber.text} ${BADGE_COLORS.amber.border}`
              : 'border-border/70 text-muted-foreground',
          )}
        >
          {r.isNoShow ? t('noShow') : t('cancelled')}
        </span>
      </button>
    )
  }

  if (isCompleted && !expanded) {
    const showUnrecorded = !r.isCancelled && !r.karuteRecordId
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="relative flex w-full items-center gap-2.5 px-4 py-2 text-left opacity-60 transition-colors active:bg-black/[0.02]"
      >
        <span
          aria-hidden
          className={`absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-full ${visuals.stripe}`}
        />
        <span
          className={`w-12 shrink-0 text-[13px] font-semibold tabular-nums text-foreground ${
            r.isCancelled ? 'line-through' : ''
          }`}
        >
          {r.startTimeHm}
        </span>
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold ring-1 ring-black/5',
            staff.bg,
            staff.text,
          )}
          aria-hidden
        >
          {r.customerInitials}
        </span>
        <span className="min-w-0 truncate text-[13px] text-foreground">
          {r.customerName}
          {honorific && (
            <span className="ml-1 text-[11px] text-muted-foreground">{honorific}</span>
          )}
        </span>
        {showUnrecorded && (
          <span
            className={`ml-auto inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-medium ${BADGE_COLORS.amber.bg} ${BADGE_COLORS.amber.text} ${BADGE_COLORS.amber.border}`}
          >
            {t('unrecorded')}
          </span>
        )}
      </button>
    )
  }

  const content = (
    <>
      {/* Status accent stripe — absolute left edge */}
      <span
        aria-hidden
        className={`absolute bottom-3.5 left-0 top-3.5 w-[3px] rounded-r-full ${visuals.stripe}`}
      />

      {/* Time + duration column */}
      <div className="w-12 shrink-0 text-left">
        <div
          className={`text-[17px] font-semibold leading-none tabular-nums text-foreground ${
            r.isCancelled ? 'line-through' : ''
          }`}
        >
          {r.startTimeHm}
        </div>
        <div className="mt-1 text-[11px] leading-none tabular-nums text-muted-foreground">
          {t('duration', { n: r.durationMin })}
        </div>
        {isNext && (
          <div className="mt-1 text-[9px] font-bold leading-none text-foreground">
            {t('nextUp')}
          </div>
        )}
      </div>

      {/* Main column: name, service, 担当 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ring-1 ring-black/5',
              staff.bg,
              staff.text,
            )}
            aria-hidden
          >
            {r.customerInitials}
          </span>
          <span className="min-w-0 truncate text-[15px] font-medium text-foreground">
            {r.customerName}
          </span>
          {honorific && (
            <span className="shrink-0 text-[12px] text-muted-foreground">{honorific}</span>
          )}
          {/* Karute number beside the name — the SAME #00139 the 顧客 list +
           *  customer profile show (computed in the page adapter, deterministic).
           *  shrink-0 so it never wraps; the name truncates instead. */}
          {r.karuteNumber && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {r.karuteNumber}
            </span>
          )}
          {isLive && (
            <Radio
              className="size-3 shrink-0 animate-pulse text-orange-600 dark:text-orange-400"
              aria-label="live"
            />
          )}
        </div>

        {/* Service — hidden when title is empty (no misleading "セッション"
         *  fallback). Duration is already in the left column. */}
        {(r.service || r.pack) && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-foreground/85">
            {r.service && <span className="min-w-0 truncate">{r.service}</span>}
            {/* 残N/M — the morning-scan prep signal (pack holders only; the
             *  desktop grid has shown this since #224, mobile never did). */}
            {r.pack && (
              <span className="shrink-0">
                <PackPill remaining={r.pack.remaining} size={r.pack.size} />
              </span>
            )}
          </div>
        )}

        {/* 担当 line — only renders when we have a staff name to show. */}
        {r.staffName && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-muted-foreground">
            <span
              className={cn('inline-block size-1.5 shrink-0 rounded-full', staff.stripe)}
              aria-hidden
            />
            <span className="truncate">
              {t('tantou', { name: r.staffName })}
            </span>
          </div>
        )}
      </div>

      {/* Status + 更新案内 — pinned to the TOP-RIGHT corner (self-start) and
       *  stacked VERTICALLY (flex-col) so two badges never sit side-by-side
       *  eating horizontal space. The status pill holds the corner on every
       *  card; the amber 更新案内 action flag hangs directly beneath it when
       *  the customer's pack is finished. */}
      <div className="flex shrink-0 flex-col items-end gap-1 self-start">
        {/* EXCEPTIONS-ONLY (Liam): 予約済/完了 are the default states — the
         *  stripe + dimming already say them quietly. Pills are reserved for
         *  states that change staff behavior. */}
        {(r.displayStatus === 'new' || r.displayStatus === 'in_session') && (
          <span
            className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium ${visuals.bg} ${visuals.text} ${visuals.border}`}
          >
            {tStatus(r.displayStatus)}
          </span>
        )}
        {r.needsRenewal && (
          <span
            className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium ${BADGE_COLORS.amber.bg} ${BADGE_COLORS.amber.text} ${BADGE_COLORS.amber.border}`}
          >
            {t('renewalFlag')}
          </span>
        )}
        {/* Done-but-unrecorded: the forgot-to-record failure mode caught the
         *  same day, on the page staff already stare at. Cancelled rows have
         *  nothing to record — excluded. */}
        {r.displayStatus === 'completed' && !r.isCancelled && !r.karuteRecordId && (
          <span
            className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium ${BADGE_COLORS.amber.bg} ${BADGE_COLORS.amber.text} ${BADGE_COLORS.amber.border}`}
          >
            {t('unrecorded')}
          </span>
        )}
      </div>

    </>
  )

  const rowClass = `relative flex min-h-[72px] items-start gap-3 px-4 py-3.5 ${
    isCompleted ? 'opacity-60' : ''
  } ${isNext ? 'ring-1 ring-inset ring-foreground/15' : ''} ${
    interactive ? 'cursor-pointer text-left transition-colors active:bg-black/[0.02]' : ''
  }`

  if (interactive) {
    // No onClick: the hold hook's onShortTap carries the tap (and swallows the
    // click that trails a completed hold). touch-action pan-y keeps vertical
    // scrolling native — a scroll fires pointercancel and aborts the hold.
    return (
      <button
        type="button"
        {...holdHandlers}
        onContextMenu={(e) => e.preventDefault()}
        style={{ touchAction: 'pan-y' }}
        className={`${rowClass} w-full`}
      >
        {content}
      </button>
    )
  }
  return <div className={rowClass}>{content}</div>
}
