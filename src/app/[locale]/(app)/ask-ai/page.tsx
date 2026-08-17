import { QuietRefresh } from '@/components/perf/QuietRefresh'
import { renderStamp } from '@/lib/perf/render-stamp'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { getOrgSettings } from '@/actions/org-settings'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { canUseAskAi, type Capability } from '@/lib/auth/permissions'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getSynqedClient } from '@/lib/synqed/client'
import { AIAssistantView } from '@/components/ai/redesign/AIAssistantView'
import { getTodaySignals } from '@/lib/karute/ai-signals'
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

  // Shared Ask-AI capability rule (H0) — same rule as the chat routes, checked
  // BEFORE the scope-count fan-out below so a denied account never preloads
  // karute/customer/appointment counts. A REJECTED capability resolve is
  // treated as no capabilities → redirect away (this surface has no error
  // envelope; the API routes return their own 500 instead). The deeper
  // resolver degrades query failures to the practitioner preset by design
  // (pre-RBAC-migration grace) — that system-wide posture is Permission v2's
  // to revisit, not this guard's.
  const caps = await getMyCapabilities().catch(() => new Set<Capability>())
  if (!canUseAskAi(caps)) {
    redirect(`/${localeArg}/dashboard`)
  }

  const t = await getTranslations('askAi')

  // Scope counts from synqed-core (the Supabase karute_records mirror is empty
  // post-migration — Karute + Recordings used to show 0). Store-lensed: same
  // active-store scope the customer/karute lists use (store-scope parity
  // packet, 2026-08-17) — a store-clamped staff must not see business-wide
  // totals; viewAll actors get their same active-store lens, not "all".
  const synqedPromise = getSynqedClient()
  const nowIso = new Date().toISOString()
  const storeScope = await resolveStoreScope()

  const [orgSettings, karuteRes, customerList, apptList, signals] =
    await Promise.all([
      getOrgSettings(),
    synqedPromise.then((synqed) =>
      synqed.karuteRecords
        .list({ page_size: 200, store_id: storeScope.storeId ?? undefined })
        .catch(() => ({ total: 0, karute_records: [] as { transcript?: string | null }[] })),
    ),
    synqedPromise.then((synqed) =>
      synqed.customers.list({ page_size: 1, store_id: storeScope.storeId ?? undefined }).catch(() => ({ total: 0 })),
    ),
    synqedPromise.then((synqed) =>
      synqed.appointments
        .list({ from: nowIso, page_size: 1, store_id: storeScope.storeId ?? undefined })
        .catch(() => ({ total: 0 })),
    ),
    // Today's ranked signal chips (PKT-101); store-scoped internally, [] on error.
    // Locale-selected tag/title/prompt strings come straight from the data.
    getTodaySignals(localeArg),
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

  return (
    <>
      {/* SWR delivery: this screen may have been served from the
          router cache — stamp when the SERVER built it so a stale
          copy refreshes itself behind the paint. */}
      <QuietRefresh renderedAt={renderStamp()} />
      <AIAssistantView
        scope={scope}
        profile={profile}
        prompts={prompts}
        signals={signals}
        locale={locale}
      />
    </>
  )
}
