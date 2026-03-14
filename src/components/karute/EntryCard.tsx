'use client'

import { useTransition, useState } from 'react'
import { Trash2, Edit2, ChevronDown, ChevronUp } from 'lucide-react'
import { CategoryBadge } from '@/components/karute/CategoryBadge'
import { ConfidenceDot } from '@/components/karute/ConfidenceDot'
import { deleteEntry } from '@/actions/entries'
import { cn } from '@/lib/utils'

interface EntryCardProps {
  entry: {
    id: string
    category: string
    content: string
    source_quote: string | null
    confidence_score: number | null
    is_manual: boolean
    created_at: string
  }
  karuteRecordId: string
}

/**
 * Compact entry row with category badge, content, and confidence dot.
 * - Click to expand source quote (AI entries only).
 * - Hover to reveal edit/delete action buttons.
 * - Manual entries show a "Manual" badge and no confidence dot.
 */
export function EntryCard({ entry, karuteRecordId }: EntryCardProps) {
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)

  function handleDelete() {
    startTransition(async () => {
      await deleteEntry(entry.id, karuteRecordId)
    })
  }

  const hasSourceQuote = !entry.is_manual && !!entry.source_quote

  return (
    <div
      className={cn(
        'group relative rounded-lg border border-border bg-card px-3 py-2 transition-opacity',
        isPending && 'opacity-40 pointer-events-none',
      )}
    >
      {/* Main row */}
      <div className="flex items-center gap-2">
        {/* Category badge */}
        <CategoryBadge category={entry.category} />

        {/* Manual badge */}
        {entry.is_manual && (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Manual
          </span>
        )}

        {/* Content */}
        <span className="flex-1 min-w-0 truncate text-sm text-foreground">
          {entry.content}
        </span>

        {/* Confidence dot */}
        <ConfidenceDot
          score={entry.confidence_score}
          isManual={entry.is_manual}
        />

        {/* Expand toggle for source quote */}
        {hasSourceQuote && (
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={expanded ? 'Collapse source quote' : 'Expand source quote'}
          >
            {expanded ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        )}

        {/* Hover-reveal action buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Edit entry"
            // TODO: Implement inline edit in a future plan
            onClick={() => {}}
          >
            <Edit2 className="size-3.5" />
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Delete entry"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded source quote */}
      {expanded && hasSourceQuote && (
        <p className="mt-2 ml-2 border-l-2 border-border pl-3 text-xs italic text-muted-foreground">
          &ldquo;{entry.source_quote}&rdquo;
        </p>
      )}
    </div>
  )
}
