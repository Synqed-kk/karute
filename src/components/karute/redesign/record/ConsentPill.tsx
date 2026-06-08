'use client'

import { useTranslations } from 'next-intl'
import { ShieldCheck } from 'lucide-react'

interface ConsentPillProps {
  consentDate: string | null
}

export function ConsentPill({ consentDate }: ConsentPillProps) {
  const t = useTranslations('recording.consent')
  if (!consentDate) return null

  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 text-[11px] font-medium text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300">
      <ShieldCheck size={13} />
      <span>{t('onFile')}</span>
      <span aria-hidden className="opacity-50">·</span>
      <span className="tabular-nums">{consentDate}</span>
    </span>
  )
}
