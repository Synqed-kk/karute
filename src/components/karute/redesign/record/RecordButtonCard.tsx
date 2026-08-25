'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Mic } from 'lucide-react'

interface RecordButtonCardProps {
  customerName: string | null
  isRecording: boolean
  elapsedSeconds: number
  onStart: () => void
  onStop: () => void
  /** 0-1 normalized waveform bars (already smoothed). Length sets bar count. */
  waveform?: number[]
  /** Consent gate (idle button). Blocked = VISIBLY disabled (dimmed, out of
   *  tab order), not a full-strength button that silently swallows taps. */
  disabled?: boolean
  /** phase === 'recorded' — the take is stopped and waiting on discard/use. */
  ended?: boolean
  /** Seconds. Ended-state display only. */
  recordingDuration?: number
  /** 0-100 raw bars, frozen at stop. Ended-state display only. */
  frozenBars?: number[]
  /** The page's discard/use row, passed through. */
  endedActions?: ReactNode
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function formatElapsed(sec: number): string {
  return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`
}

const DEFAULT_BARS = 24

// Continuity: ONE card, ONE persistent button that morphs across the three
// phases. The 0.34,1.56 overshoot is the press curve and the glyph swap ONLY —
// it must not appear anywhere else in this batch.
// Tailwind v4 compiles scale-* to the STANDALONE `scale` property, not
// `transform` — transitioning `transform` here would leave the press and the
// glyph morph snapping. (The waveform bars are a real inline `transform:
// scaleY(...)` and are deliberately untransitioned.)
const BUTTON_BASE =
  'relative flex h-16 w-16 items-center justify-center rounded-full [transition:scale_250ms_cubic-bezier(0.34,1.56,0.64,1),background-color_200ms_var(--ease-out),color_200ms_var(--ease-out),box-shadow_200ms_var(--ease-out),opacity_200ms_var(--ease-out)] motion-safe:active:scale-[0.97] disabled:cursor-default'
const GLYPH_BASE =
  'pointer-events-none absolute inset-0 grid place-items-center [transition:opacity_200ms_var(--ease-out),scale_250ms_cubic-bezier(0.34,1.56,0.64,1)]'
const GLYPH_SHOWN = 'opacity-100 scale-100'
const GLYPH_HIDDEN = 'opacity-0 scale-[0.6]'
// Recording content grows out of the button's vicinity. No stagger, no delay —
// so no fill-mode is needed. Exit is an instant unmount (mock behavior).
const LIVE_ENTRANCE =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-[6px] motion-safe:zoom-in-[0.94] duration-[260ms] ease-(--ease-out) origin-top'
const ENDED_ENTRANCE = 'motion-safe:animate-in motion-safe:fade-in-0 duration-[260ms]'
const FLAG_ROW = 'flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em]'

export function RecordButtonCard({
  customerName,
  isRecording,
  elapsedSeconds,
  onStart,
  onStop,
  waveform,
  disabled,
  ended,
  recordingDuration,
  frozenBars,
  endedActions,
}: RecordButtonCardProps) {
  const t = useTranslations('recording.button')
  const bars = waveform && waveform.length > 0 ? waveform : Array.from({ length: DEFAULT_BARS }, (_, i) => 0.3 + ((i * 17) % 60) / 100)

  // Precedence: ended → recording → idle.
  const live = !ended && isRecording
  const idle = !ended && !isRecording

  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-7 shadow-sm">
      <div className="relative">
        <button
          type="button"
          onClick={ended ? undefined : live ? onStop : onStart}
          // Ended is a VISUAL-ONLY affordance: wiring a restart here would
          // invent a supersede path over an unsaved take.
          disabled={ended ? true : idle ? disabled : false}
          aria-label={ended ? t('ended') : live ? t('stopAria') : t('startAria')}
          className={`${BUTTON_BASE} ${
            ended
              ? 'bg-red-50/50 text-red-400 shadow-none dark:bg-red-500/10'
              : 'bg-red-500 shadow-lg shadow-red-500/40 enabled:hover:bg-red-600 disabled:opacity-50'
          }`}
        >
          <span aria-hidden className={`${GLYPH_BASE} ${live ? GLYPH_HIDDEN : GLYPH_SHOWN}`}>
            <Mic size={26} className={ended ? undefined : 'text-white'} strokeWidth={2.2} />
          </span>
          <span aria-hidden className={`${GLYPH_BASE} ${live ? GLYPH_SHOWN : GLYPH_HIDDEN}`}>
            <span className="h-5 w-5 rounded-sm bg-white" />
          </span>
        </button>
        {live && (
          <span className="pointer-events-none absolute inset-0 -m-2 rounded-full border-2 border-red-500/40 motion-safe:animate-ping" />
        )}
      </div>

      {live && (
        <>
          <div className={`${FLAG_ROW} text-red-500 ${LIVE_ENTRANCE}`}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 motion-safe:animate-pulse" />
            {t('recording')}
          </div>
          <div
            className={`text-2xl font-semibold tabular-nums tracking-tight text-foreground ${LIVE_ENTRANCE}`}
          >
            {formatElapsed(elapsedSeconds)}
          </div>
          {/* scaleY, not height: a composite-only property, so the live
              waveform never lays out on the Android webview's main thread.
              No transition — useWaveformBars already smooths the samples. */}
          <div className={`flex h-10 items-end gap-[3px] ${LIVE_ENTRANCE}`}>
            {bars.map((v, i) => (
              <span
                key={i}
                className="h-full w-[3px] origin-bottom rounded-full bg-red-500/70"
                style={{ transform: `scaleY(${Math.max(0.15, Math.min(1, v))})` }}
              />
            ))}
          </div>
        </>
      )}

      {ended && (
        <>
          <div className={`${FLAG_ROW} text-muted-foreground ${ENDED_ENTRANCE}`}>{t('ended')}</div>
          <div
            className={`text-2xl font-semibold tabular-nums tracking-tight text-foreground ${ENDED_ENTRANCE}`}
          >
            {formatElapsed(recordingDuration ?? 0)}
          </div>
          {/* Frozen bars arrive 0-100 raw (not the normalized live set), so the
              0.6 dim factor divides by 100 to land in scaleY's 0-1 range. */}
          <div className={`flex h-10 items-end gap-[3px] opacity-50 ${ENDED_ENTRANCE}`}>
            {(frozenBars ?? []).map((h, i) => (
              <span
                key={i}
                className="h-full w-[3px] origin-bottom rounded-full bg-muted-foreground/50"
                style={{ transform: `scaleY(${Math.max(0.15, Math.min(1, (h * 0.6) / 100))})` }}
              />
            ))}
          </div>
          <div
            className={`w-full ${ENDED_ENTRANCE} motion-safe:slide-in-from-bottom-[6px]`}
          >
            {endedActions}
          </div>
        </>
      )}

      {idle && (
        <>
          <div className="text-base font-semibold text-foreground">{t('startTitle')}</div>
          <div className="text-[13px] text-muted-foreground">
            {/* No target → neutral copy. The '—' fallback rendered 「—様の
             *  セッションを録音します」, which read as a broken name. */}
            {customerName ? t('startSub', { name: customerName }) : t('startSubNoTarget')}
          </div>
        </>
      )}
    </section>
  )
}
