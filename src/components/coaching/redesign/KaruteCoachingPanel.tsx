'use client'

// ─────────────────────────────────────────────────────────────
// KaruteCoachingPanel — Layer 1 staff-private coaching surface
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/KaruteCoachingPanel.tsx
// (~207 lines). Visual + flow preserved with two intentional
// differences:
//
//   • NO MOCK_SUGGESTIONS array. The spike seeds 3 fake AI tips;
//     karute renders the empty state + 対応予定 scaffold until
//     Anthony wires the in-session coaching generator.
//
//   • Business-profile focus-areas block omitted. The spike pulls
//     from useActiveBusinessProfile().coachingFocus which doesn't
//     exist on karute yet — that's a Phase-3 surface. When it
//     lands, slot it in above the suggestion list (see spike
//     lines 91-110 for the exact JSX).
//
// PRIVACY POSTURE (spike header verbatim):
//   ACCESS LAYER: Layer 1 — STAFF-PRIVATE.
//   Owner/manager MUST NEVER see this panel or its contents.
//   RLS REQUIREMENT: SELECT only where staff_id = auth.uid()
//
// DATA SOURCE (when wired):
//   In-session: claude-haiku-4-5 generator triggered every ~30s
//   during recording, using the last 2 min of transcript. Real-
//   time via Supabase channel filtered to (session_id, staff_id).
//   See AI_PROMPTS.md §12 for the prompt spec.
//
//   Post-session (karute detail context): same shape, served
//   from the archived suggestions table for this karute_record.
//
// ANTHONY: when you wire the data hook, pass an array of
// CoachingSuggestion items via the `suggestions` prop (currently
// always `null` → empty state + scaffold hint).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Lock,
  MessageCircle,
  Sparkles,
  Target,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useSession } from '@/providers/session-provider'

import { CoachingSuggestionCard } from './CoachingSuggestionCard'
import { PrivacyLockBadge } from './PrivacyLockBadge'

import { ScaffoldHint } from './ScaffoldHint'

// Suggestion shape — Anthony's data hook returns an array of these.
// Matches the spike's MOCK_SUGGESTIONS shape so the swap is direct.
export interface CoachingSuggestion {
  /** Lucide icon component. The category-icon mapping below picks
   *  a sensible default if you pass `null`. */
  icon: LucideIcon | null
  category: string
  title: string
  body: string
  /** 0..1 — drives the confidence indicator dots. */
  confidence: number
}

interface KaruteCoachingPanelProps {
  /** Real suggestions when wired. `null` (default) renders the
   *  empty state + 対応予定 scaffold hint. */
  suggestions?: CoachingSuggestion[] | null
}

export function KaruteCoachingPanel({
  suggestions = null,
}: KaruteCoachingPanelProps) {
  const session = useSession()
  const t = useTranslations('coaching.panel')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)

  // Role gate (spike line 81): staff only. Owners never see this.
  // Backend RLS must enforce the same gate.
  const role = (session.activeStaff?.displayRole ?? '').toLowerCase()
  if (role === 'owner') return null

  const items = suggestions ?? []
  const hasItems = items.length > 0
  const countLabel = hasItems
    ? t('mobileRowCount', { n: items.length })
    : t('mobileRowEmpty')

  return (
    <>
      {/* Mobile: inline row at the bottom of karute detail. Tapping
       *  opens a bottom sheet with the full panel. */}
      <div className="mt-4 md:hidden">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('staffOnlyLabel')}
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex min-h-[56px] w-full items-center gap-3 rounded-xl bg-card px-4 py-3.5 ring-1 ring-black/5 transition-colors active:bg-black/[0.02] dark:ring-white/10"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
            <GraduationCap className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <span className="flex items-center gap-1.5">
              <span className="text-[15px] font-medium text-foreground">
                {t('mobileRowTitle')}
              </span>
              <Lock
                className="size-3 text-slate-500 dark:text-slate-400"
                strokeWidth={2.25}
                aria-hidden
              />
            </span>
            <span className="truncate text-[12px] text-muted-foreground">
              {countLabel}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-gray-400 dark:text-gray-500" />
        </button>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] md:hidden">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <GraduationCap className="size-4 text-indigo-600 dark:text-indigo-300" />
              {t('panelTitle')}
            </SheetTitle>
            <SheetDescription>{t('panelDescription')}</SheetDescription>
          </SheetHeader>
          <div className="mt-3 overflow-y-auto pb-2">
            <SuggestionsBody items={items} hasItems={hasItems} t={t} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop: collapsible side panel (300px, sticky top). */}
      {desktopCollapsed ? (
        <button
          type="button"
          onClick={() => setDesktopCollapsed(false)}
          className="hidden h-8 items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 md:inline-flex dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300"
        >
          <ChevronLeft className="size-3.5" />
          <GraduationCap className="size-3.5" />
          {t('panelTitle')}
        </button>
      ) : (
        <aside className="sticky top-4 hidden h-fit w-[300px] shrink-0 rounded-xl bg-card p-4 ring-1 ring-black/5 md:block dark:ring-white/10">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GraduationCap className="size-4 text-indigo-600 dark:text-indigo-300" />
              <h3 className="text-sm font-semibold text-foreground">
                {t('panelTitle')}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setDesktopCollapsed(true)}
              aria-label={t('collapseAria')}
              className="inline-flex size-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
          <SuggestionsBody items={items} hasItems={hasItems} t={t} />
        </aside>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// Shared body (used by both mobile sheet + desktop panel)
// ─────────────────────────────────────────────────────────────

function SuggestionsBody({
  items,
  hasItems,
  t,
}: {
  items: CoachingSuggestion[]
  hasItems: boolean
  t: ReturnType<typeof useTranslations>
}) {
  const tCommon = useTranslations('coaching.common')
  return (
    <>
      <div className="mb-3">
        <PrivacyLockBadge label={tCommon('privacyLayer1Badge')} />
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        {t('intro')}
      </p>

      {hasItems ? (
        <div className="space-y-2.5">
          {items.map((s, i) => (
            <CoachingSuggestionCard
              key={i}
              icon={s.icon ?? defaultIconForCategory(s.category)}
              category={s.category}
              title={s.title}
              body={s.body}
              confidence={s.confidence}
            />
          ))}
        </div>
      ) : (
        // 対応予定 scaffold — describes what'll appear here once
        // Anthony wires the in-session coaching generator (live)
        // OR the archived per-karute suggestions table (detail).
        <ScaffoldHint hint={t('emptyHint')} />
      )}
    </>
  )
}

// Sensible icon fallback per spike category name. Anthony's data
// hook can either pass its own icon or rely on this mapping.
function defaultIconForCategory(category: string): LucideIcon {
  if (category.includes('質問') || category.toLowerCase().includes('question'))
    return MessageCircle
  if (
    category.includes('クロージング') ||
    category.toLowerCase().includes('closing')
  )
    return Target
  return Sparkles
}
