export default function SettingsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-5 p-4 md:p-6">
      {/* Page header */}
      <div className="h-7 w-32 rounded bg-muted md:h-8 md:w-36" />

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl bg-muted/40 p-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 flex-1 rounded-lg bg-muted" />
        ))}
      </div>

      {/* Active panel — generic settings card */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="mb-4 flex flex-col gap-2">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-3 w-2/3 rounded bg-muted" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-10 w-full max-w-md rounded-lg bg-muted" />
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <div className="h-9 w-20 rounded-full bg-muted" />
          <div className="h-9 w-24 rounded-full bg-muted" />
        </div>
      </section>
    </div>
  )
}
