'use client'

// Staff cancel / restore for a booking.
//
// confirm mode — opened by LONG-PRESSING an active booking card. The
// hold-to-cancel pill IS the confirmation: a deliberate ~0.9s press fills the
// pill from the center, then it bursts away and the booking is CANCELLED. No
// separate confirm dialog (a hold can't happen by accident; a dialog gets
// tapped through on autopilot). Ticket-neutral by design — the no-show flow
// with the burn choice arrives once core ships NO_SHOW + status_reason.
//
// cancelled mode — opened by TAPPING a greyed キャンセル済み row. Shows the
// cancelled state and offers 元に戻す (undo): a mis-cancel needs a one-tap
// exit; restoring a booking the customer really cancelled upstream self-heals
// on the next QR crawl.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { toast } from 'sonner'
import { Ban, RotateCcw, X } from 'lucide-react'
import { cancelAppointment, restoreAppointment } from '@/actions/appointments'
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
  const [progress, setProgress] = useState(0)
  const [burst, setBurst] = useState(false)
  const raf = useRef(0)
  const holdStart = useRef(0)
  const firing = useRef(false)

  const stopHold = useCallback(() => {
    cancelAnimationFrame(raf.current)
    if (!firing.current) setProgress(0)
  }, [])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const fire = useCallback(async () => {
    if (!booking || firing.current) return
    firing.current = true
    setBurst(true)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(30)
    const res = await cancelAppointment(booking.id)
    if ('error' in res) {
      toast.error(res.error)
      firing.current = false
      setBurst(false)
      setProgress(0)
      return
    }
    toast.success(t('done', { name: booking.customerName }))
    router.refresh()
    // Let the burst animation finish before the sheet leaves.
    setTimeout(() => {
      firing.current = false
      setBurst(false)
      setProgress(0)
      onClose()
    }, 320)
  }, [booking, onClose, router, t])

  const beginHold = useCallback(
    (e: React.PointerEvent) => {
      if (busy || firing.current) return
      e.preventDefault()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      holdStart.current = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - holdStart.current) / HOLD_MS)
        setProgress(p)
        if (p >= 1) {
          void fire()
        } else {
          raf.current = requestAnimationFrame(step)
        }
      }
      raf.current = requestAnimationFrame(step)
    },
    [busy, fire],
  )

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'confirm' ? t('title') : t('cancelledTitle')}
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

            <div
              className={cn(
                'relative h-13 select-none overflow-hidden rounded-full border border-red-200 bg-red-50 transition-all dark:border-red-500/30 dark:bg-red-500/10',
                burst && 'scale-[0.15] opacity-0 duration-300 ease-in',
              )}
              style={{ height: 52, touchAction: 'none' }}
              onPointerDown={beginHold}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              role="button"
              aria-label={t('holdLabel')}
            >
              {/* The fill is itself a rounded CAPSULE growing from the center
               *  (Liam's progression spec) — fully rounded ends, no glow, not a
               *  hard-edged wipe. min-width from the first frame so it emerges
               *  as a dot-capsule, never a sliver. */}
              {progress > 0 && (
                <div
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500"
                  style={{
                    width: `max(${progress * 100}%, 44px)`,
                    height: 44,
                  }}
                />
              )}
              <div
                className={cn(
                  'pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold',
                  progress > 0.45 ? 'text-white' : 'text-red-600 dark:text-red-300',
                )}
              >
                <Ban className="size-4" />
                {t('holdLabel')}
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {progress > 0 && !burst ? t('holdKeep') : t('holdHint')}
            </p>
          </>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-sm text-muted-foreground">
              <Ban className="size-4 shrink-0" />
              {t('cancelledBody')}
            </div>
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
