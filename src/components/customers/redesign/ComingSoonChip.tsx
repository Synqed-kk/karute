'use client'

import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface ComingSoonChipProps {
  /** Smaller form for inline usage in column headers / row cells. */
  size?: 'sm' | 'md'
}

export function ComingSoonChip({ size = 'sm' }: ComingSoonChipProps) {
  const t = useTranslations('customers')
  const sizing =
    size === 'sm' ? 'h-4 px-1.5 text-[9px]' : 'h-6 px-2.5 text-[11px]'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300 ${sizing}`}
    >
      <Sparkles size={size === 'sm' ? 8 : 10} />
      <span>{t('comingSoon')}</span>
    </span>
  )
}
