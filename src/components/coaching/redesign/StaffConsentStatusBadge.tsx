'use client'

// ─────────────────────────────────────────────────────────────
// StaffConsentStatusBadge — coaching consent atom
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/StaffConsentStatusBadge.tsx
// (~28 lines). Visual preserved 1:1.
//
// Small 5-row pill rendered next to a staff name on admin
// surfaces — shows whether that staff has granted coaching
// consent yet, with the grant date in a hover tooltip.
//
// PRIVACY: Layer 2 view of Layer 1 metadata.
//   The DECISION (granted vs not) is owner-visible via the
//   coaching_consent_rollup table — see coaching-consent/hooks.ts
//   header comment for the RLS contract. Owners do NOT see the
//   raw consent_log rows (decline reasons, flip-flops) — just
//   the latest status + date.
//
// CONSUMERS (when wired)
//   • Settings/StaffSection (PR follow-up)
//   • Anywhere else admin needs to show consent state next to a
//     staff name. Avoid placing on staff-private surfaces — the
//     badge implies the viewer can see consent state.
//
// ANTHONY DATA CONTRACT
//   Caller passes the latest decision + decidedAt. The rollup
//   view exposes:
//     staff_id uuid, granted boolean, given_at timestamptz,
//     policy_version text
//   `given_at` becomes the `givenAt` tooltip when granted.

import { AlertCircle, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface StaffConsentStatusBadgeProps {
  granted: boolean
  /** Localized grant date string, surfaced as the hover title
   *  when granted. Pass null when unknown or status is
   *  pending — the badge omits the tooltip silently. */
  givenAt?: string | null
}

export function StaffConsentStatusBadge({
  granted,
  givenAt = null,
}: StaffConsentStatusBadgeProps) {
  const t = useTranslations('coaching.consentBadge')

  if (granted) {
    return (
      <span
        className="inline-flex h-5 items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 text-[10px] font-medium text-green-800 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300"
        title={givenAt ? t('grantedTooltip', { date: givenAt }) : undefined}
      >
        <Check className="size-2.5" aria-hidden />
        {t('granted')}
      </span>
    )
  }

  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 text-[10px] font-medium text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
      <AlertCircle className="size-2.5" aria-hidden />
      {t('notYet')}
    </span>
  )
}
