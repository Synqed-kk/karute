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
  const customerId = await getMemoryItemCustomerId(itemId)
  if (!customerId) throw new AppApiError('not_found', 'memory item not found')
  await proveCustomerInBusiness(synqed, customerId)
  return customerId
}

/** Require an Idempotency-Key on an effectful POST (contract §8). Presence is
 *  enforced here so a client can't omit it; de-duplication itself is a
 *  backend/store concern (Anthony) not yet built, so the current guarantee is
 *  AT-LEAST-ONCE — a retried request re-runs.
 *  ponytail: presence-only; wire a real dedup store here when Anthony ships it. */
export function requireIdempotencyKey(req: { headers: Headers }): void {
  const key = req.headers.get('idempotency-key')?.trim()
  if (!key) throw new AppApiError('validation', 'Idempotency-Key header is required')
}

/** The acting staff id for a facade write: the verified auth user, ONLY if they
 *  are a member of the business staff roster (batch-1/2 selfStaffId pattern).
 *  Returns null when unresolvable — callers that require it fail closed. */
export async function resolveSelfStaffId(businessId: string, authUserId: string): Promise<string | null> {
  const staffList = await staffListByBusinessOrThrow(businessId)
  return staffList.some((s) => s.id === authUserId) ? authUserId : null
}
