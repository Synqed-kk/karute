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
  purchaseRound?: number
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
export const getCustomerConsent = notWired('getCustomerConsent')
export const grantCustomerConsent = notWired('grantCustomerConsent') // grant = batch 5
export const revokeCustomerConsent = facadeRevokeCustomerConsent
// -- packs
export const createPackAction = facadeCreatePack
export const setPackStatusAction = notWired('setPackStatusAction') // status flip = later batch
export const redeemSessionAction = facadeRedeemSession
export const dismissVisitReconcileAction = notWired('dismissVisitReconcileAction')
export const undoRedemptionAction = notWired('undoRedemptionAction') // undo = later batch
export const logCustomerContactAction = notWired('logCustomerContactAction')
export const dismissPackAlertAction = notWired('dismissPackAlertAction')
export const setLifecycleAction = facadeSetLifecycle
// -- memory
export const addMemoryItemAction = facadeAddMemoryItem
export const updateMemoryItemAction = facadeUpdateMemoryItem
export const toggleMemoryPinAction = facadeToggleMemoryPin
export const deleteMemoryItemAction = facadeDeleteMemoryItem
export const relearnCustomerMemoryAction = facadeRelearnCustomerMemory
export const upsertPassportFieldAction = facadeUpsertPassportField
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
// -- regenerate-karute
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
