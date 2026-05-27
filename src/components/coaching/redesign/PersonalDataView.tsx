'use client'

// ─────────────────────────────────────────────────────────────
// PersonalDataView — /coaching/data wrapper
// ─────────────────────────────────────────────────────────────
// Thin client wrapper around TransparencyPage. Owns the back
// link + title + role-aware subtitle so TransparencyPage stays
// purely about content (and can be reused if we ever want to
// embed the same disclosure elsewhere, e.g. settings/coaching).
//
// Reads viewer's effective role via useEffectiveCoachingRole so
// the dev-preview pill flips the subtitle copy live.

import Link from 'next/link'
import { ArrowLeft, Shield } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { useEffectiveCoachingRole } from '@/lib/coaching-dev-preview/hooks'

import { TransparencyPage } from './TransparencyPage'

interface PersonalDataViewProps {
  viewerRealRole: 'owner' | 'staff'
}

export function PersonalDataView({ viewerRealRole }: PersonalDataViewProps) {
  const t = useTranslations('coaching.data')
  const locale = useLocale()
  const role = useEffectiveCoachingRole(viewerRealRole)
  const subtitle =
    role === 'staff' ? t('subtitleStaff') : t('subtitleOwner')

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-5 md:px-8 md:py-8">
      <Link
        href={`/${locale}/coaching`}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t('back')}
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Shield className="size-6 text-indigo-600 dark:text-indigo-300" />
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <TransparencyPage />
    </main>
  )
}
