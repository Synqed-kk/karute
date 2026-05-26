'use client'

import { useTranslations } from 'next-intl'
import { FileText } from 'lucide-react'

interface AISummaryCardProps {
  sessionDate: string
  bullets: string[]
}

export function AISummaryCard({ sessionDate, bullets }: AISummaryCardProps) {
  const t = useTranslations('karuteDetail')
  if (bullets.length === 0) return null

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-center gap-2 border-b border-border bg-sky-500/5 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <FileText size={14} className="text-sky-500" />
        <span>{t('aiSummary.title')}</span>
        <span className="ml-auto text-[12px] font-medium normal-case tracking-normal tabular-nums">
          {sessionDate}
        </span>
      </header>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-5 md:p-6">
        {bullets.map((b, i) => (
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
    </section>
  )
}
