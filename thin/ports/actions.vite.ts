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
export const uploadCustomerPhoto = notWired('uploadCustomerPhoto')
export const deleteCustomerPhoto = notWired('deleteCustomerPhoto')
export const getCustomerConsent = notWired('getCustomerConsent')
export const grantCustomerConsent = notWired('grantCustomerConsent')
export const revokeCustomerConsent = notWired('revokeCustomerConsent')
// -- packs
export const createPackAction = notWired('createPackAction')
export const setPackStatusAction = notWired('setPackStatusAction')
export const redeemSessionAction = notWired('redeemSessionAction')
export const dismissVisitReconcileAction = notWired('dismissVisitReconcileAction')
export const undoRedemptionAction = notWired('undoRedemptionAction')
export const logCustomerContactAction = notWired('logCustomerContactAction')
export const dismissPackAlertAction = notWired('dismissPackAlertAction')
export const setLifecycleAction = notWired('setLifecycleAction')
// -- memory
export const addMemoryItemAction = notWired('addMemoryItemAction')
export const updateMemoryItemAction = notWired('updateMemoryItemAction')
export const toggleMemoryPinAction = notWired('toggleMemoryPinAction')
export const deleteMemoryItemAction = notWired('deleteMemoryItemAction')
export const relearnCustomerMemoryAction = notWired('relearnCustomerMemoryAction')
export const upsertPassportFieldAction = notWired('upsertPassportFieldAction')
// -- karute (sessions list — packet 05; New カルテ create stays notWired,
//    read-only batch)
export const createManualKaruteRecord = notWired('createManualKaruteRecord')
// -- regenerate-karute
export const regenerateKaruteEntries = notWired('regenerateKaruteEntries')
export const updateKaruteSummary = notWired('updateKaruteSummary')
export const listCustomerKaruteForRegen = notWired('listCustomerKaruteForRegen')
