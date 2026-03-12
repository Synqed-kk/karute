'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Lightbulb,
  Calendar,
  AlertTriangle,
  TrendingUp,
  MessageCircle,
  Star,
  Info,
  Phone,
  Camera,
  ClipboardList,
  UserX,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type InsightType =
  | 'NEXT_TREATMENT'
  | 'FOLLOW_UP'
  | 'CHURN_RISK'
  | 'UPSELL'
  | 'TALKING_POINT'
  | 'HIGH_VALUE'
  | 'GENERAL'
  | 'REACTIVATION'
  | 'UNRESOLVED_ISSUE'
  | 'PHOTO_REQUEST'
  | 'PLAN_INCOMPLETE'

export interface InsightData {
  id: string
  type: InsightType
  title: string
  body: string
  priority: number
  action: string | null
  evidence: string | null
  status: 'ACTIVE' | 'DISMISSED' | 'ACTIONED'
}

const TYPE_CONFIG: Record<
  InsightType,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  NEXT_TREATMENT: { label: '次回施術', icon: Calendar },
  FOLLOW_UP: { label: 'フォローアップ', icon: Phone },
  CHURN_RISK: { label: '離反リスク', icon: AlertTriangle },
  UPSELL: { label: 'アップセル', icon: TrendingUp },
  TALKING_POINT: { label: '話題', icon: MessageCircle },
  HIGH_VALUE: { label: '重要顧客', icon: Star },
  GENERAL: { label: '一般', icon: Info },
  REACTIVATION: { label: '再来店促進', icon: UserX },
  UNRESOLVED_ISSUE: { label: '未解決', icon: ClipboardList },
  PHOTO_REQUEST: { label: '写真依頼', icon: Camera },
  PLAN_INCOMPLETE: { label: 'プラン未完了', icon: ClipboardList },
}

function getPriorityBorderColor(priority: number): string {
  if (priority > 0.7) return 'border-l-red-500'
  if (priority >= 0.4) return 'border-l-amber-400'
  return 'border-l-gray-300 dark:border-l-gray-600'
}

function getPriorityBadgeVariant(priority: number): 'destructive' | 'secondary' | 'outline' {
  if (priority > 0.7) return 'destructive'
  if (priority >= 0.4) return 'secondary'
  return 'outline'
}

interface InsightCardProps {
  insight: InsightData
  onAction?: (id: string, action: 'actioned' | 'dismissed') => void
}

export function InsightCard({ insight, onAction }: InsightCardProps) {
  const [isExiting, setIsExiting] = useState(false)

  const config = TYPE_CONFIG[insight.type] ?? TYPE_CONFIG.GENERAL
  const Icon = config.icon

  const handleAction = (action: 'actioned' | 'dismissed') => {
    setIsExiting(true)
    // Allow transition to complete before notifying parent
    setTimeout(() => {
      onAction?.(insight.id, action)
    }, 200)
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-l-4 bg-card p-4 text-sm transition-all duration-200',
        getPriorityBorderColor(insight.priority),
        isExiting && 'scale-95 opacity-0'
      )}
    >
      {/* Header: type badge + priority */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <Badge variant={getPriorityBadgeVariant(insight.priority)} className="gap-1">
          <Icon className="size-3" />
          {config.label}
        </Badge>
      </div>

      {/* Title */}
      <h4 className="mb-1 font-medium leading-snug">{insight.title}</h4>

      {/* Body */}
      <p className="mb-3 text-muted-foreground">{insight.body}</p>

      {/* Suggested action */}
      {insight.action && (
        <div className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs">
          <Lightbulb className="mt-0.5 size-3 shrink-0 text-amber-500" />
          <span>{insight.action}</span>
        </div>
      )}

      {/* Evidence */}
      {insight.evidence && (
        <p className="mb-3 text-xs text-muted-foreground/70">
          根拠: {insight.evidence}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          onClick={() => handleAction('actioned')}
        >
          対応済み
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => handleAction('dismissed')}
          className="text-muted-foreground"
        >
          非表示
        </Button>
      </div>
    </div>
  )
}
