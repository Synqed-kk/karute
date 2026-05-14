import { useTranslations } from 'next-intl'
import { AlertTriangle, CircleDashed, Clock, Sparkles } from 'lucide-react'

import type { KaruteDisplayStatus } from '@/lib/adapters/karute-list'
import { KARUTE_STATUS_STYLES } from './karute-status'

const ICONS = {
  sparkles: Sparkles,
  clock: Clock,
  'alert-triangle': AlertTriangle,
  'circle-dashed': CircleDashed,
} as const

interface KaruteStatusBadgeProps {
  status: KaruteDisplayStatus
  size?: 'sm' | 'xs'
}

export function KaruteStatusBadge({ status, size = 'sm' }: KaruteStatusBadgeProps) {
  const t = useTranslations('karuteList.status')
  const style = KARUTE_STATUS_STYLES[status]
  const Icon = ICONS[style.icon]
  const isXs = size === 'xs'
  return (
    <span
      className={
        isXs
          ? 'inline-flex h-[20px] items-center gap-1 rounded-full px-[7px] text-[10px] font-medium whitespace-nowrap'
          : 'inline-flex h-[22px] items-center gap-[5px] rounded-full px-2 text-[11px] font-medium whitespace-nowrap'
      }
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        color: style.text,
      }}
    >
      <Icon size={isXs ? 10 : 11} />
      <span>{t(status)}</span>
    </span>
  )
}
