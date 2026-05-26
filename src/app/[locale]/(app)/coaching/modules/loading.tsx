// Modules library skeleton — mirrors LearningModulesView layout.
// Back link, title row, AI callout, search/tab block, 6-card grid.
// Sized to match post-paint so the page doesn't reflow when data
// arrives.

export default function CoachingModulesLoading() {
  return (
    <main className="mx-auto max-w-[1280px] animate-pulse space-y-4 px-4 py-5 md:px-8 md:py-8">
      <div className="h-3 w-32 rounded bg-muted" />

      <div className="space-y-2">
        <div className="h-8 w-56 rounded bg-muted" />
        <div className="h-3 w-96 max-w-full rounded bg-muted" />
      </div>

      <div className="h-16 rounded-xl bg-muted" />

      <div className="h-10 max-w-lg rounded-md bg-muted" />
      <div className="h-10 w-80 max-w-full rounded-lg bg-muted" />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-48 rounded-xl bg-muted" />
        ))}
      </div>
    </main>
  )
}
