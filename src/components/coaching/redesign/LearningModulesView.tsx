'use client'

// ─────────────────────────────────────────────────────────────
// LearningModulesView — /coaching/modules client view
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: app/[locale]/(app)/coaching/modules/page.tsx
// (~627 lines, mostly chrome + filter logic). The page-shell
// becomes the small server page next to this file; this view
// owns the search/tab/category filter pipeline, the grid, and
// each ModuleCard's chip picker.
//
// ENTRY POINTS:
//   1. /coaching → AssignModulesCard footer "すべてのモジュールを見る"
//   2. /coaching/staff/[id] → "学習モジュールを割り当てる"
//      Navigates with ?staff=[id] so this view opens with the
//      target staff pre-selected (banner up top + chip picker
//      filtered down to just that name).
//
// ACCESS LAYER: Layer 2 / 3.
//   - Catalog browse: Layer 2 (any authenticated staff in the
//     org sees catalog entries — not other staff's assignment
//     state).
//   - Assignment writes: Layer 3 — owner-only. Frontend hides
//     the assign chips for non-owners (`canAssign` prop);
//     backend RLS enforces the write block.
//
// AI: this view READS modules that may be AI-generated (the
// purple "AI生成" chip lights up on modules with `id` prefix
// `ai-`). It does NOT trigger AI calls directly.
//
// ANTHONY: real wiring swaps:
//   modules:  useLearningModulesData() → server-joined catalog
//   staff:    useStaffPerformanceData().staff → consenting roster
//   toggle:   server action that inserts/deletes
//             learning_assignments + sends a Supabase realtime
//             notification to the assigned staff.

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  BookOpen,
  Check,
  Clock,
  Filter as FilterIcon,
  GraduationCap,
  Search,
  Sparkles,
  UserRound,
  Wand2,
  X,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEffectiveCoachingRole } from '@/lib/coaching-dev-preview/hooks'

import type { LearningModule, StaffPerformance } from './owner-types'

type TabKey = 'all' | 'assigned' | 'ai' | 'unassigned'

const TABS: TabKey[] = ['all', 'assigned', 'ai', 'unassigned']

interface LearningModulesViewProps {
  /** Owner sees assign chips; staff sees the catalog read-only. */
  role: 'owner' | 'staff'
  /** Live catalog — null until Anthony wires useLearningModulesData(). */
  modules?: LearningModule[] | null
  /** Live staff list — null until Anthony wires useStaffPerformanceData(). */
  staff?: StaffPerformance[] | null
}

export function LearningModulesView({
  role: realRole,
  modules = null,
  staff = null,
}: LearningModulesViewProps) {
  // Dev preview override (see DevPreviewToggle). Drives the
  // canAssign decision below — flipping to "staff" preview
  // disables the assignment chips, matching real-staff UX.
  const role = useEffectiveCoachingRole(realRole)
  const t = useTranslations('coaching.modules')
  const tCommon = useTranslations('coaching.common')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()

  const modulesList = useMemo(() => modules ?? [], [modules])
  const staffList = useMemo(() => staff ?? [], [staff])
  const hasModules = modulesList.length > 0

  const [tab, setTab] = useState<TabKey>('all')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  // Initial staff filter comes from ?staff=… when the user
  // arrives from /coaching/staff/[id]. Always clearable.
  const urlStaffId = searchParams.get('staff')
  const [staffFilter, setStaffFilter] = useState<string | null>(urlStaffId)

  // Seed the optimistic assignment Set from the catalog's
  // already-assigned flags. Prod wires this to the server
  // action result + realtime sync.
  const seededPairs = useMemo(() => {
    const s = new Set<string>()
    for (const m of modulesList) {
      if (m.assigned && m.assignedTo) s.add(`${m.id}:${m.assignedTo}`)
    }
    return s
  }, [modulesList])

  const [assignedPairs, setAssignedPairs] =
    useState<Set<string>>(seededPairs)

  const eligibleStaff = staffList.filter(
    (s) => s.consentGiven && !s.isTopPerformer,
  )
  const targetedStaff = staffFilter
    ? staffList.find((s) => s.staffId === staffFilter)
    : undefined

  const categories = useMemo(() => {
    const set = new Set<string>()
    modulesList.forEach((m) => set.add(m.category))
    return Array.from(set)
  }, [modulesList])

  const handleToggle = useCallback(
    (moduleId: string, staffId: string) => {
      if (role !== 'owner') return // Layer 3 — staff cannot write
      const key = `${moduleId}:${staffId}`
      setAssignedPairs((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      // ANTHONY: insert/delete learning_assignments row via
      // server action + realtime fanout to the assigned staff.
    },
    [role],
  )

  const clearStaffFilter = useCallback(() => {
    setStaffFilter(null)
    router.replace(`/${locale}/coaching/modules`)
  }, [router, locale])

  // Filter pipeline: tab → search → category → staff
  const filtered = modulesList.filter((m) => {
    if (tab === 'ai' && !m.id.startsWith('ai-')) return false
    if (tab === 'assigned' && !isAssignedAnywhere(m, assignedPairs))
      return false
    if (tab === 'unassigned' && isAssignedAnywhere(m, assignedPairs))
      return false

    if (query.trim()) {
      const q = query.trim().toLowerCase()
      if (
        !m.title.toLowerCase().includes(q) &&
        !(m.description ?? '').toLowerCase().includes(q) &&
        !m.category.toLowerCase().includes(q)
      ) {
        return false
      }
    }

    if (categoryFilter && m.category !== categoryFilter) return false

    if (staffFilter) {
      const assignedToTarget = assignedPairs.has(`${m.id}:${staffFilter}`)
      if (!assignedToTarget && isAssignedAnywhere(m, assignedPairs))
        return false
    }
    return true
  })

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
            <GraduationCap className="size-6 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('title')}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      {/* AI-generation callout — explains how this library grows */}
      <div className="mb-5 flex items-start gap-3 rounded-xl bg-purple-50/60 px-4 py-3 ring-1 ring-purple-200/70 dark:bg-purple-500/[0.08] dark:ring-purple-500/25">
        <Sparkles
          className="mt-0.5 size-4 shrink-0 text-purple-700 dark:text-purple-300"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-purple-900 dark:text-purple-200">
            {t('aiCalloutTitle')}
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-purple-800/90 dark:text-purple-300/85">
            {t('aiCalloutBody')}
          </p>
        </div>
      </div>

      {/* Staff-context banner — only when arrived with ?staff= */}
      {targetedStaff && (
        <div className="mb-5 flex items-center gap-3 rounded-xl bg-indigo-50/60 px-4 py-3 ring-1 ring-indigo-200/70 dark:bg-indigo-500/[0.08] dark:ring-indigo-500/25">
          <UserRound
            className="size-4 shrink-0 text-indigo-700 dark:text-indigo-300"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-indigo-900 dark:text-indigo-200">
              {t('staffContextTitle', { name: targetedStaff.name })}
            </div>
            <p className="text-[12px] leading-relaxed text-indigo-800/90 dark:text-indigo-300/85">
              {t('staffContextBody')}
            </p>
          </div>
          <button
            type="button"
            onClick={clearStaffFilter}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-indigo-500/15"
          >
            <X className="size-3.5" aria-hidden />
            {t('clearStaff')}
          </button>
        </div>
      )}

      {/* Search + clear */}
      <div className="mb-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative max-w-lg flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPh')}
              className="pl-9"
            />
          </div>
          {(categoryFilter || query) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCategoryFilter(null)
                setQuery('')
              }}
            >
              <X className="size-3.5" />
              {t('clearFilters')}
            </Button>
          )}
        </div>

        {/* Tabs — counts always render so 0 is honest about the empty state */}
        <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1 ring-1 ring-black/5 dark:bg-white/[0.04] dark:ring-white/10">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${
                tab === key
                  ? 'bg-card text-gray-900 shadow-sm dark:text-gray-100 dark:ring-1 dark:ring-white/10'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              {key === 'ai' && <Sparkles className="size-3.5" aria-hidden />}
              {t(`tab.${key}`)} ·{' '}
              <span className="tabular-nums text-xs">
                {
                  modulesList.filter((m) => matchTabOnly(m, key, assignedPairs))
                    .length
                }
              </span>
            </button>
          ))}
        </div>

        {/* Category chips — only render when we have categories */}
        {categories.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
            <FilterIcon
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <button
              type="button"
              onClick={() => setCategoryFilter(null)}
              className={`inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                categoryFilter === null
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-foreground/80 hover:bg-gray-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]'
              }`}
            >
              {t('allCategories')}
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() =>
                  setCategoryFilter((cur) => (cur === c ? null : c))
                }
                className={`inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                  categoryFilter === c
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-foreground/80 hover:bg-gray-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid — three states: scaffold (no catalog wired) → empty
       *  (filters exclude everything) → populated grid. */}
      {!hasModules ? (
        <CatalogScaffold hint={t('scaffoldHint')} label={tCommon('scaffoldLabel')} />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl bg-card px-6 py-12 text-center ring-1 ring-black/5 dark:ring-white/10">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-gray-100 dark:bg-white/[0.06]">
            <BookOpen className="size-6 text-gray-400 dark:text-gray-500" />
          </div>
          <div className="text-[14px] font-medium text-foreground">
            {t('emptyTitle')}
          </div>
          <div className="mx-auto mt-1 max-w-[360px] text-[12px] leading-relaxed text-muted-foreground">
            {t('emptyBody')}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((mod) => (
            <ModuleCard
              key={mod.id}
              mod={mod}
              pickerStaff={
                staffFilter
                  ? staffList.filter((s) => s.staffId === staffFilter)
                  : eligibleStaff
              }
              assignedPairs={assignedPairs}
              onToggle={handleToggle}
              canAssign={role === 'owner'}
            />
          ))}
        </div>
      )}
    </main>
  )
}

// ────────────────────────────────────────────────────────────
// Module card
// ────────────────────────────────────────────────────────────

interface ModuleCardProps {
  mod: LearningModule
  pickerStaff: Pick<StaffPerformance, 'staffId' | 'name'>[]
  assignedPairs: Set<string>
  onToggle: (moduleId: string, staffId: string) => void
  canAssign: boolean
}

function ModuleCard({
  mod,
  pickerStaff,
  assignedPairs,
  onToggle,
  canAssign,
}: ModuleCardProps) {
  const t = useTranslations('coaching.modules')
  const isAi = mod.id.startsWith('ai-')
  const assignedStaffIds = pickerStaff.filter((s) =>
    assignedPairs.has(`${mod.id}:${s.staffId}`),
  )

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-black/5 transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:ring-white/10">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-500/10">
          <BookOpen
            className="size-5 text-indigo-700 dark:text-indigo-300"
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-semibold text-foreground">
              {mod.title}
            </span>
            {isAi && (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-purple-50 px-1.5 text-[10px] font-medium text-purple-800 ring-1 ring-purple-200/60 dark:bg-purple-500/10 dark:text-purple-200 dark:ring-purple-500/20">
                <Sparkles className="size-2.5" aria-hidden />
                {t('aiGenerated')}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden />
              {t('durationMin', { n: mod.durationMin })}
            </span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span>{mod.category}</span>
          </div>
        </div>
      </div>

      {mod.description && (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {mod.description}
        </p>
      )}

      {/* Progress bar — only when assigned + non-zero completion */}
      {mod.assigned &&
        typeof mod.completionRate === 'number' &&
        mod.completionRate > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{t('completion')}</span>
              <span className="tabular-nums">
                {Math.round(mod.completionRate * 100)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
              <div
                className="h-full bg-indigo-500"
                style={{ width: `${mod.completionRate * 100}%` }}
              />
            </div>
          </div>
        )}

      {/* Assignment chips */}
      <div className="mt-auto pt-1">
        <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
          {assignedStaffIds.length > 0
            ? t('assignedCount', { n: assignedStaffIds.length })
            : t('assignTo')}
        </div>
        {pickerStaff.length === 0 ? (
          <span className="text-[11px] italic text-muted-foreground">
            {t('noEligibleStaff')}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pickerStaff.map((s) => {
              const key = `${mod.id}:${s.staffId}`
              const assigned = assignedPairs.has(key)
              return (
                <button
                  key={s.staffId}
                  type="button"
                  onClick={() => canAssign && onToggle(mod.id, s.staffId)}
                  disabled={!canAssign}
                  className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                    assigned
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-foreground/80 ring-1 ring-gray-200 hover:bg-indigo-50 hover:ring-indigo-300 dark:bg-white/[0.03] dark:ring-white/10 dark:hover:bg-indigo-500/10 dark:hover:ring-indigo-500/40'
                  } ${!canAssign ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                  {assigned ? (
                    <Check className="size-3" aria-hidden />
                  ) : (
                    <UserRound className="size-3" aria-hidden />
                  )}
                  {s.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Scaffold pane — shown when the catalog hook isn't wired yet.
// Sized to match the populated grid (3-col on lg) so the
// header + AI callout don't jump when real data lands.
// ────────────────────────────────────────────────────────────

function CatalogScaffold({ hint, label }: { hint: string; label: string }) {
  return (
    <div className="rounded-xl bg-card p-6 ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex gap-2 rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 p-4 dark:border-blue-500/30 dark:bg-blue-500/[0.06]">
        <Wand2
          className="mt-0.5 size-3.5 shrink-0 text-blue-500/80 dark:text-blue-300/80"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 inline-flex items-center">
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              {label}
            </span>
          </div>
          <p className="text-[12px] italic leading-relaxed text-muted-foreground">
            {hint}
          </p>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Filter helpers
// ────────────────────────────────────────────────────────────

function isAssignedAnywhere(
  mod: LearningModule,
  assignedPairs: Set<string>,
): boolean {
  for (const key of assignedPairs) {
    if (key.startsWith(`${mod.id}:`)) return true
  }
  return false
}

function matchTabOnly(
  mod: LearningModule,
  t: TabKey,
  assignedPairs: Set<string>,
): boolean {
  if (t === 'all') return true
  if (t === 'ai') return mod.id.startsWith('ai-')
  const assigned = isAssignedAnywhere(mod, assignedPairs)
  if (t === 'assigned') return assigned
  if (t === 'unassigned') return !assigned
  return true
}
