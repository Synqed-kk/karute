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
}: {
  code: PipelineErrorCode | null
  onCancel: () => void
  onRetry: () => void
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
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {tc('retry')}
          </button>
        </div>
      </div>
    </div>
  )
}
