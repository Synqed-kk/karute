export default function DataExportLoading() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 md:px-6 lg:px-8 py-6 md:py-8">
      {/* Header */}
      <div className="rounded-2xl border border-border/30 bg-card/40 px-6 py-5 mb-6">
        <div className="h-3 w-32 rounded bg-muted animate-pulse mb-3" />
        <div className="h-7 w-48 rounded bg-muted animate-pulse mb-2" />
        <div className="h-3 w-96 rounded bg-muted animate-pulse" />
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-1 flex items-center gap-2">
            <div className="size-7 rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-16 rounded bg-muted animate-pulse" />
            {i < 3 && <div className="flex-1 h-px bg-border/40 mx-2" />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        <div className="space-y-6">
          {/* Scope cards */}
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-border/30 bg-card/40 p-4 h-[90px] animate-pulse"
              />
            ))}
          </div>
          {/* Format cards */}
          <div className="grid grid-cols-4 gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-border/30 bg-card/40 p-3 h-[80px] animate-pulse"
              />
            ))}
          </div>
          {/* Columns + Filter cards */}
          <div className="rounded-xl border border-border/30 bg-card/40 h-48 animate-pulse" />
          <div className="rounded-xl border border-border/30 bg-card/40 h-40 animate-pulse" />
          <div className="rounded-xl border border-border/30 bg-card/40 h-32 animate-pulse" />
        </div>
        <div className="hidden xl:block">
          <div className="rounded-xl border border-border/30 bg-card/40 h-80 animate-pulse" />
        </div>
      </div>
    </div>
  )
}
