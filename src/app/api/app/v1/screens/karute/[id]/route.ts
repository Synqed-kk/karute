// Session-detail (/karute/[id], inventory #5) screen facade read (packet 07
// §Build 2). The page's fan-out collapsed onto the business-scoped Bearer client,
// assembled by the SAME buildKaruteDetailScreen the web page renders from.
//
// TENANCY: the karute is the resource — readKaruteRaw proves it FIRST (a
// cross-tenant/missing id → 404 before any secondary read; a genuine upstream
// failure → 502), OUTSIDE the wave's 502 catch. RECORDING-PRIVACY ACL (#4): the
// raw transcript is withheld SERVER-side (canViewTranscript inside the builder)
// with the caller's staff id + recordings.viewAll capability — a restricted
// viewer's DTO carries transcript:null + transcriptRestricted:true.
//
// FAILURE CONTRACT (§Build 2): the page's silent degrades on the customer /
// consent / customer-list reads become a classified 502 here, never an empty-but-
// 200 DTO. PRE-RULED EXCEPTIONS: the outcome keeps null-on-failure (product
// semantics) and photos keep the page's catch→[] grace (a plain HTTP read folded
// into the DTO — the paint-timing deviation from web's Suspense stream is
// recorded, not a defect).

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { KaruteDetailScreenDTO } from '@/lib/app-api/karute-detail-screen-dto'
import { readKaruteRaw } from '@/lib/app-api/karute-facade'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listAllCustomers } from '@/lib/customers/list-all'
import { getCustomerWithClient } from '@/lib/customers/queries'
import { getKaruteOutcomeWithClient, OLD_SHELL_OUTCOMES } from '@/lib/karute/outcome'
import { mapSynqedKaruteRecord } from '@/lib/supabase/karute'
import { buildKaruteDetailScreen } from '@/lib/karute/detail-screen'
import { canViewAllInStore, canViewTranscript, ownerHandReach } from '@/lib/auth/recording-acl'
import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { viewerAllowedStoreIds } from '@/lib/app-api/store-clamp'
import { lookupProfileIdForSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { scopeKarutePhotos } from '@/lib/karute/scoped-photos'

// Node runtime: the synqed SDK + node:crypto verifier are server-only.
export const runtime = 'nodejs'

type Params = { id: string }

async function karuteId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'karute id is required')
  return id
}

function readLocale(ctx: FacadeContext<Params>): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

export const GET = facadeHandler<Params>('karute.read', async (ctx) => {
  // Same screens-route class gate as sessions/customers/profile — 'customers.view'
  // is "view customers + karute" in permissions.ts. First body statement.
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const id = await karuteId(ctx)
  const locale = readLocale(ctx)
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  // Tenancy proof FIRST — cross-tenant/missing → 404, genuine upstream → 502,
  // both OUTSIDE the wave catch so they surface with their own status.
  const raw = await readKaruteRaw(synqed, id)
  const customerId = (raw.customer_id as string | null) ?? null
  const recordingSessionId = (raw.recording_session_id as string | null) ?? null

  try {
    const [staffList, allCustomers, outcome, gated, recordingRow] = await Promise.all([
      staffListByBusinessOrThrow(businessId),
      listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
      // Pre-ruled exception: outcome stays null-on-failure (product semantics).
      getKaruteOutcomeWithClient(synqed, id),
      customerId
        ? Promise.all([
            // Customer read (phone/email + 年齢/性別/回数/前回). Throws → 502 per
            // §Build 2 (the page's getCustomer catch→null is overridden here).
            getCustomerWithClient(synqed, customerId),
            // Consent presence. Throws → 502 (§Build 2 override of the page's
            // catch→null).
            synqed.customers.getConsent(customerId),
            // Photos folded into the DTO — page-parity graceful (catch→[]).
            synqed.customers
              .listPhotos(customerId)
              .then((r) => r.photos ?? [])
              .catch(
                () =>
                  [] as Array<{
                    id: string
                    signed_url: string | null
                    category: string
                    caption: string | null
                    recording_session_id: string | null
                  }>,
              ),
          ])
        : Promise.resolve(null),
      // The recording behind this karute — the player's presence probe (slice
      // ①). Page-parity graceful like photos above, and for the stronger
      // reason: an accessory read that blipped must cost the PLAYER, never 502
      // the whole karute screen. A 404 (row swept) is the same null.
      recordingSessionId
        ? synqed.recordings.get(recordingSessionId).catch((err: unknown) => {
            console.warn('[screens/karute] recording read failed — no player', err)
            return null
          })
        : Promise.resolve(null),
    ])

    const customer = gated?.[0] ?? null
    const consent = gated?.[1] ?? null
    const photoRows = gated?.[2] ?? []

    // The caller's roster row: staff id (ACL viewer) + display role (coaching
    // panel gate). Keyed by the CONFIRMED auth user id — never client input.
    const selfRow = staffList.find((s) => s.id === ctx.identity.authUserId) ?? null
    const viewerStaffId = selfRow ? selfRow.id : null
    const viewerRole = (selfRow?.display_role ?? '') as string
    const holdsRecordingsViewAll = ctx.identity.capabilities.has('recordings.viewAll')

    const customerName = customerId
      ? allCustomers.customers.find((c) => c.id === customerId)?.name ?? null
      : null
    const karute = mapSynqedKaruteRecord(raw, customerName)

    // THE GRANT WIDENS WHOSE RECORDINGS, NEVER WHICH STORES (⚖ Liam's store-
    // isolation law 8/17; Greptile #848 point 2) — the Bearer twin of the web
    // page's line. Resolved ONLY for a viewAll caller, and a failed assignment
    // read arrives as [] (fail closed), so an assignment blip narrows the grant
    // and never 502s the screen or hides a recorder's own transcript.
    // ONE resolved scope, fed to BOTH the read predicate and the act predicate
    // — they cannot disagree about which stores this viewer can see. Resolved
    // whenever the read grant is held: the PAIR IMPLIES IT (holdsOwnerKeys is
    // `business.manage && recordings.viewAll`), so a both-keys caller always
    // takes this branch and a caller holding neither key pays nothing.
    const callerHoldsOwnerKeys = holdsOwnerKeys(ctx.identity.capabilities)
    const allowedStoreIds = holdsRecordingsViewAll
        ? await viewerAllowedStoreIds({
            synqed,
            authUserId: ctx.identity.authUserId,
            capabilities: ctx.identity.capabilities,
            selfStaffId: viewerStaffId,
          })
        : null
    const canViewAllRecordings = canViewAllInStore({
      canViewAll: holdsRecordingsViewAll,
      allowedStoreIds,
      recordStoreId: karute.store_id,
    })

    // Recorder-lock fix (⚖ Liam 8/22): translate a synqed-core staff CARD id
    // (not a Supabase profile id) into its profile id before the ACL compare
    // in buildKaruteDetailScreen — `?? original` keeps profile-id-stamped
    // rows and unlinked card ids unchanged. Same translation as the web page.
    const ownerProfileId = karute.staff_profile_id
      ? ((await lookupProfileIdForSynqedStaffIdForBusiness(
          karute.staff_profile_id,
          businessId,
        )) ?? karute.staff_profile_id)
      : null

    // Merge→shell-update window gate (#689 P1). Fielded shells (iOS ≤4.6,
    // Android ≤code 12) parse this screen with a BAKED strict outcome enum
    // that predates 'revisit' — one such row hard-fails their ENTIRE detail
    // screen (ScreenBoundary error card, retry never recovers) until the phone
    // takes the 4.7/code-13 bake. Only a revisit-aware bundle sends
    // 'app-version' (facade-fetch), so absent/empty = an old shell; falsy, not
    // a version compare — iOS sends dotted, Android integer, and the new DTO
    // (karute-detail-screen-dto.ts) already widened the read field to
    // z.string(), making this the LAST bake-coupled enum change, so a compare
    // would be dead code with no future user. The WHOLE object goes null
    // (renders 未記録): the old baked OutcomeSchema's INNER field is the
    // strict enum, so nulling only that field still fails — and the object is
    // .nullable() on old AND new DTOs.
    // ALLOWLIST, not a 'revisit' denylist (P1b): OLD_SHELL_OUTCOMES is the
    // FROZEN enum those fielded bundles baked — their schemas can never change,
    // so any value outside it (a future 5th just as much as 'revisit') bricks
    // them identically. Same cost, no follow-up needed when the enum grows.
    // Values inside the set pass through untouched for every client.
    const outcomeMasked =
      !!outcome && !OLD_SHELL_OUTCOMES.includes(outcome.outcome) && !ctx.meta.appVersion
    const outcomeForClient = outcomeMasked ? null : outcome

    const built = buildKaruteDetailScreen({
      karute: { ...karute, staff_profile_id: ownerProfileId },
      allCustomers,
      outcome: outcomeForClient,
      viewerStaffId,
      canViewAllRecordings,
      recordingRow,
      businessId,
      staffCanReassignRecords: ctx.identity.capabilities.has('records.reassign'),
      // ⚠ HIDE, NEVER SHOW-AND-REFUSE (⚖ 9/3 named grant; fix round 4) — the
      // Bearer twin of the web page's line, the same server expression the
      // regenerate route enforces. A named grantee reads a colleague's words
      // and gets no 再生成 button; the recorder and the owner's hand keep theirs.
      // The flag is the server's gate VERBATIM: `records.write` first, then
      // the ACL — so a front-desk viewer on an unowned karute never sees a
      // control the server refuses (the ACL alone passes every unowned record).
      staffCanRegenerate:
        ctx.identity.capabilities.has('records.write') &&
        canViewTranscript({
          ownerStaffId: ownerProfileId,
          viewerStaffId,
          canViewAll: ownerHandReach({
            holdsOwnerKeys: callerHoldsOwnerKeys,
            allowedStoreIds,
            // `?? null` explicitly — see the web page's twin.
            recordStoreId: karute.store_id ?? null,
          }),
        }),
      contact: customer ? { phone: customer.phone, email: customer.email } : null,
      consentResult: consent ? { consent: consent.consent ?? null } : null,
      customer,
      locale,
    })

    // Karute-scoped display (packet PR 9a): the screens facade must not leak
    // the customer's whole photo gallery onto a single karute — same rule as
    // the web page (PhotoRecordsServer), shared via scopeKarutePhotos.
    const photos = scopeKarutePhotos(photoRows, karute.recording_session_id).map((p) => ({
      id: p.id,
      signedUrl: p.signed_url,
      category: p.category,
      caption: p.caption,
    }))

    const dto = KaruteDetailScreenDTO.parse({ ...built, photos, viewerRole })
    // karute.view audit detail (Wave V, canon's transcriptShown mandate): the
    // hook's emit carries whether the raw transcript actually shipped in THIS
    // response — false covers both "none exists" and "ACL-withheld to null".
    // customer_id is the viewer's name join (packet 30 §4 karute-row idiom).
    // The emit itself stays logFacadeAudit's (see the karute.read row comment
    // in audit.ts); this route only enriches it.
    // outcome_masked rides the same emit ONLY when the gate fired: it is the
    // gate-removal metric — the one signal that old shells are still reading
    // masked rows. Additive-only auditDetail contract, so an extra key is legal.
    ctx.auditDetail = {
      transcript_shown: dto.transcript !== null,
      customer_id: customerId,
      ...(outcomeMasked ? { outcome_masked: true } : {}),
    }
    return ok(ctx, dto)
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'session detail data unavailable')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
