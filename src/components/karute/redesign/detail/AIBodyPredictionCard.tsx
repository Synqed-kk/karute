'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Calendar, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'

export interface BodyPrediction {
  headline: string
  /** 0-100 */
  confidence: number
  delta: 'improving' | 'worsening' | 'stable' | null
  recommended: string
  recommendedSub: string | null
  rationaleSummary: string | null
}

interface AIBodyPredictionCardProps {
  prediction: BodyPrediction | null
}

export function AIBodyPredictionCard({ prediction }: AIBodyPredictionCardProps) {
  const t = useTranslations('karuteDetail.bodyPrediction')
  const [openRationale, setOpenRationale] = useState(false)
  if (!prediction) return null

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-center gap-2 border-b border-border bg-sky-500/5 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <Sparkles size={14} className="text-sky-500" />
        <span>{t('title')}</span>
      </header>
      <div className="flex flex-col gap-2.5 p-5">
        <div className="text-[17px] font-semibold leading-snug text-foreground">
          {prediction.headline}
        </div>

        <div className="mt-1 flex items-center justify-between">
          <span className="text-[13px] text-muted-foreground">{t('confidence')}</span>
          <span className="text-[15px] font-bold tabular-nums text-sky-400">
            {prediction.confidence}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-sky-400"
            style={{ width: `${Math.max(0, Math.min(100, prediction.confidence))}%` }}
          />
        </div>

        {prediction.delta && (
          <div className="flex items-center gap-1.5 text-[13px]">
            {prediction.delta === 'improving' ? (
              <TrendingUp size={13} className="text-emerald-400" />
            ) : prediction.delta === 'worsening' ? (
              <TrendingDown size={13} className="text-amber-400" />
            ) : (
              <TrendingUp size={13} className="text-muted-foreground" />
            )}
            <span className="text-muted-foreground">{t('vsLast')}</span>
            <span
              className={
                prediction.delta === 'improving'
                  ? 'text-emerald-400'
                  : prediction.delta === 'worsening'
                    ? 'text-amber-400'
                    : 'text-muted-foreground'
              }
            >
              {t(`delta.${prediction.delta}`)}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <Calendar size={13} className="text-muted-foreground" />
          <span className="text-muted-foreground">{t('recommended')}</span>
          <span className="font-medium text-foreground">{prediction.recommended}</span>
          {prediction.recommendedSub && (
            <span className="text-muted-foreground">{prediction.recommendedSub}</span>
          )}
        </div>

        {prediction.rationaleSummary && (
          <>
            <button
              type="button"
              onClick={() => setOpenRationale((v) => !v)}
              className="self-start text-xs text-muted-foreground hover:text-foreground"
            >
              {t('rationale')}{' '}
              <span className="text-muted-foreground/70">
                {openRationale ? '▴' : '▾'}
              </span>
            </button>
            {openRationale && (
              <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {prediction.rationaleSummary}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
