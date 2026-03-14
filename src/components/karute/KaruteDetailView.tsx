import { useTranslations } from 'next-intl'
import type { KaruteWithRelations } from '@/lib/supabase/karute'
import { KaruteHeader } from '@/components/karute/KaruteHeader'
import { EntryCard } from '@/components/karute/EntryCard'
import { AddEntryForm } from '@/components/karute/AddEntryForm'
import { TranscriptSection } from '@/components/karute/TranscriptSection'
import { ExportButtons } from '@/components/karute/ExportButtons'

interface KaruteDetailViewProps {
  karute: KaruteWithRelations
}

/**
 * Two-column karute detail view.
 * Per user decision:
 *  - Left column: AddEntryForm at top, then flat list of EntryCards (not grouped)
 *  - Right column: AI summary section, then collapsible transcript
 *  - Stacks vertically on mobile/tablet (lg:grid-cols-2)
 */
export function KaruteDetailView({ karute }: KaruteDetailViewProps) {
  const t = useTranslations('karute')

  const entries = (karute as { entries?: unknown[] }).entries ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <KaruteHeader karute={karute} />

      {/* Export buttons */}
      <ExportButtons karuteId={karute.id} />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column: entries */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('entries')}
          </h2>

          {/* Always-visible add entry form at the top */}
          <AddEntryForm karuteRecordId={karute.id} />

          {/* Entry list — flat, not grouped */}
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noEntries')}</p>
          ) : (
            <div className="space-y-2">
              {(entries as Array<{
                id: string
                category: string
                content: string
                source_quote: string | null
                confidence_score: number | null
                is_manual: boolean
                created_at: string
              }>).map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  karuteRecordId={karute.id}
                />
              ))}
            </div>
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
