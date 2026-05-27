'use client'

import { useTranslations } from 'next-intl'

/**
 * Horizontal row of 4 placeholder AI status chips for a customer's
 * karute. Shown on customer cards rendered in the カルテ-tab context
 * (`karuteContext={true}` on CustomerCardMobile / CustomerRowDesktop).
 *
 * Each chip = one of the four AI surfaces from the design spike's
 * karute detail page:
 *   - 体調予測  (AIBodyPredictionCard)
 *   - 推奨     (AIOutreachCard)
 *   - 要約     (AISummaryCard)
 *   - 録音     (TranscriptCollapse)
 *
 * Visual treatment: all four read as "対応予定" (Coming Soon) right
 * now because none of them are wired. When Anthony lights up a
 * surface, this component can branch on real data to render the
 * active state (filled chip + value instead of muted + soon-tag).
 *
 * Intentionally dense + small — these chips sit at the bottom of a
 * 64px customer row, they can't compete with the name / contact
 * info above them for vertical real estate.
 */
export function AiStatusChipRow() {
  const t = useTranslations('customers.list.aiStatusChip')
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <StatusChip label={t('bodyPrediction')} accent="blue" />
      <StatusChip label={t('outreach')} accent="amber" />
      <StatusChip label={t('summary')} accent="blue" />
      <StatusChip label={t('transcript')} accent="rose" />
    </div>
  )
}

type Accent = 'blue' | 'amber' | 'rose'

const ACCENT: Record<Accent, { bg: string; text: string; border: string }> = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200/60 dark:border-blue-500/20',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200/60 dark:border-amber-500/30',
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-500/10',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-200/60 dark:border-rose-500/20',
  },
}

function StatusChip({ label, accent }: { label: string; accent: Accent }) {
  const a = ACCENT[accent]
  const t = useTranslations('customers.list.aiStatusChip')
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 rounded-full border ${a.border} ${a.bg} px-1.5 text-[10px] font-medium ${a.text}`}
      // ANTHONY: when the matching surface goes live, drop the trailing
      // " · 対応予定" suffix and show the real value (e.g. "体調予測 86%"
      // / "推奨 LINE草案あり" / "要約 4件" / "録音 12:38"). Keep the
      // accent color per surface so the chip identity stays consistent
      // across both empty + populated states.
      title={`${label} · ${t('comingSoonShort')}`}
    >
      <span>{label}</span>
      <span className="opacity-60">·</span>
      <span className="opacity-70">{t('comingSoonShort')}</span>
    </span>
  )
}
