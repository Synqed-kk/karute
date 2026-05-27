// Patterns library skeleton — mirrors PatternLibrary layout.
// Back link, title row, then 5 category sections each with a
// heading line + 2 card placeholders.

export default function CoachingPatternsLoading() {
  return (
    <main className="mx-auto max-w-[1280px] animate-pulse space-y-6 px-4 py-5 md:px-8 md:py-8">
      <div className="h-3 w-32 rounded bg-muted" />

      <div className="space-y-2">
        <div className="h-8 w-72 max-w-full rounded bg-muted" />
        <div className="h-3 w-96 max-w-full rounded bg-muted" />
      </div>

      {Array.from({ length: 5 }).map((_, i) => (
        <section key={i} className="space-y-3">
          <div className="space-y-1.5">
            <div className="h-4 w-48 rounded bg-muted" />
            <div className="h-3 w-80 max-w-full rounded bg-muted" />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="h-40 rounded-xl bg-muted" />
            <div className="h-40 rounded-xl bg-muted" />
          </div>
        </section>
      ))}
    </main>
  )
}
