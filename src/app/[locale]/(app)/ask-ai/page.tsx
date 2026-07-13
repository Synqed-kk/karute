import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getOrgSettings } from '@/actions/org-settings'
import { getSynqedClient } from '@/lib/synqed/client'
import { deriveFamilyInitials } from '@/lib/customers/identity'
import { AIAssistantView } from '@/components/ai/redesign/AIAssistantView'
import {
  getBusinessProfile,
  getConsultationQuestions,
} from '@/lib/welcome/business-types'
import type { DataScopeItem } from '@/components/ai/redesign/AIPageHeader'

export default async function AskAIPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const localeArg = locale === 'ja' ? 'ja' : 'en'
  const t = await getTranslations('askAi')
  const supabase = await createClient()

  // Scope counts from synqed-core (the Supabase karute_records mirror is empty
  // post-migration — Karute + Recordings used to show 0).
  const synqedPromise = getSynqedClient()
  const nowIso = new Date().toISOString()

  const [
    {
      data: { user },
    },
    orgSettings,
    karuteRes,
    customerList,
    apptList,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getOrgSettings(),
    synqedPromise.then((synqed) =>
      synqed.karuteRecords
        .list({ page_size: 200 })
        .catch(() => ({ total: 0, karute_records: [] as { transcript?: string | null }[] })),
    ),
    synqedPromise.then((synqed) =>
      synqed.customers.list({ page_size: 1 }).catch(() => ({ total: 0 })),
    ),
    synqedPromise.then((synqed) =>
      synqed.appointments
        .list({ from: nowIso, page_size: 1 })
        .catch(() => ({ total: 0 })),
    ),
  ])

  const scope: DataScopeItem[] = [
    { label: t('scopeKarute'), count: karuteRes.total ?? 0 },
    { label: t('scopeCustomers'), count: customerList.total ?? 0 },
    { label: t('scopeBookings'), count: apptList.total ?? 0 },
    // Recordings = karute with a transcript, counted from the fetched page
    // (≤200). An exact synqed transcript-filtered count would be cleaner — Anthony.
    {
      label: t('scopeRecordings'),
      count: (karuteRes.karute_records ?? []).filter(
        (r) => (r as { transcript?: string | null }).transcript != null,
      ).length,
    },
  ]

  const businessType = orgSettings?.business_type ?? null
  const profile = businessType ? getBusinessProfile(businessType, localeArg) : null
  const prompts = getConsultationQuestions(businessType, localeArg).slice(0, 3)

  const userName = user?.email?.split('@')[0] ?? 'You'

  return (
    <AIAssistantView
      scope={scope}
      profile={profile}
      prompts={prompts}
      userName={userName}
      userInitials={deriveFamilyInitials(userName)}
      locale={locale}
    />
  )
}
