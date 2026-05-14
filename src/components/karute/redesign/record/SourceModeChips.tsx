'use client'

import { useTranslations } from 'next-intl'
import { Eye, Smartphone } from 'lucide-react'

export function SourceModeChips() {
  const t = useTranslations('recording.source')
  return (
    <div className="grid gap-2.5 md:grid-cols-2">
      <Chip
        icon={<Smartphone size={14} />}
        title={t('phoneMic')}
        sub={t('phoneMicSub')}
      />
      <Chip
        icon={<Eye size={14} />}
        title={t('modeA')}
        sub={t('modeASub')}
      />
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
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <div className="text-[11px] leading-snug text-muted-foreground">{sub}</div>
      </div>
    </div>
  )
}
