// Fallback skeleton used when a route doesn't define its own loading.tsx
// (e.g. /ask-ai). Stays generic on purpose — kept loose so it doesn't
// strongly imply a specific page layout.
export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl animate-pulse flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 rounded bg-muted md:h-8" />
        <div className="h-3.5 w-72 rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="h-24 rounded-2xl bg-muted" />
        <div className="h-24 rounded-2xl bg-muted" />
        <div className="h-24 rounded-2xl bg-muted" />
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-5/6 rounded bg-muted" />
        <div className="h-3 w-3/4 rounded bg-muted" />
      </div>
    </div>
  )
}
