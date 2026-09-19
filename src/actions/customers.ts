'use server'

import { z } from 'zod'
import { revalidatePath, updateTag } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'
import { auditWeb } from '@/lib/audit-web'
import { getCurrentUserStaffId } from '@/lib/staff'
import { parsePhotoUploadFields } from '@/lib/karute/photo-upload-fields'
import type { CustomerOption, CustomerSearchOption } from '@/components/karute/CustomerCombobox'
import type { CachedCustomerOption } from '@/lib/customers/cached'
import {
  CUSTOMER_SEARCH_LIMIT,
  matchKaruteNumber,
  foldKaruteNumberQuery,
} from '@/lib/customers/karute-number-match'

// ---------------------------------------------------------------------------
// Backend error → user-facing message
// ---------------------------------------------------------------------------

/**
 * Translate raw backend errors (Prisma / synqed-core throws) into
 * locale-aware messages the form's toast can safely display.
 *
 * The synqed-core service layer propagates Prisma errors verbatim
 * (e.g. ``Unique constraint failed on the fields: (`business_id`,
 * `email`)``). Showing that to a user is both ugly and a minor info
 * leak (column names, stack frames). This helper pattern-matches the
 * common shapes and falls back to a generic "save failed" message
 * so users never see Prisma internals.
 *
 * Raw error is still surfaced to server logs in the caller so
 * Anthony can debug from the synqed-core side.
 */
async function translateBackendError(err: unknown): Promise<string> {
  const message = err instanceof Error ? err.message : String(err)
  const t = await getTranslations('customers.form')
  if (/Unique constraint failed.*\bemail\b/i.test(message)) {
    return t('duplicateEmail')
  }
  if (/Unique constraint failed.*\bphone\b/i.test(message)) {
    return t('duplicatePhone')
  }
  return t('saveFailedGeneric')
}

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const CustomerFormSchema = z.object({
  // Rider (F4 §2h): .min(1) alone checks LENGTH, not non-whitespace — a
  // three-space name passed validation untouched (no .trim() anywhere on
  // this path) and rode into a recording target's customerName, landing
  // blank in the DiscreetRecordingIndicator popover (that display seam is
  // hardened separately). Trim BEFORE the length check, same as
  // createQuickCustomer's trim+reject below.
  name: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Name is required').max(100)),
  furigana: z.string().max(100).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  // 指名スタッフ — the customer's standing assigned/preferred stylist
  // (a synqed profile id). '' = 指名なし → stored as null. Kept lenient
  // (no .uuid()) so a profile-less staff's fallback id still validates; the
  // DB FK is the real guard. Optional so the quick-create path + older
  // callers that omit it still parse.
  assigned_staff_id: z.string().max(100).optional().or(z.literal('')),
  // 生年月日 ('YYYY-MM-DD') + 性別 ('male' | 'female' | ''). Editable by staff and
  // seeded by the deep crawl — synqed-core accepts both on create/update (the
  // crawl writes them the same way). Age is DERIVED from DOB at render, never
  // stored. '' → null.
  date_of_birth: z.string().max(10).optional().or(z.literal('')),
  gender: z.string().max(10).optional().or(z.literal('')),
  // 職業 + 会員番号 — CRM fields seeded by the deep crawl, also staff-editable. '' → null.
  occupation: z.string().max(100).optional().or(z.literal('')),
  member_number: z.string().max(100).optional().or(z.literal('')),
})

type CustomerFormInput = z.infer<typeof CustomerFormSchema>

// Strict partial-update schema (packet 03, gap 3). The old partial path forwarded
// `input as Record<string, unknown>` straight to synqed-core — any caller-supplied
// key (e.g. tenant/business columns, visit counters) rode through unchecked.
// `.strict()` REJECTS unknown keys so only these whitelisted, typed fields are
// ever written on a partial update.
const PartialCustomerSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100),
    furigana: z.string().max(100),
    phone: z.string().max(20),
    email: z.string().email('Invalid email address').or(z.literal('')),
    notes: z.string().max(4000),
    assigned_staff_id: z.string().max(100),
    date_of_birth: z.string().max(10),
    gender: z.string().max(10),
    occupation: z.string().max(100),
    member_number: z.string().max(100),
  })
  .partial()
  .strict()

export type PartialCustomerInput = z.infer<typeof PartialCustomerSchema>

// Fields whose '' sentinel means "clear to null" at the core boundary.
const NULLABLE_PARTIAL_KEYS: (keyof PartialCustomerInput)[] = [
  'furigana', 'phone', 'email', 'assigned_staff_id', 'date_of_birth', 'gender', 'occupation', 'member_number',
]

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export type ActionResult =
  | { success: true; id: string; duplicateWarning?: string }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// createCustomer
// ---------------------------------------------------------------------------

/**
 * Shared create service — takes an EXPLICIT business-scoped client so BOTH the
 * web server action (cookie identity) AND the facade POST handler (Bearer
 * identity) run the identical parse, duplicate check, core write and
 * email-collision guard. Same P-B split as updateCustomerWithClient below.
 *
 * Cache invalidation and the audit row stay OUT of here, with the callers:
 * updateTag is Server-Action-only (it throws from a Route Handler — see
 * updateCustomerWithClient's note), and the facade's customer.create row is
 * emitted by logFacadeAudit off FACADE_AUDIT_MAP.
 *
 * ⚖ STORE ISOLATION LAW: nothing here reads a store — creation is scoped by
 * the client's business alone, exactly as web does it. Both doors hand this
 * body a business-scoped client (cookie business / Bearer business), so the
 * scope cannot drift between them.
 */
export async function createCustomerWithClient(
  synqed: Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>,
  // `unknown`, like updateCustomerWithClient's own input: the facade door hands
  // this raw JSON off the wire, and CustomerFormSchema below is the ONE parse
  // both doors run. TWO independent guards keep a smuggled business_id /
  // store_id / visit_count out of core, and the load-bearing one is the
  // SECOND: (1) CustomerFormSchema is a z.object, which strips unknown keys at
  // the parse, and (2) the create payload below is an explicit field list, not
  // a spread — proven by mutation (a `...input` spread there turns the
  // store-isolation assertion red; passthrough alone does not).
  input: unknown,
): Promise<ActionResult> {
  const parsed = CustomerFormSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((e) => e.message).join(', '),
    }
  }

  const { name, furigana, phone, email, assigned_staff_id, date_of_birth, gender, occupation, member_number } = parsed.data

  try {
    // Check for duplicate name — warn but allow creation
    let duplicateWarning: string | undefined
    const dup = await synqed.customers.checkDuplicate(name)
    if (dup.exists && dup.existing_name) {
      duplicateWarning = `A customer named "${dup.existing_name}" already exists`
    }

    const customer = await synqed.customers.create({
      name,
      furigana: furigana || null,
      phone: phone || null,
      email: email || null,
      assigned_staff_id: assigned_staff_id || null,
      date_of_birth: date_of_birth || null,
      gender: gender || null,
      occupation: occupation || null,
      member_number: member_number || null,
    })

    // synqed-core dedups create on (business_id, email): an email that already
    // exists returns THAT customer instead of creating a new one. For a manual
    // add that means a typed-new person silently resolved to an existing,
    // different record — surface it as an error rather than adopting it.
    // Compare names normalized — NFKC folds full-width↔half-width (incl. the
    // full-width space common in 「姓　名」), and trim/collapse/case cover
    // cosmetic drift — so a genuine same-person re-add isn't flagged as a
    // collision just because the typed name differs in formatting.
    const normName = (s: string) =>
      s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
    if (email && normName(customer.name) !== normName(name)) {
      return {
        success: false,
        error: `The email "${email}" is already registered to "${customer.name}"`,
      }
    }

    return { success: true, id: customer.id, ...(duplicateWarning ? { duplicateWarning } : {}) }
  } catch (err) {
    // Keep the raw error in the server log so Anthony can debug; show
    // the user a clean translated message via translateBackendError.
    console.error('[createCustomer] backend error:', err)
    return { success: false, error: await translateBackendError(err) }
  }
}

/** The WEB door onto the twin above: the cookie identity's client, the two
 *  cache invalidations (Server-Action-only) and the success-only audit row.
 *  The collision/validation returns never reach them — the early return is
 *  the shared body's own `{ success: false }`. */
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
  if (!(await can('customers.manage'))) {
    return { success: false, error: await customerWriteDenied() }
  }
  const synqed = await getSynqedClient()
  const result = await createCustomerWithClient(synqed, input)
  if (!result.success) return { success: false, error: result.error }

  revalidatePath('/customers')
  updateTag('customers')

  // Success only, after the write settles (never on the collision return above).
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

export type QuickCustomerResult =
  | { success: true; id: string; name: string }
  | { success: false; error: string }

/** Quick-create's shared service — the same P-B split as
 *  createCustomerWithClient above, and deliberately its own body: the
 *  name-only path runs NO duplicate check and echoes core's stored name back
 *  for the picker to select. Folding it into the full-form body would make
 *  the phone's quick-create do something the web's never does. */
export async function createQuickCustomerWithClient(
  synqed: Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>,
  name: string,
): Promise<QuickCustomerResult> {
  const trimmedName = name.trim()
  if (!trimmedName) {
    return { success: false, error: 'Name is required' }
  }
  if (trimmedName.length > 100) {
    return { success: false, error: 'Name must be 100 characters or fewer' }
  }

  try {
    const customer = await synqed.customers.create({ name: trimmedName })
    return { success: true, id: customer.id, name: customer.name }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/** The WEB door onto the twin above — same wrapper duties as createCustomer. */
export async function createQuickCustomer(name: string): Promise<QuickCustomerResult> {
  if (!(await can('customers.manage'))) {
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

/**
 * Shared update service — takes an EXPLICIT business-scoped client so BOTH the
 * web server action (cookie identity) AND the facade PATCH handler (Bearer
 * identity) run the identical strict validation + core write. All input goes
 * through PartialCustomerSchema.strict(): unknown keys are rejected, never
 * forwarded (packet 03, gap 3). Presence-guarded so a partial save (e.g. a
 * booking-memo `{ notes }`) never wipes fields it didn't send.
 */
export async function updateCustomerWithClient(
  synqed: Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>,
  id: string,
  input: Record<string, unknown>,
): Promise<ActionResult> {
  const parsed = PartialCustomerSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((e) => e.message).join(', ') }
  }
  const data = parsed.data

  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    // '' clears a nullable field to null; name/notes pass through as-is.
    patch[key] = (NULLABLE_PARTIAL_KEYS as string[]).includes(key)
      ? (value as string) || null
      : value
  }

  try {
    await synqed.customers.update(id, patch)
    // No cache invalidation here: updateTag is Server-Action-only (throws from
    // a Route Handler), and the customer PATCH facade route calls this core
    // directly — the write would land but the response would report failure.
    // The web wrapper below owns revalidatePath/updateTag.
    return { success: true, id }
  } catch (err) {
    console.error('[updateCustomer] backend error:', err)
    return { success: false, error: await translateBackendError(err) }
  }
}

export async function updateCustomer(
  id: string,
  input: CustomerFormInput | Record<string, unknown>,
): Promise<ActionResult> {
  if (!(await can('customers.manage'))) {
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

/** Read deleted_at off an SDK customer row. SDK-skew cast (same pattern as
 *  first_visit_at in queries.ts): the field shipped in core/SDK 1.13. */
function customerDeletedAt(c: object): string | null {
  return (c as { deleted_at?: string | null }).deleted_at ?? null
}

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

/** Deletion-SCHEDULE core — business-scoped client, no cookie. Shared by the
 *  web action (cookie identity → requireCapability) and the facade POST
 *  (Bearer identity → ensureCapability), so the two doors cannot answer the
 *  same customer differently. Audit-free, the same Core/WithClient split
 *  grantCustomerConsentWithClient documents: the WEB wrapper emits the
 *  privacy.* row (emitDeletionAudit hardcodes source:'web' — it belongs to
 *  the cookie door and nowhere else), the facade's own hook emits its row.
 *  Never throws: the `error` strings are the codes both UIs map to i18n. */
export async function scheduleCustomerDeletionWithClient(
  synqed: Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>,
  id: string,
): Promise<ActionResult> {
  try {
    // Never restart a running clock: re-scheduling would push the deadline out.
    const existing = await synqed.customers.get(id)
    if (customerDeletedAt(existing)) {
      return { success: false, error: 'already_scheduled' }
    }

    await synqed.customers.update(id, {
      deleted_at: new Date().toISOString(),
    } as Parameters<typeof synqed.customers.update>[1])

    return { success: true, id }
  } catch (err) {
    console.error('[scheduleCustomerDeletion] error:', err)
    return { success: false, error: 'failed' }
  }
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

/** Deletion-CANCEL core — the schedule twin above, same split and same
 *  reasons: shared body, audit-free, never throws. */
export async function cancelCustomerDeletionWithClient(
  synqed: Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>,
  id: string,
): Promise<ActionResult> {
  try {
    const existing = await synqed.customers.get(id)
    const deletedAt = customerDeletedAt(existing)
    if (!deletedAt) {
      return { success: false, error: 'not_scheduled' }
    }
    const { undoDeadlineMs } = await import('@/lib/customers/deletion')
    if (Date.now() > undoDeadlineMs(deletedAt)) {
      return { success: false, error: 'window_expired' }
    }

    await synqed.customers.update(id, {
      deleted_at: null,
    } as Parameters<typeof synqed.customers.update>[1])

    return { success: true, id }
  } catch (err) {
    console.error('[cancelCustomerDeletion] error:', err)
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

/** Photo-upload core — business-scoped client, no cookie. Shared by the web
 *  action and the facade route (which validates the file at the trust boundary
 *  BEFORE calling this). Throws on backend failure; callers classify. */
export async function uploadCustomerPhotoWithClient(
  synqed: Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>,
  customerId: string,
  file: File,
  options: {
    category?: string
    caption?: string
    recording_session_id?: string
    captured_by_staff_id?: string
    taken_with_consent?: boolean
  } = {},
) {
  try {
    return await synqed.customers.uploadPhoto(customerId, file, options)
  } catch (err) {
    // Retry ONLY fetch()'s own network rejection — undici's invariant
    // TypeError('fetch failed'): no response headers ever arrived, so core
    // almost certainly never processed the write (8/1 field bug: intermittent
    // 502 in ~300ms, core logged nothing — suspect stale keep-alive socket;
    // undici evicts the dead socket, so the immediate retry dials fresh).
    // Everything else rethrows: a SynqedError means core answered, and a
    // res.json() failure AFTER a 2xx (SyntaxError / TypeError('terminated'))
    // means the photo IS saved — retrying those double-writes it. If undici
    // ever renames the message this degrades to no-retry, the pre-fix
    // behavior. ponytail: residual dup window (request delivered, connection
    // died pre-response-headers) closes only with core-side Idempotency-Key
    // dedup — asked; never widen this check without it.
    if (!(err instanceof TypeError && err.message === 'fetch failed')) throw err
    console.warn('[uploadCustomerPhoto] network-level failure, retrying once:', err)
    // The SDK builds a new FormData per call, so the File is safely re-sent.
    return synqed.customers.uploadPhoto(customerId, file, options)
  }
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
      error: err instanceof Error ? err.message : 'Unknown error',
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

/** Consent-grant core — business-scoped client + a RESOLVED staff id, no cookie.
 *  Shared by the web action (cookie identity → getCurrentUserStaffId) and the
 *  facade route (Bearer identity → selfStaffId). policy_version is SERVER-pinned
 *  here (never client-supplied). Throws on backend failure so each caller
 *  classifies (web → toast, facade → AppApiError). The #452 fail-closed posture
 *  (unresolvable staff id) is enforced by the CALLERS before they reach here —
 *  this core never runs without a staff id. */
export async function grantCustomerConsentWithClient(
  synqed: Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>,
  customerId: string,
  staffId: string,
  method: 'VERBAL' | 'WRITTEN',
) {
  return synqed.customers.grantConsent(customerId, {
    granted_by_staff_id: staffId,
    policy_version: RECORDING_CONSENT_POLICY_VERSION,
    method,
  })
}

export async function grantCustomerConsent(
  customerId: string,
  input: { method?: 'VERBAL' | 'WRITTEN' } = {},
) {
  const { getCurrentUserStaffId } = await import('@/lib/staff')
  const staffId = await getCurrentUserStaffId()
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

/** Consent-revoke core — business-scoped client + a RESOLVED staff id, no cookie.
 *  Shared by the web action (cookie identity → getCurrentUserStaffId) and the
 *  facade route (Bearer identity → selfStaffId). Throws on backend failure so
 *  each caller classifies (web → toast, facade → AppApiError). The #452 posture
 *  (fail closed on an unresolvable staff id) is enforced by the CALLERS before
 *  they reach here — this core never runs without a staff id. */
export async function revokeCustomerConsentWithClient(
  synqed: Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>,
  customerId: string,
  staffId: string,
): Promise<void> {
  await synqed.customers.revokeConsent(customerId, staffId)
}

export async function revokeCustomerConsent(customerId: string) {
  const { getCurrentUserStaffId } = await import('@/lib/staff')
  const staffId = await getCurrentUserStaffId()
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
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
