// Drill-down skeleton — mirrors the StaffDrillDownView grid.
// Avatar + name row, privacy notice, 4-metric grid, chart card,
// gap-list card. Sized to match the post-paint layout so there's
// no jump when the real chrome arrives.

export default function CoachingStaffDrillDownLoading() {
  return (
    <main className="mx-auto max-w-[1280px] animate-pulse px-4 py-5 md:px-8 md:py-8">
      <div className="mb-4 h-3 w-32 rounded bg-muted" />

      <div className="mb-5 flex items-start gap-3 md:mb-6 md:gap-4">
        <div className="size-12 shrink-0 rounded-full bg-muted md:size-14" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-6 w-48 rounded bg-muted md:h-7 md:w-56" />
          <div className="h-3 w-40 rounded bg-muted" />
        </div>
        <div className="hidden h-10 w-48 rounded-md bg-muted md:block" />
      </div>

      <div className="mb-5 h-16 w-full rounded-md bg-muted" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[68px] rounded-md bg-muted" />
        ))}
      </div>

      <div className="mb-5 h-56 rounded-xl bg-muted" />
      <div className="h-72 rounded-xl bg-muted" />
    </main>
  )
}
