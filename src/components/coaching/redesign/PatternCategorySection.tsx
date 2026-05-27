'use client'

// ─────────────────────────────────────────────────────────────
// PatternCategorySection — one category's slice of the library
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/PatternCategorySection.tsx
// (~29 lines).
//
// SPIKE BEHAVIOR vs SCAFFOLD POSTURE
//
// The spike hides the section entirely when `patterns.length === 0`.
// That collapses the whole library to nothing when no data is
// wired — bad UX for the scaffold phase.
//
// Karute swap: always render the heading + description (so a
// viewer sees the SHAPE of the library), and use ScaffoldHint as
// the empty state. When patterns arrive, the hint disappears and
// the grid renders the cards.

import { useTranslations } from 'next-intl'

import { PatternExampleCard } from './PatternExampleCard'
import { ScaffoldHint } from './ScaffoldHint'
import type { TopPerformerPattern } from './LearnFromTopCard'

interface PatternCategorySectionProps {
  title: string
  description: string
  patterns: TopPerformerPattern[]
  showSource: boolean
}

export function PatternCategorySection({
  title,
  description,
  patterns,
  showSource,
}: PatternCategorySectionProps) {
  const t = useTranslations('coaching.patterns')
  const hasPatterns = patterns.length > 0

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {hasPatterns ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {patterns.map((p) => (
            <PatternExampleCard
              key={p.id}
              pattern={p}
              showSource={showSource}
            />
          ))}
        </div>
      ) : (
        <ScaffoldHint hint={t('sectionEmptyHint')} />
      )}
    </section>
  )
}
