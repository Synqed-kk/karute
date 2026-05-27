export default function SessionsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-5 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="h-8 w-28 rounded bg-muted md:h-9 md:w-32" />
        <div className="h-4 w-80 rounded bg-muted" />
      </div>

      {/* 2-col grid (target+brief | chips+mic+consent) */}
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {/* Recording target card */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-6 w-6 rounded bg-muted" />
                <div className="h-4 w-32 rounded bg-muted" />
              </div>
              <div className="h-6 w-40 rounded bg-muted" />
            </div>
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-muted" />
              <div className="flex flex-col gap-1.5">
                <div className="h-5 w-40 rounded bg-muted" />
                <div className="h-3 w-52 rounded bg-muted" />
                <div className="h-3 w-32 rounded bg-muted" />
              </div>
            </div>
          </section>

          {/* Pre-session brief card */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="h-5 w-5 rounded bg-muted" />
              <div className="flex flex-col gap-1">
                <div className="h-3 w-32 rounded bg-muted" />
                <div className="h-3 w-44 rounded bg-muted" />
              </div>
            </div>
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-3 w-full rounded bg-muted" />
              ))}
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3.5">
          {/* Source/Mode chips */}
          <div className="grid gap-2.5 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3"
              >
                <div className="h-5 w-5 rounded bg-muted" />
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="h-3 w-24 rounded bg-muted" />
                  <div className="h-3 w-32 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>

          {/* Record button card */}
          <section className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-7 shadow-sm">
            <div className="h-16 w-16 rounded-full bg-muted" />
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-3 w-56 rounded bg-muted" />
          </section>

          {/* Consent pill */}
          <div className="flex justify-center">
            <div className="h-7 w-44 rounded-full bg-muted" />
          </div>
        </div>
      </div>

      {/* Recent recordings */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-3 w-6 rounded bg-muted" />
        </div>
        <ul className="m-0 flex list-none flex-col p-0">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className="grid items-center gap-3 border-b border-border py-3 last:border-b-0 md:grid-cols-[28px_36px_minmax(0,1fr)_140px_120px]"
            >
              <div className="h-7 w-7 rounded-full bg-muted" />
              <div className="h-9 w-9 rounded-full bg-muted" />
              <div className="flex flex-col gap-1">
                <div className="h-4 w-40 rounded bg-muted" />
                <div className="h-3 w-32 rounded bg-muted" />
              </div>
              <div className="flex flex-col gap-1">
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="h-3 w-32 rounded bg-muted" />
              </div>
              <div className="h-4 w-28 rounded bg-muted" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
