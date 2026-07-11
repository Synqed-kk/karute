export default function ProfileLoading() {
  return (
    <main className="mx-auto w-full max-w-[720px] animate-pulse space-y-5 px-4 py-5 md:px-8 md:py-8">
      {/* Desktop page header */}
      <div className="hidden md:block">
        <div className="h-7 w-32 rounded bg-muted" />
        <div className="mt-2 h-3 w-56 rounded bg-muted" />
      </div>

      {/* Identity card: avatar + name/role lines */}
      <section className="border-b border-black/5 bg-card p-4 dark:border-white/5 md:rounded-xl md:border-0 md:p-5 md:ring-1 md:ring-black/5 md:dark:ring-white/5">
        <div className="flex items-start gap-3">
          <div className="size-14 shrink-0 rounded-full bg-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <div className="h-5 w-36 rounded bg-muted" />
            <div className="h-3 w-48 rounded bg-muted" />
            <div className="h-3 w-24 rounded bg-muted" />
          </div>
        </div>
      </section>

      {/* Activity stats section — renders for staff accounts (the majority
          role): label + 4 stat tiles + hint banner. Owners get one spare
          block that collapses on mount — a far smaller shift than staff
          getting a whole section inserted. */}
      <section className="border-b border-black/5 bg-card p-4 dark:border-white/5 md:rounded-xl md:border-0 md:p-5 md:ring-1 md:ring-black/5 md:dark:ring-white/5">
        <div className="mb-3 h-3 w-20 rounded bg-muted" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted" />
          ))}
        </div>
        <div className="mt-3 h-12 w-full rounded-lg bg-muted/60" />
      </section>

      {/* Two settings-section cards */}
      {Array.from({ length: 2 }).map((_, i) => (
        <section
          key={i}
          className="border-b border-black/5 bg-card p-4 dark:border-white/5 md:rounded-xl md:border-0 md:p-5 md:ring-1 md:ring-black/5 md:dark:ring-white/5"
        >
          <div className="mb-4 h-4 w-28 rounded bg-muted" />
          <div className="space-y-3">
            <div className="h-10 w-full rounded-lg bg-muted" />
            <div className="h-10 w-full rounded-lg bg-muted" />
          </div>
        </section>
      ))}
    </main>
  )
}
