'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Target } from 'lucide-react'

export type SessionCategory =
  | 'treatment'
  | 'concern'
  | 'condition'
  | 'product'
  | 'next'

export interface SessionEntry {
  id: string
  category: SessionCategory
  time: string
  body: string
}

interface CurrentSessionCardProps {
  sessionDate: string
  /** 要点 — a few key points, the 2-second skim at the top of the card. */
  bullets: string[]
  /** Categorized entries — always visible, tags are the skim layer. */
  entries: SessionEntry[]
  tunedFor?: string | null
  /** Optional action rendered in the card header (e.g. AIで再生成 button). */
  headerAction?: ReactNode
}

const CATEGORY_TONE: Record<SessionCategory, { bg: string; text: string }> = {
  treatment: { bg: 'rgba(34, 197, 94, 0.16)', text: '#16a34a' },
  concern: { bg: 'rgba(245, 158, 11, 0.16)', text: '#b45309' },
  condition: { bg: 'rgba(139, 92, 246, 0.16)', text: '#7c3aed' },
  product: { bg: 'rgba(59, 130, 246, 0.16)', text: '#2563eb' },
  next: { bg: 'rgba(236, 72, 153, 0.16)', text: '#be185d' },
}

export function CurrentSessionCard({
  sessionDate,
  bullets,
  entries,
  tunedFor,
  headerAction,
}: CurrentSessionCardProps) {
  const t = useTranslations('karuteDetail')
  if (bullets.length === 0 && entries.length === 0) return null

  // Group entries by category so each colored tag renders ONCE with its points
  // stacked under it — instead of the same 施術/気になる点 badge repeating down the
  // list. Insertion order follows the adapter's clinical sort (concern→…→next).
  const entryGroups = new Map<SessionCategory, SessionEntry[]>()
  for (const e of entries) {
    const arr = entryGroups.get(e.category)
    if (arr) arr.push(e)
    else entryGroups.set(e.category, [e])
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {t('currentSession.title')}
        </h3>
        <div className="flex items-center gap-3">
          {headerAction}
          <span className="text-xs tabular-nums text-muted-foreground">{sessionDate}</span>
        </div>
      </header>

      {/* 要点 — key points: the 2-second skim */}
      {bullets.length > 0 && (
        <div className="mb-4 rounded-xl border border-sky-500/15 bg-sky-500/[0.06] px-4 py-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-600/80">
            {t('currentSession.keyPoints')}
          </div>
          <ul className="space-y-1.5">
            {bullets.map((b, i) => (
              <li
                key={i}
                className="relative pl-4 text-sm leading-snug text-foreground/90"
              >
                <span
                  className="absolute left-0 top-[8px] inline-block h-1.5 w-1.5 rounded-full bg-sky-500"
                  aria-hidden
                />
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Categorized entries — ONE badge per category, its points stacked under it */}
      {entries.length > 0 && (
        <div className="flex flex-col gap-3.5">
          {[...entryGroups.entries()].map(([category, items]) => {
            const tone = CATEGORY_TONE[category]
            return (
              <div
                key={category}
                className="flex items-start gap-2.5 text-sm leading-relaxed"
              >
                <span
                  className="mt-px inline-flex h-[22px] shrink-0 items-center justify-center rounded-md px-2.5 text-[11px] font-semibold"
                  style={{ background: tone.bg, color: tone.text }}
                >
                  {t(`currentSession.categories.${category}`)}
                </span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  {items.map((e) => (
                    <span key={e.id} className="text-foreground/85">
                      {e.body}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tunedFor && (
        <footer className="mt-5 border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/8 px-3 py-1 text-xs text-sky-400">
            <Target size={12} />
            <span className="text-muted-foreground">{t('currentSession.tunedFor')}</span>
            <span>{tunedFor}</span>
          </span>
        </footer>
      )}
    </section>
  )
}
