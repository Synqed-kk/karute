export default function WelcomeLoading() {
  return (
    <div className="min-h-svh animate-pulse bg-background px-4 py-8 md:px-6 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {/* Brand header */}
        <header className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted" />
          <div className="flex flex-col gap-1.5">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-6 w-44 rounded bg-muted md:h-7 md:w-48" />
          </div>
        </header>

        {/* Progress pills */}
        <ol className="flex items-center gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex flex-1 items-center gap-3 last:flex-initial">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-muted" />
                <div className="hidden h-3 w-24 rounded bg-muted md:block" />
              </div>
              {i < 2 && <div className="h-px flex-1 bg-border" />}
            </li>
          ))}
        </ol>

        {/* Step card */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-muted" />
            <div className="h-3 w-24 rounded bg-muted" />
          </div>
          <div className="mb-5 h-3.5 w-3/4 rounded bg-muted" />
          <div className="flex flex-col gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-10 w-full rounded-lg bg-muted" />
              </div>
            ))}
            {/* Preview card */}
            <div className="rounded-xl border border-border bg-background/40 p-4">
              <div className="mb-2 h-3 w-32 rounded bg-muted" />
              <div className="mb-1.5 h-4 w-40 rounded bg-muted" />
              <div className="mb-3 h-3 w-full rounded bg-muted" />
              <div className="space-y-1.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-3 w-2/3 rounded bg-muted" />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer (Back / Next) */}
        <footer className="flex items-center justify-between">
          <div className="h-9 w-20 rounded-full bg-muted" />
          <div className="h-9 w-24 rounded-full bg-muted" />
        </footer>
      </div>
    </div>
  )
}
