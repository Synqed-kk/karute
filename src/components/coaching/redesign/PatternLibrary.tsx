'use client'

// ─────────────────────────────────────────────────────────────
// PatternLibrary — /coaching/patterns root view
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/PatternLibrary.tsx
// (~77 lines). 5 fixed category sections rendered in the order
// defined by PATTERN_CATEGORIES.
//
// PRIVACY: Layer 2.
//   - Both roles see the catalog.
//   - sourceStaffName is owner-only (anonymized for staff).
//   - Backend MUST strip sourceStaffName server-side for staff
//     viewers. The `showSource` derivation here is for UX only.
//
// DATA SOURCE (when wired):
//   useTopPerformerPatternsData() → patterns: TopPerformerPattern[]
//   Weekly batch via claude-sonnet-4-6 over top-performer
//   transcripts; see AI_PROMPTS.md §11.
//
// ROLE
//   Reads viewer's effective role from useEffectiveCoachingRole
//   so dev preview pill flips the showSource behavior live.

import { ArrowLeft, BookOpen } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'

import { useEffectiveCoachingRole } from '@/lib/coaching-dev-preview/hooks'

import { PatternCategorySection } from './PatternCategorySection'
import {
  PATTERN_CATEGORIES,
  type PatternCategory,
} from './pattern-categories'
import type { TopPerformerPattern } from './LearnFromTopCard'

interface PatternLibraryProps {
  /** Viewer's session-derived role. Driving showSource via the
   *  effective role so the dev preview pill works live. */
  viewerRealRole: 'owner' | 'staff'
  /** Live catalog — null until Anthony wires
   *  useTopPerformerPatternsData(). */
  patterns?: TopPerformerPattern[] | null
}

export function PatternLibrary({
  viewerRealRole,
  patterns = null,
}: PatternLibraryProps) {
  const t = useTranslations('coaching.patterns')
  const tCat = useTranslations('coaching.patterns.categories')
  const locale = useLocale()
  const role = useEffectiveCoachingRole(viewerRealRole)
  const showSource = role === 'owner'

  const list = patterns ?? []
  const subtitle = role === 'staff' ? t('subtitleStaff') : t('subtitleOwner')

  // Bucket patterns by category once for the 5-section render.
  const byCategory = new Map<PatternCategory, TopPerformerPattern[]>()
  for (const key of PATTERN_CATEGORIES) byCategory.set(key, [])
  for (const p of list) {
    if (p.category && byCategory.has(p.category)) {
      byCategory.get(p.category)!.push(p)
    }
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-5 md:px-8 md:py-8">
      <Link
        href={`/${locale}/coaching`}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t('back')}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen className="size-6 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('title')}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <div className="space-y-6">
        {PATTERN_CATEGORIES.map((key) => (
          <PatternCategorySection
            key={key}
            title={tCat(`${key}.title`)}
            description={tCat(`${key}.description`)}
            patterns={byCategory.get(key) ?? []}
            showSource={showSource}
          />
        ))}
      </div>
    </main>
  )
}
