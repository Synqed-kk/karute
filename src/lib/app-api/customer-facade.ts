// Shared helpers for the customer-profile mutation facade (packet 06 batch 3).
// HTTP-layer concerns only — tenancy proof (for a clean 404 status) and the
// selfStaffId resolution (the #452 fail-closed posture). The WRITE logic lives
// in the server-action WithClient cores; these never touch it.

import { AppApiError } from './errors'
import { getCustomerWithClient } from '@/lib/customers/queries'
import { getMemoryItemCustomerId } from '@/lib/karute/customer-memory'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { newSynqedClient } from '@/lib/synqed/client'

type ScopedClient = Pick<Awaited<ReturnType<typeof newSynqedClient>>, 'customers'>

/** Prove the customer belongs to this business (the business-scoped client reads
 *  a cross-tenant id as not-found) → a clean 404 BEFORE any write. Same oracle
 *  the WithClient cores use, run here so the ROUTE returns the right status. */
export async function proveCustomerInBusiness(synqed: ScopedClient, id: string): Promise<void> {
  try {
    await getCustomerWithClient(synqed, id)
  } catch {
    throw new AppApiError('not_found', 'customer not found in this business')
  }
}

/** Resolve the memory item's customer and prove tenancy → 404 on a missing or
 *  cross-tenant item id, before any write. Returns the owning customerId. */
export async function proveMemoryItemInBusiness(synqed: ScopedClient, itemId: string): Promise<string> {
  // ONE message for both misses (missing item / cross-tenant item) — distinct
  // messages let a caller confirm a foreign item id exists (existence oracle,
  // Fable spot-audit finding; same class the AI相談 review killed).
  const customerId = await getMemoryItemCustomerId(itemId)
  if (!customerId) throw new AppApiError('not_found', 'memory item not found in this business')
  try {
    await proveCustomerInBusiness(synqed, customerId)
  } catch {
    throw new AppApiError('not_found', 'memory item not found in this business')
  }
  return customerId
}

/** Prove a pack belongs to this customer (whose tenancy is proven separately) →
 *  a clean 404 on a cross-tenant or wrong-customer packId BEFORE any redemption.
 *  The business-scoped client only lists THIS business's packs for the customer,
 *  so a packId absent from that list is not reachable here. */
export async function provePackForCustomer(
  synqed: Pick<Awaited<ReturnType<typeof newSynqedClient>>, 'packs'>,
  customerId: string,
  packId: string,
): Promise<void> {
  const { listCustomerPacksWithClient } = await import('@/lib/packs/store')
  const packs = await listCustomerPacksWithClient(synqed, customerId)
  if (!packs.some((p) => p.id === packId)) {
    throw new AppApiError('not_found', 'pack not found for this customer')
  }
}

/** Prove a photo belongs to this customer (whose tenancy is proven separately) →
 *  a clean 404 on a cross-tenant or wrong-customer photoId BEFORE any delete.
 *  Same shape as provePackForCustomer above: listPhotos IS the ownership
 *  read (the business-scoped client only lists THIS business's photos for
 *  the customer, so a photoId absent from that list is not reachable here) —
 *  core has no separate photo-ownership endpoint to prove against instead. */
export async function provePhotoForCustomer(
  synqed: Pick<Awaited<ReturnType<typeof newSynqedClient>>, 'customers'>,
  customerId: string,
  photoId: string,
): Promise<void> {
  const { photos } = await synqed.customers.listPhotos(customerId)
  if (!photos.some((p) => p.id === photoId)) {
    throw new AppApiError('not_found', 'photo not found for this customer')
  }
}

/** Require an Idempotency-Key on an effectful POST (contract §8), and RETURN it
 *  so the route can hand it to a write that knows how to dedupe on it.
 *  Anthony shipped the first such write (core #69, SDK 1.28.0): redemption
 *  creates carrying the key replay the stored row instead of burning twice.
 *  Every OTHER facade write is still AT-LEAST-ONCE — presence-only, a retried
 *  request re-runs — so routes that ignore the return value are unchanged.
 *  ponytail: per-write adoption, not a generic dedup store; wire the next write
 *  the same way when core grows a key scope for it. */
export function requireIdempotencyKey(req: { headers: Headers }): string {
  const key = req.headers.get('idempotency-key')?.trim()
  if (!key) throw new AppApiError('validation', 'Idempotency-Key header is required')
  // Bound it at the trust boundary: the value is now FORWARDED as a header and
  // persisted by core, so an unbounded client string must not ride through.
  // Every live client sends a 36-char UUID (crypto.randomUUID, idemPost), so no
  // legitimate caller can reach this.
  if (key.length > 200) {
    throw new AppApiError('validation', 'Idempotency-Key must be at most 200 characters')
  }
  return key
}

/** The acting staff id for a facade write: the verified auth user, ONLY if they
 *  are a member of the business staff roster (batch-1/2 selfStaffId pattern).
 *  Returns null when unresolvable — callers that require it fail closed. */
export async function resolveSelfStaffId(businessId: string, authUserId: string): Promise<string | null> {
  const staffList = await staffListByBusinessOrThrow(businessId)
  return staffList.some((s) => s.id === authUserId) ? authUserId : null
}
