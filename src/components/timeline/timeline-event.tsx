'use client'

import { cn } from '@/lib/utils'
import type { TimelineType } from '@/lib/types/timeline'

const typeConfig: Record<TimelineType, { icon: string; color: string; label: string }> = {
  VISIT: { icon: '●', color: 'text-blue-500', label: '来店' },
  TREATMENT: { icon: '●', color: 'text-purple-500', label: '施術' },
  NOTE: { icon: '●', color: 'text-gray-400', label: 'メモ' },
  PHOTO: { icon: '●', color: 'text-green-500', label: '写真' },
  FORM: { icon: '●', color: 'text-orange-500', label: 'フォーム' },
  CONTACT: { icon: '●', color: 'text-cyan-500', label: '連絡' },
  IMPORT: { icon: '●', color: 'text-yellow-500', label: 'インポート' },
  MILESTONE: { icon: '●', color: 'text-amber-500', label: 'マイルストーン' },
  STATUS_CHANGE: { icon: '●', color: 'text-gray-500', label: 'ステータス' },
}

function relativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今日'
  if (diffDays === 1) return '昨日'
  if (diffDays < 7) return `${diffDays}日前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}週間前`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}ヶ月前`
  return `${Math.floor(diffDays / 365)}年前`
}

interface TimelineEventProps {
  type: TimelineType
  title: string
  body?: string | null
  source?: string | null
  occurredAt: string
}

export function TimelineEvent({ type, title, body, source, occurredAt }: TimelineEventProps) {
  const config = typeConfig[type]

  return (
    <div className="group relative flex gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/40">
      {/* Icon */}
      <span className={cn('mt-1 text-[8px]', config.color)}>{config.icon}</span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {config.label}
          </span>
        </div>
        {body && (
          <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{body}</p>
        )}
      </div>

      {/* Time */}
      <span className="shrink-0 text-xs text-muted-foreground">
        {relativeTime(occurredAt)}
      </span>
    </div>
  )
}
