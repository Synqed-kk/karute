'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { coreFailureLine } from '@/lib/auth/core-failure-line'
import { auditWeb } from '@/lib/audit-web'
import { describeUnknownThrow } from '@/lib/app-api/errors'
import { getCurrentUserStaffId } from '@/lib/staff'
import { parsePhotoUploadFields } from '@/lib/karute/photo-upload-fields'
import type { CustomerOption, CustomerSearchOption } from '@/components/karute/CustomerCombobox'
import type { CachedCustomerOption } from '@/lib/customers/cached'
import {
  CUSTOMER_SEARCH_LIMIT,
  matchKaruteNumber,
  foldKaruteNumberQuery,
} from '@/lib/customers/karute-number-match'
// The eight client-threaded cores left this file for a server-only module
// (PKT-SEC-CORES-D1, 2026-09-23): every runtime export here is a
// browser-callable server action with no authentication of its own, and these
// take an already-scoped client. Never re-export them from this file.
// translateBackendError and the CustomerFormInput type came back with them —
// they are the cores' own, read by the wrappers that stayed.
import {
  cancelCustomerDeletionWithClient,
  createCustomerWithClient,
  createQuickCustomerWithClient,
  grantCustomerConsentWithClient,
  revokeCustomerConsentWithClient,
  scheduleCustomerDeletionWithClient,
  translateBackendError,
  updateCustomerWithClient,
  uploadCustomerPhotoWithClient,
  type CustomerFormInput,
} from '@/lib/customers/customers.core'

// Type ALIASES, not `export type { … } from` re-exports: Next's 'use server'
// transform registers every export NAME as a server reference at runtime, and
// a re-exported type name has no runtime binding → ReferenceError at build
// (the same note sits over MarkNoShowResult in src/actions/appointments.ts,
// and over StoreRow in src/actions/stores.ts). Each shape lives with the core
// that produces it; this file keeps publishing the names it always published.
export type ActionResult = import('@/lib/customers/customers.core').ActionResult
export type PartialCustomerInput = import('@/lib/customers/customers.core').PartialCustomerInput
export type QuickCustomerResult = import('@/lib/customers/customers.core').QuickCustomerResult

// ---------------------------------------------------------------------------
// createCustomer
// ---------------------------------------------------------------------------

/** The WEB door onto the twin in lib/customers/customers.core.ts: the cookie
 *  identity's client, the two cache invalidations (Server-Action-only) and the
 *  success-only audit row. The collision/validation returns never reach them —
 *  the early return is the shared body's own `{ success: false }`. */
/** The customer-profile WRITE gate (⚖ Liam 2026-09-16). Checked with can(),
 *  not requireCapability(), because these actions return the house
 *  { success:false, error } shape and their callers await them WITHOUT a
 *  try/catch — the same contract createAppointment's own gate documents.
 *
 *  ⚠ CAPABILITY ONLY, deliberately: customers carry NO store_id (identity is
 *  business-wide, list-all.ts's own header), so "is this customer a member of
 *  MY store?" has no answer in this app today — membership is DERIVED from
 *  events inside core. That store rule waits for core's membership change and
 *  is NOT in this door. */
/** Staff-visible, so it is TRANSLATED, never a literal: this string is returned
 *  straight into the house `{ success:false, error }` shape the customer form
 *  toasts. It reuses the app's existing generic refusal
 *  (`common.noPermission` — 「この操作を行う権限がありません。」, already
 *  born-native in messages/ja.json and shipped in en.json) rather than minting a
 *  fourth wording of the same sentence: the screen the staff member is looking
 *  at names the act, so the line only has to name the missing permission. */
async function customerWriteDenied(): Promise<string> {
  return (await getTranslations('common'))('noPermission')
}

export async function createCustomer(input: CustomerFormInput): Promise<ActionResult> {
  // Round 3 leg 7b (D-S28-1): the gate's own THROW settles too — the same answer
  // as this file's leg-7 sibling (deleteCustomerPhoto's catch): a typed core
  // outage/defect is the failure line, anything else its own message. The try
  // holds the can() call only; the denial stays below it.
  let allowed: boolean
  try {
    allowed = await can('customers.manage')
  } catch (err) {
    return { success: false, error: (await coreFailureLine(err, '[customers]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
  if (!allowed) {
    return { success: false, error: await customerWriteDenied() }
  }
  const synqed = await getSynqedClient()
  const result = await createCustomerWithClient(synqed, input)
  if (!result.success) return { success: false, error: result.error }

  revalidatePath('/customers')
  updateTag('customers')

  // Success only, after the write settles (never on the shared body's own
  // email-collision return).
  await auditWeb({
    category: 'customer',
    action: 'customer.create',
    targetType: 'customer',
    targetId: result.id,
    severity: 'info',
    requestId: crypto.randomUUID(),
  })

  return result
}

// ---------------------------------------------------------------------------
// createQuickCustomer
// ---------------------------------------------------------------------------

/** The WEB door onto its twin in lib/customers/customers.core.ts — same
 *  wrapper duties as createCustomer. */
export async function createQuickCustomer(name: string): Promise<QuickCustomerResult> {
  let allowed: boolean
  try {
    allowed = await can('customers.manage')
  } catch (err) {
    return { success: false, error: (await coreFailureLine(err, '[customers]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
  if (!allowed) {
    return { success: false, error: await customerWriteDenied() }
  }
  const synqed = await getSynqedClient()
  const result = await createQuickCustomerWithClient(synqed, name)
  if (!result.success) return { success: false, error: result.error }

  revalidatePath('/customers')
  updateTag('customers')

  // Quick-create is the same customer.create action as the full form
  // (packet 30 §2) — one create pathway, one action name.
  await auditWeb({
    category: 'customer',
    action: 'customer.create',
    targetType: 'customer',
    targetId: result.id,
    severity: 'info',
    requestId: crypto.randomUUID(),
  })

  return result
}

// ---------------------------------------------------------------------------
// updateCustomer
// ---------------------------------------------------------------------------

export async function updateCustomer(
  id: string,
  input: CustomerFormInput | Record<string, unknown>,
): Promise<ActionResult> {
  let allowed: boolean
  try {
    allowed = await can('customers.manage')
  } catch (err) {
    return { success: false, error: (await coreFailureLine(err, '[customers]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
  if (!allowed) {
    return { success: false, error: await customerWriteDenied() }
  }
  const synqed = await getSynqedClient()
  const result = await updateCustomerWithClient(synqed, id, input as Record<string, unknown>)
  if (result.success) {
    revalidatePath('/customers')
    revalidatePath(`/customers/${id}`)
    updateTag('customers')
    // Web-only emit: the facade PATCH pathway already logs customer.edit via
    // FACADE_AUDIT_MAP ('customer.update' → mutation) — updateCustomerWithClient
    // is the SHARED core both callers use, so the writer stays here, not there,
    // to avoid double-logging the facade path.
    await auditWeb({
      category: 'customer',
      action: 'customer.edit',
      targetType: 'customer',
      targetId: id,
      severity: 'info',
      requestId: crypto.randomUUID(),
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// 30-day customer deletion (schedule / cancel) — APPI erasure flow
// ---------------------------------------------------------------------------
// The old immediate deleteCustomer action is GONE (it was UI-unreachable, its
// appointment pre-delete loop is obsolete since core owns the cascade, and as
// an exported server action it was an unaudited instant-delete bypass of this
// window). NO hard delete exists anywhere (Liam ruling 2026-07-19: core
// retains all customer data permanently) — deleted_at only hides the customer
// from the app; the 30-day window bounds the in-app undo, nothing more.

async function emitDeletionAudit(
  action: 'privacy.customer_delete_scheduled' | 'privacy.customer_delete_canceled',
  customerId: string,
): Promise<void> {
  // Inline actor/business resolution — auditWeb() arrives with PR #539; this
  // stays dependency-free of that parked branch.
  const { audit } = await import('@/lib/audit')
  const { getCurrentUserStaffId, getBusinessId } = await import('@/lib/staff')
  audit({
    category: 'privacy',
    action,
    actorId: await getCurrentUserStaffId().catch(() => null),
    actorType: 'staff',
    businessId: await getBusinessId().catch(() => null),
    targetType: 'customer',
    targetId: customerId,
    severity: action === 'privacy.customer_delete_scheduled' ? 'warning' : 'notice',
    requestId: crypto.randomUUID(),
    source: 'web',
  })
}

/** Schedule deletion: sets core deleted_at = now. The customer drops from
 *  lists (core filters soft-deleted) and the profile banner starts the 30-day
 *  undo countdown. Data is retained in core forever; day 30 only closes the
 *  in-app undo. Error strings are codes the client maps to i18n. */
export async function scheduleCustomerDeletion(id: string): Promise<ActionResult> {
  try {
    // records.delete — owner / manager / senior only. Mirrors deleteKaruteRecord.
    await requireCapability('records.delete')
    // Roster check, the grantCustomerConsent posture (#452) ported here on the
    // lane lead's ruling: a stale-session records.delete holder used to
    // schedule an erasure that emitDeletionAudit filed with actorId:null —
    // an unattributable record of the one act a customer can legally demand,
    // and the facade door 403s the same caller. Refused BEFORE the write, so
    // emitDeletionAudit is unreachable from here. The refusal is the union's
    // own 'failed' (the consent sibling's { ok: false, error } spelled in this
    // union's vocabulary): the existing deleteFailed toast keeps working, and
    // a distinct code would be a new i18n string this packet may not add.
    if (!(await getCurrentUserStaffId())) {
      return { success: false, error: 'failed' }
    }
    const synqed = await getSynqedClient()

    const result = await scheduleCustomerDeletionWithClient(synqed, id)
    // Guard refusal or core failure — nothing was written, so no row and no
    // revalidation, at exactly the points the pre-split body returned.
    if (!result.success) return result

    await emitDeletionAudit('privacy.customer_delete_scheduled', id)
    revalidatePath('/customers')
    revalidatePath(`/customers/${id}`)
    updateTag('customers')
    return result
  } catch (err) {
    console.error('[scheduleCustomerDeletion] error:', err)
    return { success: false, error: 'failed' }
  }
}

/** Undo within the window: nulls deleted_at. Rejects once the deadline has
 *  passed — the sweep may already be destroying records, and a cancel that
 *  "succeeds" seconds before hard delete would lie to the staff. */
export async function cancelCustomerDeletion(id: string): Promise<ActionResult> {
  try {
    await requireCapability('records.delete')
    // Same roster check, same ruling as the schedule wrapper above — the undo
    // is as attributable an act as the schedule, and both doors now agree.
    if (!(await getCurrentUserStaffId())) {
      return { success: false, error: 'failed' }
    }
    const synqed = await getSynqedClient()

    const result = await cancelCustomerDeletionWithClient(synqed, id)
    if (!result.success) return result

    await emitDeletionAudit('privacy.customer_delete_canceled', id)
    revalidatePath('/customers')
    revalidatePath(`/customers/${id}`)
    updateTag('customers')
    return result
  } catch (err) {
    console.error('[cancelCustomerDeletion] error:', err)
    return { success: false, error: 'failed' }
  }
}

// ---------------------------------------------------------------------------
// Customer photos
// ---------------------------------------------------------------------------

export async function listCustomerPhotos(customerId: string) {
  const synqed = await getSynqedClient()
  return synqed.customers.listPhotos(customerId)
}

export async function uploadCustomerPhoto(
  customerId: string,
  formData: FormData,
) {
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided' }

  const category = formData.get('category')
  const caption = formData.get('caption')
  const { recording_session_id, taken_with_consent } = parsePhotoUploadFields(formData)

  try {
    const synqed = await getSynqedClient()
    // captured_by_staff_id is SERVER-RESOLVED — never trust client input for
    // attribution (mirrors the facade route's resolveSelfStaffId pattern).
    const captured_by_staff_id = (await getCurrentUserStaffId()) ?? undefined
    const photo = await uploadCustomerPhotoWithClient(synqed, customerId, file, {
      category: typeof category === 'string' ? category : undefined,
      caption: typeof caption === 'string' ? caption : undefined,
      recording_session_id,
      captured_by_staff_id,
      taken_with_consent,
    })
    revalidatePath(`/customers/${customerId}`)
    return { photo }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function deleteCustomerPhoto(
  customerId: string,
  photoId: string,
) {
  try {
    // records.delete — owner / manager / senior only. Mirrors scheduleCustomerDeletion /
    // deleteKaruteRecord (Liam ruling 8/9: photo delete = same destructive tier).
    await requireCapability('records.delete')
    const synqed = await getSynqedClient()
    // Parity with the facade DELETE route: tenancy proof on the customer, then
    // ownership proof that photoId is actually theirs — both BEFORE the core
    // delete. They throw AppApiError, which the catch below turns into this
    // action's own { success: false, error } contract.
    // Imported lazily (same pattern as grantCustomerConsent's staff import):
    // a static import drags customer-facade's whole graph into every module
    // that touches this file, which breaks unrelated suites' module walls.
    const { proveCustomerInBusiness, provePhotoForCustomer } = await import(
      '@/lib/app-api/customer-facade'
    )
    await proveCustomerInBusiness(synqed, customerId)
    await provePhotoForCustomer(synqed, customerId, photoId)
    await synqed.customers.deletePhoto(customerId, photoId)
    revalidatePath(`/customers/${customerId}`)
    return { success: true as const }
  } catch (err) {
    return {
      success: false as const,
      error: (await coreFailureLine(err, '[customers]')) ?? (err instanceof Error ? err.message : 'Unknown error'),
    }
  }
}

// ---------------------------------------------------------------------------
// Recording consent
// ---------------------------------------------------------------------------

// RECORDING_CONSENT_POLICY_VERSION lives in @/lib/consent (client-safe single
// source of truth) — a 'use server' module can't export a plain const, and the
// recording gate (client) must compare against the same value.

export async function getCustomerConsent(customerId: string) {
  const synqed = await getSynqedClient()
  return synqed.customers.getConsent(customerId)
}

export async function grantCustomerConsent(
  customerId: string,
  input: { method?: 'VERBAL' | 'WRITTEN' } = {},
) {
  const { getCurrentUserStaffId } = await import('@/lib/staff')
  let staffId: string | null
  try {
    staffId = await getCurrentUserStaffId()
  } catch (err) {
    // Round 3 leg 6 (2026-09-25): a roster outage answers the action's own failure shape, never a rejection.
    console.error('[customers] pre-core read failed (roster):', describeUnknownThrow(err))
    return { ok: false as const, error: (await getTranslations('common'))('somethingWentWrong') }
  }
  if (!staffId) {
    return {
      ok: false as const,
      error: 'No staff identity for the signed-in user.',
    }
  }
  try {
    const synqed = await getSynqedClient()
    const consent = await grantCustomerConsentWithClient(
      synqed,
      customerId,
      staffId,
      input.method ?? 'VERBAL',
    )
    revalidatePath(`/customers/${customerId}`)
    updateTag('customer-consent')
    // Wave W3: the web twin of the facade customer.consent.grant row (that
    // side is the generic success hook) — success only, never on the
    // no-staff/error returns.
    await auditWeb({
      category: 'customer',
      action: 'customer.consent_grant',
      targetType: 'customer',
      targetId: customerId,
      requestId: crypto.randomUUID(),
    })
    return { ok: true as const, consent }
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

export async function revokeCustomerConsent(customerId: string) {
  const { getCurrentUserStaffId } = await import('@/lib/staff')
  let staffId: string | null
  try {
    staffId = await getCurrentUserStaffId()
  } catch (err) {
    // Round 3 leg 6 (2026-09-25): a roster outage answers the action's own failure shape, never a rejection.
    console.error('[customers] pre-core read failed (roster):', describeUnknownThrow(err))
    return { ok: false as const, error: (await getTranslations('common'))('somethingWentWrong') }
  }
  if (!staffId) {
    return { ok: false as const, error: 'No staff identity for the signed-in user.' }
  }
  try {
    const synqed = await getSynqedClient()
    await revokeCustomerConsentWithClient(synqed, customerId, staffId)
    revalidatePath(`/customers/${customerId}`)
    updateTag('customer-consent')
    // Wave W3: the web twin of the facade customer.consent.revoke row.
    await auditWeb({
      category: 'customer',
      action: 'customer.consent_revoke',
      targetType: 'customer',
      targetId: customerId,
      requestId: crypto.randomUUID(),
    })
    return { ok: true as const }
  } catch (err) {
    // Same policy as the other mutating actions in this file: never leak a
    // raw Prisma/synqed-core message into a user-facing toast.
    return { ok: false as const, error: await translateBackendError(err) }
  }
}

/**
 * Company-wide customer search (⚖ Liam 2026-09-16, P3 cross-branch search) —
 * the REMOTE tier behind CustomerCombobox's/RecordCustomerPickerDialog's
 * onRemoteSearch: their local filter over the preloaded store-lensed list
 * runs first and stays instant; this backs the "find ANY company customer"
 * half. Read-only — booking/karute creation from a picked row still writes
 * at the actor's OWN store, which P1 already allows. ReassignCustomerAction
 * does not use this (excluded — reassigning a karute to another store's
 * customer is the write P1 refuses).
 */
export async function searchCustomersCompanyWide(
  query: string,
): Promise<
  | { options: CustomerSearchOption[]; karute_number_unavailable: boolean; remote_more: boolean }
  | { error: string }
> {
  try {
    await requireCapability('customers.view')
    const q = query.trim()
    if (!q) return { options: [], karute_number_unavailable: false, remote_more: false }

    // Lazy imports (same convention as revokeCustomerConsent above): these
    // pull in store-scope.ts's / cached.ts's own SynqedClient chains, which
    // every OTHER action in this file has no reason to carry as a permanent
    // module-load cost.
    const { resolveStoreScope, customerLensFor } = await import('@/lib/auth/store-scope')
    const { getCachedCustomerList } = await import('@/lib/customers/cached')
    const [synqed, scope] = await Promise.all([getSynqedClient(), resolveStoreScope()])
    const enforceStore = scope.allowedStoreIds != null
    const lens = customerLensFor(scope)

    // Eligibility FIRST (Greptile fold): the business-wide cache scan is only
    // useful for a karute-number term, so an ordinary name search never pays
    // for loading it.
    const karuteQuery = foldKaruteNumberQuery(q)

    // "other_store" = not in the CALLER's own store-lensed preloaded list —
    // the same cached list their combobox was already seeded with (no core
    // membership call). Unclamped viewers are already preloaded business-wide,
    // so nothing this search returns can ever be "other store" for them.
    //
    // Each cache read is settled on its OWN and its OUTCOME kept (ok/failed),
    // not collapsed to a bare value — a failure here must read as UNKNOWN,
    // never silently as "own store"/"no karute match" (Greptile fold: the
    // prior .catch(() => null) made a failed lens read indistinguishable from
    // "not attempted", so a foreign customer could ship with no 他店舗 chip).
    const settleCache = (p: Promise<CachedCustomerOption[]> | null) =>
      p ? p.then((rows) => ({ ok: true as const, rows })).catch(() => ({ ok: false as const })) : Promise.resolve(null)
    const [searchRes, ownResult, businessResult] = await Promise.all([
      // +1 (F-2 fold, ⚖ Liam 2026-09-16): a probe row so the cap below can
      // tell "exactly 8" from "8 shown, more exist" — the source of truth
      // for remote_more, never the SDK's own total.
      synqed.customers.list({ search: q, page_size: CUSTOMER_SEARCH_LIMIT + 1 }),
      settleCache(enforceStore && lens !== null ? getCachedCustomerList(lens) : null),
      settleCache(karuteQuery ? getCachedCustomerList() : null),
    ])
    // null = not attempted (unclamped, or no karute-number term) — a real
    // answer, not a failure. ownIds stays null on either "not attempted" OR
    // "failed"; the caller can't tell those apart from ownIds alone, which is
    // exactly why other_store below reads `enforceStore` too, not just ownIds.
    const ownIds = ownResult?.ok ? new Set(ownResult.rows.map((c) => c.id)) : null
    const businessWide = businessResult?.ok ? businessResult.rows : []
    const karuteNumberUnavailable = karuteQuery != null && !businessResult?.ok

    const rows: CustomerOption[] = searchRes.customers.map((c) => ({
      id: c.id,
      name: c.name,
      furigana: c.furigana,
      phone: c.phone,
    }))
    // Karute number ahead of the name/phone matches — a hit already present
    // (digits also matched a phone number) is just reordered, never duplicated.
    const karuteHits = matchKaruteNumber(q, businessWide)
    const hitIds = new Set(karuteHits.map((h) => h.id))
    const merged: CustomerOption[] = [
      ...karuteHits.map((h) => ({ id: h.id, name: h.name, furigana: h.furigana, phone: h.phone })),
      ...rows.filter((r) => !hitIds.has(r.id)),
    ]
    // F-2 fold (Greptile, PR #945): the remote tier was capping at
    // CUSTOMER_SEARCH_LIMIT with no signal at all — computed AFTER the
    // karute-number merge, off the +1 probe above (⚖ 8/25: numbers explain
    // themselves; nothing hidden silently).
    const remoteMore = merged.length > CUSTOMER_SEARCH_LIMIT

    // true/false only once the lens read actually succeeded; enforceStore
    // with no usable ownIds (lens failed, or had nothing to look up) is
    // UNKNOWN — never defaults to false ("confirmed own store").
    const otherStoreFor = (id: string): boolean | null => {
      if (!enforceStore) return false
      if (!ownIds) return null
      return !ownIds.has(id)
    }
    const options: CustomerSearchOption[] = merged
      .slice(0, CUSTOMER_SEARCH_LIMIT)
      .map((r) => ({ ...r, other_store: otherStoreFor(r.id) }))
    return { options, karute_number_unavailable: karuteNumberUnavailable, remote_more: remoteMore }
  } catch (err) {
    return { error: (await coreFailureLine(err, '[customers]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
}
