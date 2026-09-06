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
import { can, getMyCapabilities } from '@/lib/auth/require-permission'
import {
  canViewAllInStore,
  canViewTranscript,
  ownerHandReach,
  readDoorStoreId,
} from '@/lib/auth/recording-acl'
import { statusOf } from '@/lib/recording/take-binding'
import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { resolveStoreScope } from '@/lib/auth/store-scope'
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
    holdsRecordingsViewAll,
    storeScope,
    canReassign,
    businessId,
    capabilities,
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
    // The viewer's store assignment (⚖ 8/17 store isolation; Greptile #848
    // point 2). null = unrestricted (stores.viewAll / floating); a THROWN or
    // degraded lookup becomes [] below and fails the grant closed — it never
    // widens into "every store", and it never costs a recorder her own take.
    resolveStoreScope().catch((err: unknown) => {
      console.warn('[karute-detail] store scope read failed — failing closed', err)
      return null
    }),
    // F4: records.reassign gate — the 顧客を変更 entry point.
    can('records.reassign'),
    // The tenant the key grammar's take fence is checked against.
    getBusinessId(),
    // The whole set, for the ACT gate below. `can()` resolves through the same
    // per-request memo, so this costs no extra read — and asking for the SET
    // rather than a second can() keeps `business.manage` out of the capability
    // log this page keeps for the READ (it is never asked as its own question).
    getMyCapabilities(),
  ])
  if (!karute) notFound()

  // The recording behind this karute — the player's presence probe. Fired
  // alongside the customer wave below (it needs only the session id, which the
  // karute read just gave us) and EVERY failure degrades: an accessory read
  // that blipped must cost the player, never the whole karute (D-8, the photos
  // precedent).
  //
  // ⚖ …BUT IT DEGRADES TO `'unreadable'`, NOT TO `null` (fix round 6, Greptile
  // #849 review 2). Null is a record that NAMES no store, and a store we could
  // not read is not a store that does not exist: collapsing the two handed a
  // store-clamped grantee a colleague's transcript whenever this read blipped.
  // The player still goes away (the builder is handed `null` below); the store
  // question gets the honest answer — see readDoorStoreId (auth/recording-acl).
  const recordingSessionId = karute.recording_session_id
  const recordingPromise = recordingSessionId
    ? synqedPromise
        .then((synqed) => synqed.recordings.get(recordingSessionId))
        .catch((err: unknown) => {
          // A 404 — the row was swept — is the same null as no session;
          // anything else is 'unreadable' (a definite no is a no; only an
          // unknown closes).
          if (statusOf(err) === 404) return null
          console.warn('[karute-detail] recording read failed — no player', err)
          return 'unreadable' as const
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

  // THE GRANT WIDENS WHOSE RECORDINGS, NEVER WHICH STORES (⚖ Liam's store-
  // isolation law 8/17; Greptile #848 point 2). Before the named grant every
  // viewAll holder was an owner, and the owner preset carries stores.viewAll —
  // so a holder without store reach could not exist. The first named grantee is
  // that person, and this is the line that keeps her inside her own stores.
  // ONE resolved scope, fed to BOTH the read predicate and the act predicate —
  // they cannot disagree about which stores this viewer can see.
  const allowedStoreIds =
    storeScope === null || storeScope.degraded ? [] : storeScope.allowedStoreIds

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

  // The recording row, awaited BESIDE the customer wave rather than ahead of it
  // (③ fix round 4). It has been in flight since the top of this function, and
  // nothing above needs it, so awaiting it here costs no extra call AND keeps
  // it off the critical path — awaiting it earlier made the three customer
  // reads wait behind one `recordings.get`.
  const recordingRead = await recordingPromise
  // Everything BUT the store question wants a ROW or nothing: a read that
  // failed is no row, so the player disappears exactly as it did before (fix
  // round 6). Only the two store computations below see the sentinel.
  const recordingRow = recordingRead === 'unreadable' ? null : recordingRead
  // ⚖ R1′ — WHICH STORE JUDGES THIS KARUTE (③ fix round 3; Greptile #849). The
  // karute's own store leads; a karute that carries none inherits the RECORDING
  // row's, which since ③ names the branch the device was in. ONE spelling for
  // all three read doors — and, since fix round 4, for the act doors beside them
  // (readDoorStoreId, auth/recording-acl.ts), so the words door, the sound door
  // and the 再生成 button can never disagree about one karute.
  const canViewAllRecordings = canViewAllInStore({
    canViewAll: holdsRecordingsViewAll,
    allowedStoreIds,
    recordStoreId: readDoorStoreId(karute, recordingRead),
  })

  // ⚠ HIDE, NEVER SHOW-AND-REFUSE (⚖ 9/3 named grant; fix round 4). The READ is
  // `recordings.viewAll`; the ACT — rewriting a colleague's record — is the
  // owner's two keys. This is the SERVER'S OWN expression, character for
  // character (actions/regenerate-karute.ts), so the button and the action
  // cannot drift: the recorder keeps her own button on the own-recording
  // branch, the owner and any both-keys holder keep theirs, and a named
  // grantee reads the words with no button at all.
  // The flag is the server's gate VERBATIM: `records.write` first, then the
  // ACL — so a front-desk viewer on an unowned karute never sees a control the
  // server refuses (the ACL alone passes every unowned record).
  const staffCanRegenerate =
    capabilities.has('records.write') &&
    canViewTranscript({
      ownerStaffId: ownerProfileId,
      viewerStaffId,
      // ownerHandReach, not holdsOwnerKeys — the ACT door obeys the store law
      // too (⚖ 8/17; fix round 7), so the button and the door cannot drift: a
      // clamped both-keys manager sees no button on a store she cannot reach,
      // and gets no 再生成 if she posts anyway.
      canViewAll: ownerHandReach({
        holdsOwnerKeys: holdsOwnerKeys(capabilities),
        allowedStoreIds,
        // ⚖ AN ACT IS NEVER MORE PERMISSIVE THAN THE READ (③ fix round 4): the
        // SAME input as canViewAllRecordings above. Reading the karute alone
        // here let a clamped manager who could not READ this record still see
        // the 再生成 button on it — the wrong way round for the stronger door.
        recordStoreId: readDoorStoreId(karute, recordingRead),
      }),
    })

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
    staffCanRegenerate,
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
      staffCanRegenerate={built.staffCanRegenerate}
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
