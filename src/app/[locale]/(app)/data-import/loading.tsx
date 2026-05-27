export default function DataImportLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div>
        <div className="h-7 w-40 rounded bg-muted md:h-8" />
        <div className="mt-2 h-4 w-72 rounded bg-muted" />
      </div>

      <div className="rounded-2xl border border-dashed border-border/50 bg-card/50 p-12">
        <div className="flex flex-col items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-muted/50" />
          <div className="flex flex-col items-center gap-2">
            <div className="h-4 w-48 rounded bg-muted" />
            <div className="h-3 w-64 rounded bg-muted" />
          </div>
          <div className="h-9 w-32 rounded-xl bg-muted" />
        </div>
      </div>

      <div className="rounded-2xl border border-border/30 bg-card/50 p-5">
        <div className="mb-3 h-4 w-32 rounded bg-muted" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border/20 p-3">
              <div className="h-4 w-16 rounded bg-muted" />
              <div className="mt-2 h-3 w-full rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
