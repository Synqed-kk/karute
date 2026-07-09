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
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { toast } from 'sonner'
import { AlertTriangle, Ban, ChevronDown, RotateCcw, X } from 'lucide-react'
import {
  cancelAppointment,
  getBurnablePackSummary,
  markNoShowAppointment,
  restoreAppointment,
} from '@/actions/appointments'
import { NO_SHOW_REASONS, type NoShowReason } from '@/lib/appointments/status'
import { useHoldToConfirm } from '@/hooks/use-hold-to-confirm'
import type { ReservationView } from '@/lib/adapters/reservation-view'
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
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const [noShowOpen, setNoShowOpen] = useState(false)
  const [noShowReason, setNoShowReason] = useState<NoShowReason>(NO_SHOW_REASONS[0])
  const [burnPack, setBurnPack] = useState(false)
  const [packSummary, setPackSummary] = useState<{ packId: string; remaining: number } | null>(null)
  const packFetched = useRef(false)

  // Reset the no-show section whenever a different booking is targeted.
  useEffect(() => {
    setNoShowOpen(false)
    setNoShowReason(NO_SHOW_REASONS[0])
    setBurnPack(false)
    setPackSummary(null)
    packFetched.current = false
  }, [booking?.id])

  const cancelHold = useHoldToConfirm(HOLD_MS, useCallback(async () => {
    if (!booking) return
    const res = await cancelAppointment(booking.id)
    if ('error' in res) {
      toast.error(res.error)
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
  }, [booking, onClose, router, t]))

  const noShowHold = useHoldToConfirm(HOLD_MS, useCallback(async () => {
    if (!booking) return
    const res = await markNoShowAppointment(booking.id, {
      reason: noShowReason,
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
  }, [booking, burnPack, noShowReason, onClose, packSummary, router, t]))

  const toggleNoShowSection = useCallback(() => {
    setNoShowOpen((v) => !v)
    if (!packFetched.current && booking) {
      packFetched.current = true
      void getBurnablePackSummary(booking.clientId).then(setPackSummary)
    }
  }, [booking])

  const restore = useCallback(async () => {
    if (!booking || busy) return
    setBusy(true)
    const res = await restoreAppointment(booking.id)
    setBusy(false)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    toast.success(t('restored', { name: booking.customerName }))
    router.refresh()
    onClose()
  }, [booking, busy, onClose, router, t])

  if (!booking) return null

  const reasonLabel = (code: string) =>
    (NO_SHOW_REASONS as readonly string[]).includes(code) ? t(`noShowReasons.${code}`) : code

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
      <div
        className="w-full max-w-md rounded-t-2xl bg-background p-5 pb-8 shadow-xl md:rounded-2xl md:pb-5"
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
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t('ticketNote')}</p>

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
                </span>
                <ChevronDown className={cn('size-4 transition-transform', noShowOpen && 'rotate-180')} />
              </button>

              {noShowOpen && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {NO_SHOW_REASONS.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setNoShowReason(code)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                          noShowReason === code
                            ? 'border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {reasonLabel(code)}
                      </button>
                    ))}
                  </div>

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
            {booking.isNoShow && booking.statusReason && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('reason')}: {reasonLabel(booking.statusReason)}
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
