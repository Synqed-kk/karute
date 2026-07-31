export default function AskAILoading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl animate-pulse flex-col gap-5 p-4 pb-0 md:p-6 md:pb-0">
      {/* Page header: icon + title/subtitle, then the data-scope chip row —
          AIPageHeader always renders these, so the skeleton must hold the
          space or the whole page jumps down when it mounts. */}
      <header className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-muted" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <div className="h-6 w-28 rounded bg-muted" />
            <div className="h-3 w-64 max-w-full rounded bg-muted" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-7 w-24 rounded-full bg-muted" />
          ))}
        </div>
      </header>

      {/* Business-profile hint box (always renders one of its two branches) */}
      <div className="h-[92px] w-full rounded-xl border border-border/30 bg-card/50" />

      {/* Recommended-prompts header */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="h-3 w-24 rounded bg-muted" />
      </div>

      {/* 3 prompt cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl border border-border/30 bg-card/50" />
        ))}
      </div>

      {/* Conversation header + empty thread */}
      <div className="h-4 w-28 rounded bg-muted" />
      <div className="flex flex-col gap-5 pb-2">
        <div className="h-16 rounded-xl border border-dashed border-border bg-card/40" />
        <div className="h-11 w-full rounded-xl bg-muted" />
      </div>
    </div>
  )
}
