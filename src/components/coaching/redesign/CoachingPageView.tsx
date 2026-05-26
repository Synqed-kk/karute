'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ShieldCheck } from 'lucide-react'

import { CoachingHeader } from './CoachingHeader'
import { StaffDashboardScaffold } from './StaffDashboardScaffold'
import { OwnerDashboardScaffold } from './OwnerDashboardScaffold'
import { CoachingConsentDialog } from './CoachingConsentDialog'
import {
  useCoachingConsent,
  useCoachingConsentMutations,
} from '@/lib/coaching-consent/hooks'

// ─────────────────────────────────────────────────────────────
// Coaching root view — role-aware dashboard router
// ─────────────────────────────────────────────────────────────
// Spike source: synqed-karute-design-spike/src/app/[locale]/(app)/
// coaching/page.tsx (lines 12-21).
//
// Role is derived from the session's activeStaff.displayRole on
// the server-side page.tsx and passed in here as a prop — the
// spike's demo role-toggle is intentionally omitted (per the
// spike's own ANTHONY comment, the toggle was scaffolding for
// the spike preview and should not survive into karute prod).
//
// CONSENT BANNER (NEW)
// ────────────────────
// Staff coaching surfaces (Layer 1 data — personal growth, focus
// recommendations, etc) are gated behind a one-time opt-in. When
// a staff member opens /coaching without a decision on file, a
// banner surfaces at the top inviting them to review the consent
// dialog. Owners don't see this banner (their data is Layer 2/3
// aggregate; no consent required for THEIR view).
//
// ROLE CHECK CONTRACT (spike comment, preserved verbatim):
//   "This page renders differently for スタッフ vs オーナー.
//    Frontend role check for UI rendering only.
//    Backend MUST enforce the same distinction via RLS +
//    API-layer checks."
export function CoachingPageView({ role }: { role: 'owner' | 'staff' }) {
  const t = useTranslations('coaching.consent')
  const consent = useCoachingConsent()
  const { grant, decline, reset } = useCoachingConsentMutations()
  const [dialogOpen, setDialogOpen] = useState(false)

  const showStaffConsentBanner =
    role === 'staff' && consent.status === 'unset'
  const showStaffConsentSummary =
    role === 'staff' && consent.status !== 'unset'

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-4 md:p-6 md:gap-6">
      <CoachingHeader role={role} />

      {/* Staff opt-in banner — only shows when consent is unset.
       *  Tapping "確認する" opens the full CoachingConsentDialog
       *  with the privacy posture spelled out. */}
      {showStaffConsentBanner && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50/70 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <ShieldCheck
            className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-amber-900 dark:text-amber-100">
              {t('bannerTitle')}
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-amber-900/80 dark:text-amber-100/80">
              {t('bannerBody')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="shrink-0 self-center rounded-md bg-amber-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-amber-800 dark:bg-amber-500 dark:hover:bg-amber-600"
          >
            {t('bannerCta')}
          </button>
        </div>
      )}

      {/* Granted/declined summary chip — once a decision exists,
       *  show a compact status row with a "review again" affordance.
       *  Lets staff revisit the dialog (and decline retroactively if
       *  they change their mind). */}
      {showStaffConsentSummary && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <ShieldCheck
              className={`size-3.5 ${
                consent.status === 'granted'
                  ? 'text-emerald-600 dark:text-emerald-300'
                  : 'text-muted-foreground'
              }`}
              aria-hidden
            />
            {consent.status === 'granted'
              ? t('summaryGranted')
              : t('summaryDeclined')}
          </span>
          <button
            type="button"
            onClick={() => {
              reset()
              setDialogOpen(true)
            }}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
          >
            {t('summaryReview')}
          </button>
        </div>
      )}

      {role === 'owner' ? <OwnerDashboardScaffold /> : <StaffDashboardScaffold />}

      <CoachingConsentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConsent={(granted) => (granted ? grant() : decline())}
      />
    </main>
  )
}
