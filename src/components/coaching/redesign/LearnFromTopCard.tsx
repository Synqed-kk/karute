'use client'

// ─────────────────────────────────────────────────────────────
// LearnFromTopCard — staff dashboard Row 1 right
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/LearnFromTopCard.tsx
// (~106 lines). Visual preserved with one intentional skip:
//
//   • Business-profile "{業種} 向け" block omitted (lines
//     57-81 in spike). The spike pulls from
//     useActiveBusinessProfile().topPatternExamples which
//     doesn't exist on karute yet — Phase-3 surface. When
//     Anthony wires that profile, slot the block in just
//     above the main pattern list.
//
// PRIVACY: Layer 2 — sourceStaffName MUST be stripped for
// staff at the API layer (NEVER show another staff's name to
// a staff viewer). The `showSource` prop is true only on the
// owner-view callers; staff view passes false.

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, BookOpen } from 'lucide-react'

import { ScaffoldHint } from './ScaffoldHint'

export interface TopPerformerPattern {
  id: string
  categoryLabel: string
  title: string
  description: string
  /** Owner-only — anonymized away for staff viewers via
   *  showSource=false. */
  sourceStaffName?: string | null
}

interface LearnFromTopCardProps {
  patterns?: TopPerformerPattern[] | null
  /** Owner view shows the source staff name; staff view never
   *  does (Layer 2 anonymization). */
  showSource?: boolean
}

export function LearnFromTopCard({
  patterns = null,
  showSource = false,
}: LearnFromTopCardProps) {
  const t = useTranslations('coaching.staff.learnFromTop')
  const locale = useLocale()
  const items = (patterns ?? []).slice(0, 3)
  const hasItems = items.length > 0

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-indigo-600 dark:text-indigo-300" />
          <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
        </div>
        <Link
          href={`/${locale}/coaching`}
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 dark:text-indigo-300"
        >
          {t('seeAll')}
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      {hasItems ? (
        <div className="space-y-3">
          {items.map((pattern) => (
            <div
              key={pattern.id}
              className="rounded-md border border-gray-100 bg-gray-50/60 p-3 dark:border-white/5 dark:bg-white/[0.03]"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-flex h-5 items-center rounded-full border border-indigo-200 bg-indigo-100 px-2 text-[10px] font-medium text-indigo-800 dark:border-indigo-500/20 dark:bg-indigo-500/15 dark:text-indigo-300">
                  {pattern.categoryLabel}
                </span>
                {showSource && pattern.sourceStaffName && (
                  <span className="text-[10px] text-muted-foreground">
                    · {pattern.sourceStaffName}
                  </span>
                )}
              </div>
              <div className="mb-1 text-sm font-medium text-foreground">
                {pattern.title}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {pattern.description}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <ScaffoldHint hint={t('emptyHint')} />
      )}
    </div>
  )
}
