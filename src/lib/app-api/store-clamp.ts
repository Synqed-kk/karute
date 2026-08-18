// Store clamp — proves TENANCY first, then applies staff-assignment restriction
// (PLAN §5, packet point 4). The #441 cross-tenant/cross-store leak class lives
// here: on the Bearer path there is NO active-store cookie, so a store-id must
// travel as an EXPLICIT request field and be PROVEN to belong to the caller's
// business before any staff-assignment logic runs. Otherwise the old cookie
// fallback would silently resolve to the primary store — a wrong-store leak.

import type { SynqedClient } from '@synqed-kk/client'
import { staffStoresOverlap, type Capability } from '@/lib/auth/permissions'
import { AppApiError } from './errors'

/** SynqedError's HTTP status, duck-typed: a VALUE import of the SDK class
 *  would make jest load the ESM-only package (type-only imports erase), and
 *  instanceof is fragile across module instances anyway. In the clamp's try
 *  the only thrower is synqed.stores.get, so a numeric .status IS the SDK's
 *  upstream answer; a network TypeError has none. */
function upstreamStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

export interface ClampedStore {
  /** The store to scope this request to. null = unrestricted WITHIN the verified
   *  tenant (cross-store viewer, or floating staff). Never null-means-all-tenants. */
  storeId: string | null
  /** The stores the caller is restricted to, or null when unrestricted. A
   *  non-null array means store-scoped reads MUST stay within it. */
  allowedStoreIds: string[] | null
}

/**
 * Resolve the effective store scope for a facade request.
 *
 * @param synqed  a business-scoped client (built from the Bearer-resolved
 *                businessId) — so `stores.get` failing means "not this tenant".
 * @param authUserId  the confirmed profile/staff id (the store-assignment key).
 * @param capabilities  the caller's RBAC set (`stores.viewAll` = cross-store).
 * @param requestedStoreId  the explicit `store-id` request header, or null.
 *
 * The two VERDICT throws here (wrong-tenant, outside-assignment) carry
 * `reason: 'store_header'` — the client contract that "the store-id you sent
 * is un-servable for YOU", the only 403 the thin shell's stranded-pin
 * self-heal may act on. Three store_forbidden classes must NOT carry it:
 * resource ownership (karute route's "this booking belongs to a store you
 * are not assigned to" — the pin is fine, the resource isn't), the
 * fail-CLOSED assignment lookup below, and the fail-CLOSED store-verify
 * transient path in step 1 (both: verdict UNKNOWN — a transient blip must
 * not wipe a good pin, and an unlensed retry re-hits the same lookup anyway,
 * so healing there could never help).
 */
export async function resolveStoreForRequest(args: {
  synqed: Pick<SynqedClient, 'stores' | 'staffStores'>
  authUserId: string
  capabilities: Set<Capability>
  requestedStoreId: string | null
}): Promise<ClampedStore> {
  const { synqed, authUserId, capabilities, requestedStoreId } = args

  // 1. TENANCY FIRST: a supplied store-id must belong to THIS business. The
  //    client is business-scoped, so a DEFINITIVE rejection from stores.get
  //    (404/403 — core is api-key + business-id scoped; these judge the id,
  //    not the caller) = not this tenant's store → verdict, marked. Anything
  //    else (5xx / 429 / network) is UNKNOWN — fail closed WITHOUT the
  //    marker, same rule as the assignment lookup below: a transient blip
  //    must never clear a good pin (fleet round 2, P1).
  if (requestedStoreId) {
    try {
      await synqed.stores.get(requestedStoreId)
    } catch (err) {
      const status = upstreamStatus(err)
      if (status === 404 || status === 403) {
        throw new AppApiError('store_forbidden', 'store-id does not belong to this business', { reason: 'store_header' })
      }
      throw new AppApiError('store_forbidden', 'could not verify store (fail-closed)')
    }
  }

  // 2. Cross-store viewers (owner / manager / SV) range freely within the tenant.
  if (capabilities.has('stores.viewAll')) {
    return { storeId: requestedStoreId, allowedStoreIds: null }
  }

  // 3. Resolve the caller's assignment. A THROWN lookup is UNKNOWN, not floating:
  //    fail closed rather than fall through to "works everywhere" (the old
  //    fail-OPEN bug where missing/errored read as every-store).
  let assigned: string[]
  try {
    assigned = (await synqed.staffStores.get(authUserId)).store_ids
  } catch {
    throw new AppApiError('store_forbidden', 'could not resolve store assignment (fail-closed)')
  }

  // 4. DELIBERATE empty set = floating staff (works in every store) — unrestricted
  //    within the verified tenant. This is the one legitimate "no clamp" case,
  //    and it is distinguished from the errored case above by construction.
  if (assigned.length === 0) {
    return { storeId: requestedStoreId, allowedStoreIds: null }
  }

  // 5. Clamped staff: a supplied store must be one they're assigned to.
  if (requestedStoreId && !assigned.includes(requestedStoreId)) {
    throw new AppApiError('store_forbidden', 'store-id outside your assignment', { reason: 'store_header' })
  }
  return { storeId: requestedStoreId ?? assigned[0], allowedStoreIds: assigned }
}

/**
 * Staff WRITE store clamp for the facade twins (PATCH + DELETE /staff/[id],
 * POST /staff/[id]/avatar) — the Bearer twin of storeScopeError in
 * src/actions/staff.ts. Throws `store_forbidden` when the target staff works
 * only in stores this caller isn't assigned to; returns silently otherwise.
 *
 * Same three free passes as web: `stores.viewAll` and a floating caller (both
 * `allowedStoreIds: null` out of resolveStoreForRequest), plus a SELF-edit.
 * A failed lookup of the CALLER's own assignment already fails closed inside
 * resolveStoreForRequest; a failed lookup of the TARGET's fails closed here.
 * The self-pass covers DELETE as well as name/avatar: a clamped caller may
 * still remove their own row, unchanged from main — core's last-member guard
 * is the backstop there.
 *
 * The ROSTER check is web's `degraded` refusal (staffWriteInScope, F-A) on
 * this transport, and it lives INSIDE the floating branch on purpose. Core
 * answers `{ store_ids: [] }` for an id it holds no rows for, so the ONE free
 * pass it can corrupt is the floating one — the pass that asks the assignment
 * nothing. A caller with a real assignment is already judged by overlap, which
 * a roster miss cannot loosen, so charging them an uncached full-roster read
 * would buy nothing (and on the pin/voice routes it would be the SECOND such
 * read in one request). `businessId` rides the args to reach that oracle.
 *
 * `requestedStoreId: null` deliberately: these routes carry no `store-id`
 * header, and the clamp is called purely for its viewAll / assignment /
 * fail-closed resolution. The throw carries no `reason: 'store_header'` — this
 * is resource ownership (the caller's pin is fine, the row isn't), the same
 * class as the karute route's "this booking belongs to a store…".
 *
 * One code, three meanings: `store_forbidden` carries the true out-of-scope
 * refusal AND both fail-closed arms (the roster miss here, and the unreadable
 * resolution inside resolveStoreForRequest). The client copy names only the
 * first. Accepted as-is — every one of them is "you may not write this row",
 * and splitting the code would leak which lookup failed.
 */
export async function ensureStaffWriteInScope(args: {
  synqed: Pick<SynqedClient, 'stores' | 'staffStores'>
  businessId: string
  authUserId: string
  capabilities: Set<Capability>
  targetStaffId: string
}): Promise<void> {
  const { synqed, businessId, authUserId, capabilities, targetStaffId } = args
  if (targetStaffId === authUserId) return
  const { allowedStoreIds } = await resolveStoreForRequest({
    synqed,
    authUserId,
    capabilities,
    requestedStoreId: null,
  })
  // A cross-store viewer is finished here, and must NOT be charged the roster
  // read below — resolveStoreForRequest returned for them without consulting
  // an assignment at all. `allowedStoreIds: null` alone cannot say which of
  // the two unclamped shapes this is; the capability can.
  if (capabilities.has('stores.viewAll')) return
  if (!allowedStoreIds) {
    // FLOATING — the only pass a roster miss can corrupt (see the doc above).
    // Web parity, staffWriteInScope's `degraded` arm: an auth id the roster
    // cannot place has no assignment to read, so nothing about it is vouched
    // for. Same oracle the pin/voice routes use for actingStaffId/selfUserId.
    //
    // LAZY import, load-bearing: customer-facade's static graph reaches
    // @/lib/customers/queries and through it the ESM-only SDK, and this
    // module's header rule is that the SDK stays OUT of its graph (a static
    // import here breaks every suite that loads a facade route without
    // mocking the client).
    const { resolveSelfStaffId } = await import('./customer-facade')
    if (!(await resolveSelfStaffId(businessId, authUserId))) {
      throw new AppApiError(
        'store_forbidden',
        'your staff record could not be resolved (fail-closed)',
      )
    }
    return
  }
  const targetStores = await synqed.staffStores
    .get(targetStaffId)
    .then((r) => r.store_ids)
    .catch(() => null)
  if (staffStoresOverlap(allowedStoreIds, targetStores)) return
  throw new AppApiError(
    'store_forbidden',
    'this staff member belongs to a store you are not assigned to',
  )
}

/**
 * EXPORT-HARDENED store lens (packet 23 fix round, blind-fleet finding).
 *
 * Bulk-PII surfaces follow web's /api/export rule, which is DELIBERATELY
 * stricter than the ordinary-read convention above: ONLY `stores.viewAll`
 * exports business-wide. Floating staff (empty assignment — `allowedStoreIds:
 * null` from resolveStoreForRequest, indistinguishable there from viewAll)
 * clamp to their store lens: the tenant-validated `store-id` header if one
 * rode the request, else the business's primary store — the Bearer twin of
 * web's `activeStore ?? getPrimaryStoreId()`. Web earned this rule from two
 * Greptile P1s (see /api/export's own comment); reusing the list convention
 * here silently reopened that bug class on the facade.
 *
 * FAIL CLOSED: a floating caller whose store lens cannot be resolved
 * (stores.list failed / zero stores) is refused, never widened.
 *
 * Returns the storeId to filter by, or undefined = business-wide (viewAll only).
 */
export async function resolveExportStoreId(args: {
  synqed: Pick<SynqedClient, 'stores' | 'staffStores'>
  authUserId: string
  capabilities: Set<Capability>
  requestedStoreId: string | null
}): Promise<string | undefined> {
  // Full clamp first — keeps every tenancy/assignment validation and
  // fail-closed rule above, including header-store verification.
  const clamp = await resolveStoreForRequest(args)

  // Mirror web: a cross-store viewer NEVER store-filters the export, even if
  // an explicit store-id rode the request.
  if (args.capabilities.has('stores.viewAll')) return undefined

  // Clamped staff: resolveStoreForRequest's storeId is requested ?? assigned[0]
  // by construction — always concrete.
  if (clamp.allowedStoreIds != null) return clamp.storeId ?? clamp.allowedStoreIds[0]

  // Floating staff: header store already passed tenancy validation above.
  if (clamp.storeId) return clamp.storeId
  try {
    const { stores } = await args.synqed.stores.list()
    const primary = stores.find((s) => s.is_primary)?.id ?? stores[0]?.id
    if (primary) return primary
  } catch {
    /* fall through to fail-closed */
  }
  throw new AppApiError('store_forbidden', 'could not resolve your store scope (fail-closed)')
}
