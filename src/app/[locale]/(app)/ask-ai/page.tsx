import { createClient } from '@/lib/supabase/server'
import { getOrgSettings } from '@/actions/org-settings'
import { getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { createServiceClient } from '@/lib/supabase/service'
import { AIAssistantView } from '@/components/ai/redesign/AIAssistantView'
import {
  getBusinessProfile,
  getConsultationQuestions,
} from '@/lib/welcome/business-types'
import type { DataScopeItem } from '@/components/ai/redesign/AIPageHeader'

function deriveInitials(name: string | null | undefined): string {
  if (!name) return 'U'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

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
    businessId,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getOrgSettings(),
    getBusinessId(),
  ])

  // Scope counts: total karute + total customers + upcoming bookings + total
  // recordings (= karute_records with a non-null transcript).
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = service as any
  const synqed = await getSynqedClient()
  const nowIso = new Date().toISOString()

  const [karuteCountRes, recordingCountRes, customerList, apptList] =
    await Promise.all([
      sb
        .from('karute_records')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', businessId),
      sb
        .from('karute_records')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', businessId)
        .not('transcript', 'is', null),
      synqed.customers.list({ page_size: 1 }).catch(() => ({ total: 0 })),
      synqed.appointments
        .list({ from: nowIso, page_size: 1 })
        .catch(() => ({ total: 0 })),
    ])

  const scope: DataScopeItem[] = [
    { label: 'Karute', count: karuteCountRes.count ?? 0 },
    { label: 'Customers', count: customerList.total ?? 0 },
    { label: 'Bookings', count: apptList.total ?? 0 },
    { label: 'Recordings', count: recordingCountRes.count ?? 0 },
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
      userInitials={deriveInitials(userName)}
      locale={locale}
    />
  )
}
