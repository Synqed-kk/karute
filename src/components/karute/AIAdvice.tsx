'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Gift } from 'lucide-react'

interface AIAdviceProps {
  summary: string | null
  entries: { category: string; title: string }[]
  locale: string
}

function getCacheKey(summary: string | null, entries: { category: string; title: string }[]) {
  return `ai_advice_${btoa(JSON.stringify({ s: summary?.slice(0, 100), e: entries.length })).slice(0, 32)}`
}

export function AIAdvice({ summary, entries, locale }: AIAdviceProps) {
  const t = useTranslations('karute')
  const [advice, setAdvice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const cacheKey = getCacheKey(summary, entries)

    // Check localStorage first
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const { advice: a, ts } = JSON.parse(cached)
        // Use cache if less than 7 days old
        if (Date.now() - ts < 7 * 24 * 60 * 60 * 1000) {
          setAdvice(a)
          setLoading(false)
          return
        }
      }
    } catch {}

    async function fetchAdvice() {
      try {
        const res = await fetch('/api/ai/advice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary, entries, locale }),
        })
        const data = await res.json()
        const a = data.advice || null
        setAdvice(a)

        // Cache in localStorage
        if (a) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ advice: a, ts: Date.now() }))
          } catch {}
        }
      } catch {
        setAdvice(null)
      } finally {
        setLoading(false)
      }
    }
    fetchAdvice()
  }, [summary, entries, locale])

  if (loading) {
    return (
      <div className="rounded-xl border border-border/30 bg-gradient-to-r from-amber-500/5 to-transparent p-5">
        <div className="flex items-center gap-2 mb-2">
          <Gift className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">{t('adviceForNextVisit')}</h3>
        </div>
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (!advice) return null

  return (
    <div className="rounded-xl border border-border/30 bg-gradient-to-r from-amber-500/5 to-transparent p-5">
      <div className="flex items-center gap-2 mb-3">
        <Gift className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold">{t('adviceForNextVisit')}</h3>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{advice}</p>
    </div>
  )
}
