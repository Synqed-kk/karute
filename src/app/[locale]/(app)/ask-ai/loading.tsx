export default function AskAILoading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl animate-pulse flex-col gap-5 p-4 pb-0 md:p-6 md:pb-0">
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
