'use client'

// Staff cancel / no-show / restore for a booking.
//
// confirm mode — opened by LONG-PRESSING an active booking card. The
// hold-to-cancel pill IS the confirmation: a deliberate ~0.9s press fills the
// pill from the center, then it bursts away and the booking is CANCELLED. No
// separate confirm dialog (a hold can't happen by accident; a dialog gets
// tapped through on autopilot). Ticket-neutral by design — cancel and no-show
// are separate, deliberate staff choices (a no-show is the one that may burn
// a ticket). Below the cancel pill, a collapsed 無断キャンセル section opens
// into reason chips + an optional burn toggle + its own hold pill in warning
// styling — same hold mechanics (useHoldToConfirm), different action + tint.
//
// cancelled mode — opened by TAPPING a greyed キャンセル済み OR amber 無断
// キャンセル row. Shows the terminal state (+ the stored reason for a
// no-show) and offers 元に戻す (undo): restore is status-only both ways — it
// never re-issues a burned ticket; unburning is a separate, explicit action.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { toast } from 'sonner'
import { AlertTriangle, Ban, ChevronDown, RotateCcw, X } from 'lucide-react'
import {
  cancelAppointment,
  getBurnablePackSummary,
  markNoShowAppointment,
  restoreAppointment,
} from '@/actions/appointments'
import {
  CANCEL_REASONS,
  LEGACY_NO_SHOW_REASONS,
  NO_SHOW_REASON_NO_CONTACT,
  type CancelReason,
} from '@/lib/appointments/status'
import { useHoldToConfirm } from '@/hooks/use-hold-to-confirm'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import { formatCompactDateJst, hmInJst } from '@/lib/date/jst'
import { cn } from '@/lib/utils'

const HOLD_MS = 900

interface CancelBookingSheetProps {
  booking: ReservationView | null
  mode: 'confirm' | 'cancelled'
  onClose: () => void
}

export function CancelBookingSheet({ booking, mode, onClose }: CancelBookingSheetProps) {
  const t = useTranslations('reservation.cancelSheet')
  const tc = useTranslations('reservation')
  const locale = useLocale()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const [noShowOpen, setNoShowOpen] = useState(false)
  // Optional reason for the NORMAL cancel (taxonomy fix 2026-07-10): a cancel
  // implies contact — the chips record how. Toggleable, none preselected (an
  // un-reasoned cancel is valid; don't force a tap). The no-show side asks
  // nothing: 無断 IS the reason, and first-time/repeat is DERIVED below.
  const [cancelReason, setCancelReason] = useState<CancelReason | null>(null)
  const [burnPack, setBurnPack] = useState(false)
  const [packSummary, setPackSummary] = useState<{ packId: string; remaining: number } | null>(null)
  const packFetched = useRef(false)
  // The CURRENT target's id — in-flight pack fetches compare against this so
  // a slow response for a previous booking can't stamp its data on this one.
  const bookingIdRef = useRef<string | null>(null)

  // Reset both sections whenever a different booking is targeted.
  useEffect(() => {
    bookingIdRef.current = booking?.id ?? null
    setNoShowOpen(false)
    setCancelReason(null)
    setBurnPack(false)
    setPackSummary(null)
    packFetched.current = false
  }, [booking?.id])

  const cancelHold = useHoldToConfirm(HOLD_MS, useCallback(async () => {
    if (!booking) return
    const res = await cancelAppointment(
      booking.id,
      cancelReason ? { reason: cancelReason } : undefined,
    )
    if ('error' in res) {
      // Generic key, never res.error raw — server errors are English/internal
      // (requireCapability, SynqedError) and this is a Japanese-first UI.
      // Same policy the no-show path below has had since it shipped.
      toast.error(t('cancelErrorGeneric'))
      cancelHold.reset()
      return
    }
    toast.success(t('done', { name: booking.customerName }))
    router.refresh()
    setTimeout(() => {
      cancelHold.reset()
      onClose()
    }, 320)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking, cancelReason, onClose, router, t]))

  const noShowHold = useHoldToConfirm(HOLD_MS, useCallback(async () => {
    if (!booking) return
    const res = await markNoShowAppointment(booking.id, {
      burnPack: burnPack && !!packSummary,
    })
    if ('error' in res) {
      toast.error(
        res.code === 'no_burnable_pack' || res.code === 'already_terminal'
          ? t(`noShowError.${res.code}`)
          : t('noShowErrorGeneric'),
      )
      noShowHold.reset()
      return
    }
    if (res.burnError) {
      // Partial outcome: the no-show IS recorded but the ticket was NOT
      // consumed — staff must hear both halves, not a success toast.
      toast.warning(t(`noShowBurnWarn.${res.burnError}`, { name: booking.customerName }))
    } else {
      toast.success(t('noShowDone', { name: booking.customerName }))
    }
    router.refresh()
    setTimeout(() => {
      noShowHold.reset()
      onClose()
    }, 320)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking, burnPack, onClose, packSummary, router, t]))

  const toggleNoShowSection = useCallback(() => {
    setNoShowOpen((v) => !v)
    if (!packFetched.current && booking) {
      packFetched.current = true
      const forBookingId = booking.id
      void getBurnablePackSummary(booking.clientId).then((summary) => {
        // Staleness guard: a slow fetch for booking A resolving after the
        // sheet re-targeted booking B must not attach A's pack count/burn
        // availability to B's sheet. (The server re-derives the real burn
        // target independently — this is display truth, not burn truth.)
        setPackSummary((prev) =>
          bookingIdRef.current === forBookingId ? summary : prev,
        )
      })
    }
  }, [booking])

  const restore = useCallback(async () => {
    if (!booking || busy) return
    setBusy(true)
    const res = await restoreAppointment(booking.id)
    setBusy(false)
    if ('error' in res) {
      // Generic key, never res.error raw — see the cancel handler.
      toast.error(t('restoreErrorGeneric'))
      return
    }
    toast.success(t('restored', { name: booking.customerName }))
    router.refresh()
    onClose()
  }, [booking, busy, onClose, router, t])

  if (!booking) return null

  // Stored status_reason → label. Three vocabularies may appear on old/new
  // rows: the fixed no-show code, the cancel chips, and the two LEGACY
  // no-show chips (rows recorded before the 2026-07-10 taxonomy fix).
  const reasonLabel = (code: string) => {
    if (code === NO_SHOW_REASON_NO_CONTACT) return t(`noShowReasons.${code}`)
    if ((LEGACY_NO_SHOW_REASONS as readonly string[]).includes(code))
      return t(`noShowReasons.${code}`)
    if ((CANCEL_REASONS as readonly string[]).includes(code))
      return t(`cancelReasons.${code}`)
    return code
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'confirm' ? t('title') : booking.isNoShow ? t('noShowRestoreTitle') : t('cancelledTitle')
      }
    >
      {/* select-none: the sheet opens UNDER a finger that is still mid
       *  long-press (that's how it's summoned) — without it, iOS's native
       *  text-selection gesture lands on the customer name the moment the
       *  sheet renders. */}
      <div
        className="w-full max-w-md select-none rounded-t-2xl bg-background p-5 pb-8 shadow-xl md:rounded-2xl md:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between">
          <div>
            <p className="text-base font-semibold">
              {booking.customerName}
              <span className="ml-0.5 text-sm font-normal text-muted-foreground">
                {tc('card.customerSuffix')}
              </span>
              {booking.karuteNumber && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {booking.karuteNumber}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {booking.startTimeHm} · {tc('card.duration', { n: booking.durationMin })}
              {booking.staffName && <> · {t('staffPrefix')} {booking.staffName}</>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {mode === 'confirm' ? (
          <>
            <p className="mb-1 mt-3 text-sm font-medium">{t('title')}</p>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t('ticketNote')}</p>

            {/* Optional cancel-reason chips (taxonomy fix 2026-07-10): a
             *  cancel implies contact — record how. Toggleable; none required.
             *  These were wrongly INSIDE the no-show section before, where
             *  picking 当日連絡あり branded a customer who properly called as
             *  a no-show (unfair strike + poisoned no_show_count). */}
            <div className="mb-4">
              <p className="mb-1.5 text-xs text-muted-foreground">{t('reasonOptional')}</p>
              <div className="flex flex-wrap gap-1.5">
                {CANCEL_REASONS.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setCancelReason((cur) => (cur === code ? null : code))}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      cancelReason === code
                        ? 'border-red-400 bg-red-50 text-red-700 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-300'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {t(`cancelReasons.${code}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* 案C (Liam, 2026-07-06): soft red tint — solid enough to read as
             *  a button on the white sheet, calm enough not to shout; the
             *  bright fill keeps maximum contrast against it. */}
            <div
              className={cn(
                'relative h-13 select-none overflow-hidden rounded-full border border-red-300 bg-red-100 transition-all dark:border-red-500/40 dark:bg-red-500/15',
                cancelHold.burst && 'scale-[0.15] opacity-0 duration-300 ease-in',
              )}
              style={{ height: 52, touchAction: 'none' }}
              onPointerDown={cancelHold.begin}
              onPointerUp={cancelHold.stop}
              onPointerLeave={cancelHold.stop}
              onPointerCancel={cancelHold.stop}
              role="button"
              aria-label={t('holdLabel')}
            >
              {/* The fill is a rounded capsule growing from the center (Liam's
               *  progression spec) — FULL height, flush to the track's top and
               *  bottom (no inset gap), rounded ends left/right, no glow.
               *  min-width from the first frame so it emerges as a dot, never a
               *  sliver. */}
              {cancelHold.progress > 0 && (
                <div
                  className="absolute left-1/2 top-0 h-full -translate-x-1/2 rounded-full bg-red-500"
                  style={{ width: `max(${cancelHold.progress * 100}%, 52px)` }}
                />
              )}
              <div
                className={cn(
                  'pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold',
                  cancelHold.progress > 0.45 ? 'text-white' : 'text-red-700 dark:text-red-300',
                )}
              >
                <Ban className="size-4" />
                {t('holdLabel')}
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {cancelHold.progress > 0 && !cancelHold.burst ? t('holdKeep') : t('holdHint')}
            </p>

            {/* 無断キャンセル section — collapsed by default; opening it
             *  lazy-fetches the customer's burnable pack (if any). Visually
             *  separate from the cancel pill above (border-t) so the two
             *  actions never read as one flow. */}
            <div className="mt-5 border-t border-border/60 pt-4">
              <button
                type="button"
                onClick={toggleNoShowSection}
                className="flex w-full items-center justify-between text-sm font-medium text-amber-700 dark:text-amber-400"
              >
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="size-4" />
                  {t('noShowSectionLabel')}
                  <span className="text-xs font-normal text-amber-700/70 dark:text-amber-400/70">
                    {t('noShowSectionSub')}
                  </span>
                </span>
                <ChevronDown className={cn('size-4 transition-transform', noShowOpen && 'rotate-180')} />
              </button>

              {noShowOpen && (
                <div className="mt-3 space-y-3">
                  {/* DERIVED first-time/repeat context — never a staff choice
                   *  (the old 初回の無断キャンセル chip could contradict the
                   *  data). Same no_show_count the 顧客 list badge reads. */}
                  {booking.noShowCount >= 1 ? (
                    <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      {t('noShowPriorCount', { n: booking.noShowCount })}
                    </p>
                  ) : (
                    <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                      {t('noShowFirstTime')}
                    </p>
                  )}

                  {packSummary && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={burnPack}
                        onChange={(e) => setBurnPack(e.target.checked)}
                        className="size-4 rounded border-border"
                      />
                      {t('burnPack', { n: packSummary.remaining })}
                    </label>
                  )}

                  <div
                    className={cn(
                      'relative h-13 select-none overflow-hidden rounded-full border border-amber-300 bg-amber-100 transition-all dark:border-amber-500/40 dark:bg-amber-500/15',
                      noShowHold.burst && 'scale-[0.15] opacity-0 duration-300 ease-in',
                    )}
                    style={{ height: 52, touchAction: 'none' }}
                    onPointerDown={noShowHold.begin}
                    onPointerUp={noShowHold.stop}
                    onPointerLeave={noShowHold.stop}
                    onPointerCancel={noShowHold.stop}
                    role="button"
                    aria-label={t('noShowHoldLabel')}
                  >
                    {noShowHold.progress > 0 && (
                      <div
                        className="absolute left-1/2 top-0 h-full -translate-x-1/2 rounded-full bg-amber-500"
                        style={{ width: `max(${noShowHold.progress * 100}%, 52px)` }}
                      />
                    )}
                    <div
                      className={cn(
                        'pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold',
                        noShowHold.progress > 0.45 ? 'text-white' : 'text-amber-800 dark:text-amber-300',
                      )}
                    >
                      <AlertTriangle className="size-4" />
                      {t('noShowHoldLabel')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-sm text-muted-foreground">
              <Ban className="size-4 shrink-0" />
              {booking.isNoShow ? t('noShowBody') : t('cancelledBody')}
            </div>
            {/* Reason line for BOTH terminal kinds now — cancels carry the
             *  new optional chips, no-shows the fixed code (+ legacy chips on
             *  pre-2026-07-10 rows). Absent reason → no line. */}
            {booking.statusReason && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('reason')}: {reasonLabel(booking.statusReason)}
              </p>
            )}
            {/* Sync-cancelled rows (QR crawl) carry no status_set_by — render
             *  nothing rather than an empty "操作" label. */}
            {booking.statusSetByName && booking.statusSetAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('statusSetBy', {
                  name: booking.statusSetByName,
                  date: formatCompactDateJst(new Date(booking.statusSetAt), locale),
                  time: hmInJst(new Date(booking.statusSetAt)),
                })}
              </p>
            )}
            <button
              type="button"
              onClick={restore}
              disabled={busy}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              <RotateCcw className="size-4" />
              {busy ? t('restoring') : t('restore')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
