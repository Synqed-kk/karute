export default function CoachingLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl animate-pulse flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted" />
          <div className="flex flex-col gap-2">
            <div className="h-7 w-32 rounded bg-muted md:h-8 md:w-36" />
            <div className="h-3 w-72 rounded bg-muted" />
          </div>
        </div>
        <div className="h-6 w-28 rounded-full bg-muted" />
      </header>

      <section className="rounded-2xl border border-border bg-card p-8 shadow-sm md:p-12">
        <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-muted" />
        <div className="mx-auto h-5 w-56 rounded bg-muted" />
        <div className="mx-auto mt-3 h-3 w-full max-w-md rounded bg-muted" />
        <div className="mx-auto mt-1.5 h-3 w-3/4 max-w-sm rounded bg-muted" />
        <div className="mx-auto mt-6 flex max-w-md flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-3 w-full rounded bg-muted" />
          ))}
        </div>
      </section>
    </div>
  )
}
