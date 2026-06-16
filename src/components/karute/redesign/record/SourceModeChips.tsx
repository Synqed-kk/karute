'use client'

import { useTranslations } from 'next-intl'
import { Eye, Smartphone } from 'lucide-react'

/**
 * Quiet "current setup" footer at the BOTTOM of the record page. Mic source and
 * disclosure mode are set-once configuration, not per-session decisions, so they
 * sit below the recording flow — de-emphasised so the record button stays the
 * hero, but still visible (モードA is disclosure-relevant; staff should be able
 * to confirm which mode is live without leaving the page).
 */
export function SourceModeChips() {
  const t = useTranslations('recording.source')
  return (
    <div className="grid gap-x-6 gap-y-2 border-t border-border pt-3 sm:grid-cols-2">
      <Chip
        icon={<Smartphone size={13} />}
        title={t('phoneMic')}
        sub={t('phoneMicSub')}
      />
      <Chip icon={<Eye size={13} />} title={t('modeA')} sub={t('modeASub')} />
    </div>
  )
}

function Chip({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode
  title: string
  sub: string
}) {
  return (
    <div className="flex items-start gap-2 text-muted-foreground">
      <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center opacity-70">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="text-[12px] font-medium">{title}</div>
        <div className="text-[11px] leading-snug opacity-70">{sub}</div>
      </div>
    </div>
  )
}
