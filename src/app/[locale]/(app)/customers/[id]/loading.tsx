export default function CustomerProfileLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl animate-pulse flex-col gap-6 p-4 md:p-6">
      {/* Back link */}
      <div className="h-4 w-16 rounded bg-muted" />

      {/* Identity card */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="flex items-start gap-4 md:gap-6">
          <div className="h-14 w-14 shrink-0 rounded-full bg-muted md:h-16 md:w-16" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-baseline gap-2.5">
              <div className="h-6 w-44 rounded bg-muted md:h-7 md:w-52" />
              <div className="h-4 w-14 rounded bg-muted" />
            </div>
            <div className="h-3.5 w-2/3 rounded bg-muted" />
            <div className="h-3.5 w-1/2 rounded bg-muted" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="h-7 w-14 rounded bg-muted" />
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-3 w-32 rounded bg-muted" />
          </div>
        </div>
      </section>

      {/* Contact card */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="mb-3 h-4 w-20 rounded bg-muted" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-3 w-16 rounded bg-muted" />
              <div className="h-4 w-32 rounded bg-muted" />
            </div>
          ))}
        </div>
      </section>

      {/* Session history */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="mb-4 h-4 w-32 rounded bg-muted" />
        <div className="flex flex-col">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[90px_minmax(0,1fr)_120px] items-center gap-3 border-b border-border py-3 last:border-b-0"
            >
              <div className="h-4 w-20 rounded bg-muted" />
              <div className="flex flex-col gap-1.5">
                <div className="h-4 w-40 rounded bg-muted" />
                <div className="h-3 w-28 rounded bg-muted" />
              </div>
              <div className="h-4 w-24 rounded bg-muted" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
