import 'server-only'

// The eight karute cores, moved out of src/actions/karute.ts
// (PKT-SEC-CORES-D2, 2026-09-23). Every runtime export of a 'use server'
// module is registered as a browser-callable server action with no
// authentication of its own — and passing a client object as the first
// argument is no barrier, because the reply decoder revives nested
// references. getCustomerKaruteRecords in particular answered any signed-in
// staffer with ANY customer's karute list, by id, across every store (⚖ Liam
// 2026-08-17, the store-isolation law). These eight are INTERNAL: they take
// an already-scoped client — or, for getCustomerKaruteRecords, build one from
// the caller's own cookie session — and trust the caller to have gated the
// request. They live here, in a server-only module with NO directive, so the
// only way in is a server-side import: the web actions in
// src/actions/karute.ts, the server components (sessions/page.tsx,
// AiInsightSlots.tsx), src/lib/karute/ai-reengagement.ts, and the facade
// routes under src/app/api/app/v1/ (karute POST, karute/manual,
// karute/[id]/reassign, .../entries/[entryId], .../summary, .../entry-edits,
// screens/record, customers/[id]/ai/*).
//
// The private helpers and result types the eight own came with them.
// resolveKaruteStoreId STAYED: it reads the cookie store scope and only the
// web wrappers call it. ReassignCustomerOption and ReassignKaruteCustomerResult
// stayed too — they belong to listReassignCustomerOptions and
// reassignKaruteCustomer, which are web actions.

import { staffListByBusinessOrThrow, type StaffMember } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import type { RecordStoreScope } from '@/lib/auth/store-lock'
import { audit } from '@/lib/audit'
import {
  auditStoreWriteRefused,
  ensureRecordStoreInScopeAudited,
  type StoreRefusalActor,
} from '@/lib/audit-store-lock'
import { SESSION_CATEGORY_TO_ENTRY_CATEGORY, summaryTextToBullets } from '@/lib/adapters/karute-detail'
import { ENTRY_CONTENT_INVALID_ERROR } from '@/types/karute'
import type { KaruteRecord, SynqedClient, EntryEditAction, KaruteEntryEdit } from '@synqed-kk/client'
import type { SessionCategory } from '@/components/karute/redesign/detail/CurrentSessionCard'
import { AppApiError } from '@/lib/app-api/errors'
import { readKaruteRaw, KARUTE_NOT_FOUND } from '@/lib/app-api/karute-facade'
import { reassignFacts } from '@/lib/karute/reassign-facts'

/**
 * Create the karute record — or, if this recording session was ALREADY saved,
 * UPDATE that record with the newest content instead.
 *
 * Why: core's idempotent create (synqed-core #38) returns the EXISTING record
 * when recording_session_id repeats. If an autosave lands server-side but the
 * client sees a network error, the staff is routed to review, edits the
 * summary/entries, and re-saves — the bare create would hand back the OLD
 * record and report success while every edit silently vanished. Upserting by
 * recording session makes the record converge on what the staff last saw
 * (core's update does a FULL entries replace — verified in karute.service).
 *
 * `entriesMode` makes the entries decision on that collision EXPLICIT per
 * caller, not inferred: 'replace' always sends entries — the converge-on-
 * staff contract above, so staff edits/hand-adds (with their is_manual flags)
 * always land. 'fill-if-empty' omits entries when the existing record already
 * has some — for a caller with nothing newer to say (autosave resending the
 * same extraction), so it can't clobber edits made in between. Either mode
 * still sends entries when the existing record has none (a genuinely-first
 * upsert can always land its set).
 *
 * `fresh` tells the caller whether memory ingest should run — an update is a
 * retry of a transcript that was already ingested on the first save.
 * Residual race (concurrent first saves both passing the lookup) falls back
 * to core's dedupe, which is correct there: both carry identical content.
 *
 * Audit choke point (packet 30 §3): web saveKaruteRecord, web
 * saveKaruteRecordInline, and the facade POST all funnel here — ONE emit
 * covers all three. `actor` is threaded explicitly (this function has no
 * cookie/Bearer context of its own): facade callers pass their already-
 * resolved identity, web callers resolve it via resolveWebAuditContext()
 * BEFORE calling in. process-recording.ts does NOT call this function (its
 * own upsert, own pre-existing karute.save emit) — do not add it here.
 */
export async function createOrUpdateKaruteRecord(
  synqed: SynqedClient,
  payload: Parameters<SynqedClient['karuteRecords']['create']>[0],
  actor: {
    actorId: string | null
    businessId: string | null
    source: 'web' | 'facade'
    /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta
     *  on the facade twin. */
    requestId?: string
  },
  entriesMode: 'replace' | 'fill-if-empty',
  /** THE BY-ID WRITE STORE LOCK's scope for the CONVERGE branch below —
   *  REQUIRED, never optional, so tsc forces every transport to hand one over
   *  (web: resolveStoreScope(); facade: resolveWriteStoreScope()). An optional
   *  parameter would have let a future caller re-open the hole silently. */
  scope: RecordStoreScope,
): Promise<{ id: string; fresh: boolean; transcriptChanged: boolean; storeId: string | null }> {
  const emitSave = (result: { id: string; fresh: boolean; transcriptChanged: boolean; storeId: string | null }) => {
    audit({
      category: 'karute',
      action: 'karute.save',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'karute',
      targetId: result.id,
      // The PERSISTED store (fix round 2, Greptile P1): on the converge branch
      // the update keeps the existing record's ORIGINAL store_id (CEILING
      // F-7 above) rather than payload.store_id, so the audit row must name
      // that store too — else it can name a store the record isn't in.
      storeId: result.storeId ?? undefined,
      // customer_id rides in detail (ids only, PII rule) so the audit-log
      // viewer can resolve a name for this karute row — see AuditLogSection
      // §4 target-label join off detail.customer_id. recording_session_id +
      // appointment_id (PR B2 §3) let the per-recording thread page (PR D)
      // join a karute back to its recording/appointment.
      detail: {
        fresh: result.fresh,
        transcript_changed: result.transcriptChanged,
        customer_id: payload.customer_id ?? null,
        recording_session_id: payload.recording_session_id ?? null,
        appointment_id: payload.appointment_id ?? null,
      },
      requestId: actor.requestId,
      source: actor.source,
    })
    return result
  }

  const recordingSessionId = payload.recording_session_id
  if (recordingSessionId) {
    // ONLY a 404 means "no record yet". Any other lookup failure (timeout,
    // backend error) must FAIL the save so the client retries — falling
    // through to create() would re-enter core's idempotent dedupe and hand
    // back stale content as success: the exact bug this upsert exists to
    // prevent. Structural status check (not instanceof) so partial test
    // mocks of the client package can't break the detection.
    const existing = await synqed.karuteRecords
      .getByRecordingSession(recordingSessionId)
      .catch((err: unknown) => {
        const status =
          err && typeof err === 'object' && 'status' in err
            ? (err as { status: unknown }).status
            : undefined
        if (status === 404) return null
        throw err
      })
    if (existing) {
      // STORE LOCK (⚖ Liam 2026-09-16; BUILD-REPORT-P1.md §9.5 — the LAST by-id
      // write door). This branch is keyed by recording_session_id alone, and the
      // update below re-points customer_id / transcript / ai_summary /
      // appointment_id / entries: without this line a clamped actor who holds one
      // session id rewrites ANOTHER store's record on either transport. Refuses
      // with the SAME not_found readKaruteRaw throws for a missing id, so this
      // door is no existence oracle either. The CREATE arm needs no lock — its
      // store comes from resolveKaruteStoreId / resolveSaveStore, already clamped.
      ensureRecordStoreInScopeAudited({ store_id: existing.store_id ?? null }, scope, KARUTE_NOT_FOUND, {
        actor,
        category: 'karute',
        targetType: 'karute',
        targetId: existing.id,
        door: 'karute.save',
        detail: { recording_session_id: recordingSessionId },
      })
      // Collision on recording_session_id (fix round — the prior "this
      // branch's payload is the SAME content by construction" premise was
      // wrong: this branch is also reached by ReviewScreen's saveKaruteRecord
      // when an autosave landed server-side first, so the collision payload
      // can legitimately carry staff edits the existing record doesn't have
      // yet). entriesMode makes the decision explicit instead: a core
      // `entries` replace is a full replace (UpdateKaruteRecordInput.entries
      // "atomically replaces ALL entries"), so 'fill-if-empty' omits it when
      // the existing record already has entries — nothing to add for a caller
      // with nothing newer to say. 'replace' always sends entries — the
      // converge-on-staff contract this function's header describes. Either
      // way, an existing record with zero entries has nothing to lose, so
      // entries still go through.
      const existingHasEntries = Array.isArray(existing.entries) && existing.entries.length > 0
      const omitEntries = entriesMode === 'fill-if-empty' && existingHasEntries
      await synqed.karuteRecords.update(existing.id, {
        // E-1 (fix round 1): the CUSTOMER moves with the update. Without it a
        // save that re-points to a different customer — the recovery banner's
        // 保存先を変更, after an earlier partial save already landed a record
        // under this recording_session_id — silently kept the OLD customer
        // while appointment_id below moved to the NEW one: a karute filed on
        // customer A carrying customer B's booking, with a success toast. The
        // payload's customer is the caller's explicit intent on every one of
        // this chokepoint's callers, so it is the authority here too.
        //   CEILING (F-7, recorded not fixed): store_id and staff_id do NOT
        //   move with it. A cross-store re-point onto an existing record keeps
        //   the OLD store stamp, so under the ⚖ store-isolation law the new
        //   customer's branch cannot see their own karute. Reachable only when
        //   the staff's active store changed between the partial save and the
        //   recovery; queued to the store-isolation census lane.
        customer_id: payload.customer_id,
        transcript: payload.transcript,
        ai_summary: payload.ai_summary,
        appointment_id: payload.appointment_id,
        ...(omitEntries ? {} : { entries: payload.entries }),
      })
      return emitSave({
        id: existing.id,
        fresh: false,
        // The retry EDITED the transcript → there's genuinely new material
        // for memory ingest; an identical transcript is just a resend.
        transcriptChanged: existing.transcript !== payload.transcript,
        // CEILING (F-7 above): store_id does NOT move with this update, so
        // the persisted store is still the EXISTING record's — already in
        // hand from the lookup, no second read.
        storeId: existing.store_id,
      })
    }
  }
  const record = await synqed.karuteRecords.create(payload)
  return emitSave({ id: record.id, fresh: true, transcriptChanged: true, storeId: record.store_id ?? payload.store_id ?? null })
}

/**
 * The recent karute records for ONE customer, newest first — read from
 * synqed-core (the source of truth). The Supabase `karute_records` mirror is
 * empty post-migration, so the record page's "recent recordings" + first-visit
 * brief must read here, scoped to the recording-target customer. Best-effort:
 * returns [] on any failure.
 */
export async function getCustomerKaruteRecords(
  customerId: string,
  limit = 5,
): Promise<KaruteRecord[]> {
  return getCustomerKaruteRecordsWithClient(await getSynqedClient(), customerId, limit)
}

/** Client-threaded getCustomerKaruteRecords — the facade Bearer path (packet 07
 *  Decision 1: the AI body-prediction read fetches the customer's 8 recent records
 *  on the business-scoped client). Same best-effort []-on-failure contract. */
export async function getCustomerKaruteRecordsWithClient(
  synqed: Pick<SynqedClient, 'karuteRecords'>,
  customerId: string,
  limit = 5,
): Promise<KaruteRecord[]> {
  try {
    const res = await synqed.karuteRecords.list({
      customer_id: customerId,
      page_size: limit,
    })
    const rows = [...(res.karute_records ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )
    // The list endpoint omits per-entry detail (only entry_count). The
    // pre-session brief derives 会話のきっかけ / 前回の主訴 / 前回の商品提案 from the
    // MOST-RECENT record's entries — so fetch that one in full. Without this the
    // brief boxes were empty and the card fell back to its placeholder copy.
    // Best-effort: keep the lighter list row if the detail fetch fails.
    if (rows.length > 0) {
      const full = await synqed.karuteRecords
        .get(rows[0].id, { include_entries: true })
        .catch(() => null)
      if (full) rows[0] = full
    }
    return rows
  } catch (err) {
    console.error('[getCustomerKaruteRecords] failed:', err)
    return []
  }
}

export type ReassignPreview = {
  requiresConfirm: true
  fromCustomerId: string
  fromName: string
  toName: string
  // R11-1: split from one burnCount — linked (provable) vs sameDay
  // (presence-only, must be labeled unconfirmed by every surface). See
  // reassign-facts.ts's own header comment for why.
  linkedBurnCount: number
  sameDayBurnCount: number
  photoCount: number
}

export type ReassignSuccess = {
  success: true
  fromCustomerId: string
  toCustomerId: string
  linkedBurnCount: number
  sameDayBurnCount: number
  photoCount: number
}

type ReassignScope = {
  viewAll: boolean
  /** null = unrestricted (viewAll, or a floating actor). */
  allowedStoreIds: string[] | null
  /** Web-only: a clamped actor whose assignment lookup itself failed
   *  (resolveStoreScope's F-A convention) — refuse, never widen. Facade
   *  callers pass false (resolveStoreForRequest already fails closed on this
   *  case by throwing before the caller ever gets a scope back). */
  degraded?: boolean
}

type ReassignClient = Pick<SynqedClient, 'karuteRecords' | 'customers' | 'packs'>

/** Tenancy proof + name, for BOTH the from- and to-customer — the
 *  business-scoped client reads a cross-tenant/missing id as 404, same proof
 *  strength as proveCustomerInBusiness (src/lib/app-api/customer-facade.ts);
 *  inlined here (rather than calling that helper + a second getCustomer) so
 *  the one call that proves tenancy is the SAME call that gets the name the
 *  preview panel needs. */
async function reassignCustomerOrThrow(
  synqed: Pick<SynqedClient, 'customers'>,
  id: string,
): Promise<{ id: string; name: string }> {
  try {
    const c = await synqed.customers.get(id)
    return { id: c.id, name: c.name }
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: unknown }).status
        : undefined
    if (status === 404) throw new AppApiError('not_found', 'customer not found in this business')
    throw new AppApiError('upstream_unavailable', 'customer read failed')
  }
}

/** Does the to-customer belong to ANY of the actor's assigned stores?
 *  Customers carry no store_id of their own (list-all.ts's own header:
 *  "customers have no store_id — identity is business-wide"; membership is
 *  DERIVED server-side from events) — so the only live proof is the same
 *  store-scoped roster the picker itself resolves through. Bounded by the
 *  actor's own store count (almost always 1-2), one full-store page-sweep
 *  each — same pagination primitive every other store-scoped list already
 *  pays for a picker roster. */
async function toCustomerInScope(
  synqed: Pick<SynqedClient, 'customers'>,
  toCustomerId: string,
  allowedStoreIds: string[],
): Promise<boolean> {
  // Lazy import: list-all.ts's own module scope mints an unstable_cache(...)
  // instance on load (a real, pre-existing coupling, not something this file
  // can avoid via a static import) — same "keep a heavy graph out of modules
  // that don't need it" rule deleteCustomerPhoto's dynamic import of
  // customer-facade.ts already documents in this file's neighborhood.
  const { listAllCustomers } = await import('@/lib/customers/list-all')
  for (const storeId of allowedStoreIds) {
    // Bounded by the actor's own (small) store count; the first hit
    // short-circuits the rest — a plain sequential await is fine here.
    const { customers } = await listAllCustomers(synqed as SynqedClient, {
      store_id: storeId,
      enforceStore: true,
    })
    if (customers.some((c) => c.id === toCustomerId)) return true
  }
  return false
}

/** The store-scope clamp (mirrors menus.ts's storeScopeError shape, packet
 *  §2b): viewAll passes; a degraded lookup fails closed (never widens); a
 *  floating actor (allowedStoreIds null, not degraded) is unclamped; a
 *  clamped actor's to-customer must resolve inside one of their stores. No
 *  business-wide roster ever reaches a clamped actor — this is the SERVER
 *  refusal backstopping the store-scoped picker (hide, never show-and-refuse).
 *
 *  R3-1 (fix round 4: moved out of this file — now src/lib/auth/store-lock.ts —
 *  sourceStoreOutOfScope is a pure predicate, the same class as
 *  customerLensFor/menuStoresForScope there, and shared with the
 *  reassign-options facade route): composes the SOURCE record's store clamp
 *  with the pre-existing to-customer clamp — one function proves BOTH sides
 *  of the write, so neither caller (the web action, the facade route) can
 *  get one proof without the other. Runs before the preview return too, so
 *  a clamped actor can't even see an out-of-store record's honesty preview.
 *
 *  R9-2 (existence-oracle class, Greptile round-5 3/5): the source-store
 *  refusal below is now SHAPED exactly like readKaruteRaw's not_found (same
 *  code + message, karute-facade.ts's classifyGetError) — before, a clamped
 *  actor got 404 for a genuinely nonexistent karute id but 403
 *  store_forbidden for one that exists in another store, letting them probe
 *  ids for existence across the whole business by error shape alone. The
 *  karute read itself can't be reordered away (the store_id is only known
 *  AFTER the fetch, unlike the to-customer side below), so the only way to
 *  close the oracle is making the two outcomes byte-identical. viewAll is
 *  unaffected — it never reaches this branch. */
async function ensureReassignStoreScope(
  synqed: Pick<SynqedClient, 'customers'>,
  record: { store_id: string | null },
  karuteId: string,
  toCustomerId: string,
  scope: ReassignScope,
  actor: StoreRefusalActor,
): Promise<void> {
  // R3-1's record half now lives in ONE place for every by-id write door
  // (src/lib/auth/store-lock.ts) — same three
  // outcomes as before, byte for byte: viewAll passes, a degraded lookup
  // fails closed, an out-of-store record refuses as readKaruteRaw's own
  // not_found. Only the to-customer half below is reassign-specific.
  // Every refusal carries the actor supplied by the authenticated caller.
  ensureRecordStoreInScopeAudited(record, scope, KARUTE_NOT_FOUND, {
    actor,
    category: 'karute',
    targetType: 'karute',
    targetId: karuteId,
    door: 'karute.customer_reassign',
  })
  if (scope.viewAll) return
  if (!scope.allowedStoreIds) return // floating — unclamped
  if (await toCustomerInScope(synqed, toCustomerId, scope.allowedStoreIds)) return
  // ⚖ FRESH-EYES-P1B F7 — THE OTHER HALF OF THE SAME PROBE. The record half above
  // files its row; this one refused silently, so a clamped actor could enumerate
  // customer ids against a karute they legitimately hold and no owner would ever
  // see it. Exactly ONE row per request either way: the record half THROWS, so
  // control only reaches here when it passed.
  // The throw below is untouched — auditStoreWriteRefused records, never decides.
  auditStoreWriteRefused({
    actor,
    category: 'karute',
    targetType: 'karute',
    targetId: karuteId,
    door: 'reassign.to_customer',
    recordStoreId: record.store_id,
    code: 'store_forbidden',
    // The id that was probed. Ids only — never the customer's name.
    detail: { to_customer_id: toCustomerId },
  })
  throw new AppApiError('store_forbidden', 'that customer is outside your assigned store')
}

/**
 * Reassign core — refusal auditing requires the authenticated caller's actor.
 * Capability gating and SUCCESS auditing remain the caller's job: the web
 * wrapper emits auditWeb; the facade uses its FACADE_AUDIT_MAP success hook.
 *
 * TWO-PHASE, stateless (packet §2b): `confirmed:false` returns the honesty
 * preview and performs NO write; `confirmed:true` RE-RUNS every proof (a
 * fresh, independent check — nothing from the preview call is trusted) then
 * writes EXACTLY `{ customer_id: toCustomerId }`. ⚠ NEVER add `entries` (or
 * any other field) to that update call — the SDK atomically REPLACES every
 * entry when `entries` rides an update (census B, karute.ts:190's own
 * comment on the sibling recovery-repoint call).
 *
 * Money (回数券 redemptions) and photos are NEVER moved, deleted, or
 * re-pointed — reassignFacts is COUNTS ONLY.
 */
export async function reassignKaruteCustomerWithClient(
  synqed: ReassignClient,
  karuteId: string,
  toCustomerId: string,
  opts: { confirmed: boolean },
  scope: ReassignScope,
  /** Required for every store-lock refusal row, on both transports. */
  actor: StoreRefusalActor,
): Promise<ReassignPreview | ReassignSuccess> {
  const record = await readKaruteRaw(synqed, karuteId)
  const fromCustomerId = record.customer_id

  // R9-1 (existence-oracle class, Greptile round-5 3/5): clamp BEFORE any
  // to-customer lookup. toCustomerInScope proves membership by ROSTER
  // presence only — it never distinguishes "exists in another store" from
  // "doesn't exist at all" — so a clamped actor's out-of-roster to-id now
  // refuses HERE, never reaching the customers.get below that would
  // otherwise leak a not_found vs store_forbidden oracle. viewAll/floating
  // actors pass straight through unaffected; their to-customer's honest
  // existence is still proven by the fetch that follows.
  //
  // D-R9 (fix round 10): the no-customer and same-customer guards moved
  // below this clamp too — they used to run first, so a clamped actor
  // holding any out-of-store karute id could learn from the VALIDATION
  // shape alone whether that id exists (no-customer: needs only one id) or
  // even which customer it's attached to (same-customer: enumerate the
  // actor's own roster against the id). Both are now unreachable for an
  // out-of-store record — the clamp throws the identical not_found first.
  // In-scope actors see no behavior change: toCustomerInScope proves
  // membership by roster presence, and a record's own attached customer is
  // always in that record's store roster (event-derived membership), so
  // to === from still passes the clamp and reaches the guards below.
  await ensureReassignStoreScope(synqed, record, karuteId, toCustomerId, scope, actor)

  if (!fromCustomerId) {
    throw new AppApiError('validation', 'this karute has no customer to reassign from')
  }
  if (toCustomerId === fromCustomerId) {
    throw new AppApiError('validation', 'already this customer')
  }

  const [fromCustomer, toCustomer] = await Promise.all([
    reassignCustomerOrThrow(synqed, fromCustomerId),
    reassignCustomerOrThrow(synqed, toCustomerId),
  ])

  const facts = await reassignFacts(synqed, fromCustomerId, {
    id: karuteId,
    appointment_id: record.appointment_id,
    recording_session_id: record.recording_session_id,
    session_date: record.session_date,
  })

  if (!opts.confirmed) {
    return {
      requiresConfirm: true,
      fromCustomerId,
      fromName: fromCustomer.name,
      toName: toCustomer.name,
      linkedBurnCount: facts.linkedBurnCount,
      sameDayBurnCount: facts.sameDayBurnCount,
      photoCount: facts.photoCount,
    }
  }

  // ⚠ EXACTLY this one key — see the header note above.
  await synqed.karuteRecords.update(karuteId, { customer_id: toCustomerId })

  return {
    success: true,
    fromCustomerId,
    toCustomerId,
    linkedBurnCount: facts.linkedBurnCount,
    sameDayBurnCount: facts.sameDayBurnCount,
    photoCount: facts.photoCount,
  }
}

/**
 * The manual create's SHARED body — an EXPLICIT client plus an ALREADY-RESOLVED
 * store and staff, so the web action (cookie identity/store) and the facade
 * POST (Bearer identity, clamp store) run the identical core write. Same P-B
 * split as createCustomerWithClient (src/lib/customers/customers.core.ts).
 *
 * Deliberately OUT here, with the callers: the capability + other-staff checks
 * (each door has its own capability source), store resolution, the cache
 * invalidations (updateTag is Server-Action-only), the redirect, and the audit
 * row (the facade's, off FACADE_AUDIT_MAP).
 *
 * ⚖ STORE ISOLATION LAW: `storeId` is a PARAMETER, never read off `input` —
 * both doors hand this body a SERVER-resolved store. The payload below is an
 * EXPLICIT field list, not a spread of `input`; that is the load-bearing guard
 * (a `...input` spread turns the payload assertion red under mutation).
 */
export async function createManualKaruteRecordWithClient(
  synqed: Pick<SynqedClient, 'karuteRecords'>,
  input: {
    customerId: string
    staffId: string
    storeId: string | null
    sessionDate: string // YYYY-MM-DD — actual session day (backdating)
    durationMinutes: number
    service: string
  },
): Promise<{ id: string } | { error: string }> {
  try {
    const record = await synqed.karuteRecords.create({
      customer_id: input.customerId,
      store_id: input.storeId,
      staff_id: input.staffId,
      status: 'DRAFT',
      // No transcript / no entries on manual create — staff fills
      // those in on the detail page (or via a later recording).
      transcript: null,
      ai_summary: null,
      entries: [],
      ...({
        service: input.service || null,
        duration_minutes: input.durationMinutes > 0 ? input.durationMinutes : null,
        session_date: input.sessionDate || null,
      } as Record<string, unknown>),
    })
    return { id: record.id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unexpected error' }
  }
}

export type UpdateKaruteEntryResult = { ok: true } | { conflict: true } | { error: string }

/** Core-only variant, distinct from {error} — a content-validation failure
 *  (facade maps it to 400) is not a generic upstream failure (facade maps
 *  {error} to a fixed generic 502, never the raw message). The web wrapper
 *  collapses this into {error} before returning — the sheet only ever sees
 *  {ok}|{conflict}|{error}. Kept structural (no shared string constant) so
 *  the facade route needs no extra import from this file — the
 *  updateTag-ban scanner (facade-core-updatetag-ban.test.ts) requires every
 *  action-module name a route imports to resolve to a function declaration. */
type CoreUpdateEntryResult = UpdateKaruteEntryResult | { validationError: string }

/** The by-id STORE lock's two inputs, threaded as ONE parameter so tsc makes
 *  every caller answer for both (⚖ Liam 2026-09-16). `recordStoreId` is the
 *  store off the caller's OWN authoritative read of the record — both
 *  transports already perform it (the web wrapper for customer_id, the facade
 *  route as its tenancy proof), so the lock costs no extra round trip; `scope`
 *  is web's resolveStoreScope or the facade's resolveStoreForRequest clamp.
 *  Required, never optional: a lock with a default is a lock that fails open. */
export interface KaruteStoreLock {
  recordStoreId: string | null
  scope: RecordStoreScope
}

type SynqedEntryClient = Pick<SynqedClient, 'karuteRecords'>

/**
 * Per-entry edit-save CORE — CAS via expected_version. NEVER call core's
 * update({entries}): that full-replaces every entry (incl. human rows) —
 * updateEntry is the ONLY safe per-entry write. Shared by the web wrapper
 * below and the facade PATCH route (…/karute/[id]/entries/[entryId]). No
 * capability/revalidate here — callers own those; the spine emit IS here
 * (choke-point doctrine, mirrors createOrUpdateKaruteRecord's emitSave above)
 * so both callers get exactly one emit with no FACADE_AUDIT_MAP row (see the
 * "not a row here" comment in src/lib/audit.ts).
 */
export async function updateKaruteDetailEntryWithClient(
  synqed: SynqedEntryClient,
  recordId: string,
  entryId: string,
  input: {
    content?: string
    category?: SessionCategory
    expectedVersion: number
    actorStaffId: string | null
  },
  actor: {
    actorId: string | null
    businessId: string | null
    source: 'web' | 'facade'
    /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta
     *  on the facade twin. */
    requestId?: string
  },
  customerId: string | null,
  lock: KaruteStoreLock,
): Promise<CoreUpdateEntryResult> {
  // STORE LOCK FIRST — before the content bounds below, before any write: an
  // actor who may not touch this record must not learn anything about it, not
  // even that their edit was well-formed. Throws (never returns): the web
  // wrapper's catch maps it to the house { error }, the facade handler maps it
  // to the same 404 body a missing id gets.
  ensureRecordStoreInScopeAudited({ store_id: lock.recordStoreId }, lock.scope, KARUTE_NOT_FOUND, {
    actor,
    category: 'karute',
    targetType: 'karute',
    targetId: recordId,
    door: 'karute.entry_edit',
  })
  // Content bounds checked HERE (not just the facade's zod) so the web path
  // is covered too — a whitespace-only edit or a >4000-char paste never
  // reaches updateEntry.
  if (input.content !== undefined) {
    const trimmed = input.content.trim()
    if (trimmed.length === 0 || input.content.length > 4000) {
      return { validationError: ENTRY_CONTENT_INVALID_ERROR }
    }
  }
  try {
    const written = await synqed.karuteRecords.updateEntry(recordId, entryId, {
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.category !== undefined
        ? { category: SESSION_CATEGORY_TO_ENTRY_CATEGORY[input.category] }
        : {}),
      expected_version: input.expectedVersion,
      actor_staff_id: input.actorStaffId,
      action: 'EDIT',
    })
    audit({
      category: 'karute',
      action: 'karute.entry_edit',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'karute',
      targetId: recordId,
      // customer_id rides in detail (ids only, PII rule) — same viewer
      // name-join rationale as karute.save's emitSave above.
      // entry_edit_id = core's entry_edits row for THIS edit (SDK >= 1.25,
      // core #69) — the receipt's handle on the change row, so a 監査ログ
      // dispute reads the before/after off core instead of guessing which
      // edit row belongs to this emit.
      //
      // `?? null` is a RUNTIME-ONLY guard, and tsc cannot police it: the SDK
      // types entry_edit_id as required, so `written?.entry_edit_id` resolves
      // statically to `string` and the fallback branch is statically dead —
      // deleting it still compiles clean (proved by stress probe S4). It
      // earns its place at the network boundary, where a degraded or
      // pre-1.25 core can hand back a response the types swear is impossible;
      // the detail shape takes null but not undefined, and an absent key
      // reads as "never wired" rather than "core gave none". The only thing
      // holding it is the degraded-response test in each of the two suites
      // below — karute-entry-edit-action.test.ts and
      // app-api-karute-entry-edit.test.ts. Do not drop those and trust the
      // compiler.
      detail: {
        entry_id: entryId,
        category: input.category ?? null,
        customer_id: customerId,
        entry_edit_id: written?.entry_edit_id ?? null,
      },
      requestId: actor.requestId,
      source: actor.source,
    })
    return { ok: true }
  } catch (err) {
    // Stale version → 409. Structural status check, not instanceof SynqedError
    // (same convention as createOrUpdateKaruteRecord's lookup above — a
    // partial test client can't break detection). current_version rides the
    // body, not the typed error — callers re-fetch. NEVER retry the CAS.
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: unknown }).status
        : undefined
    if (status === 409) return { conflict: true }
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export type UpdateKaruteDetailSummaryResult = { ok: true } | { error: string }

/** Core-only variant — same structural convention as CoreUpdateEntryResult
 *  above (facade maps validationError to 400, {error} to a fixed generic
 *  502; the web wrapper collapses it into {error}). */
type CoreUpdateDetailSummaryResult = UpdateKaruteDetailSummaryResult | { validationError: string }

// NO content in the audit detail — the emitter's interim sink is a console
// line into Vercel log drains and its PII rule is "ids only, no note/summary
// text, ever" (src/lib/audit.ts header + AuditEvent.detail doc). The DETAILED
// before/after Liam requires lives where #620's entry-edit precedent puts it:
// core's record-level lineage row (contentBefore/After, UNTRUNCATED) written
// on every edited_summary change, surfaced by the 監査ログ row expansion and
// the sheet's 編集履歴 block. The row itself carries lengths + ids only.

/**
 * Whole-section summary edit CORE — writes the `edited_summary` overlay (⚖
 * Liam 7/29: ONE pencil, whole-section edit). `ai_summary` is never touched;
 * readers already prefer the overlay via effectiveSummary. NO CAS: core's
 * record update has no expected_version — last write wins, and no version is
 * lost because core logs every change as a record-level lineage row (entry
 * ids null). Shared by the web wrapper below and the facade PATCH route
 * (…/karute/[id]/summary); the spine emit IS here (choke-point doctrine,
 * mirrors updateKaruteDetailEntryWithClient above) so both callers get
 * exactly one karute.summary_edit row and the facade key stays a
 * FACADE_AUDIT_MAP skip.
 */
export async function updateKaruteDetailSummaryWithClient(
  synqed: SynqedEntryClient,
  recordId: string,
  input: {
    content: string
    actorStaffId: string | null
  },
  actor: {
    actorId: string | null
    businessId: string | null
    source: 'web' | 'facade'
    requestId?: string
  },
  customerId: string | null,
  /** The effective summary BEFORE this edit (edited ?? ai), from the caller's
   *  authoritative read — rides the audit detail as `before`. */
  summaryBefore: string | null,
  lock: KaruteStoreLock,
): Promise<CoreUpdateDetailSummaryResult> {
  // STORE LOCK FIRST — see updateKaruteDetailEntryWithClient.
  ensureRecordStoreInScopeAudited({ store_id: lock.recordStoreId }, lock.scope, KARUTE_NOT_FOUND, {
    actor,
    category: 'karute',
    targetType: 'karute',
    targetId: recordId,
    door: 'karute.summary_edit',
  })
  // Content bounds checked HERE (not just the facade's zod) so the web path
  // is covered too — same rule as updateKaruteDetailEntryWithClient: an
  // emptied or >4000-char summary never reaches core. The bullet-split check
  // closes the marker-only hole (blind-round P2): text like a lone 「・」
  // passes trim but splits to ZERO bullets — the card renders nothing, the
  // pencil unmounts with it (permanent UI lockout of edited_summary), and
  // every downstream effectiveSummary reader is fed the marker. Reject it on
  // BOTH surfaces at the choke.
  const trimmed = input.content.trim()
  if (
    trimmed.length === 0 ||
    input.content.length > 4000 ||
    summaryTextToBullets(input.content).length === 0
  ) {
    return { validationError: ENTRY_CONTENT_INVALID_ERROR }
  }
  // No-change guard at the choke (the sheet no-ops too, but a facade caller
  // might not): an identical save writes nothing and must not mint an audit
  // row claiming an edit happened.
  if (input.content === summaryBefore) return { ok: true }
  try {
    await synqed.karuteRecords.update(recordId, {
      edited_summary: input.content,
      actor_staff_id: input.actorStaffId,
    })
    audit({
      category: 'karute',
      action: 'karute.summary_edit',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'karute',
      targetId: recordId,
      // customer_id rides in detail (ids only, PII rule — same viewer
      // name-join rationale as karute.entry_edit above). Lengths, not text
      // (see the no-content comment above the function): the before/after
      // themselves live in core's lineage row, read back by the 監査ログ
      // expansion. before_len is the caller's proof-read view — best-effort
      // under concurrency (no CAS on this path; core's lineage row is the
      // transactional truth).
      detail: {
        customer_id: customerId,
        before_len: summaryBefore === null ? 0 : summaryBefore.length,
        after_len: input.content.length,
      },
      requestId: actor.requestId,
      source: actor.source,
    })
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export interface EntryEditHistoryRow {
  id: string
  entryIdOld: string | null
  entryIdNew: string | null
  // Nullable — this table family has legacy-null enum precedent (pre-taxonomy
  // rows). Never rendered with action-specific UI (uniform row rendering).
  action: EntryEditAction | null
  actorName: string | null
  contentBefore: string | null
  contentAfter: string | null
  createdAt: string
}

type SynqedEntryEditReadClient = Pick<SynqedClient, 'karuteRecords'>

const ENTRY_EDIT_HISTORY_PAGE_SIZE = 100
// Hard ceiling on the pagination loop below — regen passes write ~2
// rows/entry, so a heavily-regenerated record can cross the old
// single-page-of-100 ceiling this replaces. 10 pages at the size above;
// `truncated` tells the sheet when a record's REAL trail exceeds it.
// ponytail: hard-capped at 1000 rows, move to a "load more" UI if a record's
// trail ever needs more.
const ENTRY_EDIT_HISTORY_HARD_CAP = 1000

/**
 * Per-entry edit trail CORE — read-only, shared by the web wrapper below and
 * the facade GET route (…/karute/[id]/entry-edits). Paginates (page_size
 * 100) until the whole trail is fetched or the hard cap above, newest first.
 *
 * Name resolution is SERVER-side (denormalized-label idiom, audit-route
 * precedent — staffListByBusinessOrThrow's roster join): a roster failure
 * degrades every actorName to null, it NEVER throws — a staff-directory
 * hiccup must not take the whole history sheet down.
 */
export async function listEntryEditHistoryWithClient(
  synqed: SynqedEntryEditReadClient,
  businessId: string,
  karuteRecordId: string,
): Promise<{ edits: EntryEditHistoryRow[]; truncated: boolean }> {
  const raw: KaruteEntryEdit[] = []
  let page = 1
  let total = 0
  do {
    const res = await synqed.karuteRecords.listEntryEdits({
      karute_record_id: karuteRecordId,
      page,
      page_size: ENTRY_EDIT_HISTORY_PAGE_SIZE,
    })
    raw.push(...res.entry_edits)
    total = res.total
    page += 1
    // A short/empty page ends the loop even if `total` disagrees — never
    // spin forever chasing a count the server isn't actually delivering.
    if (res.entry_edits.length === 0) break
  } while (raw.length < total && raw.length < ENTRY_EDIT_HISTORY_HARD_CAP)

  // De-dup by id (fix round 2, delta-verify with core-source evidence): core
  // orders `created_at desc` with NO id tiebreak and plain offset paging — a
  // regen batch writes many rows with an IDENTICAL created_at, so a tie
  // straddling a page boundary can land on BOTH of two sequential fetches
  // (and a concurrent insert between fetches can shift the offset too, live
  // multi-staff app). `truncated` below is computed off this DEDUPED count,
  // not the raw fetch count, so a page's worth of loss from the same drift
  // shows up as `total > uniqueCount` — the sheet's honest partial note,
  // never a silent gap. Offset drift can still SKIP a row mid-flight; that
  // self-heals on reopen. Durable fix is core-side cursor pagination + an id
  // tiebreak (Anthony's side — not touched here).
  const seen = new Set<string>()
  const deduped = raw.filter((e) => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  const roster = await staffListByBusinessOrThrow(businessId).catch(() => [] as StaffMember[])
  const nameById = new Map(roster.map((s) => [s.id, s.full_name]))
  const edits = deduped
    // Defensive sort — core already returns newest first, but nothing here
    // depends on that holding forever. Id tiebreak makes a tied created_at
    // (the regen-batch case above) render in a STABLE order across renders.
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .map((e) => ({
      id: e.id,
      entryIdOld: e.entry_id_old ?? null,
      entryIdNew: e.entry_id_new ?? null,
      action: e.action ?? null,
      actorName: (e.actor_staff_id ? nameById.get(e.actor_staff_id) : null) ?? null,
      contentBefore: e.content_before,
      contentAfter: e.content_after,
      createdAt: e.created_at,
    }))
  return { edits, truncated: total > edits.length }
}
