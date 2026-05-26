'use client'

// ─────────────────────────────────────────────────────────────
// TransparencyPage — /coaching/data content
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/TransparencyPage.tsx
// (~112 lines). Visual + copy preserved 1:1.
//
// PURPOSE
//
// Plain-language summary of:
//   1. The privacy mission ("support is team, privacy is yours")
//   2. The two-column "staff-private" vs "owner-visible" lists
//   3. A consent-review affordance (opens CoachingConsentDialog)
//   4. A data-deletion request affordance
//
// ROLE
//
// Both roles can view. The page server tolerates either role
// — owner viewers get a slightly different subtitle (informational
// vs first-person). The two lists themselves describe the SAME
// privacy split regardless of viewer; what's owner-visible vs
// staff-private is a property of the data, not the viewer.
//
// The consent dialog re-open here is purely for staff. We
// surface it for both roles for now (no harm in owners
// reviewing what they're asking staff to agree to), but the
// dialog itself is mostly self-explanatory for any reader.

import { useState } from 'react'
import { Cloud, Eye, FileText, Lock, Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

import { CoachingConsentDialog } from './CoachingConsentDialog'
import { DataDeletionRequestButton } from './DataDeletionRequestButton'

export function TransparencyPage() {
  const t = useTranslations('coaching.data')
  const [consentOpen, setConsentOpen] = useState(false)

  const staffOnlyItems = [
    t('staffOnly.recordings'),
    t('staffOnly.sessionDetail'),
    t('staffOnly.customerInteractions'),
    t('staffOnly.personalSuggestions'),
    t('staffOnly.personalNotes'),
  ]

  const ownerVisibleItems = [
    t('ownerVisible.metrics'),
    t('ownerVisible.trends'),
    t('ownerVisible.categoricalAi'),
    t('ownerVisible.moduleProgress'),
  ]

  return (
    <div className="space-y-6">
      <CoachingConsentDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        onConsent={() => setConsentOpen(false)}
      />

      {/* Mission statement */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-5 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex items-start gap-3">
          <Shield
            className="mt-0.5 size-5 shrink-0 text-slate-600 dark:text-slate-400"
            aria-hidden
          />
          <div>
            <h2 className="mb-1 text-sm font-semibold">{t('missionTitle')}</h2>
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              {t('missionBody')}
            </p>
          </div>
        </div>
      </div>

      {/* Two-col staff-private / owner-visible */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-5 dark:border-indigo-500/15 dark:bg-indigo-500/[0.05]">
          <div className="mb-4 flex items-center gap-2">
            <Lock
              className="size-4 text-indigo-700 dark:text-indigo-300"
              aria-hidden
            />
            <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
              {t('staffOnly.title')}
            </h3>
          </div>
          <ul className="space-y-2">
            {staffOnlyItems.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200"
              >
                <span
                  className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-indigo-500"
                  aria-hidden
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-gray-200 bg-card p-5 dark:border-white/10">
          <div className="mb-4 flex items-center gap-2">
            <Eye
              className="size-4 text-gray-600 dark:text-gray-400"
              aria-hidden
            />
            <h3 className="text-sm font-semibold text-foreground">
              {t('ownerVisible.title')}
            </h3>
          </div>
          <ul className="space-y-2">
            {ownerVisibleItems.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300"
              >
                <span
                  className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-gray-400"
                  aria-hidden
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Synqed (service provider) access — full-width pane.
       *  Legally precise disclosure of what the SaaS provider does
       *  with data, distinct from what the salon owner sees above.
       *  This is the section that lets pattern extraction + AI
       *  improvement happen with explicit (not implicit) consent. */}
      <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-5 dark:border-violet-500/20 dark:bg-violet-500/[0.06]">
        <div className="mb-3 flex items-center gap-2">
          <Cloud
            className="size-4 text-violet-700 dark:text-violet-300"
            aria-hidden
          />
          <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-200">
            {t('synqedAccess.title')}
          </h3>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
          {t('synqedAccess.intro')}
        </p>
        <ul className="space-y-2">
          {[
            t('synqedAccess.patternMining'),
            t('synqedAccess.modelImprovement'),
            t('synqedAccess.subProcessors'),
            t('synqedAccess.humanAccess'),
          ].map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300"
            >
              <span
                className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-violet-500"
                aria-hidden
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Two-col actions: review consent + request deletion */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-card p-5 dark:border-white/10">
          <h3 className="mb-2 text-sm font-semibold">
            {t('reviewConsentTitle')}
          </h3>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            {t('reviewConsentBody')}
          </p>
          <Button
            variant="outline"
            onClick={() => setConsentOpen(true)}
            className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/20 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
          >
            <FileText className="size-3.5" aria-hidden />
            {t('reviewConsentCta')}
          </Button>
        </div>

        <div className="rounded-lg border border-gray-200 bg-card p-5 dark:border-white/10">
          <h3 className="mb-2 text-sm font-semibold">{t('deletionTitle')}</h3>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            {t('deletionBody')}
          </p>
          <DataDeletionRequestButton />
        </div>
      </div>
    </div>
  )
}
