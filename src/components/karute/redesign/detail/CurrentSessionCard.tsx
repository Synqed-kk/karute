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

export function CurrentSessionCard({
  sessionDate,
  entries,
  tunedFor,
}: CurrentSessionCardProps) {
  const t = useTranslations('karuteDetail')
  if (entries.length === 0) return null

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {t('currentSession.title')}
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">{sessionDate}</span>
      </header>
      <div className="flex flex-col gap-3.5">
        {entries.map((e) => {
          const tone = CATEGORY_TONE[e.category]
          return (
            <div
              key={e.id}
              className="grid items-baseline gap-3 text-sm leading-snug md:grid-cols-[88px_56px_1fr]"
            >
              <span
                className="inline-flex h-[22px] w-fit items-center justify-center rounded-md px-2.5 text-[11px] font-semibold"
                style={{ background: tone.bg, color: tone.text }}
              >
                {t(`currentSession.categories.${e.category}`)}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {e.time}
              </span>
              <span className="text-foreground/85">{e.body}</span>
            </div>
          )
        })}
      </div>
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
