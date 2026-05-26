// Data transparency skeleton — mirrors PersonalDataView layout.
// Back link, title row, mission card, 2-col privacy split,
// 2-col actions.

export default function CoachingDataLoading() {
  return (
    <main className="mx-auto max-w-[1280px] animate-pulse space-y-6 px-4 py-5 md:px-8 md:py-8">
      <div className="h-3 w-32 rounded bg-muted" />

      <div className="space-y-2">
        <div className="h-8 w-56 max-w-full rounded bg-muted" />
        <div className="h-3 w-96 max-w-full rounded bg-muted" />
      </div>

      <div className="h-24 rounded-lg bg-muted" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="h-56 rounded-lg bg-muted" />
        <div className="h-56 rounded-lg bg-muted" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="h-40 rounded-lg bg-muted" />
        <div className="h-40 rounded-lg bg-muted" />
      </div>
    </main>
  )
}
