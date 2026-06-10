'use client'

// PRE-session repurchase cue — the heads-up BEFORE the record button, not after
// (Liam: getting the question only at the stop dialog is an "oh shit" moment;
// staff must know to have the next-pack conversation DURING the session).
// Sits between the 録音対象 card and the brief — the last thing staff read
// before pressing record. Same threshold as the stop dialog's repurchase mode
// (REPURCHASE_PROMPT_REMAINING — one source, the surfaces can't disagree).

import { useTranslations } from 'next-intl'
import { Ticket } from 'lucide-react'
import { REPURCHASE_PROMPT_REMAINING } from '@/lib/packs/resolve'

export function RepurchaseCueBanner({
  pack,
}: {
  pack: { remaining: number; size: number } | null
}) {
  const t = useTranslations('recording.repurchaseCue')
  if (!pack || pack.remaining > REPURCHASE_PROMPT_REMAINING || pack.remaining <= 0) {
    return null
  }
  const last = pack.remaining === 1
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-2xl border p-4 ${
        last
          ? 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10'
          : 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          last
            ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
        }`}
      >
        <Ticket size={15} />
      </span>
      <div className="min-w-0">
        <div
          className={`text-[13px] font-semibold ${
            last
              ? 'text-red-700 dark:text-red-300'
              : 'text-amber-800 dark:text-amber-200'
          }`}
        >
          {t('title', { n: pack.remaining })}
        </div>
        <p
          className={`mt-0.5 text-[12px] leading-relaxed ${
            last
              ? 'text-red-700/80 dark:text-red-300/80'
              : 'text-amber-700/90 dark:text-amber-300/90'
          }`}
        >
          {last ? t('bodyLast') : t('body')}
        </p>
      </div>
    </div>
  )
}
