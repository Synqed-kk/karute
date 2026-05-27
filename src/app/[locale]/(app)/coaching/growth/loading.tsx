// Growth detail skeleton — mirrors PersonalGrowthView sections.
// Back link, title row, chart, 3-up stat strip, 2-col strengths/
// focus, mastered list, insights list, transcript card.

export default function CoachingGrowthLoading() {
  return (
    <main className="mx-auto max-w-[1280px] animate-pulse space-y-5 px-4 py-5 md:px-8 md:py-8">
      <div className="h-3 w-32 rounded bg-muted" />

      <div className="space-y-2">
        <div className="h-8 w-56 max-w-full rounded bg-muted" />
        <div className="h-3 w-96 max-w-full rounded bg-muted" />
      </div>

      <div className="h-56 rounded-xl bg-muted" />

      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="h-40 rounded-xl bg-muted" />
        <div className="h-40 rounded-xl bg-muted" />
      </div>

      <div className="h-48 rounded-xl bg-muted" />
      <div className="h-64 rounded-xl bg-muted" />
      <div className="h-72 rounded-xl bg-muted" />
    </main>
  )
}
