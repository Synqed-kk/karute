'use client'

import { useTranslations } from 'next-intl'
import { Target, ChevronRight } from 'lucide-react'

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
  /**
   * Brief, skimmable digest (3–4 bullets) — the headline content of 本日のセッション.
   * This is what staff reads in seconds before the next visit.
   */
  bullets: string[]
  /**
   * Full categorized entries — the granular log. Tucked into a collapsible so the
   * box stays skimmable; the deep per-topic detail belongs in the dedicated cards
   * (memory / body / outreach), not stacked here.
   */
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
  bullets,
  entries,
  tunedFor,
}: CurrentSessionCardProps) {
  const t = useTranslations('karuteDetail')
  if (bullets.length === 0 && entries.length === 0) return null

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {t('currentSession.title')}
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">{sessionDate}</span>
      </header>

      {/* Brief digest — the skimmable "what happened today" */}
      {bullets.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {bullets.map((b, i) => (
            <li
              key={i}
              className="relative pl-4 text-sm leading-relaxed text-foreground/90"
            >
              <span
                className="absolute left-0 top-[9px] inline-block h-1.5 w-1.5 rounded-full bg-sky-500"
                aria-hidden
              />
              {b}
            </li>
          ))}
        </ul>
      )}

      {/* Full categorized log — collapsed by default (open only when there is no
          digest to show). Keeps the headline box brief and skimmable. */}
      {entries.length > 0 && (
        <details
          open={bullets.length === 0}
          className={`group ${bullets.length > 0 ? 'mt-4 border-t border-border pt-3' : ''}`}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={13}
              className="shrink-0 transition-transform group-open:rotate-90"
            />
            {t('currentSession.recordToggle', { count: entries.length })}
          </summary>
          <div className="mt-3 flex flex-col gap-2.5">
            {entries.map((e) => {
              const tone = CATEGORY_TONE[e.category]
              return (
                <div
                  key={e.id}
                  className="grid items-baseline gap-3 text-sm leading-snug md:grid-cols-[80px_1fr]"
                >
                  <span
                    className="inline-flex h-[22px] w-fit items-center justify-center rounded-md px-2.5 text-[11px] font-semibold"
                    style={{ background: tone.bg, color: tone.text }}
                  >
                    {t(`currentSession.categories.${e.category}`)}
                  </span>
                  <span className="text-foreground/85">{e.body}</span>
                </div>
              )
            })}
          </div>
        </details>
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
