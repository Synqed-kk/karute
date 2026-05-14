'use client'

import { useTranslations } from 'next-intl'
import { CheckCircle2 } from 'lucide-react'

interface ConsentPillProps {
  consentDate: string | null
}

export function ConsentPill({ consentDate }: ConsentPillProps) {
  const t = useTranslations('recording.consent')
  if (!consentDate) return null

  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 text-[11px] font-semibold text-emerald-500">
      <CheckCircle2 size={12} strokeWidth={2.5} />
      <span>{t('onFile')}</span>
      <span aria-hidden className="opacity-60">·</span>
      <span className="tabular-nums">{consentDate}</span>
    </span>
  )
}
