import { Sparkles, Target } from 'lucide-react'
import type { BusinessProfile } from '@/lib/welcome/business-types'

// Stubbed for v1. Backend pieces this needs:
//   - aiActions: producer service that emits suggested actions (a table +
//     a heuristic job, or an LLM call against recent karute + customers).
//   - todaysFocus: per-business-type tuned content (the BusinessProfile from
//     the welcome wizard supplies the label; the focus items come from a
//     separate `business_profile_topics` lookup keyed by business_type).
// Until those land, this card surfaces the title + business-type chip so the
// dashboard layout reads correctly, with an empty state instead of fake data.
interface AIActionsHeroProps {
  businessProfile: BusinessProfile | null
}

export function AIActionsHero({ businessProfile }: AIActionsHeroProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/15 text-sky-400">
            <Sparkles size={16} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              AI suggested actions
            </h2>
            <div className="text-xs text-muted-foreground">0 waiting</div>
          </div>
        </div>
        {businessProfile && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
            <Target size={11} />
            <span>{businessProfile.label}</span>
          </span>
        )}
      </div>

      <div className="rounded-xl border border-dashed border-border/60 bg-background/40 p-6 text-center">
        <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Sparkles size={14} />
        </div>
        <p className="text-sm font-medium text-foreground">
          No AI suggestions yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Once you&apos;ve recorded a few sessions, AI will surface follow-up reminders, draft messages, and karute that need review.
        </p>
      </div>
    </section>
  )
}
