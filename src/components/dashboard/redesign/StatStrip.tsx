// `trend` / `trendLabel` props removed — no producer in
// dashboard/page.tsx ever set them, so the TrendingUp/Down icon +
// `+X%` row never rendered. Same class of bug as the レビュー要
// filter chip from PR #63. The "Rebooking rate" tile's value is
// also `null` today (page.tsx comment: "needs a returning-customer/
// total calc that we haven't wired up yet") so the tile already
// shows "—". When trend + rebooking-rate producers ship together,
// restore the prop schema in one go.

export interface StatStripData {
  weeklyRecordings: { value: number }
  todaysCustomers: { value: number }
  monthlyKarute: { value: number }
  rebookingRate: { value: number | null }
}

export function StatStrip({ stats }: { stats: StatStripData }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile
        label="Recordings this week"
        value={stats.weeklyRecordings.value}
      />
      <StatTile label="Today's customers" value={stats.todaysCustomers.value} />
      <StatTile label="Monthly karute" value={stats.monthlyKarute.value} />
      <StatTile
        label="Rebooking rate"
        value={stats.rebookingRate.value}
        unit={stats.rebookingRate.value != null ? '%' : undefined}
      />
    </div>
  )
}

function StatTile({
  label,
  value,
  unit,
}: {
  label: string
  value: number | null
  unit?: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
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
