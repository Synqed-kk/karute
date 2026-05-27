'use client'

// ─────────────────────────────────────────────────────────────
// GrowthProgressChart — staff personal growth detail
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/GrowthProgressChart.tsx
// (~95 lines). Same SVG geometry; bigger viewBox than the owner
// drill-down trajectory chart (640×200 vs 600×160).
//
// PRIVACY: Layer 1 — staff-private.
//   RLS REQUIREMENT: SELECT only where staff_id = auth.uid().
//   Owners NEVER see this chart, even via join.
//
// DATA SOURCE (when wired):
//   usePersonalGrowthData().growth.progressHistory

import { useTranslations } from 'next-intl'

import { PrivacyLockBadge } from './PrivacyLockBadge'
import { ScaffoldHint } from './ScaffoldHint'
import type { GrowthPoint } from './personal-growth-types'

interface GrowthProgressChartProps {
  points?: GrowthPoint[] | null
}

export function GrowthProgressChart({
  points = null,
}: GrowthProgressChartProps) {
  const t = useTranslations('coaching.growth')
  const tCommon = useTranslations('coaching.common')
  const series = points ?? []
  const hasData = series.length > 0

  const width = 640
  const height = 200
  const padX = 24
  const padY = 28
  const plotW = width - padX * 2
  const plotH = height - padY * 2

  const max = hasData ? Math.max(...series.map((p) => p.score), 100) : 100
  const min = hasData ? Math.min(...series.map((p) => p.score), 0) : 0
  const range = max - min || 1
  const step = series.length > 1 ? plotW / (series.length - 1) : 0

  const coords = series.map((p, i) => {
    const x = padX + i * step
    const y = padY + plotH - ((p.score - min) / range) * plotH
    return { x, y, p }
  })

  const pathD = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`)
    .join(' ')

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('chartTitle')}</h3>
        <PrivacyLockBadge label={tCommon('privacyLayer1Badge')} />
      </div>

      {hasData ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-48 w-full overflow-visible"
          role="img"
          aria-label={t('chartTitle')}
        >
          <defs>
            <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const y = padY + plotH * frac
            return (
              <line
                key={frac}
                x1={padX}
                x2={width - padX}
                y1={y}
                y2={y}
                stroke="#e5e7eb"
                strokeDasharray="2 3"
              />
            )
          })}

          <path
            d={`${pathD} L ${coords[coords.length - 1].x} ${padY + plotH} L ${coords[0].x} ${padY + plotH} Z`}
            fill="url(#growthFill)"
          />
          <path
            d={pathD}
            fill="none"
            stroke="#6366f1"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {coords.map((c, i) => (
            <g key={i}>
              <circle
                cx={c.x}
                cy={c.y}
                r="5"
                fill="#fff"
                stroke="#6366f1"
                strokeWidth="2.5"
              />
              <text
                x={c.x}
                y={c.y - 12}
                textAnchor="middle"
                className="fill-indigo-900 dark:fill-indigo-200"
                fontSize="11"
                fontWeight="600"
              >
                {c.p.score}
              </text>
              <text
                x={c.x}
                y={height - 6}
                textAnchor="middle"
                className="fill-slate-400 dark:fill-slate-500"
                fontSize="10"
              >
                {t('monthAxisLabel', { mm: c.p.month.slice(5) })}
              </text>
            </g>
          ))}
        </svg>
      ) : (
        <ScaffoldHint hint={t('chartEmptyHint')} />
      )}
    </div>
  )
}
