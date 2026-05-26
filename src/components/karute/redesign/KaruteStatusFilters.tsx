'use client'

import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

export type KaruteStatusFilterKey =
  | 'all'
  | 'week'
  | 'aiPending'
  | 'review'
  | 'draft'

export interface KaruteStatusCounts {
  all: number
  week: number
  aiPending: number
  review: number
  draft: number
}

interface KaruteStatusFiltersProps {
  active: KaruteStatusFilterKey
  counts: KaruteStatusCounts
  onChange: (key: KaruteStatusFilterKey) => void
}

const KEYS: KaruteStatusFilterKey[] = ['all', 'week', 'aiPending', 'review', 'draft']

export function KaruteStatusFilters({ active, counts, onChange }: KaruteStatusFiltersProps) {
  const t = useTranslations('karuteList.filter')
  return (
    <div className="flex flex-wrap items-center gap-2">
      {KEYS.map((k) => {
        const isActive = active === k
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
              'border-border bg-card',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span>{t(k)}</span>
            <span
              className={cn(
                'tabular-nums text-[12px] font-medium',
                isActive ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {counts[k]}
            </span>
          </button>
        )
      })}
    </div>
  )
}
