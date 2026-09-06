import { QuietRefresh } from '@/components/perf/QuietRefresh'
import { renderStamp } from '@/lib/perf/render-stamp'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { getKaruteRecord } from '@/lib/supabase/karute'
import { getKaruteOutcome } from '@/lib/karute/outcome'
import { KaruteDetailView } from '@/components/karute/redesign/detail/KaruteDetailView'
import { PhotoRecordsServer } from '@/components/karute/redesign/detail/PhotoRecordsServer'
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
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { can } from '@/lib/auth/require-permission'
import { listAllCustomers } from '@/lib/customers/list-all'
import { getCustomer } from '@/lib/customers/queries'
import { buildKaruteDetailScreen } from '@/lib/karute/detail-screen'
import { auditWeb } from '@/lib/audit-web'
import { lookupProfileIdForSynqedStaffId } from '@/lib/synqed/staff-map'

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
  const [
    karute,
    allCustomers,
    outcome,
    viewerStaffId,
    canViewAllRecordings,
    canReassign,
    businessId,
  ] = await Promise.all([
    getKaruteRecord(id),
    // Page to completion so the karute number resolves for an overflow customer.
    synqedPromise.then((synqed) =>
      listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
    ),
    getKaruteOutcome(id),
    // Recording-privacy ACL inputs (#4): the viewer's staff id + whether they
    // may read every staff's raw recordings (the owner, or a person the owner
    // named). Both independent of the karute, so fan them out in the same wave.
    getCurrentUserStaffId(),
    can('recordings.viewAll'),
    // F4: records.reassign gate — the 顧客を変更 entry point.
    can('records.reassign'),
    // The tenant the key grammar's take fence is checked against.
    getBusinessId(),
  ])
  if (!karute) notFound()

  // The recording behind this karute — the player's presence probe. Fired
  // alongside the customer wave below (it needs only the session id, which the
  // karute read just gave us) and EVERY failure degrades to null: an accessory
  // read that blipped must cost the player, never the whole karute (D-8, the
  // photos precedent).
  const recordingSessionId = karute.recording_session_id
  const recordingPromise = recordingSessionId
    ? synqedPromise
        .then((synqed) => synqed.recordings.get(recordingSessionId))
        .catch((err: unknown) => {
          console.warn('[karute-detail] recording read failed — no player', err)
          return null
        })
    : Promise.resolve(null)

  // Recorder-lock fix (⚖ Liam 8/22): the karute's staff_profile_id sometimes
  // carries a synqed-core staff CARD id (not a Supabase profile id) — those
  // rows locked the recorder out of her own transcript. Translate card→profile
  // for the ACL compare only; `?? original` keeps profile-id-stamped rows
  // (the common case) and card ids with no linked profile unchanged.
  const ownerProfileId = karute.staff_profile_id
    ? ((await lookupProfileIdForSynqedStaffId(karute.staff_profile_id)) ??
      karute.staff_profile_id)
    : null

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
  const recordingRow = await recordingPromise

  // Post-fetch assembly is shared with the facade screen GET (packet 07) so web
  // and thin can never derive a different view-model from the same raw wave.
  const built = buildKaruteDetailScreen({
    karute: { ...karute, staff_profile_id: ownerProfileId },
    allCustomers,
    outcome,
    viewerStaffId,
    canViewAllRecordings,
    recordingRow,
    businessId,
    staffCanReassignRecords: canReassign,
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
    <>
      {/* SWR delivery: stamp when the SERVER built this so a stale
          router-cache copy refreshes itself behind the paint. */}
      <QuietRefresh renderedAt={renderStamp()} />
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
      recording={built.recording}
      staffCanReassignRecords={built.staffCanReassignRecords}
      // fallback=null, not a skeleton: the card is now only-when-photos, so a
      // photo-shaped placeholder would flash a box that then vanishes on every
      // karute with no linked photos (Liam 8/10, mock frame C).
      photosSlot={
        customerId ? (
          <Suspense fallback={null}>
            <PhotoRecordsServer
              customerId={customerId}
              recordingSessionId={karute.recording_session_id}
            />
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
            appointmentId={karute.appointment_id ?? null}
            storeId={karute.store_id ?? null}
          />
        </Suspense>
      }
    />
    </>
  )
}
