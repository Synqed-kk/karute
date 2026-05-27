'use client'

import { useTranslations } from 'next-intl'
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
  const t = useTranslations('review')

  const draftEntries: KaruteDraftEntry[] = entries.map((e) => ({
    category: e.category,
    content: e.title,
    sourceQuote: e.source_quote,
    confidenceScore: e.confidence_score,
  }))

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-muted-foreground">{t('aiSummary')}</h2>
        <p className="text-sm text-foreground/80 leading-relaxed">{summary}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('entriesConfirmed', { count: entries.length })}
        </p>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{t('selectCustomerAndSave')}</h3>
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
