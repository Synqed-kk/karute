export default function KaruteDetailLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-4 p-4 md:p-6">
      {/* Breadcrumb + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-4 w-20 rounded bg-muted" />
          <div className="h-4 w-3 rounded bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-4 w-3 rounded bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-24 rounded-lg bg-muted" />
          <div className="h-8 w-20 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Customer header card */}
      <section className="flex items-start gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm md:gap-6 md:p-6">
        <div className="h-14 w-14 shrink-0 rounded-full bg-muted md:h-16 md:w-16" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-baseline gap-2.5">
            <div className="h-6 w-40 rounded bg-muted md:h-7 md:w-48" />
            <div className="h-4 w-14 rounded bg-muted" />
          </div>
          <div className="h-3 w-2/3 rounded bg-muted" />
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-3 w-1/2 rounded bg-muted" />
        </div>
      </section>

      {/* Two-col bottom */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {/* Current session card */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
            <div className="mb-4 h-4 w-32 rounded bg-muted" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="grid items-baseline gap-3 md:grid-cols-[88px_56px_1fr]"
                >
                  <div className="h-5 w-20 rounded bg-muted" />
                  <div className="h-3 w-10 rounded bg-muted" />
                  <div className="h-4 w-full rounded bg-muted" />
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* AI Summary card */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border bg-sky-500/5 px-4 py-3">
              <div className="h-3 w-24 rounded bg-muted" />
            </div>
            <div className="space-y-2.5 p-5 md:p-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-3 w-full rounded bg-muted" />
              ))}
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
          </section>

          {/* Recording transcript */}
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded bg-muted" />
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="h-4 w-40 rounded bg-muted" />
                <div className="h-3 w-24 rounded bg-muted" />
              </div>
              <div className="h-8 w-8 rounded-lg bg-muted" />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
