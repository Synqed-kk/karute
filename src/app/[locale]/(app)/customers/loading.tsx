export default function CustomersLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-4 p-4 md:p-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="h-7 w-32 rounded bg-muted md:h-8 md:w-36" />
          <div className="h-3.5 w-56 rounded bg-muted" />
        </div>
        <div className="h-9 w-36 rounded-[10px] bg-muted" />
      </div>

      {/* Filter / search bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-9 flex-1 rounded-[10px] bg-muted md:max-w-sm" />
        <div className="h-8 w-20 rounded-full bg-muted" />
      </div>

      {/* List rows */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        {/* Header row */}
        <div className="grid grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_120px_80px] items-center gap-3 border-b border-border px-4 py-2.5">
          <div className="h-3 w-3 rounded bg-muted" />
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="h-3 w-16 rounded bg-muted" />
          <div className="h-3 w-16 rounded bg-muted" />
          <div className="h-3 w-12 rounded bg-muted" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_120px_80px] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
          >
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="flex flex-col gap-1.5">
              <div className="h-4 w-40 rounded bg-muted" />
              <div className="h-3 w-24 rounded bg-muted" />
            </div>
            <div className="h-3.5 w-32 rounded bg-muted" />
            <div className="h-3.5 w-20 rounded bg-muted" />
            <div className="h-3.5 w-12 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-2 pt-1">
        <div className="h-8 w-16 rounded-md bg-muted" />
        <div className="h-8 w-8 rounded-md bg-muted" />
        <div className="h-8 w-8 rounded-md bg-muted" />
        <div className="h-8 w-8 rounded-md bg-muted" />
        <div className="h-8 w-16 rounded-md bg-muted" />
      </div>
    </div>
  )
}
