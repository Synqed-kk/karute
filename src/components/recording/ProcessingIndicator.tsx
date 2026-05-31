'use client'

import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { useGlobalPipeline } from '@/hooks/use-global-pipeline'

/**
 * Top-corner, NON-blocking progress chip for the background AI pipeline.
 *
 * Mounted at the (app) layout root next to DiscreetRecordingIndicator, so it
 * floats over every route — the app stays fully usable while a 60–90 min
 * recording transcribes in the background (no more full-screen ProcessingModal
 * freezing the whole UI). Staff can start a NEW recording while a previous take
 * processes, so this chip and DiscreetRecordingIndicator can be visible at once
 * — it's offset to the left of the recording dot to sit beside it, not under it.
 *
 *   processing → spinner + current stage (文字起こし中 → 抽出 → 要約)
 *   review     → green "確認する" pill → taps through to /sessions to review+save
 *   error      → red "処理に失敗" pill → taps through to /sessions to retry/discard
 *   idle       → renders nothing
 */
export function ProcessingIndicator() {
  const t = useTranslations('review')
  const { state, step } = useGlobalPipeline()

  if (state === 'idle') return null

  // Top-right, inset for the notch/safe-area, but offset left of the recording
  // dot (right-3, size-7, z-[100]) so the two never stack in the same spot.
  const wrap =
    'fixed right-12 top-[max(0.75rem,env(safe-area-inset-top))] z-[90]'

  if (state === 'processing') {
    const stepLabel =
      step === 'extracting'
        ? t('extracting')
        : step === 'summarizing'
          ? t('summarizing')
          : t('transcribing')
    return (
      <div className={wrap} role="status" aria-live="polite">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur supports-backdrop-filter:bg-card/80">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-500" aria-hidden />
          <span>{stepLabel.replace('...', '')}</span>
        </span>
      </div>
    )
  }

  const reviewReady = state === 'review'
  return (
    <Link
      href={'/sessions' as Parameters<typeof Link>[0]['href']}
      className={wrap}
      aria-label={reviewReady ? t('reviewReady') : t('processingFailed')}
    >
      <span
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition-colors ${
          reviewReady
            ? 'bg-emerald-600 hover:bg-emerald-700'
            : 'bg-red-600 hover:bg-red-700'
        }`}
      >
        {reviewReady ? (
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
        )}
        <span>{reviewReady ? t('reviewReady') : t('processingFailed')}</span>
      </span>
    </Link>
  )
}
