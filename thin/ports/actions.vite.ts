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
// facade re-derives 購入回数 / 合計金額 / burn pairing server-side, so the port
// forwards the client's fields verbatim and never derives money or pairing.
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
  totalPrice?: number | null
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
// The web updateKaruteOutcome takes (karuteRecordId, customerId, outcome), but the
// facade DERIVES customerId server-side from the karute record (never trusts the
// client) — so the port drops the customerId arg and forwards only the outcome.
async function facadeUpdateKaruteOutcome(
  karuteRecordId: string,
  _customerId: string,
  outcome: { status: string; reason?: string | null; isFirstVisit?: boolean },
): Promise<{ error?: string }> {
  void _customerId // path is karuteRecordId; customerId is server-derived
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
  const res = await getDataPort().apiFetch('/api/app/v1/karute', idemPost(input))
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
export const listAssignableStaff = notWired('listAssignableStaff')
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

// -- stores (chrome packet — the StoreSwitcher's one mutation). The web
// version writes the karute_active_store cookie; the shell persists the
// store-id header source instead and reloads so every screen re-fetches
// through the new lens. Validity is the SERVER's call: the facade clamp
// fails closed on a store outside the caller's scope, so no pre-validation
// here. Reload is safe from the switcher — it is hidden while recording.
export const setActiveStore = async (
  storeId: string,
): Promise<{ ok: true } | { error: string }> => {
  const { setThinActiveStore } = await import('../chrome/store-pref')
  setThinActiveStore(storeId)
  window.location.reload()
  return { ok: true }
}
export const listStores = notWired('listStores')
export const createStore = notWired('createStore')
export const updateStore = notWired('updateStore')
export const getActiveStoreId = notWired('getActiveStoreId')
export const getStaffStores = notWired('getStaffStores')
export const setStaffStores = notWired('setStaffStores')
export const getEntitlement = notWired('getEntitlement')
export const startRecordingSession = facadeStartRecordingSession
// -- settings (design-parity packet 12 §S1) — organization/theme/ai/recording/
// packs tabs are LIVE this slice; upsertOrgSettings is the one write all five
// share. 店舗/スタッフ/同期/監査ログ render an in-shell 準備中 panel
// (SettingsShell's pendingTabIds) — SettingsShell still statically imports
// every section unconditionally, so StoresSection/StaffSection/SyncSection/
// AuditLogSection (and their children: InviteStaffDialog, StaffList,
// StaffForm, PinSetup, VoiceEnrollmentDialog) are ALL in the thin bundle's
// import graph regardless of which tabs are pending — Rollup requires every
// named import they make from @/actions/* to resolve, hence the stub roster
// below. None of these run in S1 (their tabs never render past the pending
// intercept); notWired throws loudly if that ever changes without a
// deliberate wire-up.
export const upsertOrgSettings = facadeUpsertOrgSettings
export const getOrgSettings = notWired('getOrgSettings')
export const listAuditLog = notWired('listAuditLog')
export const createInvite = notWired('createInvite')
export const listInvites = notWired('listInvites')
export const revokeInvite = notWired('revokeInvite')
export const getStaffPermissions = notWired('getStaffPermissions')
export const setStaffPermissions = notWired('setStaffPermissions')
export const createStaff = notWired('createStaff')
export const deleteStaff = notWired('deleteStaff')
export const updateStaff = notWired('updateStaff')
export const uploadStaffAvatar = notWired('uploadStaffAvatar')
export const removeStaffPin = notWired('removeStaffPin')
export const setStaffPin = notWired('setStaffPin')
export const enrollVoiceAction = notWired('enrollVoiceAction')
export const revokeVoiceAction = notWired('revokeVoiceAction')
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
// -- karute-outcome (packet 07 §Build 3)
export const updateKaruteOutcome = facadeUpdateKaruteOutcome
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
export const listCustomerKaruteForRegen = notWired('listCustomerKaruteForRegen')
