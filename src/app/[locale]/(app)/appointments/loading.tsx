export default function AppointmentsLoading() {
  return (
    <div className="animate-pulse space-y-3 p-4 md:p-6">
      {/* Page header — title + date pager + new-booking button */}
      <div className="mb-4 flex items-center justify-between gap-2 md:gap-3">
        <div className="flex items-center gap-1">
          <div className="hidden h-8 w-32 rounded bg-muted md:block" />
          <div className="size-8 rounded-md bg-muted" />
          <div className="h-8 w-44 rounded-md bg-muted" />
          <div className="size-8 rounded-md bg-muted" />
          <div className="ml-1 h-8 w-14 rounded-md bg-muted" />
        </div>
        <div className="size-9 rounded-md bg-muted md:hidden" />
        <div className="hidden h-9 w-32 rounded-md bg-muted md:block" />
      </div>

      {/* Day/Week/Month toggle + legend chips */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-8 w-44 rounded-full bg-muted" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-3 w-10 rounded bg-muted" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="size-2.5 rounded-sm bg-muted" />
              <div className="h-3 w-12 rounded bg-muted" />
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-4 rounded-sm bg-muted" />
            <div className="h-3 w-10 rounded bg-muted" />
          </div>
        </div>
      </div>

      {/* Desktop time-grid */}
      <div className="hidden md:block">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex h-8 items-end border-b border-border px-3">
            <div className="h-3 w-14 rounded bg-muted" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex h-[88px] items-center gap-3 border-b border-border px-3 last:border-b-0"
            >
              <div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
              <div className="flex w-44 flex-col gap-1.5">
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="h-3 w-24 rounded bg-muted" />
              </div>
              <div className="flex h-full flex-1 items-center gap-2 pt-3">
                <div className="h-12 w-32 rounded-md bg-muted" />
                <div className="h-12 w-28 rounded-md bg-muted" />
                <div className="h-12 w-40 rounded-md bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile agenda */}
      <div className="space-y-2 md:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-2 rounded-xl border border-border bg-card p-3"
          >
            <div className="h-[60px] w-[60px] shrink-0 rounded-xl bg-muted" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
