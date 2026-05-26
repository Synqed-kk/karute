import { createClient } from '@/lib/supabase/server'
import { getOrgSettings } from '@/actions/org-settings'
import { getSynqedClient } from '@/lib/synqed/client'
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
  ] = await Promise.all([supabase.auth.getUser(), getOrgSettings()])

  // Scope counts, all from synqed-core (the source of truth): total karute,
  // customers, upcoming bookings, and recordings.
  const synqed = await getSynqedClient()
  const nowIso = new Date().toISOString()

  const [karuteRes, recordingRes, customerList, apptList] = await Promise.all([
    synqed.karuteRecords.list({ page_size: 1 }).catch(() => ({ total: 0 })),
    synqed.recordings.list({ page_size: 1 }).catch(() => ({ total: 0 })),
    synqed.customers.list({ page_size: 1 }).catch(() => ({ total: 0 })),
    synqed.appointments
      .list({ from: nowIso, page_size: 1 })
      .catch(() => ({ total: 0 })),
  ])

  const scope: DataScopeItem[] = [
    { label: 'Karute', count: karuteRes.total ?? 0 },
    { label: 'Customers', count: customerList.total ?? 0 },
    { label: 'Bookings', count: apptList.total ?? 0 },
    { label: 'Recordings', count: recordingRes.total ?? 0 },
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
