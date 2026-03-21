import { useTranslations, useLocale } from 'next-intl'
import type { KaruteWithRelations } from '@/lib/supabase/karute'
import { KaruteHeader } from '@/components/karute/KaruteHeader'
import { EntryCard } from '@/components/karute/EntryCard'
import { AddEntryForm } from '@/components/karute/AddEntryForm'
import { TranscriptSection } from '@/components/karute/TranscriptSection'
import { ExportButtons } from '@/components/karute/ExportButtons'
import { AIAdvice } from '@/components/karute/AIAdvice'

interface KaruteDetailViewProps {
  karute: KaruteWithRelations
}

type EntryItem = {
  id: string
  category: string
  content: string
  source_quote: string | null
  confidence_score: number | null
  is_manual: boolean
  created_at: string
  title?: string
}

export function KaruteDetailView({ karute }: KaruteDetailViewProps) {
  const t = useTranslations('karute')
  const locale = useLocale()

  const entries = (karute as { entries?: EntryItem[] }).entries ?? []

  // Group entries by category
  const grouped = entries.reduce<Record<string, EntryItem[]>>((acc, entry) => {
    const cat = entry.category || 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(entry)
    return acc
  }, {})

  const categoryOrder = Object.keys(grouped).sort()

  return (
    <div className="space-y-6">
      {/* Header */}
      <KaruteHeader karute={karute} />

      {/* AI Advice — prominent at top */}
      <AIAdvice
        summary={karute.summary}
        entries={entries.map((e) => ({
          category: e.category,
          title: e.title ?? e.content,
        }))}
        locale={locale}
      />

      {/* Export buttons */}
      <ExportButtons karuteId={karute.id} />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column: entries grouped by category */}
        <div className="space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('entries')}
          </h2>

          <AddEntryForm karuteRecordId={karute.id} />

          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noEntries')}</p>
          ) : (
            categoryOrder.map((category) => (
              <div key={category} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-1">
                  {category}
                </h3>
                {grouped[category].map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    karuteRecordId={karute.id}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        {/* Right column: summary + transcript */}
        <div className="space-y-4">
          {/* AI Summary */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('summary')}
            </h2>
            {karute.summary ? (
              <p className="text-sm text-foreground/80 leading-relaxed">
                {karute.summary}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">—</p>
            )}
          </div>

          {/* Collapsible transcript */}
          <TranscriptSection transcript={karute.transcript} />
        </div>
      </div>
    </div>
  )
}
