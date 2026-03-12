'use client'

import { useCallback, useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { InsightCard, type InsightData } from '@/components/customer/insight-card'
import { Lightbulb, Loader2, Sparkles } from 'lucide-react'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

interface InsightsPanelProps {
  customerId: string
}

export function InsightsPanel({ customerId }: InsightsPanelProps) {
  const [isGenerating, setIsGenerating] = useState(false)

  const { data, error, mutate } = useSWR<{ insights: InsightData[] }>(
    `/api/insights?customerId=${customerId}`,
    fetcher
  )

  const insights = data?.insights ?? []
  const activeInsights = insights
    .filter((i) => i.status === 'ACTIVE')
    .sort((a, b) => b.priority - a.priority)

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true)
    try {
      await fetch('/api/insights/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      })
      // Refresh the insights list
      await mutate()
    } catch {
      // TODO: toast error
    } finally {
      setIsGenerating(false)
    }
  }, [customerId, mutate])

  const handleInsightAction = useCallback(
    async (id: string, action: 'actioned' | 'dismissed') => {
      // Optimistic update
      mutate(
        (current) => {
          if (!current) return current
          return {
            insights: current.insights.map((i) =>
              i.id === id
                ? { ...i, status: action === 'actioned' ? 'ACTIONED' as const : 'DISMISSED' as const }
                : i
            ),
          }
        },
        false
      )

      try {
        await fetch(`/api/insights/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: action === 'actioned' ? 'ACTIONED' : 'DISMISSED',
          }),
        })
        await mutate()
      } catch {
        // Revert on error
        await mutate()
      }
    },
    [mutate]
  )

  if (error) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <p className="text-sm text-muted-foreground">
          インサイトの読み込みに失敗しました
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-4 text-amber-500" />
          <h3 className="text-sm font-medium">AIインサイト</h3>
          {activeInsights.length > 0 && (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
              {activeInsights.length}
            </span>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              インサイトを生成
            </>
          )}
        </Button>
      </div>

      {/* Insights list */}
      {!data ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : activeInsights.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-center">
          <Lightbulb className="mb-2 size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            インサイトはまだありません
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            「インサイトを生成」ボタンで顧客データを分析できます
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeInsights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onAction={handleInsightAction}
            />
          ))}
        </div>
      )}
    </div>
  )
}
