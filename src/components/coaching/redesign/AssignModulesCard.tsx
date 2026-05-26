'use client'

// ─────────────────────────────────────────────────────────────
// AssignModulesCard — owner dashboard Row 4
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/AssignModulesCard.tsx
// (~125 lines). Visual + interactive flow preserved 1:1.
//
// Interactive chips toggle which staff a module is assigned
// to — Set-backed local state for now (matches spike). Anthony's
// real impl: insert/delete `learning_assignments` rows on toggle
// + send a Supabase realtime notification to the assigned staff.
//
// CONSENT GATE preserved verbatim from spike: only staff with
// consentGiven=true appear as assignable chips. Non-consented
// staff don't surface here.
//
// PRIVACY: Layer 3 — owner action. No staff-side data
// surfaced (just the module catalog + names of consented staff).
//
// NOTE (from spike header, preserved verbatim):
// This is a SUMMARY card on the coaching landing page. It
// shows the 3 highest-priority unassigned modules with
// quick-assign chips + a footer link to the full library at
// /coaching/modules.

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen, Check, Plus, Wand2 } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { LearningModule, StaffPerformance } from './owner-types'

interface AssignModulesCardProps {
  modules?: LearningModule[] | null
  staff?: StaffPerformance[] | null
}

export function AssignModulesCard({
  modules = null,
  staff = null,
}: AssignModulesCardProps) {
  const t = useTranslations('coaching.owner.assignModules')
  const tCommon = useTranslations('coaching.common')
  const locale = useLocale()

  const moduleList = modules ?? []
  const staffList = staff ?? []
  const hasData = moduleList.length > 0 && staffList.length > 0

  const [assignedPairs, setAssignedPairs] = useState<Set<string>>(
    new Set(
      moduleList
        .filter((m) => m.assigned && m.assignedTo)
        .map((m) => `${m.id}:${m.assignedTo}`),
    ),
  )

  const unassigned = moduleList.filter((m) => !m.assigned)
  const quickPreview = unassigned.slice(0, 3)

  const toggle = (moduleId: string, staffId: string) => {
    const key = `${moduleId}:${staffId}`
    setAssignedPairs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    // ANTHONY: insert/delete learning_assignments row via server
    // action + send a realtime notification to the assigned staff.
  }

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-3 flex items-center gap-2">
        <Plus className="size-4 text-indigo-600 dark:text-indigo-300" />
        <h3 className="text-sm font-semibold text-foreground">
          {t('cardTitle')}
        </h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{t('cardIntro')}</p>

      {hasData ? (
        <>
          <div className="space-y-4">
            {quickPreview.map((mod) => (
              <div
                key={mod.id}
                className="rounded-md border border-gray-200 bg-gray-50/60 p-3 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="mb-2 flex items-center gap-2">
                  <BookOpen className="size-3.5 text-indigo-600 dark:text-indigo-300" />
                  <div className="text-sm font-medium text-foreground">
                    {mod.title}
                  </div>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {t('durationMin', { n: mod.durationMin })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {staffList
                    .filter((s) => !s.isTopPerformer && s.consentGiven)
                    .map((s) => {
                      const key = `${mod.id}:${s.staffId}`
                      const assigned = assignedPairs.has(key)
                      return (
                        <button
                          key={s.staffId}
                          type="button"
                          onClick={() => toggle(mod.id, s.staffId)}
                          className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors ${
                            assigned
                              ? 'bg-indigo-600 text-white'
                              : 'border border-gray-200 bg-card text-gray-700 hover:border-indigo-400 dark:border-white/10 dark:text-gray-300'
                          }`}
                        >
                          {assigned && <Check className="size-2.5" aria-hidden />}
                          {s.name}
                        </button>
                      )
                    })}
                </div>
              </div>
            ))}
          </div>

          <Link
            href={`/${locale}/coaching/modules`}
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'mt-4 w-full text-indigo-700 hover:bg-indigo-50 hover:text-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-200',
            )}
          >
            {t('seeAllModules')}
            <ArrowRight className="ml-1 size-3.5" aria-hidden />
          </Link>
        </>
      ) : (
        <div className="flex gap-2 rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 p-3 dark:border-blue-500/30 dark:bg-blue-500/[0.06]">
          <Wand2
            className="mt-0.5 size-3 shrink-0 text-blue-500/80 dark:text-blue-300/80"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 inline-flex items-center">
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                {tCommon('scaffoldLabel')}
              </span>
            </div>
            <p className="text-[11px] italic leading-relaxed text-muted-foreground">
              {t('emptyHint')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
