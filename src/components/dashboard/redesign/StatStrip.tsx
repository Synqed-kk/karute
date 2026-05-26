import { TrendingDown, TrendingUp } from 'lucide-react'

// `trend` / `trendLabel` props preserved on the prop schema and the
// StatTile component, even though no producer in dashboard/page.tsx
// sets them today. Keeping the surface means Anthony can see the
// exact shape the trend producer needs to feed (signed delta + an
// optional label like "vs last week"). When the calc lands, set
// trend/trendLabel on the stats and the TrendingUp/Down icon + delta
// pill lights up automatically.
//
// ANTHONY producers needed:
//   - weeklyRecordings.trend: count delta vs the previous 7-day
//     window, expressed as a percentage
//   - rebookingRate.value + .trend: returning-customer / total-
//     customer ratio with the same delta calc

export interface StatStripData {
  weeklyRecordings: { value: number; trend?: number | null; trendLabel?: string }
  todaysCustomers: { value: number }
  monthlyKarute: { value: number }
  rebookingRate: { value: number | null; trend?: number | null; trendLabel?: string }
}

export function StatStrip({ stats }: { stats: StatStripData }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile
        label="Recordings this week"
        value={stats.weeklyRecordings.value}
        trend={stats.weeklyRecordings.trend}
        trendLabel={stats.weeklyRecordings.trendLabel}
      />
      <StatTile label="Today's customers" value={stats.todaysCustomers.value} />
      <StatTile label="Monthly karute" value={stats.monthlyKarute.value} />
      <StatTile
        label="Rebooking rate"
        value={stats.rebookingRate.value}
        unit={stats.rebookingRate.value != null ? '%' : undefined}
        trend={stats.rebookingRate.trend}
        trendLabel={stats.rebookingRate.trendLabel}
      />
    </div>
  )
}

function StatTile({
  label,
  value,
  unit,
  trend,
  trendLabel,
}: {
  label: string
  value: number | null
  unit?: string
  trend?: number | null
  trendLabel?: string
}) {
  const hasTrend = trend !== undefined && trend !== null
  const trendPositive = (trend ?? 0) >= 0
  const TrendIcon = trendPositive ? TrendingUp : TrendingDown
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {hasTrend && (
          <div
            className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${
              trendPositive ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            <TrendIcon size={12} />
            <span className="tabular-nums">
              {trendPositive ? '+' : ''}
              {trend}
              {trendLabel ?? '%'}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {value ?? '—'}
        </span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}
