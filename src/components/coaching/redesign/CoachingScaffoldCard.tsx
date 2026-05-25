'use client'

// ─────────────────────────────────────────────────────────────
// Generic coaching-card scaffold
// ─────────────────────────────────────────────────────────────
// Used across both StaffDashboardScaffold + OwnerDashboardScaffold
// to render the chrome of a coaching surface (icon, title, optional
// privacy badge) with a 対応予定 hint + descriptive body explaining
// what that card will contain once Anthony wires the data layer.
//
// Visual matches the spike's coaching cards (rounded border, indigo
// accent on staff cards / amber accent on owner cards via the
// `tone` prop) so the eventual real-data render slides in without
// layout shifts.
//
// ANTHONY: when you wire a card's data hook, replace the slot
// where <CoachingScaffoldCard> renders with the real card component
// (MonthlyGrowthCard / TeamPerformanceCard / etc — to be ported
// in a follow-up PR per MERGE_NOTES_FOR_ANTHONY.md punchlist).

import { Lock, Wand2 } from 'lucide-react'

export type CoachingScaffoldTone = 'indigo' | 'amber' | 'violet' | 'emerald'

interface CoachingScaffoldCardProps {
  /** Lucide icon component — matches the eventual real card's icon
   *  so staff recognise the slot when scaffolds disappear. */
  icon: React.ReactNode
  /** Card title (JA from i18n). */
  title: string
  /** Body copy explaining what'll appear here once wired. */
  body: string
  /** Sub-title / data-source hint shown beneath title (optional). */
  subtitle?: string
  /** Privacy-layer indicator. 'layer1' = staff-private (Lock icon),
   *  'layer2' = team-shared (no badge), 'layer3' = aggregated. */
  privacyLayer?: 'layer1' | 'layer2' | 'layer3'
  /** Accent tone — indigo for staff, amber for owner (matches spike). */
  tone?: CoachingScaffoldTone
  /** Layout span. Some cards take 2 grid columns. */
  spanCols?: 1 | 2
  /** Layout span (vertical) — for the wide-table scaffold. */
  spanRows?: 1 | 2
}

const TONE_RING: Record<CoachingScaffoldTone, string> = {
  indigo:
    'border-indigo-100 bg-gradient-to-br from-indigo-50/40 to-card dark:border-indigo-500/20 dark:from-indigo-500/[0.04]',
  amber:
    'border-amber-100 bg-gradient-to-br from-amber-50/40 to-card dark:border-amber-500/20 dark:from-amber-500/[0.04]',
  violet:
    'border-violet-100 bg-gradient-to-br from-violet-50/40 to-card dark:border-violet-500/20 dark:from-violet-500/[0.04]',
  emerald:
    'border-emerald-100 bg-gradient-to-br from-emerald-50/40 to-card dark:border-emerald-500/20 dark:from-emerald-500/[0.04]',
}

const TONE_ICON: Record<CoachingScaffoldTone, string> = {
  indigo: 'text-indigo-600 dark:text-indigo-300',
  amber: 'text-amber-700 dark:text-amber-300',
  violet: 'text-violet-600 dark:text-violet-300',
  emerald: 'text-emerald-600 dark:text-emerald-300',
}

export function CoachingScaffoldCard({
  icon,
  title,
  body,
  subtitle,
  privacyLayer,
  tone = 'indigo',
  spanCols = 1,
  spanRows = 1,
}: CoachingScaffoldCardProps) {
  const colSpan =
    spanCols === 2 ? 'lg:col-span-2' : ''
  const rowSpan =
    spanRows === 2 ? 'lg:row-span-2' : ''

  return (
    <div
      className={`rounded-lg border p-5 ${TONE_RING[tone]} ${colSpan} ${rowSpan}`.trim()}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`shrink-0 ${TONE_ICON[tone]}`}>{icon}</span>
          <h3 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h3>
        </div>
        {privacyLayer === 'layer1' && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Lock size={10} aria-hidden />
            Layer 1
          </span>
        )}
      </div>
      {subtitle && (
        <p className="mb-3 text-[12px] text-muted-foreground">{subtitle}</p>
      )}

      {/* 対応予定 hint — dashed blue panel matching the AI-capability
       *  hint pattern used on PreSessionBriefCard. */}
      <div className="flex gap-2 rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 p-3 dark:border-blue-500/30 dark:bg-blue-500/[0.06]">
        <Wand2
          className="mt-0.5 size-3 shrink-0 text-blue-500/80 dark:text-blue-300/80"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 inline-flex items-center">
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              対応予定
            </span>
          </div>
          <p className="text-[12px] italic leading-relaxed text-muted-foreground">
            {body}
          </p>
        </div>
      </div>
    </div>
  )
}
