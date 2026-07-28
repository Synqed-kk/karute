'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { FileText, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { summaryTextToBullets } from '@/lib/adapters/karute-detail'
import { SummaryEditSheet } from './SummaryEditSheet'

interface AISummaryCardProps {
  sessionDate: string
  bullets: string[]
  /** Enables the 詳細記録 pencil (edit-layer W2 summary half) when present —
   *  raw text seeds the sheet; absent (e.g. a caller that predates the
   *  field) renders the card read-only, exactly as before. */
  karuteRecordId?: string
  /** Raw effective summary (edited ?? ai) — the sheet edits THIS text; the
   *  bullet split above is display-only. */
  summaryRaw?: string | null
  /** True when the summary carries a human overlay — amber pencil. */
  summaryEdited?: boolean
}

export function AISummaryCard({
  sessionDate,
  bullets,
  karuteRecordId,
  summaryRaw,
  summaryEdited,
}: AISummaryCardProps) {
  const t = useTranslations('karuteDetail')
  const [sheetOpen, setSheetOpen] = useState(false)
  // Optimistic post-save override (EntryEditSheet's onSaved fleet fix): a
  // re-open before router.refresh() lands re-seeds the sheet with the
  // just-saved text, and the bullets repaint immediately.
  const [override, setOverride] = useState<string | null>(null)

  const raw = override ?? summaryRaw ?? null
  const shownBullets = override !== null ? summaryTextToBullets(override) : bullets
  const edited = override !== null || (summaryEdited ?? false)
  const canEdit = !!karuteRecordId && raw !== null

  if (shownBullets.length === 0) return null

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-center gap-2 border-b border-border bg-sky-500/5 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <FileText size={14} className="text-sky-500" />
        <span>{t('aiSummary.title')}</span>
        <span className="ml-auto text-[12px] font-medium normal-case tracking-normal tabular-nums">
          {sessionDate}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={t('summaryEdit.editButton')}
            className={cn(
              'shrink-0 transition-colors hover:text-foreground',
              // Amber = edited — the entry rows' provenance signal, same rule
              // (CurrentSessionCard's pencil).
              edited ? 'text-amber-600' : 'text-muted-foreground/40',
            )}
          >
            <Pencil size={12} />
          </button>
        )}
      </header>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-5 md:p-6">
        {shownBullets.map((b, i) => (
          <li
            key={i}
            className="relative pl-3.5 text-sm leading-snug text-foreground/85"
          >
            <span
              className="absolute left-0 top-[8px] inline-block h-1.5 w-1.5 rounded-full bg-sky-500"
              aria-hidden
            />
            {b}
          </li>
        ))}
      </ul>
      {canEdit && karuteRecordId && (
        <SummaryEditSheet
          karuteRecordId={karuteRecordId}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          seed={raw}
          edited={edited}
          onSaved={setOverride}
        />
      )}
    </section>
  )
}
