export default function DashboardLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-5 p-4 md:p-6">
      {/* Header: greeting + owner pill + Setup-store button */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="h-7 w-72 rounded bg-muted md:h-8 md:w-80" />
          <div className="h-3.5 w-56 rounded bg-muted" />
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="h-8 w-28 rounded-full bg-muted" />
          <div className="h-8 w-28 rounded-full bg-muted" />
        </div>
      </header>

      {/* Onboarding banner (only shows pre-setup; keep in skeleton for stable height) */}
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-4 w-56 rounded bg-muted" />
          <div className="h-3 w-full max-w-md rounded bg-muted" />
          <div className="mt-1 flex items-center gap-2">
            <div className="h-8 w-24 rounded-full bg-muted" />
            <div className="h-8 w-20 rounded-full bg-muted" />
          </div>
        </div>
      </div>

      {/* AI Actions Hero */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-full bg-muted" />
            <div className="flex flex-col gap-1.5">
              <div className="h-4 w-40 rounded bg-muted" />
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
          </div>
          <div className="h-6 w-32 rounded-full bg-muted" />
        </div>
        <div className="rounded-xl border border-dashed border-border/60 bg-background/40 p-6">
          <div className="mx-auto mb-2 h-8 w-8 rounded-full bg-muted" />
          <div className="mx-auto h-4 w-40 rounded bg-muted" />
          <div className="mx-auto mt-2 h-3 w-3/4 rounded bg-muted" />
        </div>
      </section>

      {/* Stat strip — 4 tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-card p-4 shadow-sm"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="h-3 w-28 rounded bg-muted" />
              <div className="h-3 w-10 rounded bg-muted" />
            </div>
            <div className="h-7 w-12 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* 2-col bottom: Today's appointments + Recent karute */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, col) => (
          <section
            key={col}
            className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 rounded bg-muted" />
                <div className="h-4 w-36 rounded bg-muted" />
                <div className="h-3 w-10 rounded bg-muted" />
              </div>
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
            <div className="flex flex-col">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 border-b border-border py-3 last:border-b-0"
                >
                  <div className="w-14 shrink-0">
                    <div className="h-4 w-10 rounded bg-muted" />
                    <div className="mt-1 h-3 w-8 rounded bg-muted" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="h-3.5 w-32 rounded bg-muted" />
                      <div className="h-3 w-12 rounded bg-muted" />
                      <div className="ml-auto h-4 w-16 rounded-full bg-muted" />
                    </div>
                    <div className="h-3 w-40 rounded bg-muted" />
                    <div className="h-3 w-24 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
