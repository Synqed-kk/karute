'use server'

import { z } from 'zod'
import { revalidatePath, updateTag } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { requireCapability } from '@/lib/auth/require-permission'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

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
  name: z.string().min(1, 'Name is required').max(100),
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

export async function createCustomer(input: CustomerFormInput): Promise<ActionResult> {
  const parsed = CustomerFormSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((e) => e.message).join(', '),
    }
  }

  const { name, furigana, phone, email, assigned_staff_id, date_of_birth, gender, occupation, member_number } = parsed.data

  try {
    const synqed = await getSynqedClient()

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

    revalidatePath('/customers')
    updateTag('customers')

    return { success: true, id: customer.id, ...(duplicateWarning ? { duplicateWarning } : {}) }
  } catch (err) {
    // Keep the raw error in the server log so Anthony can debug; show
    // the user a clean translated message via translateBackendError.
    console.error('[createCustomer] backend error:', err)
    return { success: false, error: await translateBackendError(err) }
  }
}

// ---------------------------------------------------------------------------
// createQuickCustomer
// ---------------------------------------------------------------------------

export async function createQuickCustomer(
  name: string,
): Promise<{ success: true; id: string; name: string } | { success: false; error: string }> {
  const trimmedName = name.trim()
  if (!trimmedName) {
    return { success: false, error: 'Name is required' }
  }
  if (trimmedName.length > 100) {
    return { success: false, error: 'Name must be 100 characters or fewer' }
  }

  try {
    const synqed = await getSynqedClient()
    const customer = await synqed.customers.create({ name: trimmedName })

    revalidatePath('/customers')
    updateTag('customers')

    return { success: true, id: customer.id, name: customer.name }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// listAssignableStaff — staff options for the 指名スタッフ picker in
// CustomerForm. Returns the tenant roster as {id, name}. Dynamic import keeps
// the staff/auth module off the rest of this server-action bundle (mirrors the
// pattern used by grantCustomerConsent below).
// ---------------------------------------------------------------------------

export async function listAssignableStaff(): Promise<{ id: string; name: string }[]> {
  try {
    const { getStaffList } = await import('@/lib/staff')
    const staff = await getStaffList()
    return staff.map((s) => ({ id: s.id, name: s.full_name ?? 'Unknown' }))
  } catch (err) {
    console.error('[listAssignableStaff] failed:', err)
    return []
  }
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
    revalidatePath('/customers')
    revalidatePath(`/customers/${id}`)
    updateTag('customers')
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
  const synqed = await getSynqedClient()
  return updateCustomerWithClient(synqed, id, input as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// 30-day customer deletion (schedule / cancel) — APPI erasure flow
// ---------------------------------------------------------------------------
// The old immediate deleteCustomer action is GONE (it was UI-unreachable, its
// appointment pre-delete loop is obsolete since core owns the cascade, and as
// an exported server action it was an unaudited instant-delete bypass of this
// window). Hard deletion now happens ONLY in the nightly sweep
// (/api/cleanup-deleted) at deleted_at + 30d.

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
    source: 'web',
  })
}

/** Schedule deletion: sets core deleted_at = now. The customer drops from
 *  lists (core filters soft-deleted), the profile banner starts the 30-day
 *  countdown, and the nightly sweep hard-deletes at day 30. Error strings are
 *  codes the client maps to i18n. */
export async function scheduleCustomerDeletion(id: string): Promise<ActionResult> {
  try {
    // records.delete — owner / manager / senior only. Mirrors deleteKaruteRecord.
    await requireCapability('records.delete')
    const synqed = await getSynqedClient()

    // Never restart a running clock: re-scheduling would push the deadline out.
    const existing = await synqed.customers.get(id)
    if (customerDeletedAt(existing)) {
      return { success: false, error: 'already_scheduled' }
    }

    await synqed.customers.update(id, {
      deleted_at: new Date().toISOString(),
    } as Parameters<typeof synqed.customers.update>[1])

    await emitDeletionAudit('privacy.customer_delete_scheduled', id)
    revalidatePath('/customers')
    revalidatePath(`/customers/${id}`)
    updateTag('customers')
    return { success: true, id }
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
    const synqed = await getSynqedClient()

    const existing = await synqed.customers.get(id)
    const deletedAt = customerDeletedAt(existing)
    if (!deletedAt) {
      return { success: false, error: 'not_scheduled' }
    }
    const { hardDeleteDeadlineMs } = await import('@/lib/customers/deletion')
    if (Date.now() > hardDeleteDeadlineMs(deletedAt)) {
      return { success: false, error: 'window_expired' }
    }

    await synqed.customers.update(id, {
      deleted_at: null,
    } as Parameters<typeof synqed.customers.update>[1])

    await emitDeletionAudit('privacy.customer_delete_canceled', id)
    revalidatePath('/customers')
    revalidatePath(`/customers/${id}`)
    updateTag('customers')
    return { success: true, id }
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
  options: { category?: string; caption?: string } = {},
) {
  return synqed.customers.uploadPhoto(customerId, file, options)
}

export async function uploadCustomerPhoto(
  customerId: string,
  formData: FormData,
) {
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided' }

  const category = formData.get('category')
  const caption = formData.get('caption')

  try {
    const synqed = await getSynqedClient()
    const photo = await uploadCustomerPhotoWithClient(synqed, customerId, file, {
      category: typeof category === 'string' ? category : undefined,
      caption: typeof caption === 'string' ? caption : undefined,
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
    const synqed = await getSynqedClient()
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
    const consent = await synqed.customers.grantConsent(customerId, {
      granted_by_staff_id: staffId,
      policy_version: RECORDING_CONSENT_POLICY_VERSION,
      method: input.method ?? 'VERBAL',
    })
    revalidatePath(`/customers/${customerId}`)
    updateTag('customer-consent')
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
    return { ok: true as const }
  } catch (err) {
    // Same policy as the other mutating actions in this file: never leak a
    // raw Prisma/synqed-core message into a user-facing toast.
    return { ok: false as const, error: await translateBackendError(err) }
  }
}
