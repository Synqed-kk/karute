export default function SettingsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl animate-pulse flex-col gap-6 p-4 md:p-6">
      {/* Page header */}
      <div className="h-7 w-32 rounded bg-muted md:h-8 md:w-36" />

      {/* 10-tab strip (single row, horizontally scrollable) */}
      <div className="flex items-center gap-1 rounded-xl border border-border/30 bg-muted/30 p-1 overflow-hidden">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="h-9 w-[110px] shrink-0 rounded-lg bg-muted"
          />
        ))}
      </div>

      {/* Active panel — generic section card */}
      <section className="rounded-xl border border-border/30 bg-card/50 p-6">
        <div className="mb-5 flex flex-col gap-2">
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="h-3 w-2/3 rounded bg-muted" />
        </div>

        {/* Setup banner */}
        <div className="mb-5 h-12 w-full rounded-lg bg-muted/60" />

        {/* Two-column form rows */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-10 w-full rounded-lg bg-muted" />
            </div>
          ))}
        </div>

        {/* Hours-of-operation block */}
        <div className="border-t border-border/30 pt-5">
          <div className="mb-3 h-4 w-32 rounded bg-muted" />
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="grid grid-cols-[56px_1fr_20px_1fr_72px] items-center gap-2"
              >
                <div className="h-4 w-10 rounded bg-muted" />
                <div className="h-9 w-full rounded-lg bg-muted" />
                <div className="h-3 w-3 rounded bg-muted" />
                <div className="h-9 w-full rounded-lg bg-muted" />
                <div className="h-7 w-full rounded-md bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
