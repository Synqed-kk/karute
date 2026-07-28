'use client'

import { useEffect, useState } from 'react'
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
  // Optimistic post-save override (CurrentSessionCard's stale-reopen guard,
  // adapted): a re-open before router.refresh() lands re-seeds the sheet with
  // the just-saved text and the bullets repaint immediately. The summary has
  // no version field for the entry card's `o.version > entry.version` inert
  // rule, so `basedOn` (the prop the save was made FROM) plays that role: the
  // override wins ONLY while the prop still shows the pre-save text. The
  // moment summaryRaw moves at all — our own save landing, or another
  // device's newer edit — props win again; a versionless override that never
  // expired would silently mask (and on re-save clobber) the other edit.
  const [override, setOverride] = useState<{ raw: string; basedOn: string | null } | null>(null)

  const activeOverride = override !== null && override.basedOn === (summaryRaw ?? null)
  // Tombstone (delta round, ABA hole): a value-equality inert rule can
  // RESURRECT — props move to our saved text (inert, correct), a colleague
  // later reverts the summary back to the pre-save value, and basedOn
  // matches again, masking their revert indefinitely. The entry card's
  // `version >` rule is monotonic and can't ABA; without a version, kill the
  // override permanently the first time props move off basedOn.
  useEffect(() => {
    if (override !== null && override.basedOn !== (summaryRaw ?? null)) setOverride(null)
  }, [override, summaryRaw])
  const raw = activeOverride ? override.raw : (summaryRaw ?? null)
  const shownBullets = activeOverride ? summaryTextToBullets(override.raw) : bullets
  const edited = activeOverride || (summaryEdited ?? false)
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
          onSaved={(savedRaw) => setOverride({ raw: savedRaw, basedOn: summaryRaw ?? null })}
        />
      )}
    </section>
  )
}
