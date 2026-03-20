'use client'

import { SaveKaruteFlow } from '@/components/karute/SaveKaruteFlow'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import type { Entry } from '@/types/ai'
import type { KaruteDraftEntry } from '@/lib/karute/draft'

interface ReviewConfirmStepProps {
  transcript: string
  summary: string
  entries: Entry[]
  customers: CustomerOption[]
  duration?: number
  appointmentId?: string
  appointmentCustomerId?: string
}

export function ReviewConfirmStep({
  transcript,
  summary,
  entries,
  customers,
  duration,
  appointmentId,
  appointmentCustomerId,
}: ReviewConfirmStepProps) {
  const draftEntries: KaruteDraftEntry[] = entries.map((e) => ({
    category: e.category,
    content: e.title,
    sourceQuote: e.source_quote,
    confidenceScore: e.confidence_score,
  }))

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-muted-foreground">AI Summary</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">{summary}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} confirmed
        </p>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Select customer &amp; save</h3>
        <SaveKaruteFlow
          customers={customers}
          appointmentCustomerId={appointmentCustomerId}
          directDraft={{
            transcript,
            summary,
            entries: draftEntries,
            duration,
            appointmentId,
          }}
        />
      </div>
    </div>
  )
}
