'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Link, useRouter } from '@/i18n/navigation'
import { useGlobalPipeline } from '@/hooks/use-global-pipeline'
import { globalPipeline } from '@/lib/global-pipeline'
import { saveKaruteRecordInline } from '@/actions/karute'
import type { EntryCategory } from '@/lib/karute/categories'

/**
 * Top-corner, NON-blocking progress chip for the background AI pipeline — AND
 * the home of the B2 auto-save.
 *
 * Mounted once at the (app) layout root, so it floats over every route and its
 * effects run no matter which page the staff has moved on to. The app stays
 * fully usable while a 60–90 min recording transcribes in the background.
 *
 *   processing  → spinner + current stage (文字起こし中 → 抽出 → 要約)
 *   autosaving  → spinner + 保存中; the effect below saves the take (known
 *                 customer + outcome chosen at stop) so the staff NEVER returns
 *                 to a review screen. On failure it drops to `review`.
 *   review      → green "確認する" pill → /sessions to review+save (walk-ins /
 *                 no-outcome takes / auto-save fallbacks)
 *   error       → red "処理に失敗" pill → /sessions to retry/discard
 *   idle        → renders nothing
 */
export function ProcessingIndicator() {
  const t = useTranslations('review')
  const router = useRouter()
  const { state, step } = useGlobalPipeline()
  // One-shot per run, keyed by the pipeline's runId: a re-render can't re-fire
  // the save for the same take, and a NEW take (new runId) still fires once.
  const autosavedRunRef = useRef<number | null>(null)
  // Held completion state (design #5): on autosave success the chip does NOT
  // vanish — it turns emerald, holds 「保存済み」 ~2s, fades, and ONLY THEN
  // resets the pipeline. Staff glancing up after a 60-90min transcription get
  // a definitive "saved", not an empty corner indistinguishable from
  // "never started".
  const [done, setDone] = useState<{ runId: number; leaving: boolean } | null>(null)

  useEffect(() => {
    if (state !== 'autosaving') return
    const runId = globalPipeline.runId
    if (autosavedRunRef.current === runId) return
    autosavedRunRef.current = runId

    const ctx = globalPipeline.context
    const result = globalPipeline.result
    // The state machine only enters 'autosaving' with a customer + outcome; this
    // guard is defensive (incl. an empty AI summary). Fall back to review.
    if (
      !ctx?.appointmentCustomerId ||
      (!ctx.outcome && !ctx.outcomeSkipped) ||
      !result ||
      !result.summary?.trim()
    ) {
      globalPipeline.failAutosaveToReview(runId)
      return
    }
    const customerId = ctx.appointmentCustomerId

    // NOTE: like the rest of the in-memory pipeline, a full page reload mid-save
    // isn't recovered here (the record still persists server-side if the request
    // landed; the durable server-job is the documented v2). runId guards the
    // in-session races: a save resolving after a new recording started must not
    // clobber or hijack the new take.
    void (async () => {
      const res = await saveKaruteRecordInline({
        customerId,
        transcript: result.transcript,
        summary: result.summary,
        entries: result.entries.map((e) => ({
          category: e.category as EntryCategory,
          content: e.title,
          sourceQuote: e.source_quote,
          confidenceScore: e.confidence_score,
        })),
        duration: ctx.duration,
        appointmentId: ctx.appointmentId,
        outcome: ctx.outcome,
      })
      if ('error' in res) {
        // Never silently lose a take — tell the staff, and drop THIS run to
        // review (no-op if a newer recording already superseded it).
        toast.error(t('autosaveFailed'))
        globalPipeline.failAutosaveToReview(runId)
      } else {
        const id = res.id
        toast.success(t('autoSaved'), {
          action: {
            label: t('viewSaved'),
            onClick: () =>
              router.push(`/karute/${id}` as Parameters<typeof router.push>[0]),
          },
        })
        // Hold the 保存済み state ~2s → 200ms fade → THEN reset. reset(runId)
        // stays guarded, so a newer take is never wiped.
        setDone({ runId, leaving: false })
        setTimeout(
          () =>
            setDone((d) => (d && d.runId === runId ? { ...d, leaving: true } : d)),
          2000,
        )
        setTimeout(() => {
          globalPipeline.reset(runId)
          setDone((d) => (d && d.runId === runId ? null : d))
        }, 2250)
      }
    })()
  }, [state, t, router])

  // Top-right, inset for the notch/safe-area, but offset left of the recording
  // dot (right-3, size-7, z-[100]) so the two never stack in the same spot.
  const wrap =
    'fixed right-12 top-[max(0.75rem,env(safe-area-inset-top))] z-[90]'

  // Held 保存済み state takes precedence (the pipeline is still 'autosaving'
  // during the hold). If a NEWER take superseded it, fall through to live state.
  if (done && globalPipeline.runId === done.runId) {
    return (
      <div className={wrap} role="status" aria-live="polite">
        <span
          className={`inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-lg transition-all duration-200 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300 ${
            done.leaving
              ? 'scale-95 opacity-0'
              : 'animate-in fade-in zoom-in-95 duration-300'
          }`}
        >
          <CheckCircle2
            className="size-3.5 shrink-0 animate-in zoom-in-50 duration-300"
            aria-hidden
          />
          <span>{t('savedChip')}</span>
        </span>
      </div>
    )
  }

  if (state === 'idle') return null

  if (state === 'processing' || state === 'autosaving') {
    // 4-stage micro progress track (transcribe → extract → summarize → save):
    // completed = emerald, current = pulsing half-emerald, upcoming = muted.
    // The spinner stays for liveness; the track says WHERE it is.
    const stageIdx =
      state === 'autosaving'
        ? 3
        : step === 'summarizing'
          ? 2
          : step === 'extracting'
            ? 1
            : 0
    const stepLabel =
      state === 'autosaving'
        ? t('autoSaving')
        : step === 'extracting'
          ? t('extracting')
          : step === 'summarizing'
            ? t('summarizing')
            : t('transcribing')
    return (
      <div className={wrap} role="status" aria-live="polite">
        <span className="inline-flex flex-col gap-1 rounded-2xl border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur supports-backdrop-filter:bg-card/80">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-500" aria-hidden />
            <span>{stepLabel.replace('...', '')}</span>
          </span>
          <span className="flex gap-[3px] pl-[22px]" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-[3px] w-2.5 rounded-full transition-colors duration-300 ${
                  i < stageIdx
                    ? 'bg-emerald-500'
                    : i === stageIdx
                      ? 'animate-pulse bg-emerald-500/60'
                      : 'bg-muted-foreground/25'
                }`}
              />
            ))}
          </span>
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
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition-colors animate-in fade-in zoom-in-95 duration-300 ${
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
