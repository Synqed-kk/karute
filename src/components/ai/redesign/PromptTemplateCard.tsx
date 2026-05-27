'use client'

import { ArrowRight, Sparkles, TrendingUp, Users } from 'lucide-react'
import type { ConsultationQuestion } from '@/lib/welcome/business-types'

interface PromptTemplateCardProps {
  template: ConsultationQuestion
  onPick: (example: string) => void
}

const CATEGORY_ICONS: Record<ConsultationQuestion['category'], typeof TrendingUp> = {
  Analysis: TrendingUp,
  Customer: Users,
  Strategy: Sparkles,
}

const CATEGORY_TONES: Record<
  ConsultationQuestion['category'],
  { bg: string; text: string }
> = {
  Analysis: { bg: 'bg-emerald-500/15', text: 'text-emerald-300' },
  Customer: { bg: 'bg-sky-500/15', text: 'text-sky-300' },
  Strategy: { bg: 'bg-violet-500/15', text: 'text-violet-300' },
}

export function PromptTemplateCard({ template, onPick }: PromptTemplateCardProps) {
  const Icon = CATEGORY_ICONS[template.category]
  const tone = CATEGORY_TONES[template.category]
  return (
    <button
      type="button"
      onClick={() => onPick(template.example)}
      className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/30"
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded ${tone.bg} ${tone.text}`}
        >
          <Icon size={12} />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {template.category}
        </span>
      </div>
      <div className="text-sm font-semibold text-foreground">{template.title}</div>
      <p className="line-clamp-2 text-xs text-muted-foreground">{template.preview}</p>
      <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 group-hover:text-sky-300">
        <span>Try this prompt</span>
        <ArrowRight size={11} />
      </div>
    </button>
  )
}
