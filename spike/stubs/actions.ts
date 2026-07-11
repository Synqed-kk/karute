// STUB for every `@/actions/*` server-action module the profile client subtree
// imports (customers, packs, memory, regenerate-karute). In Next these are
// `'use server'` RPC references; in a non-Next bundle importing them pulls the
// real server code (synqed-core client + SUPABASE_SERVICE_ROLE_KEY + next/headers
// cookies) into the browser. The thin target must intercept them and, in a real
// build, replace each with a fetch() to a data/mutation endpoint.
//
// ponytail: named exports resolve lazily via a Proxy so we never have to
// enumerate the ~30 action names by hand — any import name returns a no-op that
// logs. Upgrade path: swap each no-op for a typed fetch() to the BFF.
const noop = async (...args: unknown[]) => {
  console.warn('[spike stub] server action called (no-op):', args)
  return { ok: true }
}

export default new Proxy(
  {},
  {
    get: () => noop,
  },
) as Record<string, typeof noop>

// The FULL export surface of all four `@/actions/*` modules the profile tree
// touches (customers, packs, memory, regenerate-karute). Rollup resolves named
// imports statically, so every name must exist. This list IS the mutation-RPC
// contract the thin target would have to reimplement as fetch() calls — 28
// server actions behind this one screen.
// -- customers
export const createCustomer = noop
export const createQuickCustomer = noop
export const listAssignableStaff = noop
export const updateCustomer = noop
export const deleteCustomer = noop
export const listCustomerPhotos = noop
export const uploadCustomerPhoto = noop
export const deleteCustomerPhoto = noop
export const getCustomerConsent = noop
export const grantCustomerConsent = noop
export const revokeCustomerConsent = noop
// -- packs
export const createPackAction = noop
export const setPackStatusAction = noop
export const redeemSessionAction = noop
export const dismissVisitReconcileAction = noop
export const undoRedemptionAction = noop
export const logCustomerContactAction = noop
export const dismissPackAlertAction = noop
export const setLifecycleAction = noop
// -- memory
export const addMemoryItemAction = noop
export const updateMemoryItemAction = noop
export const toggleMemoryPinAction = noop
export const deleteMemoryItemAction = noop
export const relearnCustomerMemoryAction = noop
export const upsertPassportFieldAction = noop
// -- regenerate-karute
export const regenerateKaruteEntries = noop
export const updateKaruteSummary = noop
export const listCustomerKaruteForRegen = noop
