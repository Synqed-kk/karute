'use client'

// Pipeline-failure card (record page). Renders a LOCALIZED message from the
// pipeline's stable error code — never raw exception text (the empty-transcript
// throw used to surface its English message verbatim mid-app). Extracted from
// RecordPageView so the string contract is pinnable in isolation.

import { useTranslations } from 'next-intl'
import type { PipelineErrorCode } from '@/lib/global-pipeline'

export function PipelineErrorCard({
  code,
  onCancel,
  onRetry,
  onDiscard,
  errorRepeated = false,
  onHandwrite,
}: {
  code: PipelineErrorCode | null
  onCancel: () => void
  onRetry: () => void
  /** ⚖ 8/26 rider — the moment this refusal is known is the moment the
   *  banner-dead-loop ruling's condition (a) is proven, so the discard exit
   *  lives here. Gated on `code` too (not just presence), so a caller passing
   *  it for the wrong code can never widen the byte-identical contract for
   *  every other code. */
  onDiscard?: () => void
  /** UPDATE 25 GROUP A, piece c — this retry failed with the SAME code as the
   *  one before it (global-pipeline's own memory). 再試行 is NEVER removed on
   *  it — a wrong detector must never lock a real take out (B2's own rule). */
  errorRepeated?: boolean
  /** UPDATE 25 GROUP A, piece c — the same-day 手書き door, offered ONLY when
   *  the caller has already proven (against the row's server-derived
   *  `sameDay`) that this failed take's session is today's. Gated on `code`
   *  too, the same discipline as `onDiscard` above. */
  onHandwrite?: () => void
}) {
  const t = useTranslations('recording')
  const tc = useTranslations('common')
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-red-500/30 bg-card p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-foreground">
          {t(
            code === 'empty-transcript'
              ? 'pipelineErrorEmptyTranscript'
              : code === 'consent-required'
                ? 'pipelineErrorConsentRequired'
                : code === 'discarded'
                  ? 'pipelineErrorDiscarded'
                  : 'pipelineErrorGeneric',
          )}
        </p>
        {errorRepeated && (
          <p className="mt-2 text-sm text-muted-foreground">{t('pipelineErrorRepeated')}</p>
        )}
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {tc('cancel')}
          </button>
          {/* ⚖ NO RETRY FOR A DISCARD (fix round 6, R7). Every other code here
              can come out differently on a second attempt; this one cannot —
              a staff member made a decision and wrote why, and the worker
              refuses the re-armed job on exactly the same ground. The button
              is not disabled, it is absent: a greyed control still reads as
              "later, maybe". */}
          {code !== 'discarded' && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              {tc('retry')}
            </button>
          )}
        </div>
        {code === 'empty-transcript' && onHandwrite && (
          <button
            type="button"
            onClick={onHandwrite}
            // The R13 wash recipe (RecordingsInboxCard's WASH_BTN) — never a
            // solid fill, never black: this is an exit FROM the recording, not
            // an action ON it.
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-primary bg-primary/8 px-4 text-sm font-semibold text-primary"
          >
            {t('inbox.action.handwrite')}
          </button>
        )}
        {code === 'empty-transcript' && onDiscard && (
          <button
            type="button"
            onClick={onDiscard}
            // SHOULD-FIX-4: same scale as the キャンセル/再試行 pair above it
            // (px-*/py-*/text-sm) — a real tap target, not a 16px sliver.
            className="mt-3 px-4 py-2 text-sm font-medium text-destructive underline underline-offset-2"
          >
            {t('discardTakeAction')}
          </button>
        )}
      </div>
    </div>
  )
}
