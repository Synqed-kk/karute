'use client'

// ─────────────────────────────────────────────────────────────
// DiscreetRecordingIndicator — top-right "ninja dot"
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: src/components/layout/DiscreetRecording-
// Indicator.tsx (~206 lines). Visual + flow preserved.
//
// What it does
// ------------
// While a recording is active, renders a small (28px) muted
// dot in the top-right corner. The dot:
//   - Is INTENTIONALLY subtle so customers don't notice it
//   - A regular tap does NOTHING (no accidental stops)
//   - A long-press (≥450ms) reveals a popover with:
//       • "Recording active" header + pulse animation
//       • Elapsed time
//       • Stop button
//       • Privacy note + mode hint
//   - Popover auto-closes after 10s of no interaction
//   - Popover closes on outside-tap
//
// Differences from spike
// ----------------------
// 1. State comes from karute's useGlobalRecorder (not spike's
//    useRecording). Elapsed time computed from startedAt
//    instead of the spike's setInterval — matches MiniRecorder's
//    existing pattern.
// 2. Position-only mobile variant for karute. The spike's
//    desktop variant ("floating bottom-right like a FAB") isn't
//    used here — karute's desktop chrome already has a sidebar
//    + the FAB pattern doesn't fit the layout. The dot floats
//    top-right on all viewports.
// 3. Replaces the old MiniRecorder (top-center red pill with
//    pause/stop controls). Pause/resume affordance is dropped
//    to match the spike — if staff need finer control, go to
//    /ja/sessions which has the full RecordButtonCard.
//
// ANTHONY: backend MUST NOT auto-pause when this dot is
// long-pressed (no side effect on hold). The stop button inside
// the popover triggers the actual stop. Same as MiniRecorder
// previously.

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Info, ShieldCheck, Square, X } from 'lucide-react'

import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import { useLongPress } from '@/hooks/use-long-press'

const AUTO_CLOSE_MS = 10_000

export function DiscreetRecordingIndicator() {
  const t = useTranslations('discreetIndicator')
  const router = useRouter()
  const { state, startedAt, stopRecording, target } = useGlobalRecorder()
  const [open, setOpen] = useState(false)
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
  )
  const autoCloseTimer = useRef<number | null>(null)

  const isActive = state === 'recording' || state === 'paused'

  const longPress = useLongPress({
    thresholdMs: 450,
    onLongPress: () => setOpen(true),
  })

  // Tick the timer once a second while recording.
  useEffect(() => {
    if (state !== 'recording' || !startedAt) return
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [state, startedAt])

  // When recording stops, explicitly close the popover BEFORE
  // unmount. Without this, the component unmounts with `open=true`
  // mid-cycle — the mousedown / setTimeout cleanups still run, but
  // React's effect-order during unmount has occasionally left
  // pointer-capture state lingering on the dot button, which in
  // Chrome can block page-level scroll until a hard reload.
  // Closing first lets the open-effect's cleanup run cleanly,
  // then the unmount removes the rest.
  useEffect(() => {
    if (!isActive && open) setOpen(false)
  }, [isActive, open])

  // Auto-close the popover after AUTO_CLOSE_MS of no interaction.
  useEffect(() => {
    if (!open) return
    if (typeof window === 'undefined') return
    autoCloseTimer.current = window.setTimeout(
      () => setOpen(false),
      AUTO_CLOSE_MS,
    )
    return () => {
      if (autoCloseTimer.current !== null) {
        window.clearTimeout(autoCloseTimer.current)
        autoCloseTimer.current = null
      }
    }
  }, [open])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    if (typeof window === 'undefined') return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target && target.closest('[data-discreet-reveal]')) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDocClick)
    return () => window.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (!isActive) return null

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const elapsedStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return (
    <div
      data-discreet-reveal
      className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[100]"
    >
      <button
        type="button"
        aria-label={t('dotAria')}
        title={t('dotTitle')}
        {...longPress}
        className="inline-flex size-7 items-center justify-center rounded-full bg-neutral-200/80 ring-1 ring-neutral-300 transition-colors hover:bg-neutral-300 dark:bg-neutral-700/70 dark:ring-neutral-600 dark:hover:bg-neutral-600"
      >
        <span className="relative flex items-center justify-center">
          <span className="absolute inline-flex size-3 rounded-full bg-red-500/30 animate-ping" />
          <span className="relative inline-block size-1.5 rounded-full bg-red-500" />
        </span>
      </button>

      {open && (
        <div
          data-discreet-reveal
          className="absolute right-0 top-9 z-[110] w-[280px] rounded-lg bg-card p-3 shadow-xl ring-1 ring-black/10 dark:ring-white/15"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="relative flex size-4 items-center justify-center">
                <span className="absolute inline-flex size-full rounded-full bg-red-500/30 animate-ping" />
                <span className="relative inline-block size-2 rounded-full bg-red-500" />
              </span>
              <span className="text-[13px] font-semibold text-foreground">
                {t('recordingActive')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('close')}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>

          <div className="mb-2 text-[20px] font-semibold leading-none tabular-nums text-foreground">
            {elapsedStr}
          </div>

          <p className="mb-3 flex items-start gap-1 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            {t('modeHint')}
          </p>

          <p className="mb-3 flex items-start gap-1 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3 shrink-0" aria-hidden />
            {t('privacyNote')}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                // Same carry as the bottom-nav center button (field bug 8/2):
                // a bare /sessions loads the NEXT SCHEDULED booking's page
                // under the live recording. String href — thin-shell shim.
                router.push(
                  target
                    ? `/sessions?customerId=${encodeURIComponent(target.customerId)}`
                    : '/sessions',
                )
              }}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-border bg-background text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('openPage')}
            </button>
            <button
              type="button"
              onClick={() => {
                stopRecording()
                setOpen(false)
              }}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-red-600 text-[13px] font-medium text-white transition-colors hover:bg-red-700"
            >
              <Square className="size-3" fill="currentColor" />
              {t('stop')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
