'use client'

import { useTranslations } from 'next-intl'
import { Clock, Gift, Sparkles, Target } from 'lucide-react'

export interface PreSessionBrief {
  lastVisitDate: string
  lastVisitAgo: string
  hooks: { title: string; body: string | null }[]
  concerns: string[]
  lastProduct: { name: string; reaction: string | null } | null
  recommendedFocus: string | null
}

interface PreSessionBriefCardProps {
  brief: PreSessionBrief | null
}

interface BriefSectionProps {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  isLast?: boolean
}

function BriefSection({ icon, title, children, isLast }: BriefSectionProps) {
  return (
    <div className={`pb-3.5 pt-3.5 ${isLast ? '' : 'border-b border-border'}`}>
      <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <div className="text-[13px] leading-snug text-foreground/85">{children}</div>
    </div>
  )
}

export function PreSessionBriefCard({ brief }: PreSessionBriefCardProps) {
  const t = useTranslations('recording.brief')
  if (!brief) return null

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-2 flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center text-sky-400">
          <Sparkles size={14} />
        </span>
        <div className="flex flex-col">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {t('title')}
          </div>
          <div className="text-[12px] text-muted-foreground">
            {t('lastVisit', { date: brief.lastVisitDate, ago: brief.lastVisitAgo })}
          </div>
        </div>
      </header>

      <BriefSection icon={<Sparkles size={12} className="text-sky-400" />} title={t('hooks')}>
        <ul className="flex list-none flex-col gap-1.5">
          {brief.hooks.map((h, i) => (
            <li key={i} className="grid grid-cols-[12px_1fr] items-baseline gap-1.5">
              <span
                className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-sky-400"
                aria-hidden
              />
              <span>
                <span className="font-semibold text-foreground">{h.title}</span>
                {h.body && <span className="text-muted-foreground"> — {h.body}</span>}
              </span>
            </li>
          ))}
        </ul>
      </BriefSection>

      <BriefSection icon={<Clock size={12} />} title={t('concerns')}>
        <ul className="flex list-none flex-col gap-1.5">
          {brief.concerns.map((c, i) => (
            <li key={i} className="grid grid-cols-[12px_1fr] items-baseline gap-1.5">
              <span
                className="mt-2 inline-block h-1 w-1 rounded-full bg-foreground/30"
                aria-hidden
              />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </BriefSection>

      {brief.lastProduct && (
        <BriefSection icon={<Gift size={12} />} title={t('lastProduct')}>
          <span className="font-semibold text-foreground">{brief.lastProduct.name}</span>
          {brief.lastProduct.reaction && (
            <span className="text-muted-foreground"> — {brief.lastProduct.reaction}</span>
          )}
        </BriefSection>
      )}

      {brief.recommendedFocus && (
        <BriefSection icon={<Target size={12} />} title={t('recommendedFocus')} isLast>
          <p>{brief.recommendedFocus}</p>
        </BriefSection>
      )}
    </section>
  )
}
