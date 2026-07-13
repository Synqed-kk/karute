'use client'

import {
  ArrowRight,
  Calendar,
  RotateCcw,
  Ticket,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { SignalKind, TodaySignal } from '@/lib/karute/ai-signals'
import type { ConsultationQuestion } from '@/lib/welcome/business-types'
import { getCategoryLabel } from './PromptTemplateCard'

// Icon per signal kind (mock-v2: calendar / person / ticket / refresh).
const KIND_ICONS: Record<SignalKind, LucideIcon> = {
  today_roster: Calendar,
  next_visit: UserRound,
  ticket_low: Ticket,
  long_absence: RotateCcw,
}

interface SignalChipsProps {
  signals: TodaySignal[]
  onPick: (signal: TodaySignal) => void
}

/** 今日のヒント — the primary block. Every string comes from PKT-101 data
 *  (tagJa / titleJa); nothing about the signal is hard-coded here. */
export function SignalChips({ signals, onPick }: SignalChipsProps) {
  const t = useTranslations('askAi')
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {signals.map((s) => {
        const Icon = KIND_ICONS[s.kind]
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            className="flex w-full items-start gap-3 rounded-2xl border border-border bg-card p-3.5 text-left shadow-sm transition-colors hover:border-foreground/15 hover:bg-muted/30"
          >
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <Icon size={18} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="inline-flex w-fit items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
                {s.tagJa}
              </span>
              <span className="text-sm font-semibold leading-snug text-foreground">
                {s.titleJa}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {t('open')}
                <ArrowRight size={12} />
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface TunedPromptPillProps {
  template: ConsultationQuestion
  onPick: (example: string) => void
}

/** Compact じっくり相談 pill — the demoted tuned prompt when signals lead the
 *  page. Horizontal-scroll on mobile / 3-col grid on desktop (handled by the
 *  parent row). */
export function TunedPromptPill({ template, onPick }: TunedPromptPillProps) {
  const locale = useLocale()
  return (
    <button
      type="button"
      onClick={() => onPick(template.example)}
      className="flex w-[220px] shrink-0 flex-col gap-1 rounded-xl border border-border bg-muted p-2.5 text-left transition-colors hover:border-foreground/15 hover:bg-muted/70 md:w-auto"
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {getCategoryLabel(template.category, locale)}
      </span>
      <span className="text-[13px] font-semibold text-foreground">
        {template.title}
      </span>
    </button>
  )
}
