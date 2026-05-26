'use client'

// ─────────────────────────────────────────────────────────────
// IntakeFormEditor — owner-customizable first-visit form
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/settings/IntakeFormEditor.tsx (~588 LOC).
// Simplified for karute's current state — spike's "Synqed base
// intake hints" come from BusinessTypeProfile.intakeHints which
// doesn't exist on karute's lib/welcome/business-types.ts yet.
// This version ships the OWNER-CUSTOM half — owners add per-
// section custom fields. When Anthony extends BusinessProfile
// with intakeHints, the Synqed-base section auto-renders without
// further frontend work (the hidden-base toggle infra is already
// in the state layer + IntakeCustomizations type).
//
// ANTHONY: when intakeHints lands on each BusinessProfile, swap
// in a SectionEditor `baseItems` prop wired to:
//   profile.intakeHints[section] ?? []
//
// LAYOUT
//
//   Header (icon + title + subtitle + Reset button)
//   Guardrail note (privacy banner)
//   Two-column on lg:
//     left  → 4 SectionEditors (symptoms / posture / beauty / goals)
//     right → PreviewPane (how the customer sees the form)

import { useState } from 'react'
import {
  Activity,
  ClipboardList,
  FileText,
  Heart,
  Plus,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIntakeFormCustomizations } from '@/lib/intake-form-customizations/hooks'
import {
  INTAKE_SECTION_KEYS,
  type IntakeCustomField,
  type IntakeCustomizations,
  type IntakeSectionKey,
} from '@/lib/intake-form-customizations/types'

interface IntakeFormEditorProps {
  /** Active business type from orgSettings. Drives the storage
   *  key so switching business types doesn't bleed custom fields
   *  across templates. */
  businessType: string
}

const SECTION_META: Record<
  IntakeSectionKey,
  { icon: LucideIcon; tone: string; bg: string }
> = {
  symptoms: {
    icon: Activity,
    tone: 'text-sky-700 dark:text-sky-300',
    bg: 'bg-sky-50 dark:bg-sky-500/10',
  },
  posture: {
    icon: ClipboardList,
    tone: 'text-violet-700 dark:text-violet-300',
    bg: 'bg-violet-50 dark:bg-violet-500/10',
  },
  beauty: {
    icon: Heart,
    tone: 'text-rose-700 dark:text-rose-300',
    bg: 'bg-rose-50 dark:bg-rose-500/10',
  },
  goals: {
    icon: Target,
    tone: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-500/10',
  },
}

export function IntakeFormEditor({ businessType }: IntakeFormEditorProps) {
  const t = useTranslations('settings.intakeForm')
  const locale = useLocale()
  const isEn = locale === 'en'
  const {
    customizations,
    addCustomField,
    removeCustomField,
    clearAll,
  } = useIntakeFormCustomizations(businessType)

  const totalCustomCount = INTAKE_SECTION_KEYS.reduce(
    (sum, k) => sum + customizations.customFields[k].length,
    0,
  )

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 shadow-sm ring-1 ring-black/5 md:p-5 dark:ring-white/5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
            <FileText className="size-4" aria-hidden />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('title')}
            </h2>
            <p className="mt-0.5 max-w-[620px] text-[11px] leading-relaxed text-muted-foreground">
              {t('subtitle', { count: totalCustomCount })}
            </p>
          </div>
        </div>
        {totalCustomCount > 0 && (
          <button
            type="button"
            onClick={() => {
              if (typeof window === 'undefined') return
              if (!window.confirm(t('resetConfirm'))) return
              clearAll()
            }}
            className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-red-700 dark:hover:text-red-300"
          >
            <Trash2 className="size-3" aria-hidden />
            {t('resetLabel')}
          </button>
        )}
      </div>

      {/* Guardrail note */}
      <div className="flex items-start gap-2 rounded-md bg-amber-50/70 px-3 py-2 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <div>{t('guardrail')}</div>
      </div>

      {/* Synqed-base notice — placeholder for when Anthony adds intakeHints */}
      <div className="flex items-start gap-2 rounded-md border border-dashed border-blue-300/60 bg-blue-50/40 px-3 py-2 dark:border-blue-500/30 dark:bg-blue-500/[0.06]">
        <Sparkles
          className="mt-0.5 size-3 shrink-0 text-blue-500/80 dark:text-blue-300/80"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 inline-flex items-center">
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              {t('baseScaffoldLabel')}
            </span>
          </div>
          <p className="text-[11px] italic leading-relaxed text-muted-foreground">
            {t('baseScaffoldHint')}
          </p>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* Editor column */}
        <div className="space-y-4">
          {INTAKE_SECTION_KEYS.map((section) => (
            <SectionEditor
              key={section}
              section={section}
              customItems={customizations.customFields[section]}
              onAdd={(input) => addCustomField(section, input)}
              onRemoveCustom={(id) => removeCustomField(section, id)}
            />
          ))}
        </div>

        {/* Preview column */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <PreviewPane customizations={customizations} isEn={isEn} />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// SectionEditor — owner-custom fields list + add-field form
// ─────────────────────────────────────────────────────────────

interface SectionEditorProps {
  section: IntakeSectionKey
  customItems: IntakeCustomField[]
  onAdd: (input: { labelJa: string; labelEn: string }) => void
  onRemoveCustom: (id: string) => void
}

function SectionEditor({
  section,
  customItems,
  onAdd,
  onRemoveCustom,
}: SectionEditorProps) {
  const t = useTranslations('settings.intakeForm')
  const tSection = useTranslations('settings.intakeForm.sectionTitles')
  const [labelJa, setLabelJa] = useState('')
  const [labelEn, setLabelEn] = useState('')

  const meta = SECTION_META[section]
  const Icon = meta.icon
  const canSubmit = labelJa.trim().length > 0 && labelEn.trim().length > 0

  const handleAdd = () => {
    if (!canSubmit) return
    onAdd({ labelJa, labelEn })
    setLabelJa('')
    setLabelEn('')
  }

  return (
    <div className="rounded-lg p-3 ring-1 ring-gray-200 dark:ring-white/10">
      {/* Section header */}
      <div className="mb-2.5 flex items-center gap-2">
        <div
          className={`flex size-6 items-center justify-center rounded-md ${meta.bg}`}
        >
          <Icon className={`size-3.5 ${meta.tone}`} aria-hidden />
        </div>
        <h3 className="text-[13px] font-semibold text-foreground">
          {tSection(section)}
        </h3>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {t('itemCount', { custom: customItems.length })}
        </span>
      </div>

      {/* Custom fields list */}
      {customItems.length > 0 && (
        <div className="mb-2 space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('customHeader')}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {customItems.map((field) => (
              <span
                key={field.id}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-indigo-50 px-2.5 text-[11px] font-medium text-indigo-800 ring-1 ring-indigo-200/60 dark:bg-indigo-500/15 dark:text-indigo-200 dark:ring-indigo-500/20"
              >
                <span>{field.labelJa}</span>
                <button
                  type="button"
                  aria-label={t('removeCustomTitle')}
                  onClick={() => {
                    if (typeof window === 'undefined') return
                    if (!window.confirm(t('removeCustomConfirm'))) return
                    onRemoveCustom(field.id)
                  }}
                  className="ml-0.5 inline-flex size-3.5 items-center justify-center rounded-full text-indigo-700/70 transition-colors hover:bg-red-100 hover:text-red-700 dark:text-indigo-300/70 dark:hover:bg-red-500/20 dark:hover:text-red-300"
                >
                  <Trash2 className="size-2.5" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Add field form */}
      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          value={labelJa}
          onChange={(e) => setLabelJa(e.target.value)}
          placeholder={t('addPlaceholderJa')}
          className="h-9 text-[12px]"
        />
        <Input
          value={labelEn}
          onChange={(e) => setLabelEn(e.target.value)}
          placeholder={t('addPlaceholderEn')}
          className="h-9 text-[12px]"
        />
        <Button
          onClick={handleAdd}
          disabled={!canSubmit}
          className="h-9 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Plus className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('addButton')}</span>
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PreviewPane — how customers see the form
// ─────────────────────────────────────────────────────────────

function PreviewPane({
  customizations,
  isEn,
}: {
  customizations: IntakeCustomizations
  isEn: boolean
}) {
  const t = useTranslations('settings.intakeForm.preview')
  const tSection = useTranslations('settings.intakeForm.sectionTitles')

  const visibleSections = INTAKE_SECTION_KEYS.filter(
    (k) => customizations.customFields[k].length > 0,
  )

  return (
    <div className="rounded-lg bg-gradient-to-br from-blue-50/60 via-card to-card p-4 ring-1 ring-blue-200/60 dark:from-blue-500/[0.06] dark:via-transparent dark:to-transparent dark:ring-blue-500/20">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('label')}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-foreground">{t('greeting')}</h3>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
        {t('subtitle')}
      </p>

      {visibleSections.length === 0 ? (
        <p className="mt-3 text-[11px] italic leading-relaxed text-muted-foreground">
          {t('emptyState')}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {visibleSections.map((section) => (
            <div key={section}>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {tSection(section)}
              </div>
              <ul className="mt-1 space-y-1">
                {customizations.customFields[section].map((field) => (
                  <li
                    key={field.id}
                    className="flex items-center gap-1.5 text-[12px] text-foreground/90"
                  >
                    <span className="size-1 shrink-0 rounded-full bg-foreground/50" />
                    <span>{isEn ? field.labelEn : field.labelJa}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-[10px] italic leading-relaxed text-muted-foreground">
        {t('footer')}
      </p>
    </div>
  )
}
