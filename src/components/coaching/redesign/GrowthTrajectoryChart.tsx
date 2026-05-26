'use client'

// ─────────────────────────────────────────────────────────────
// GrowthTrajectoryChart — staff drill-down chart
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/GrowthTrajectoryChart.tsx
// (~118 lines). SVG geometry preserved 1:1 — same viewBox,
// padding, gradient, point styling.
//
// PRIVACY: Layer 2 — month-by-month aggregate category scores.
// No session-level data, no per-customer breakdowns. Pure
// rollup; no AI call required.
//
// DATA SOURCE (when wired):
//   useStaffPerformanceData().staff.find(...).trajectoryL2
//   (nightly batch fine; not realtime).

import { useTranslations } from 'next-intl'

import type { TrajectoryPoint } from './owner-types'

import { ScaffoldHint } from './ScaffoldHint'

interface GrowthTrajectoryChartProps {
  points?: TrajectoryPoint[] | null
  /** Pre-localized title; usually "<name>さんの成長推移". */
  title: string
}

export function GrowthTrajectoryChart({
  points = null,
  title,
}: GrowthTrajectoryChartProps) {
  const t = useTranslations('coaching.staffDrill')
  const series = points ?? []
  const hasData = series.length > 0

  // SVG geometry — same constants as spike.
  const width = 600
  const height = 160
  const padX = 20
  const padY = 20
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
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">
          {t('chartSubtitle')}
        </span>
      </div>

      {hasData ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-40 w-full overflow-visible"
          role="img"
          aria-label={title}
        >
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* horizontal grid */}
          {[0, 0.5, 1].map((frac) => {
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

          {/* area fill */}
          <path
            d={`${pathD} L ${coords[coords.length - 1].x} ${padY + plotH} L ${coords[0].x} ${padY + plotH} Z`}
            fill="url(#chartFill)"
          />

          {/* line */}
          <path
            d={pathD}
            fill="none"
            stroke="#6366f1"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* points */}
          {coords.map((c, i) => (
            <g key={i}>
              <circle
                cx={c.x}
                cy={c.y}
                r="4"
                fill="#fff"
                stroke="#6366f1"
                strokeWidth="2"
              />
              <text
                x={c.x}
                y={c.y - 10}
                textAnchor="middle"
                className="fill-slate-700 dark:fill-slate-300"
                fontSize="10"
                fontWeight="500"
              >
                {c.p.score}
              </text>
              <text
                x={c.x}
                y={height - 4}
                textAnchor="middle"
                className="fill-slate-400 dark:fill-slate-500"
                fontSize="9"
              >
                {c.p.month.slice(5)}
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
