'use client'

import { ArrowRight, Sparkles, TrendingUp, Users } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
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

// Amber is the sole accent family (mock-v2 canon) — categories differ by icon +
// label, not hue.
const CATEGORY_TONE = 'bg-amber-500/10 text-amber-700 dark:text-amber-300'

// Display-only localization of the category chip. The `category` field VALUE
// stays English (it keys the icon map above) — only the rendered label
// localizes. Exported so the compact じっくり相談 pill reuses the same source.
const CATEGORY_LABELS: Record<
  ConsultationQuestion['category'],
  { en: string; ja: string }
> = {
  Analysis: { en: 'Analysis', ja: '分析' },
  Customer: { en: 'Customer', ja: '顧客' },
  Strategy: { en: 'Strategy', ja: '戦略' },
}

export function getCategoryLabel(
  category: ConsultationQuestion['category'],
  locale: string,
): string {
  return CATEGORY_LABELS[category][locale === 'ja' ? 'ja' : 'en']
}

export function PromptTemplateCard({ template, onPick }: PromptTemplateCardProps) {
  const t = useTranslations('askAi')
  const locale = useLocale()
  const Icon = CATEGORY_ICONS[template.category]
  const categoryLabel = getCategoryLabel(template.category, locale)
  return (
    <button
      type="button"
      onClick={() => onPick(template.example)}
      className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/30"
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded ${CATEGORY_TONE}`}
        >
          <Icon size={12} />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {categoryLabel}
        </span>
      </div>
      <div className="text-sm font-semibold text-foreground">{template.title}</div>
      <p className="line-clamp-2 text-xs text-muted-foreground">{template.preview}</p>
      <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 group-hover:text-amber-600 dark:text-amber-300">
        <span>{t('tryPrompt')}</span>
        <ArrowRight size={11} />
      </div>
    </button>
  )
}
