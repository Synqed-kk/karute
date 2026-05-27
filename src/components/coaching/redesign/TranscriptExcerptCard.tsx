'use client'

// ─────────────────────────────────────────────────────────────
// TranscriptExcerptCard — staff session transcripts + AI notes
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/TranscriptExcerptCard.tsx
// (~61 lines).
//
// PRIVACY: Layer 1 — STAFF-PRIVATE. The single most sensitive
// surface in coaching:
//   - Raw transcript text (staff's words + customer's words)
//   - AI coaching notes attached at specific timestamps
// Owners / managers MUST NEVER read this data, even via join.
//   RLS: SELECT only where staff_id = auth.uid().
//   Explicit policy denies owners even with elevated roles.
//
// DATA SOURCE (when wired):
//   useSessionTranscriptsData() → TranscriptExcerpt[]
//   Transcript chunks themselves are raw; coaching notes attached
//   come from the personal-coaching insight generator.

import { FileText } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { PrivacyLockBadge } from './PrivacyLockBadge'
import { ScaffoldHint } from './ScaffoldHint'
import type { TranscriptExcerpt } from './personal-growth-types'

interface TranscriptExcerptCardProps {
  excerpts?: TranscriptExcerpt[] | null
}

export function TranscriptExcerptCard({
  excerpts = null,
}: TranscriptExcerptCardProps) {
  const t = useTranslations('coaching.growth')
  const tCommon = useTranslations('coaching.common')
  const list = excerpts ?? []
  const hasItems = list.length > 0

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-indigo-600 dark:text-indigo-300" />
          <h3 className="text-sm font-semibold">{t('transcriptsTitle')}</h3>
        </div>
        <PrivacyLockBadge label={tCommon('privacyLayer1Badge')} />
      </div>
      <p className="mb-4 text-[11px] text-muted-foreground">
        {t('transcriptsIntro')}
      </p>

      {hasItems ? (
        <div className="space-y-4">
          {list.map((ex) => (
            <div
              key={ex.id}
              className="rounded-md border border-gray-200 dark:border-white/10"
            >
              <div className="flex items-center justify-between gap-2 rounded-t-md border-b border-gray-100 bg-gray-50/50 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
                <span className="text-[11px] font-medium text-foreground">
                  {ex.context}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {ex.date}
                </span>
              </div>
              <div className="whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-foreground">
                {ex.excerpt}
              </div>
              <div className="rounded-b-md border-t border-indigo-100 bg-indigo-50/50 px-3 py-2.5 dark:border-indigo-500/15 dark:bg-indigo-500/[0.06]">
                <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                  {t('coachingNoteLabel')}
                </div>
                <p className="text-xs leading-relaxed text-indigo-900 dark:text-indigo-200">
                  {ex.coachingNote}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ScaffoldHint hint={t('transcriptsEmptyHint')} />
      )}
    </div>
  )
}
