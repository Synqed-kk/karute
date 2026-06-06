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
  const supabase = await createClient()

  const [
    {
      data: { user },
    },
    orgSettings,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getOrgSettings(),
  ])

  // Scope counts from synqed-core (the Supabase karute_records mirror is empty
  // post-migration — Karute + Recordings used to show 0).
  const synqed = await getSynqedClient()
  const nowIso = new Date().toISOString()

  const [karuteRes, customerList, apptList] = await Promise.all([
    synqed.karuteRecords
      .list({ page_size: 200 })
      .catch(() => ({ total: 0, karute_records: [] as { transcript?: string | null }[] })),
    synqed.customers.list({ page_size: 1 }).catch(() => ({ total: 0 })),
    synqed.appointments
      .list({ from: nowIso, page_size: 1 })
      .catch(() => ({ total: 0 })),
  ])

  const scope: DataScopeItem[] = [
    { label: 'Karute', count: karuteRes.total ?? 0 },
    { label: 'Customers', count: customerList.total ?? 0 },
    { label: 'Bookings', count: apptList.total ?? 0 },
    // Recordings = karute with a transcript, counted from the fetched page
    // (≤200). An exact synqed transcript-filtered count would be cleaner — Anthony.
    {
      label: 'Recordings',
      count: (karuteRes.karute_records ?? []).filter(
        (r) => (r as { transcript?: string | null }).transcript != null,
      ).length,
    },
  ]

  const businessType = orgSettings?.business_type ?? null
  const profile = businessType ? getBusinessProfile(businessType) : null
  const prompts = getConsultationQuestions(businessType).slice(0, 3)

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
