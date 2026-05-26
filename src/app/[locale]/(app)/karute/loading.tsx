export default function KaruteLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-4 p-4 md:gap-5 md:p-6">
      {/* Header: title + stats + CTA */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="h-8 w-28 rounded bg-muted md:h-9 md:w-32" />
          <div className="h-4 w-72 rounded bg-muted" />
        </div>
        <div className="h-10 w-36 rounded-[10px] bg-muted" />
      </div>

      {/* Search bar */}
      <div className="h-11 rounded-[10px] bg-muted" />

      {/* 4 status filter chips — matches the live list (レビュー要
       *  was dropped in PR #63 because no data path assigned it).
       *  Earlier value of 5 caused a chip-count flash on every page
       *  load. */}
      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-muted" />
        ))}
      </div>

      {/* 2 date groups, 2 rows each */}
      {Array.from({ length: 2 }).map((_, g) => (
        <section key={g} className="space-y-2.5">
          <div className="h-3 w-48 rounded bg-muted" />
          <div className="flex flex-col gap-2">
            {Array.from({ length: 2 }).map((_, r) => (
              <div
                key={r}
                className="grid items-start gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm"
                style={{ gridTemplateColumns: '64px 44px minmax(0, 1fr)' }}
              >
                <div className="flex flex-col gap-1">
                  <div className="h-4 w-12 rounded bg-muted" />
                  <div className="h-3 w-8 rounded bg-muted" />
                </div>
                <div className="h-9 w-9 rounded-full bg-muted" />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-36 rounded bg-muted" />
                    <div className="h-3 w-12 rounded bg-muted" />
                    <div className="ml-auto h-5 w-20 rounded-full bg-muted" />
                  </div>
                  <div className="h-3 w-full rounded bg-muted" />
                  <div className="h-3 w-2/3 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
