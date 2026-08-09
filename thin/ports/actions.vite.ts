// `@/actions/*` server-action alias target for the thin shell.
//
// ⚠ BLOCKER / BFF DEPENDENCY: the ~28 server actions behind these screens are
// Next `'use server'` RPCs backed by synqed-core + service-role Supabase. Their
// REST/facade equivalents (the BFF) are a BACKEND deliverable (Anthony), not
// buildable in this packet. So each call THROWS a clear error — a LOUD failure,
// deliberately NOT the export spike's silent `{ ok: true }` no-op (which would
// let a mutation appear to succeed). First paint never calls a mutation, so the
// probe is unaffected; screen-conversion volume (post-checkpoint) wires each
// action to its facade endpoint as the BFF lands.

import { getDataPort } from '@/lib/ports/data-port'
import { redirect as thinRedirect } from './nav.vite'
// Pure, side-effect-free constants (no next/*, no synqed client) — safe to
// import directly rather than duplicating the tier/feature matrix by hand.
// FREE_TIER_LIMITS only (not the full 5-tier TIER_FEATURES) — the fallback
// below is always 'free', and this keeps the other 4 tiers' data out of the
// thin bundle (budget headroom).
import { FREE_TIER_LIMITS, type TierFeatures } from '@/lib/subscription/types'
// Pure, side-effect-free (zero imports of its own — the module's own header
// comment states it is shared by server-action gates AND client UI gating);
// StaffForm.tsx already imports CAPABILITIES/PERMISSION_ROLES/
// presetCapabilities from here directly, so this type-only import adds
// nothing new to the bundle's import graph.
import type { Capability, PermissionRole } from '@/lib/auth/permissions'

function notWired(name: string) {
  return async (): Promise<never> => {
    throw new Error(
      `[thin] server action "${name}" is not wired to a facade endpoint yet ` +
        '(BFF is a backend dependency — see thin/ports/actions.vite.ts).',
    )
  }
}

// First REAL facade endpoint (packet 03 vertical slice). Routes through the
// DataPort seam — the Authorization: Bearer header is the DataPort/auth-client's
// job (packet 01 integration), NOT this port's; here we only call the seam.
type ActionResult =
  | { success: true; id: string }
  | { success: false; error: string }

async function facadeUpdateCustomer(id: string, input: unknown): Promise<ActionResult> {
  const res = await getDataPort().apiFetch(`/api/app/v1/customers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (res.ok) return { success: true, id }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return { success: false, error: body?.error?.message ?? `Update failed (${res.status})` }
}

const enc = encodeURIComponent

/** Effectful call that returns the web action's `{ ok }` contract — a non-2xx
 *  facade response is a failed action, never a thrown one (the UI toasts off
 *  `ok`). */
async function okCall(path: string, init: RequestInit): Promise<{ ok: boolean }> {
  const res = await getDataPort().apiFetch(path, init)
  return { ok: res.ok }
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// -- memory (packet 06 §Build 4) ---------------------------------------------
// ⚠ packet-vs-source: the declared routes nest item mutations under
// /customers/[id]/memory/[itemId], but the web action signatures
// (updateMemoryItemAction/toggleMemoryPinAction/deleteMemoryItemAction) carry
// ONLY the item id — the profile card has the customerId but never passes it
// down to these. The facade routes prove tenancy from the ITEM's owner and never
// read the path [id], so it is a decorative segment here; the port fills it with
// a sentinel. Flagged for Fable/Anthony (itemId-only routes, or thread
// customerId through the three signatures). Tenancy is unaffected.
const MEMORY_ITEM_ID_SENTINEL = '-'

async function facadeAddMemoryItem(input: {
  customerId: string
  category: string
  label: string
  detail?: string | null
}): Promise<{ ok: boolean }> {
  return okCall(
    `/api/app/v1/customers/${enc(input.customerId)}/memory`,
    jsonInit('POST', { category: input.category, label: input.label, detail: input.detail ?? null }),
  )
}

async function facadeUpdateMemoryItem(input: {
  id: string
  label: string
  detail?: string | null
}): Promise<{ ok: boolean }> {
  return okCall(
    `/api/app/v1/customers/${MEMORY_ITEM_ID_SENTINEL}/memory/${enc(input.id)}`,
    jsonInit('PATCH', { label: input.label, detail: input.detail ?? null }),
  )
}

async function facadeToggleMemoryPin(id: string, pinned: boolean): Promise<{ ok: boolean }> {
  return okCall(
    `/api/app/v1/customers/${MEMORY_ITEM_ID_SENTINEL}/memory/${enc(id)}`,
    jsonInit('PATCH', { pinned }),
  )
}

async function facadeDeleteMemoryItem(id: string): Promise<{ ok: boolean }> {
  return okCall(`/api/app/v1/customers/${MEMORY_ITEM_ID_SENTINEL}/memory/${enc(id)}`, {
    method: 'DELETE',
  })
}

async function facadeRelearnCustomerMemory(
  customerId: string,
): Promise<{ ok: boolean; items: number; locked?: boolean }> {
  const res = await getDataPort().apiFetch(
    `/api/app/v1/customers/${enc(customerId)}/memory/relearn`,
    {
      method: 'POST',
      // Idempotency-Key required (contract §8). No client dedup store, so a fresh
      // key per call is fine — the guarantee is at-least-once either way.
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    },
  )
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; items?: number; locked?: boolean }
    | null
  if (!res.ok || !body) return { ok: false, items: 0 }
  return { ok: !!body.ok, items: body.items ?? 0, locked: body.locked }
}

async function facadeUpsertPassportField(input: {
  customerId: string
  fieldKey: string
  value: string
}): Promise<{ ok: boolean }> {
  return okCall(
    `/api/app/v1/customers/${enc(input.customerId)}/passport`,
    jsonInit('POST', { fieldKey: input.fieldKey, value: input.value }),
  )
}

// -- customer photos + consent (packet 06 §Build 4) --------------------------
async function facadeUploadCustomerPhoto(
  customerId: string,
  formData: FormData,
): Promise<{ photo?: unknown; error?: string }> {
  // Multipart: pass the FormData straight through — the browser sets the
  // multipart Content-Type + boundary; do NOT set it by hand.
  const res = await getDataPort().apiFetch(`/api/app/v1/customers/${enc(customerId)}/photos`, {
    method: 'POST',
    body: formData,
  })
  const body = (await res.json().catch(() => null)) as
    | { photo?: unknown; error?: { message?: string } }
    | null
  if (res.ok && body) return { photo: body.photo }
  return { error: body?.error?.message ?? `Upload failed (${res.status})` }
}

async function facadeRevokeCustomerConsent(
  customerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await getDataPort().apiFetch(
    `/api/app/v1/customers/${enc(customerId)}/consent/revoke`,
    { method: 'POST' },
  )
  if (res.ok) return { ok: true }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return { ok: false, error: body?.error?.message ?? `Revoke failed (${res.status})` }
}

// -- packs (packet 06 §Build 5) ----------------------------------------------
// create + redeem are effectful → send an Idempotency-Key (at-least-once). The
// facade re-derives 購入回数 / 合計金額 / burn pairing server-side, so this port
// never derives money or pairing itself. totalPrice specifically is DROPPED
// here, not forwarded (F7, PR-0 fix round) — the facade route ignores it
// (CreatePackSchema accepts it only for old baked-shell compat; the value
// never reaches createPackActionWithClient's derivation), so sending it from
// this port would be a dead, misleading field. Every OTHER create/redeem
// field still rides through verbatim.
const idemPost = (body?: unknown): RequestInit => ({
  method: 'POST',
  headers: {
    'Idempotency-Key': crypto.randomUUID(),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
})

async function facadeCreatePack(input: {
  customerId: string
  kind: string
  packSize: number
  unitPrice: number
  purchasedAt?: string | null
  notes?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const { customerId, ...rest } = input
  const res = await getDataPort().apiFetch(`/api/app/v1/customers/${enc(customerId)}/packs`, idemPost(rest))
  if (res.ok) return { ok: true }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return { ok: false, error: body?.error?.message ?? `Create failed (${res.status})` }
}

async function facadeRedeemSession(input: {
  packId: string
  customerId: string
  redeemedOn?: string
  appointmentId?: string | null
  karuteRecordId?: string | null
  source?: 'manual' | 'backfill'
}): Promise<{ ok: boolean; redemptionId?: string; error?: string }> {
  const { customerId, ...rest } = input
  const res = await getDataPort().apiFetch(
    `/api/app/v1/customers/${enc(customerId)}/packs/redeem`,
    idemPost(rest),
  )
  const body = (await res.json().catch(() => null)) as
    | { redemptionId?: string; error?: { message?: string } }
    | null
  if (res.ok) return { ok: true, redemptionId: body?.redemptionId }
  return { ok: false, error: body?.error?.message ?? `Redeem failed (${res.status})` }
}

async function facadeSetLifecycle(input: {
  customerId: string
  status: string
  referral: boolean
}): Promise<{ ok: boolean }> {
  return okCall(
    `/api/app/v1/customers/${enc(input.customerId)}/lifecycle`,
    jsonInit('POST', { status: input.status, referral: input.referral }),
  )
}

// -- session detail: outcome + regenerate (packet 07 Decision 2 + §Build 3) ----
// Signature matches the web action (Wave W3: BOTH surfaces now derive
// customerId server-side from the karute record — the caller never supplies it).
async function facadeUpdateKaruteOutcome(
  karuteRecordId: string,
  outcome: { status: string; reason?: string | null; isFirstVisit?: boolean },
): Promise<{ error?: string }> {
  const res = await getDataPort().apiFetch(
    `/api/app/v1/karute/${enc(karuteRecordId)}/outcome`,
    jsonInit('POST', {
      status: outcome.status,
      reason: outcome.reason ?? null,
      isFirstVisit: outcome.isFirstVisit,
    }),
  )
  if (res.ok) return {}
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return { error: body?.error?.message ?? `Update failed (${res.status})` }
}

// Effectful + expensive → Idempotency-Key (at-least-once). The whole extract →
// summarize → apply runs server-side; the client sends only the id. Returns the
// button's RegenerateResult shape — a non-2xx (403 ACL / 429 rate-limit / 404) is
// mapped to { error } so the button toasts it exactly like the web action does.
async function facadeRegenerateKarute(
  karuteRecordId: string,
): Promise<{ error?: string; warning?: string; added?: number; removed?: number }> {
  const res = await getDataPort().apiFetch(
    `/api/app/v1/karute/${enc(karuteRecordId)}/regenerate`,
    { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
  )
  const body = (await res.json().catch(() => null)) as
    | { error?: unknown; warning?: string; added?: number; removed?: number }
    | null
  if (!res.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message
    return { error: message ?? `Regenerate failed (${res.status})` }
  }
  return {
    error: typeof body?.error === 'string' ? body.error : undefined,
    warning: body?.warning,
    added: body?.added,
    removed: body?.removed,
  }
}

// -- session detail: per-entry edit (edit-layer W2 PR-B — edit-save only, no
// delete; that's PR-B2). Same result shape as the web action
// (updateKaruteDetailEntry) so EntryEditSheet's success/conflict/error
// branches behave identically on both platforms.
async function facadeUpdateKaruteEntry(
  karuteRecordId: string,
  entryId: string,
  input: { content?: string; category?: string; expectedVersion: number },
): Promise<{ ok: true } | { conflict: true } | { error: string }> {
  // customer_id is server-derived on BOTH platforms (facade proof-read / web
  // authoritative GET) — it never rides the wire or the action input.
  // Whole body try/caught: a network-level fetch rejection must come back as
  // the declared {error} result, exactly like the web action's catch — an
  // escaped rejection would strand EntryEditSheet in its saving state
  // (Greptile P1, #615).
  try {
    const res = await getDataPort().apiFetch(
      `/api/app/v1/karute/${enc(karuteRecordId)}/entries/${enc(entryId)}`,
      jsonInit('PATCH', input),
    )
    if (res.status === 409) return { conflict: true }
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    return { error: body?.error?.message ?? `Update failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network request failed' }
  }
}

// -- session detail: whole-summary edit (edit-layer W2 summary half — the
// 詳細記録 pencil). Same result shape as the web action
// (updateKaruteDetailSummary) so SummaryEditSheet's success/error branches
// behave identically on both platforms. NOT the regen path's
// updateKaruteSummary (ai_summary) — this writes the edited_summary overlay.
async function facadeUpdateKaruteDetailSummary(
  karuteRecordId: string,
  input: { content: string },
): Promise<{ ok: true } | { error: string }> {
  // Whole body try/caught: a network-level fetch rejection must come back as
  // the declared {error} result, exactly like the web action's catch — same
  // transport-rejection parity as facadeUpdateKaruteEntry above (Greptile P1,
  // #615).
  try {
    const res = await getDataPort().apiFetch(
      `/api/app/v1/karute/${enc(karuteRecordId)}/summary`,
      jsonInit('PATCH', input),
    )
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    return { error: body?.error?.message ?? `Update failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network request failed' }
  }
}

// -- session detail: per-entry edit history (edit-layer W2 history-sheet
// packet). Local redeclaration of EntryEditHistoryRow (src/actions/karute.ts)
// — same "redeclare the shape" convention as AuditLogEvent/StoreRow below.
// Same result shape as the web action (listEntryEditHistory) so
// EntryHistorySheet's rows/error branches behave identically on both
// platforms.
type EntryEditHistoryRow = {
  id: string
  entryIdOld: string | null
  entryIdNew: string | null
  // Nullable — legacy-null enum precedent on this table family.
  action: string | null
  actorName: string | null
  contentBefore: string | null
  contentAfter: string | null
  createdAt: string
}

async function facadeListEntryEditHistory(
  karuteRecordId: string,
): Promise<{ edits: EntryEditHistoryRow[]; truncated: boolean } | { error: string }> {
  // Whole body try/caught: a network-level fetch rejection must come back as
  // the declared {error} result, exactly like the web action's catch — same
  // transport-rejection parity as facadeUpdateKaruteEntry above (Greptile P1,
  // #615).
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/karute/${enc(karuteRecordId)}/entry-edits`)
    const body = (await res.json().catch(() => null)) as
      | { edits?: EntryEditHistoryRow[]; truncated?: boolean; error?: { message?: string } }
      | null
    if (res.ok && body) return { edits: body.edits ?? [], truncated: body.truncated ?? false }
    return { error: body?.error?.message ?? `Request failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network request failed' }
  }
}

// -- recording flow: save + mint + consent + undo (packet 08 batch 5) ---------
// The karute SAVE serves BOTH web flavors through ONE facade route. The consent
// gate round-trips CONSENT_REQUIRED_ERROR as the error message so ReviewScreen's
// existing `result.error === CONSENT_REQUIRED_ERROR` re-prompt path matches.
import type { SaveKaruteInput } from '@/types/karute'

async function facadeSaveKarute(input: SaveKaruteInput): Promise<{ error: string } | void> {
  const res = await getDataPort().apiFetch('/api/app/v1/karute', idemPost(input))
  const body = (await res.json().catch(() => null)) as
    | { id?: string; error?: { message?: string } }
    | null
  if (!res.ok || !body?.id) {
    return { error: body?.error?.message ?? `Save failed (${res.status})` }
  }
  // web redirects by throwing NEXT_REDIRECT; thin navigates then throws the same
  // marker so ReviewScreen's catch runs clearDraft()/onSaved() identically (the
  // re-thrown marker is harmless post-navigation — TRACE DUTY §Build 3/6).
  thinRedirect(`/karute/${body.id}`)
  throw new Error('NEXT_REDIRECT')
}

async function facadeSaveKaruteInline(
  input: SaveKaruteInput,
): Promise<{ id: string } | { error: string }> {
  // 'fill-if-empty' (edit-layer Wave 1 fix round): autosave has nothing newer
  // to say than what's already on the record, so the facade omits `entries`
  // on a collision rather than replacing them — see SaveKaruteSchema's
  // entriesMode + createOrUpdateKaruteRecord. facadeSaveKarute (above) sends
  // no flag, taking the schema's 'replace' default (the staff-intent path).
  const res = await getDataPort().apiFetch(
    '/api/app/v1/karute',
    idemPost({ ...input, entriesMode: 'fill-if-empty' as const }),
  )
  const body = (await res.json().catch(() => null)) as
    | { id?: string; error?: { message?: string } }
    | null
  if (res.ok && body?.id) return { id: body.id }
  return { error: body?.error?.message ?? `Save failed (${res.status})` }
}

async function facadeStartRecordingSession(input: {
  customerId?: string | null
  appointmentId?: string | null
}): Promise<{ id: string } | null> {
  // Fail-OPEN: capture must NEVER block on the mint (web action contract).
  try {
    const res = await getDataPort().apiFetch('/api/app/v1/recordings/session', idemPost(input))
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as { id?: string | null } | null
    return body?.id ? { id: body.id } : null
  } catch {
    return null
  }
}

async function facadeGetCustomerConsent(
  customerId: string,
): Promise<{ consent: unknown }> {
  const res = await getDataPort().apiFetch(`/api/app/v1/customers/${enc(customerId)}/consent`)
  // Fail closed: any failure → consent not on file (the record button stays blocked).
  if (!res.ok) return { consent: null }
  const body = (await res.json().catch(() => null)) as { consent?: unknown } | null
  return { consent: body?.consent ?? null }
}

async function facadeGrantCustomerConsent(
  customerId: string,
  input: { method?: 'VERBAL' | 'WRITTEN' } = {},
): Promise<{ ok: true; consent?: unknown } | { ok: false; error: string }> {
  const res = await getDataPort().apiFetch(
    `/api/app/v1/customers/${enc(customerId)}/consent/grant`,
    idemPost({ method: input.method ?? 'VERBAL' }),
  )
  const body = (await res.json().catch(() => null)) as
    | { consent?: unknown; error?: { message?: string } }
    | null
  if (res.ok) return { ok: true, consent: body?.consent }
  return { ok: false, error: body?.error?.message ?? `Grant failed (${res.status})` }
}

async function facadeUndoRedemption(redemptionId: string): Promise<{ ok: boolean }> {
  const res = await getDataPort().apiFetch(
    `/api/app/v1/packs/redemptions/${enc(redemptionId)}/undo`,
    idemPost(),
  )
  if (!res.ok) return { ok: false }
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null
  return { ok: !!body?.ok }
}

// -- org-settings (design-parity packet 12 §S1). RPC-style, same class as
// statusCall below: upsertOrgSettings's own result shape ({ success: true } |
// { error: string }) rides the 2xx body VERBATIM — OrganizationSection/
// ThemeSection/AISection/RecordingSection/PacksSection all branch on
// `'error' in result` exactly as they do against the web action. try/catch
// delivers the transport promise every caller here awaits WITHOUT one of
// their own (same #566 precedent as statusCall): an offline/DNS reject must
// land as { error }, never an unhandled rejection.
type UpsertOrgSettingsResult = { success: true } | { error: string }

async function facadeUpsertOrgSettings(
  settings: Record<string, unknown>,
): Promise<UpsertOrgSettingsResult> {
  try {
    const res = await getDataPort().apiFetch('/api/app/v1/org-settings', jsonInit('PATCH', settings))
    const parsed = (await res.json().catch(() => null)) as
      | (UpsertOrgSettingsResult & { error?: unknown })
      | { error?: { message?: string } }
      | null
    if (res.ok && parsed) return parsed as UpsertOrgSettingsResult
    const envelope = parsed as { error?: { code?: string; message?: string } } | null
    // Web-parity for the one denial the sections actually surface: web's
    // upsertOrgSettings soft-returns this exact string on a failed
    // settings.manage gate, and 4 of 5 sections toast result.error VERBATIM
    // — the facade's raw capability-key message must never reach the UI.
    if (envelope?.error?.code === 'forbidden') {
      return { error: 'You do not have permission to change settings.' }
    }
    return { error: envelope?.error?.message ?? `Request failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

// -- welcome wizard onboarding (design-parity packet 21). Mirrors
// completeOnboarding's validation EXACTLY (src/actions/org-settings.ts:
// 217-221, same order, same strings) — WelcomeWizard's own step gating
// already blocks these on both platforms, so this is a backstop, not new
// behavior. On pass, delegates to facadeUpsertOrgSettings above — the SAME
// write path the settings sections already use — with the wizard's 5-field
// payload.
//
// Stated divergence from the web action (src/actions/org-settings.ts):
// validation runs in the port, not a server — the facade PATCH still
// enforces settings.manage + zod server-side regardless, so this is a
// backstop on both platforms, same as the wizard's own step gating.
//
// setup_completed_at: the ISO string sent below is ADVISORY ONLY — the
// facade PATCH route clamps any client-supplied value to SERVER time
// (org-settings/route.ts), because the stamp renders verbatim as the
// salon's setup-complete date in OrganizationSection and a device clock
// must never write that record. Web parity holds: both platforms end up
// server-clock.
async function facadeCompleteOnboarding(input: {
  businessName: string
  businessType: string
  disclosureMode: 'A' | 'B' | 'C'
  privacyConfirmed: boolean
}): Promise<UpsertOrgSettingsResult> {
  if (!input.businessName.trim()) return { error: 'Store name is required' }
  if (!input.businessType) return { error: 'Business type is required' }
  if (input.disclosureMode === 'A' && !input.privacyConfirmed) {
    return { error: 'Privacy policy confirmation required for Mode A' }
  }
  return facadeUpsertOrgSettings({
    salon_name: input.businessName.trim(),
    business_type: input.businessType,
    recording_disclosure_mode: input.disclosureMode,
    recording_disclosure_privacy_confirmed: input.privacyConfirmed,
    setup_completed_at: new Date().toISOString(),
  })
}

// -- dashboard pack mutations (design-parity Gap B-1 PR 2). RPC-style: the
// facade's 2xx body rides through VERBATIM — dismissVisitReconcileAction /
// dismissPackAlertAction / logCustomerContactAction return { ok, error? } and
// ReconcileStrip/PackAlertsCard branch on it directly, same class as
// statusCall's appointments discriminators below. Only a non-2xx transport/
// auth/validation failure gets normalized to { ok: false, error }. No
// Idempotency-Key: none of these three are redeem-class (see the routes'
// own comments) — a retried dismiss/log is harmless, matching web parity
// (the web actions send none either).
async function rpcPost<T extends { ok: boolean }>(path: string, body: unknown): Promise<T> {
  try {
    const res = await getDataPort().apiFetch(path, jsonInit('POST', body))
    const parsed = (await res.json().catch(() => null)) as
      | (T & { error?: unknown })
      | { error?: { code?: string; message?: string } }
      | null
    if (res.ok && parsed) return parsed as T
    const envelope = (parsed as { error?: { code?: string; message?: string } } | null)?.error
    // A missing-capability 403 (e.g. a role downgraded after the screen
    // loaded) maps to the literal 'forbidden' string — PackAlertsCard
    // branches on res.error === 'forbidden' for its specific toast, matching
    // the web action's own tolerant { ok:false, error:'forbidden' } contract.
    const message = envelope?.code === 'forbidden' ? 'forbidden' : envelope?.message
    return { ok: false, error: message ?? `Request failed (${res.status})` } as unknown as T
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' } as unknown as T
  }
}

function facadeDismissVisitReconcile(input: {
  customerId: string
  appointmentId?: string | null
  visitDay: string
}): Promise<{ ok: boolean }> {
  const { customerId, ...rest } = input
  return rpcPost(`/api/app/v1/customers/${enc(customerId)}/packs/reconcile/dismiss`, rest)
}

function facadeDismissPackAlert(input: {
  customerId: string
  reason?: string
}): Promise<{ ok: boolean; error?: string }> {
  const { customerId, ...rest } = input
  return rpcPost(`/api/app/v1/customers/${enc(customerId)}/packs/alerts/dismiss`, rest)
}

function facadeLogCustomerContact(input: {
  customerId: string
  channel: 'phone' | 'sms' | 'email' | 'line' | 'in_person'
  note?: string
}): Promise<{ ok: boolean; error?: string }> {
  const { customerId, ...rest } = input
  return rpcPost(`/api/app/v1/customers/${enc(customerId)}/packs/contact`, rest)
}

// Any name resolves to a loud-throwing async fn (covers dynamic access).
const proxy = new Proxy(
  {},
  { get: (_t, name) => notWired(String(name)) },
) as Record<string, ReturnType<typeof notWired>>
export default proxy

// Static named exports — Rollup resolves named imports at build time, so every
// name the aliased modules (customers / packs / memory / regenerate-karute) export
// must exist. This list IS the mutation-RPC surface one screen depends on.
// -- customers
export const createCustomer = notWired('createCustomer')
export const createQuickCustomer = notWired('createQuickCustomer')
export const updateCustomer = facadeUpdateCustomer
export const deleteCustomer = notWired('deleteCustomer')
export const listCustomerPhotos = notWired('listCustomerPhotos')
export const uploadCustomerPhoto = facadeUploadCustomerPhoto
export const deleteCustomerPhoto = notWired('deleteCustomerPhoto')
export const getCustomerConsent = facadeGetCustomerConsent
export const grantCustomerConsent = facadeGrantCustomerConsent
export const revokeCustomerConsent = facadeRevokeCustomerConsent
// -- packs
export const createPackAction = facadeCreatePack
export const setPackStatusAction = notWired('setPackStatusAction') // status flip = later batch
export const redeemSessionAction = facadeRedeemSession
export const dismissVisitReconcileAction = facadeDismissVisitReconcile
export const undoRedemptionAction = facadeUndoRedemption
export const logCustomerContactAction = facadeLogCustomerContact
export const dismissPackAlertAction = facadeDismissPackAlert
export const setLifecycleAction = facadeSetLifecycle
// -- memory
export const addMemoryItemAction = facadeAddMemoryItem
export const updateMemoryItemAction = facadeUpdateMemoryItem
export const toggleMemoryPinAction = facadeToggleMemoryPin
export const deleteMemoryItemAction = facadeDeleteMemoryItem
export const relearnCustomerMemoryAction = facadeRelearnCustomerMemory
export const upsertPassportFieldAction = facadeUpsertPassportField
// -- recording flow (packet 08 batch 5). saveKaruteRecord/Inline +
//    startRecordingSession were Proxy-only; they MUST be named exports now that
//    thin imports @/actions/karute + @/actions/recordings (Rollup resolves named
//    imports at build time).
export const saveKaruteRecord = facadeSaveKarute
export const saveKaruteRecordInline = facadeSaveKaruteInline

// -- stores (design-parity packet 12 §B-3 S2 — 店舗 tab live). Mirrors
// StoreRow (src/actions/stores.ts) — a local redeclaration, not an import:
// the real module's import chain pulls in next/headers et al via
// getSynqedClient, which the boundary would need to unwind for a type-only
// need (same "redeclare the shape" convention this file already uses for
// MarkNoShowResult / UpsertOrgSettingsResult above).
type StoreRow = {
  id: string
  name: string
  address: string | null
  phone: string | null
  isPrimary: boolean
  active: boolean
  staffCount: number
  customerCount: number
  businessType: string | null
}
type StoreInput = {
  name: string
  address?: string
  phone?: string
  business_type?: string
}

// Web-exact failure semantics (Greptile P2, PR #579): web's listStores()
// action degrades to [] ONLY on its getBusinessId() catch (unauthenticated);
// every other failure propagates so StoresSection's refresh()/mount effect —
// which never wraps this call in its own try/catch — sees the reject and
// leaves last-good state untouched, same as web. A blanket []-on-any-failure
// here would instead silently blank out a paying tenant's real store list.
async function facadeListStores(): Promise<StoreRow[]> {
  const res = await getDataPort().apiFetch('/api/app/v1/stores')
  if (res.status === 401) return []
  if (!res.ok) throw new Error(`store list failed (${res.status})`)
  const body = (await res.json()) as { stores?: StoreRow[] }
  return body.stores ?? []
}

async function facadeCreateStore(
  input: StoreInput,
): Promise<{ id: string } | { error: string }> {
  try {
    const res = await getDataPort().apiFetch('/api/app/v1/stores', idemPost(input))
    const body = (await res.json().catch(() => null)) as
      | { id?: string; error?: string | { message?: string } }
      | null
    if (res.ok && body?.id) return { id: body.id }
    // Business failure (e.g. STORE_LIMIT_REACHED) rides a 2xx { error: string }
    // VERBATIM — RPC-style, same class as createAppointment/facadeUpsertOrgSettings
    // above — so StoresSection's `res.error === 'STORE_LIMIT_REACHED'` branch
    // sees the identical string on both paths. Transport/auth failures carry
    // the facade's { error: { message } } envelope.
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message
    return { error: message ?? `Create failed (${res.status})` }
  } catch (err) {
    // try/catch: handleFormSave awaits without one — a transport reject would
    // strand the dialog's `saved` state (see statusCall's identical rationale).
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

async function facadeUpdateStore(
  id: string,
  input: StoreInput,
): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/stores/${enc(id)}`, jsonInit('PATCH', input))
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string | { message?: string } }
      | null
    if (res.ok && body?.ok) return { ok: true }
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message
    return { error: message ?? `Update failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

// -- entitlement (design-parity packet 12 §B-3 S2). Mirrors Entitlement
// (src/lib/subscription/entitlement-resolve.ts) — local redeclaration for
// the same reason as StoreRow above; built on the pure, side-effect-free
// subscription/types constants (safe to import — no next/*, no synqed
// client) rather than duplicating the tier/feature matrix by hand.
type SubscriptionTier = 'trial' | 'free' | 'standard' | 'professional' | 'enterprise'
type Entitlement = {
  tier: SubscriptionTier
  storeLimit: number | 'unlimited'
  storeCount: number
  isUnlimited: boolean
  features: TierFeatures
  staffLimit: number | 'unlimited'
  canAddStore: boolean
  enforced: boolean
  degraded: boolean
}

// Exists ONLY for the 401 class — mirrors web's getEntitlement() action,
// which returns this exact safe/blocked shape when getBusinessId() throws
// (unauthenticated), never for any other failure.
const UNAUTH_ENTITLEMENT: Entitlement = {
  tier: 'free',
  storeLimit: 1,
  storeCount: 0,
  isUnlimited: false,
  features: FREE_TIER_LIMITS,
  staffLimit: FREE_TIER_LIMITS.staff,
  canAddStore: false,
  enforced: false,
  degraded: false,
}

// Web-exact failure semantics (Greptile P2, PR #579): any failure OTHER than
// 401 propagates — a transport blip or a 500 must not replace a paying
// tenant's real plan state with the blocked-free default (StoresSection's
// mount effect catches this to console and keeps its last-good entitlement,
// same as web's own try/catch around getEntitlement()).
async function facadeGetEntitlement(): Promise<Entitlement> {
  const res = await getDataPort().apiFetch('/api/app/v1/entitlement')
  if (res.status === 401) return UNAUTH_ENTITLEMENT
  if (!res.ok) throw new Error(`entitlement fetch failed (${res.status})`)
  const body = (await res.json()) as { entitlement?: Entitlement }
  if (!body.entitlement) throw new Error('entitlement fetch failed: malformed response')
  return body.entitlement
}

// Per-staff store assignment (design-parity packet 12 §B-3 S4b tab-live
// prerequisite). getStaffStores never throws on web (catches to []
// unconditionally, including on a facade 403 — the GET carries a
// staff.manage floor web doesn't have); setStaffStores mirrors
// facadeUpdateStore's business-result passthrough, with the PUT route's
// owner-only 403 elevation mapped back to web's own exact copy (same
// "forbidden code → the action's own copy" idiom as facadeUpsertOrgSettings
// above — STORE_OWNER_DENIAL, src/lib/validations/store.ts).
async function facadeGetStaffStores(staffId: string): Promise<string[]> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/staff/${enc(staffId)}/stores`)
    if (!res.ok) return []
    const body = (await res.json().catch(() => null)) as { storeIds?: string[] } | null
    return body?.storeIds ?? []
  } catch {
    return []
  }
}

async function facadeSetStaffStores(
  staffId: string,
  storeIds: string[],
): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await getDataPort().apiFetch(
      `/api/app/v1/staff/${enc(staffId)}/stores`,
      jsonInit('PUT', { storeIds }),
    )
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string | { message?: string; code?: string } }
      | null
    if (res.ok && body?.ok) return { ok: true }
    if (typeof body?.error === 'object' && body.error?.code === 'forbidden') {
      return { error: 'Only the salon owner can manage stores.' }
    }
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message
    return { error: message ?? `Request failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

// (chrome packet — the StoreSwitcher's one mutation). The web version writes
// the karute_active_store cookie; the shell persists the store-id header
// source instead and reloads so every screen re-fetches through the new
// lens. Validity is the SERVER's call: the facade clamp fails closed on a
// store outside the caller's scope, so no pre-validation here. Reload is
// safe from the switcher — it is hidden while recording.
export const setActiveStore = async (
  storeId: string,
): Promise<{ ok: true } | { error: string }> => {
  const { setThinActiveStore } = await import('../chrome/store-pref')
  setThinActiveStore(storeId)
  window.location.reload()
  return { ok: true }
}
export const listStores = facadeListStores
export const createStore = facadeCreateStore
export const updateStore = facadeUpdateStore
// Local read, no network — the same store-pref module setActiveStore writes
// to, keyed per signed-in user (see thin/chrome/store-pref.ts's own header).
export const getActiveStoreId = async (): Promise<string | null> => {
  const { getThinActiveStore } = await import('../chrome/store-pref')
  return getThinActiveStore()
}
export const getStaffStores = facadeGetStaffStores
export const setStaffStores = facadeSetStaffStores
export const getEntitlement = facadeGetEntitlement
export const startRecordingSession = facadeStartRecordingSession

// -- audit log (design-parity packet 17 §S3 — 監査ログ tab live). Mirrors
// AuditLogEvent/AuditLogFilters (src/actions/audit-log.ts) — local
// redeclarations, not imports: same "redeclare the shape" convention as
// StoreRow/StoreInput above.
type AuditLogEvent = {
  id: string
  at: string
  actor_id: string | null
  actor_type: string
  category: string
  action: string
  target_type: string | null
  target_id: string | null
  target_label: string | null
  detail: unknown
  break_glass: boolean
  severity: string
  // SDK 1.14 write-time snapshot name (packet 18 T3) — optional/nullable so
  // an old cached response (missing the key entirely) still parses.
  actor_label?: string | null
}
type AuditLogFilters = {
  category?: string
  actorId?: string
  from?: string
  to?: string
  targetId?: string
  includeViews?: boolean
  breakGlass?: boolean
  page?: number
}
type AuditLogListResult =
  | {
      ok: true
      events: AuditLogEvent[]
      total: number
      page: number
      hasMore: boolean
      breakGlassTotal: number | null
      // Exact 変更/警告 strip counts (packet 18 T1) — add-only.
      warningsTotal: number | null
      changesTotal: number | null
      targetLabels: Record<string, string>
    }
  | { ok: false; error: 'forbidden' | 'failed' }

// Web-exact never-throw envelope (mirrors listAuditLog's own web behavior):
// a 2xx body already IS the union, forwarded verbatim; 403 → the
// capability-missing meaning; 401 → 'failed' (transient auth — AuthGate
// owns session death, never render a permissions error for a dying token);
// any other non-ok status or a transport reject also degrades to 'failed'.
async function facadeListAuditLog(filters: AuditLogFilters): Promise<AuditLogListResult> {
  const q = new URLSearchParams()
  if (filters.category) q.set('category', filters.category)
  if (filters.actorId) q.set('actorId', filters.actorId)
  if (filters.from) q.set('from', filters.from)
  if (filters.to) q.set('to', filters.to)
  if (filters.targetId) q.set('targetId', filters.targetId)
  if (filters.includeViews) q.set('includeViews', '1')
  if (filters.breakGlass) q.set('breakGlass', '1')
  q.set('page', String(filters.page ?? 1))

  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/audit-log?${q.toString()}`)
    if (res.status === 403) return { ok: false, error: 'forbidden' }
    if (!res.ok) return { ok: false, error: 'failed' }
    const body = (await res.json().catch(() => null)) as AuditLogListResult | null
    return body ?? { ok: false, error: 'failed' }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

// -- staff credentials/identity (design-parity packet 12 §B-3 S4b — スタッフ
// tab live). Local redeclarations, not imports — same "redeclare the shape"
// convention as StoreRow/AuditLogEvent above (the real modules' import
// chains pull in next/cache et al).
type InviteRole = 'ADMIN' | 'STYLIST' | 'ASSISTANT'
type InviteInput = { email: string; role: InviteRole; staffId?: string }
type InviteRow = {
  id: string
  email: string
  role: InviteRole
  status: 'pending' | 'accepted' | 'revoked'
  created_at: string
  expires_at: string
}

// PIN routes: web's own { error? } result rides the 2xx body VERBATIM (the
// core's own business-result passthrough — a PIN write failure is a 200
// with an error string, not a non-2xx status). Non-2xx (auth/validation/
// transport) maps to the same fallback shape.
async function facadeSetStaffPin(staffId: string, pin: string): Promise<{ error?: string }> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/staff/${enc(staffId)}/pin`, jsonInit('PUT', { pin }))
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | { error?: { message?: string } }
      | null
    if (res.ok && body) return body as { error?: string }
    const message = (body as { error?: { message?: string } } | null)?.error?.message
    return { error: message ?? `Request failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

async function facadeRemoveStaffPin(staffId: string): Promise<{ error?: string }> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/staff/${enc(staffId)}/pin`, { method: 'DELETE' })
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | { error?: { message?: string } }
      | null
    if (res.ok && body) return body as { error?: string }
    const message = (body as { error?: { message?: string } } | null)?.error?.message
    return { error: message ?? `Request failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

// Voice routes: web's own { ok, enrolledAt? } / { ok } contracts never carry
// an 'error' field — a denied/failed write is silently { ok: false }, so the
// body's OWN `ok` is read (unlike okCall, which only checks HTTP status —
// the facade route always 200s even on a business-level ownership denial,
// same RPC-style class as every other core-backed route in this file).
async function facadeEnrollVoice(
  staffId: string,
  formData: FormData,
): Promise<{ ok: boolean; enrolledAt?: string }> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/staff/${enc(staffId)}/voice`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) return { ok: false }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; enrolledAt?: string } | null
    return { ok: !!body?.ok, enrolledAt: body?.enrolledAt }
  } catch {
    return { ok: false }
  }
}

async function facadeRevokeVoice(staffId: string): Promise<{ ok: boolean }> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/staff/${enc(staffId)}/voice`, { method: 'DELETE' })
    if (!res.ok) return { ok: false }
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null
    return { ok: !!body?.ok }
  } catch {
    return { ok: false }
  }
}

// Invites: createInvite is create-class → Idempotency-Key (idemPost). listInvites
// degrades to [] on ANY failure (web-exact — the web action's own two catches
// both return []). revokeInvite mirrors createStore's business-result
// passthrough (2xx { ok: true } | { error } VERBATIM).
async function facadeCreateInvite(input: InviteInput): Promise<{ token: string } | { error: string }> {
  try {
    const res = await getDataPort().apiFetch('/api/app/v1/invites', idemPost(input))
    const body = (await res.json().catch(() => null)) as
      | { token?: string; error?: string | { message?: string } }
      | null
    if (res.ok && body?.token) return { token: body.token }
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message
    return { error: message ?? `Create failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

async function facadeListInvites(): Promise<InviteRow[]> {
  try {
    const res = await getDataPort().apiFetch('/api/app/v1/invites')
    if (!res.ok) return []
    const body = (await res.json().catch(() => null)) as { invites?: InviteRow[] } | null
    return body?.invites ?? []
  } catch {
    return []
  }
}

async function facadeRevokeInvite(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/invites/${enc(id)}`, { method: 'DELETE' })
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string | { message?: string } }
      | null
    if (res.ok && body?.ok) return { ok: true }
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message
    return { error: message ?? `Revoke failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

// -- staff profile/authority (design-parity packet 12 §B-3 S4b tab-live
// prerequisite — StaffForm calls getStaffPermissions/getStaffStores on
// mount and create/update/setStaffPermissions/setStaffStores on submit;
// StaffList calls deleteStaff/uploadStaffAvatar — all reachable now that
// the tab is live). Local redeclarations, not imports — same "redeclare the
// shape" convention as StoreRow/InviteRow above (the real actions modules'
// import chains pull in next/cache et al).
type StaffProfileInput = { name: string; position: string; email: string; phone: string }
type StaffActionResult = { error: string } | void
type StaffPermissionsResult = { permissionRole: PermissionRole; capabilities: Capability[]; isOwner: boolean }

// create/update/delete: web's own { error } | void result rides the 2xx
// body VERBATIM ({id}|{ok:true} on success, {error} on a business failure —
// same RPC-style class as every other core-backed route in this file).
// createStaff is create-class → Idempotency-Key (idemPost), matching
// createInvite/createStore.
async function facadeCreateStaffAction(data: StaffProfileInput): Promise<StaffActionResult> {
  try {
    const res = await getDataPort().apiFetch('/api/app/v1/staff', idemPost(data))
    const body = (await res.json().catch(() => null)) as
      | { id?: string; error?: string | { message?: string } }
      | null
    if (res.ok && body?.id) return
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message
    return { error: message ?? `Create failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

async function facadeUpdateStaffAction(id: string, data: StaffProfileInput): Promise<StaffActionResult> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/staff/${enc(id)}`, jsonInit('PATCH', data))
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string | { message?: string } }
      | null
    if (res.ok && body?.ok) return
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message
    return { error: message ?? `Update failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

async function facadeDeleteStaffAction(id: string): Promise<StaffActionResult> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/staff/${enc(id)}`, { method: 'DELETE' })
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string | { message?: string } }
      | null
    if (res.ok && body?.ok) return
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message
    return { error: message ?? `Delete failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

// avatar: multipart passthrough — same idiom as facadeUploadCustomerPhoto/
// facadeEnrollVoice above (the browser sets the multipart Content-Type +
// boundary; do NOT set it by hand).
async function facadeUploadStaffAvatarAction(
  staffId: string,
  formData: FormData,
): Promise<{ url: string } | { error: string }> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/staff/${enc(staffId)}/avatar`, {
      method: 'POST',
      body: formData,
    })
    const body = (await res.json().catch(() => null)) as
      | { url?: string; error?: string | { message?: string } }
      | null
    if (res.ok && body?.url) return { url: body.url }
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message
    return { error: message ?? `Upload failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

// permissions: GET's 2xx body IS the union already (StaffPermissionsResult |
// {error}) — verbatim passthrough, same class as facadeUpsertOrgSettings.
// PUT mirrors it; StaffForm branches on 'error' in result exactly as it
// does against the web action.
async function facadeGetStaffPermissions(
  staffId: string,
): Promise<StaffPermissionsResult | { error: string }> {
  try {
    const res = await getDataPort().apiFetch(`/api/app/v1/staff/${enc(staffId)}/permissions`)
    const parsed = (await res.json().catch(() => null)) as
      | (StaffPermissionsResult & { error?: unknown })
      | { error?: { message?: string } }
      | null
    if (res.ok && parsed) return parsed as StaffPermissionsResult | { error: string }
    const envelope = parsed as { error?: { message?: string } } | null
    return { error: envelope?.error?.message ?? `Request failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

async function facadeSetStaffPermissions(
  staffId: string,
  permissionRole: PermissionRole,
  capabilities: Capability[],
): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await getDataPort().apiFetch(
      `/api/app/v1/staff/${enc(staffId)}/permissions`,
      jsonInit('PUT', { permissionRole, capabilities }),
    )
    const parsed = (await res.json().catch(() => null)) as
      | ({ ok: true } | { error: string })
      | { error?: { message?: string } }
      | null
    if (res.ok && parsed) return parsed as { ok: true } | { error: string }
    const envelope = parsed as { error?: { message?: string } } | null
    return { error: envelope?.error?.message ?? `Request failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

// -- settings (design-parity packet 12 §S1, packet 17 §S3, §B-3 S4b) —
// organization/theme/ai/recording/packs/店舗/監査ログ/スタッフ tabs are LIVE
// (upsertOrgSettings is the one write the first five share; audit is
// read-only; staff profile/authority/credentials all wired below). 同期 is
// WEB-ONLY via SettingsShell's webOnlyTabIds (honest Web版 copy, not 準備中
// — #585) — SettingsShell still statically imports every section
// unconditionally, so SyncSection stays in the thin bundle's import graph
// regardless of the tab never rendering it in-shell — Rollup requires every
// named import it makes from @/actions/* to resolve, hence the one
// remaining stub below.
export const upsertOrgSettings = facadeUpsertOrgSettings
// completeOnboarding (design-parity packet 21): WelcomeWizard imports it by
// name from '@/actions/org-settings' — Rollup fails without it now that
// WelcomeScreen brings the wizard into the bundle's import graph.
export const completeOnboarding = facadeCompleteOnboarding
// getOrgSettings stays notWired — web-only cached cookie reader (the thin
// welcome screen reads via WelcomeScreenDTO/screens/welcome instead); zero
// thin callers remain.
export const getOrgSettings = notWired('getOrgSettings')
export const listAuditLog = facadeListAuditLog
export const createInvite = facadeCreateInvite
export const listInvites = facadeListInvites
export const revokeInvite = facadeRevokeInvite
export const getStaffPermissions = facadeGetStaffPermissions
export const setStaffPermissions = facadeSetStaffPermissions
export const createStaff = facadeCreateStaffAction
export const deleteStaff = facadeDeleteStaffAction
export const updateStaff = facadeUpdateStaffAction
export const uploadStaffAvatar = facadeUploadStaffAvatarAction
export const removeStaffPin = facadeRemoveStaffPin
export const setStaffPin = facadeSetStaffPin
export const enrollVoiceAction = facadeEnrollVoice
export const revokeVoiceAction = facadeRevokeVoice
// -- karute (sessions list — packet 05; New カルテ create is unwired in the
//    read-only batch, but speaks the action's own { error } | void contract:
//    NewKaruteDialog only renders RETURNED errors — a throw inside its
//    transition bypasses the error UI and leaves the dialog hanging (Greptile
//    P1 on #484). Honest failure through the dialog's own path, never a
//    silent success.
export const createManualKaruteRecord = async (): Promise<{ error: string }> => ({
  error:
    '[thin] createManualKaruteRecord is not wired to a facade endpoint yet ' +
    '(BFF is a backend dependency — see thin/ports/actions.vite.ts).',
})
// -- appointments (design-parity P-B 2/2). The mutation routes are RPC-style:
//    the web action's result shape rides the 2xx body VERBATIM, so these
//    ports pass it through — CancelBookingSheet branches on `code`/`burnError`
//    and must see the same discriminators on both paths. Non-2xx (auth /
//    validation / transport) maps to the actions' own { error } contract.
type MarkNoShowResult =
  | { success: true; burnError?: 'below_zero' | 'burn_failed' | 'already_burned' }
  | { error: string; code?: 'no_burnable_pack' | 'already_terminal' }

async function statusCall(path: string, body?: unknown): Promise<MarkNoShowResult> {
  // try/catch delivers the comment's transport promise: an offline/DNS reject
  // must land as { error } — the sheet awaits WITHOUT a catch, and a rejection
  // there leaves the hold-pill burst with no toast and the sheet frozen.
  try {
    const res = await getDataPort().apiFetch(path, idemPost(body))
    const parsed = (await res.json().catch(() => null)) as
      | (MarkNoShowResult & { error?: unknown })
      | { error?: { message?: string } }
      | null
    if (res.ok && parsed) return parsed as MarkNoShowResult
    const message = (parsed as { error?: { message?: string } } | null)?.error?.message
    return { error: message ?? `Request failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

export const createAppointment = async (input: {
  staffProfileId: string
  clientId: string
  startTime: string
  durationMinutes: number
  tzOffsetMinutes?: number
  title?: string
  notes?: string
}): Promise<{ id: string } | { error: string }> => {
  // try/catch: the dialog's handleSave awaits without one — a transport
  // reject would strand `saving` true and dead the save button (see
  // statusCall's identical rationale).
  try {
    const res = await getDataPort().apiFetch('/api/app/v1/appointments', idemPost(input))
    const body = (await res.json().catch(() => null)) as
      | { id?: string; error?: string | { message?: string } }
      | null
    if (res.ok && body?.id) return { id: body.id }
    // Business failure rides a 2xx { error: string }; transport/auth failures
    // carry the facade's { error: { message } } envelope.
    const message =
      typeof body?.error === 'string' ? body.error : body?.error?.message
    return { error: message ?? `Create failed (${res.status})` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

export const cancelAppointment = (
  appointmentId: string,
  input?: { reason?: string; burnPack?: boolean },
): Promise<MarkNoShowResult> =>
  statusCall(`/api/app/v1/appointments/${enc(appointmentId)}/cancel`, input ?? {})

export const markNoShowAppointment = (
  appointmentId: string,
  input: { burnPack: boolean },
): Promise<MarkNoShowResult> =>
  statusCall(`/api/app/v1/appointments/${enc(appointmentId)}/no-show`, input)

export const restoreAppointment = (
  appointmentId: string,
): Promise<{ success: true } | { error: string }> =>
  statusCall(`/api/app/v1/appointments/${enc(appointmentId)}/restore`) as Promise<
    { success: true } | { error: string }
  >

// READ: null = "no burnable pack" — the cancel sheet just hides its burn
// toggle (the web action's own catch→null contract; never a throw).
export const getBurnablePackSummary = async (
  customerId: string,
): Promise<{ packId: string; remaining: number } | null> => {
  try {
    const res = await getDataPort().apiFetch(
      `/api/app/v1/customers/${enc(customerId)}/packs/burnable`,
    )
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as
      | { summary?: { packId: string; remaining: number } | null }
      | null
    return body?.summary ?? null
  } catch {
    return null
  }
}
// -- karute-outcome (packet 07 §Build 3). The `satisfies` pin is type-only
// (erased by vite, no runtime import): under tsc the shared components check
// against the WEB action while vite swaps in this port — a signature drift
// between the two is invisible at both build gates without it (Wave W3
// blind-round catch: the web action's arity change would have shipped a
// device-runtime break).
export const updateKaruteOutcome =
  facadeUpdateKaruteOutcome satisfies typeof import('@/actions/karute-outcome').updateKaruteOutcome
// -- regenerate-karute (packet 07 Decision 2). regenerateKarute is the new
//    server-side orchestration; the entries/summary cores + the bulk backfill
//    tool stay web-internal (notWired — Decision 2 pre-ruling).
export const regenerateKarute = facadeRegenerateKarute
// Capability READ, not a mutation: false = the dev-regen button never renders
// in thin (dev tools are owner web-only; mirrors the action's own fail-closed
// catch). NOT notWired — a throw here would break profile/memory render paths
// that probe the gate on mount.
export const canUseDevRegen = async (): Promise<boolean> => false
// Drift 7/16-18: deletion lane added these to the customer profile privacy tab.
export const scheduleCustomerDeletion = notWired('scheduleCustomerDeletion')
export const cancelCustomerDeletion = notWired('cancelCustomerDeletion')
export const regenerateKaruteEntries = notWired('regenerateKaruteEntries')
export const updateKaruteSummary = notWired('updateKaruteSummary')
// -- entry edit (edit-layer W2 PR-B — edit-save only, no delete yet)
export const updateKaruteDetailEntry = facadeUpdateKaruteEntry
// -- summary edit (edit-layer W2 summary half — the 詳細記録 pencil). The
// `satisfies` pin is type-only (erased by vite — see updateKaruteOutcome's
// comment above): a signature drift between the web action and this port
// would otherwise be invisible at both build gates.
export const updateKaruteDetailSummary =
  facadeUpdateKaruteDetailSummary satisfies typeof import('@/actions/karute').updateKaruteDetailSummary
// -- entry edit history (edit-layer W2 history-sheet packet)
export const listEntryEditHistory = facadeListEntryEditHistory
export const listCustomerKaruteForRegen = notWired('listCustomerKaruteForRegen')
