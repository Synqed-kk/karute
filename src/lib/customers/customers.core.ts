import 'server-only'

// The eight client-threaded customer cores, moved out of
// src/actions/customers.ts (PKT-SEC-CORES-D1, 2026-09-23). Every runtime
// export of a 'use server' module is registered as a browser-callable server
// action with no authentication of its own — and passing a client object as
// the first argument is no barrier, because the reply decoder revives nested
// references. These eight are INTERNAL helpers: they take an already-scoped
// client and trust the caller to have gated the request. They live here, in a
// server-only module with NO directive, so the only way in is a server-side
// import — the web actions in src/actions/customers.ts and the facade routes
// under src/app/api/app/v1/customers/ (POST, quick, [id] PATCH,
// [id]/deletion/schedule, [id]/deletion/cancel, [id]/photos,
// [id]/consent/grant, [id]/consent/revoke).
//
// The private parse/translate/read helpers the eight need came with them. Two
// of them are read by functions that STAYED behind, so they are exported here
// and imported back rather than duplicated (⚖ one home per fact):
// translateBackendError (revokeCustomerConsent's toast) and CustomerFormInput
// (createCustomer/updateCustomer's parameter type). customerWriteDenied and
// emitDeletionAudit read the cookie session and belong to the web wrappers
// alone, so they stayed in the action file.

import { z } from 'zod'
import { getTranslations } from 'next-intl/server'

// Type-only: the eight signatures name the client shape as
// Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>, and this
// module must not pull the cookie-session client into its runtime graph.
import type { getSynqedClient } from '@/lib/synqed/client'
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
export async function translateBackendError(err: unknown): Promise<string> {
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

export type CustomerFormInput = z.infer<typeof CustomerFormSchema>

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

/** Read deleted_at off an SDK customer row. SDK-skew cast (same pattern as
 *  first_visit_at in queries.ts): the field shipped in core/SDK 1.13. */
function customerDeletedAt(c: object): string | null {
  return (c as { deleted_at?: string | null }).deleted_at ?? null
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
