import { Brain } from 'lucide-react'

// Stubbed. Real Customer Memory needs the customer_memory_items table from
// the karute detail handoff — AI-extracted profile rows with sections
// (personal / body / preferences / goals / lifestyle), pinning, and a
// derived "Talking points for today" view. Until the extraction job runs,
// every customer shows the empty state below.
export function MemoryTabContent() {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center shadow-sm md:px-8 md:py-16">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/15 text-violet-300">
        <Brain size={18} />
      </div>
      <p className="text-sm font-semibold text-foreground">No memory yet</p>
      <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
        Customer Memory will populate after the first recorded session — AI
        extracts pinned facts about personal context, body / health, preferences,
        goals, and lifestyle.
      </p>
    </section>
  )
}
