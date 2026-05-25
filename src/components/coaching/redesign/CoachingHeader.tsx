'use client'

import { useTranslations } from 'next-intl'
import { GraduationCap } from 'lucide-react'

// Header matches the spike's CoachingPageHeader minus the demo-only
// role toggle (the spike's toggle was scaffolding for the spike
// preview; karute derives role from session.activeStaff.displayRole
// via the server-side check in page.tsx, so a UI toggle would be
// misleading). When Anthony adds an explicit "preview as staff"
// affordance for owners, slot it back in here.
//
// Spike source: synqed-karute-design-spike/src/components/coaching/
// CoachingPageHeader.tsx (lines 10-27).
export function CoachingHeader({
  role,
}: {
  role: 'owner' | 'staff'
}) {
  const t = useTranslations('coaching.header')
  const subtitle =
    role === 'staff' ? t('subtitleStaff') : t('subtitleOwner')

  return (
    <div className="flex flex-col gap-1 md:gap-2">
      <div className="flex items-center gap-2">
        <GraduationCap className="size-6 text-indigo-600 dark:text-indigo-300" />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[26px]">
          {t('title')}
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}
