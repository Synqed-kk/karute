'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Camera, TrendingUp, Calendar, MessageCircle, Lightbulb, Check, X } from 'lucide-react'

interface Insight {
  type: string
  title: string
  body: string
  customerName?: string
  priority: number
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  PHOTO_REQUEST: Camera,
  UPSELL: TrendingUp,
  NEXT_TREATMENT: Calendar,
  FOLLOW_UP: Calendar,
  TALKING_POINT: MessageCircle,
  GENERAL: Lightbulb,
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  PHOTO_REQUEST: 'photoRequest',
  UPSELL: 'upsell',
  NEXT_TREATMENT: 'nextTreatment',
  FOLLOW_UP: 'followUp',
  TALKING_POINT: 'talkingPoint',
  GENERAL: 'general',
}

export function AIRecommendedActions({ locale }: { locale: string }) {
  const t = useTranslations('aiActions')

  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())

  const cacheKey = `ai_insights_${locale}`

  const fetchInsights = useCallback(async () => {
    // Check localStorage first
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const { insights: cachedInsights, ts } = JSON.parse(cached)
        if (Date.now() - ts < 24 * 60 * 60 * 1000) {
          setInsights(cachedInsights)
          setLoading(false)
          return
        }
      }
    } catch {}

    setLoading(true)
    try {
      const res = await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      const data = await res.json()
      const newInsights = data.insights ?? []
      setInsights(newInsights)

      // Only cache non-empty results so we retry on next load if empty
      if (newInsights.length > 0) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ insights: newInsights, ts: Date.now() }))
        } catch {}
      } else {
        try { localStorage.removeItem(cacheKey) } catch {}
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [locale, cacheKey])

  useEffect(() => {
    fetchInsights()
  }, [fetchInsights])

  const visibleInsights = insights.filter((_, i) => !dismissed.has(i))

  if (loading) {
    return (
      <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">{t('title')}</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </div>
      </div>
    )
  }

  if (!loading && insights.length === 0) return null

  return (
    <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">{t('title')}</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{t('subtitle')}</p>
        </div>
      </div>

      {visibleInsights.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">{t('allActionsHandled')}</p>
      ) : (
        <div className="space-y-4">
          {visibleInsights.map((insight, idx) => {
            const realIdx = insights.indexOf(insight)
            const Icon = TYPE_ICONS[insight.type] ?? Lightbulb
            const labelKey = TYPE_LABEL_KEYS[insight.type]
            return (
              <div key={realIdx} className="flex items-start gap-3 py-3 border-b border-border/20 last:border-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium">{insight.title}</span>
                    <span className="rounded-full border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {labelKey ? t(labelKey as Parameters<typeof t>[0]) : insight.type}
                    </span>
                  </div>
                  {insight.customerName && (
                    <p className="text-xs text-muted-foreground mb-1">{insight.customerName}</p>
                  )}
                  <p className="text-sm text-muted-foreground leading-relaxed">{insight.body}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setDismissed((s) => new Set(s).add(realIdx))}
                    className="p-1.5 rounded-md text-green-500 hover:bg-green-500/10 transition-colors"
                    title={t('markAsDone')}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissed((s) => new Set(s).add(realIdx))}
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors"
                    title={t('dismiss')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
