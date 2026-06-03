'use client'

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
  entries: SessionEntry[]
  tunedFor?: string | null
}

const CATEGORY_TONE: Record<SessionCategory, { bg: string; text: string }> = {
  treatment: { bg: 'rgba(34, 197, 94, 0.18)', text: '#16a34a' },
  concern: { bg: 'rgba(245, 158, 11, 0.18)', text: '#b45309' },
  condition: { bg: 'rgba(139, 92, 246, 0.18)', text: '#7c3aed' },
  product: { bg: 'rgba(59, 130, 246, 0.18)', text: '#2563eb' },
  next: { bg: 'rgba(236, 72, 153, 0.18)', text: '#be185d' },
}

// Stable session-narrative order — concerns raised → condition read → treatment
// done → products suggested → next visit. Categories absent from the data are
// skipped. This is intentionally NOT the entries' arrival order: staff skim by
// type, not chronology (chronology lives in the transcript).
const CATEGORY_ORDER: SessionCategory[] = [
  'concern',
  'condition',
  'treatment',
  'product',
  'next',
]

export function CurrentSessionCard({
  sessionDate,
  entries,
  tunedFor,
}: CurrentSessionCardProps) {
  const t = useTranslations('karuteDetail')
  if (entries.length === 0) return null

  // Group entries by category so a category renders ONCE (chip + bullet list)
  // instead of repeating the chip + the placeholder created_at time per entry.
  const byCategory = new Map<SessionCategory, SessionEntry[]>()
  for (const e of entries) {
    const arr = byCategory.get(e.category)
    if (arr) arr.push(e)
    else byCategory.set(e.category, [e])
  }
  const groups = CATEGORY_ORDER.filter((c) => byCategory.has(c))

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {t('currentSession.title')}
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {sessionDate}
        </span>
      </header>

      <div className="flex flex-col gap-5">
        {groups.map((category) => {
          const tone = CATEGORY_TONE[category]
          const items = byCategory.get(category)!
          return (
            <div key={category} className="flex flex-col gap-2">
              {/* Category header — once per category */}
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex h-[22px] items-center rounded-md px-2.5 text-[11px] font-semibold"
                  style={{ background: tone.bg, color: tone.text }}
                >
                  {t(`currentSession.categories.${category}`)}
                </span>
                {items.length > 1 && (
                  <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                )}
              </div>
              {/* Entries — clean bullets, color-keyed to the category */}
              <ul className="flex flex-col gap-1.5">
                {items.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start gap-2.5 text-sm leading-snug text-foreground/90"
                  >
                    <span
                      aria-hidden
                      className="mt-[7px] size-1.5 shrink-0 rounded-full"
                      style={{ background: tone.text }}
                    />
                    <span className="min-w-0">{e.body}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {tunedFor && (
        <footer className="mt-5 border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/8 px-3 py-1 text-xs text-sky-400">
            <Target size={12} />
            <span className="text-muted-foreground">
              {t('currentSession.tunedFor')}
            </span>
            <span>{tunedFor}</span>
          </span>
        </footer>
      )}
    </section>
  )
}
