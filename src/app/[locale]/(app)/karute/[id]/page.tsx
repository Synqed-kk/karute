import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { getKaruteRecord } from '@/lib/supabase/karute'
import { getKaruteOutcome } from '@/lib/karute/outcome'
import { KaruteDetailView } from '@/components/karute/redesign/detail/KaruteDetailView'
import {
  PhotoRecordsServer,
  PhotoRecordsSkeleton,
} from '@/components/karute/redesign/detail/PhotoRecordsServer'
import {
  getCustomerContact,
  getCachedCustomerConsent,
} from '@/lib/customers/customer-detail-cached'
import {
  AIBodyPredictionSlot,
  AISuggestedMessageSlot,
} from '@/components/karute/redesign/detail/AiInsightSlots'
import {
  AIBodyPredictionPreview,
  AIOutreachPreview,
} from '@/components/customers/redesign/profile/UpcomingAiFeatures'
import { getSynqedClient } from '@/lib/synqed/client'
import { getCurrentUserStaffId } from '@/lib/staff'
import { can } from '@/lib/auth/require-permission'
import { listAllCustomers } from '@/lib/customers/list-all'
import { getCustomer } from '@/lib/customers/queries'
import { buildKaruteDetailScreen } from '@/lib/karute/detail-screen'
import { auditWeb } from '@/lib/audit-web'

interface KaruteDetailPageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function KaruteDetailPage({
  params,
}: KaruteDetailPageProps) {
  const { id, locale } = await params

  // Fetch the karute and the tenant customer list in parallel — the list feeds
  // the sequential karute number (below) and doesn't depend on the karute.
  const synqedPromise = getSynqedClient()
  const [karute, allCustomers, outcome, viewerStaffId, canViewAllRecordings] =
    await Promise.all([
      getKaruteRecord(id),
      // Page to completion so the karute number resolves for an overflow customer.
      synqedPromise.then((synqed) =>
        listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
      ),
      getKaruteOutcome(id),
      // Recording-privacy ACL inputs (#4): the viewer's staff id + whether they
      // may read every staff's raw recordings (owner/manager). Both independent
      // of the karute, so fan them out in the same wave.
      getCurrentUserStaffId(),
      // Fail closed on a capability-resolution failure (the resolver throws
      // post-#652): own-recordings-only view, page still renders — same
      // absorption as dashboard's can('alerts.manage').
      can('recordings.viewAll').catch(() => false),
    ])
  if (!karute) notFound()

  const customerId = karute.client_id ?? null

  // Customer contact + consent are both cached per-customer with their own tag
  // invalidation. Photos are NOT awaited here; they're streamed in via a
  // Suspense boundary below so the shell paints first.
  const [contact, consentResult, customer] = customerId
    ? await Promise.all([
        getCustomerContact(customerId),
        getCachedCustomerConsent(customerId).catch(() => ({ consent: null })),
        getCustomer(customerId).catch(() => null),
      ])
    : [null, null, null]

  // Post-fetch assembly is shared with the facade screen GET (packet 07) so web
  // and thin can never derive a different view-model from the same raw wave.
  const built = buildKaruteDetailScreen({
    karute,
    allCustomers,
    outcome,
    viewerStaffId,
    canViewAllRecordings,
    contact,
    consentResult,
    customer,
    locale,
  })

  // Single-record open = a view event (Wave V, web twin of the facade hook's
  // karute.view — the karute.read row comment in audit.ts is the contract).
  // Fired AFTER the existence check (a 404 open is not a view — same 7/17
  // ruling as customer.view) and after assembly so transcript_shown reflects
  // what THIS render actually ships: false covers both "none exists" and
  // "ACL-withheld to null". customer_id is the 監査ログ name join (packet 30
  // §4 karute-row idiom, ids only). Fire-and-forget, never blocks the render
  // (same web writers' best-effort contract as customers/[id]/page.tsx).
  void auditWeb({
    category: 'karute',
    action: 'karute.view',
    targetType: 'karute',
    targetId: id,
    severity: 'info',
    detail: { transcript_shown: built.transcript !== null, customer_id: customerId },
  })

  return (
    <KaruteDetailView
      karuteId={built.karuteId}
      customerId={built.customerId}
      outcome={built.outcome}
      header={built.header}
      sessionDateLong={built.sessionDateLong}
      sessionDateIso={built.sessionDateIso}
      entries={built.entries}
      summaryBullets={built.summaryBullets}
      summaryRaw={built.summaryRaw}
      summaryEdited={built.summaryEdited}
      transcript={built.transcript}
      consentOnFile={built.consentOnFile}
      transcriptDurationLabel={built.transcriptDurationLabel}
      transcriptRestricted={built.transcriptRestricted}
      photosSlot={
        customerId ? (
          <Suspense fallback={<PhotoRecordsSkeleton />}>
            <PhotoRecordsServer customerId={customerId} />
          </Suspense>
        ) : null
      }
      memory={null}
      bodyPredictionSlot={
        customerId ? (
          <Suspense fallback={<AIBodyPredictionPreview />}>
            <AIBodyPredictionSlot customerId={customerId} locale={locale} />
          </Suspense>
        ) : (
          <AIBodyPredictionPreview />
        )
      }
      suggestedMessageSlot={
        <Suspense fallback={<AIOutreachPreview />}>
          <AISuggestedMessageSlot
            karuteId={id}
            customerId={customerId}
            customerName={built.header.customerName}
            summary={karute.summary ?? null}
            locale={locale}
          />
        </Suspense>
      }
    />
  )
}
