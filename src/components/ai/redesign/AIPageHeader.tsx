import { FileText, Sparkles } from 'lucide-react'
import { ComingSoonChip } from '@/components/customers/redesign/ComingSoonChip'

export interface DataScopeItem {
  label: string
  count: number
}

interface AIPageHeaderProps {
  scope: DataScopeItem[]
}

export function AIPageHeader({ scope }: AIPageHeaderProps) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
          <Sparkles size={18} />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[26px]">
            AI Assistant
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground md:text-sm">
            Ask anything about your business — answers ground in your karute,
            customer, and recording data.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <FileText size={11} />
          <span>Data connected</span>
        </span>
        {scope.map((s) => (
          <span
            key={s.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px]"
          >
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-semibold tabular-nums text-foreground">
              {s.count}
            </span>
          </span>
        ))}
        {/* RAG grounding only retrieves the top few rows today; the chips show
            the total inventory but the AI isn't doing full-corpus search yet. */}
        <ComingSoonChip />
      </div>
    </header>
  )
}
