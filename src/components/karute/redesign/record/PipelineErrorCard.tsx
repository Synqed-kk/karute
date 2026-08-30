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
                : 'pipelineErrorGeneric',
          )}
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {tc('cancel')}
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            {tc('retry')}
          </button>
        </div>
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
