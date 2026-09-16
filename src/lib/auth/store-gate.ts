
import { cache } from 'react'

// THE UNASSIGNED STORE GATE — one home for the rule "a staff member with no
// store assigned sees nothing and does nothing" (⚖ Liam 2026-09-16).
//
// Its STATIC graph is deliberately empty (react's cache and nothing else). Both
// resolvers, ~20 read backstops, the write-stamping doors and the capability
// seam all consult this module, on both transports — so importing it must cost
// a caller nothing, and no suite must ever have to stub it. That is why it sits
// apart from store-scope.ts (cookie session, service client) and store-clamp.ts
// (SDK), and why the one function that does need the SDK imports it lazily,
// inside its own body.

/**
 * THE ONE GUARD for "this actor reaches no store at all" — a CLAMPED scope
 * (`allowedStoreIds` is an array, not null) whose array is EMPTY.
 *
 * It is the boolean twin of `customerLensFor`'s `null` arm (store-scope.ts),
 * lifted out so every store-scoped read and write can spell the same refusal
 * without inventing a lens it doesn't need. The rule at every call site is
 * identical: an actor who reaches no store gets an EMPTY result or a refusal —
 * NEVER a business-wide one. `storeId ?? undefined` means "no filter" to core,
 * so without this guard "sees nothing" silently becomes "sees everything"
 * (CENSUS-UNASSIGNED-FLIP.md, the whole falls-open list).
 *
 * The three shapes it must NOT fire on, all unchanged:
 *   - `allowedStoreIds: null` → unclamped (stores.viewAll, floating staff, a
 *     degraded lookup) — today's behaviour, business-wide.
 *   - a clamped actor WITH stores → their own lens, business-wide never.
 *   - a scope that failed to resolve at all — callers already catch and refuse.
 *
 * ponytail: dead in production until the gate itself lands — both resolvers
 * still answer `allowedStoreIds: null` for an empty assignment today, so
 * nothing reaches this predicate yet. That is the point: the backstops are
 * proved standing on their own BEFORE the flip that makes them load-bearing
 * (⚖ the layer matrix: each layer must hold with the layers above it OFF).
 */
export function reachesNoStore(scope: {
  allowedStoreIds: readonly string[] | null
}): boolean {
  return scope.allowedStoreIds !== null && scope.allowedStoreIds.length === 0
}

/**
 * The refusal a store-UNASSIGNED actor hears on a WRITE that has to name a
 * store (a karute with no linked booking, a recording job). Japanese, the
 * settings register — the staff member's next move is to ask a manager, not to
 * retry. It lives here rather than in the `'use server'` action that throws it:
 * such a file may only export async functions.
 */
export const UNASSIGNED_STORE_DENIAL =
  '担当店舗が未設定のため保存できません。管理者に店舗の割り当てを依頼してください。'

/**
 * The refusal when an unassigned actor tries to PIN a store (the switcher's
 * third flip point, actions/stores.ts). Same register as the empty screen the
 * app shell renders — the screen's own title/body live in the message
 * catalogues (ja/en) because they are UI copy; this one is a server answer.
 */
export const STORE_UNASSIGNED_DENIAL =
  '担当店舗が未設定です。管理者に店舗の割り当てを依頼してください。'

/**
 * THE DEFINITION, in one place (⚖ Liam 2026-09-16, PKT-P2 §Definitions):
 *
 *   unassigned := NOT `stores.viewAll`
 *                 ∧ the staff_stores lookup SUCCEEDED with 0 rows
 *                 ∧ the business has ≥ 2 stores
 *
 * Every other shape keeps exactly today's behaviour, and each exclusion is
 * load-bearing:
 *
 *   - `viewAll` — the assignment is never consulted for a cross-store role.
 *   - `assigned: null` — the lookup FAILED (`degraded`, ⚖ 8/17 F-A). A blipped
 *     core call must not blank a working staff member mid-shift; writes already
 *     fail closed on `degraded` and reads are unchanged by the shipped
 *     convention. Never conflate the two.
 *   - SINGLE-STORE CARVE-OUT — with exactly one store, an empty assignment IS
 *     that store: there is nothing to isolate from. This returns `unclamped`,
 *     i.e. BYTE-IDENTICAL to today, rather than clamping to `[theOnlyStore]`.
 *     The packet's Layer-3 line suggested the latter; it would flip
 *     `sourceStoreOutOfScope` from false to TRUE for every legacy null-store
 *     record in a single-store salon (a write refusal La Estro would feel the
 *     day this ships) while buying no isolation at all. The packet's own proof
 *     line — "single-store floating = unchanged" — is the reading kept here.
 *   - `storeCount: null` — the store list could not be read. UNKNOWN is not
 *     "≥2": an outage must not blank every floating staff member at once
 *     (⚖ reversible-by-default). The 1→2 store transition backfills real
 *     assignments, so this arm only ever covers a genuine outage.
 */
export type StoreAssignmentVerdict = 'viewAll' | 'clamped' | 'unassigned' | 'unclamped'

export function storeAssignmentVerdict(facts: {
  viewAll: boolean
  /** staff_stores rows, or null when the lookup itself failed. */
  assigned: readonly string[] | null
  /** How many stores the business has; null = the list could not be read. */
  storeCount: number | null
}): StoreAssignmentVerdict {
  if (facts.viewAll) return 'viewAll'
  // ⚖ ADJUDICATED AND CLOSED (fold round 2, 2026-09-16) — do not re-open.
  // `assigned === null` means the staffStores.get lookup ITSELF failed, and
  // that can happen to ANY non-viewAll staff member, not just unplaced ones.
  // Failing closed here would blank every branch-restricted person in the
  // business — カルテ, 予約, dashboard, the whole floor — on any blip, which is
  // an order of magnitude more blast radius than the gate itself has. It also
  // overturns the standing ⚖ 8/17 F-A split the codebase implements
  // everywhere: writes fail closed on degraded, reads are unchanged
  // (staffWriteInScope · menus.storeScopeError · viewerScopeForActs → [] ·
  // resolveStoreForRequest step 3 throws). The write plane IS already tight;
  // this is the read plane, and it stays as it is.
  if (facts.assigned === null) return 'unclamped' // degraded — today's behaviour
  if (facts.assigned.length > 0) return 'clamped'
  if (facts.storeCount !== null && facts.storeCount >= 2) return 'unassigned'
  // ⚠ THE PACKET CONTRADICTS ITSELF HERE, and this line is the ruling (⚖ Liam
  // 2026-09-16 16:1x, confirmed): PKT-P2 §Layer-3 asked the carve-out to resolve
  // as `[theOnlyStore]`, while PKT-P2 §Proof asked for "single-store floating =
  // unchanged". The second wins — see the carve-out paragraph above for why
  // clamping would refuse legacy null-store writes for nothing.
  //
  // ⚖ THE `storeCount === null` ARM IS ALSO ADJUDICATED AND CLOSED (fold round
  // 2) — do not re-open. Exposed: only an actor who is non-viewAll, whose
  // assignment lookup SUCCEEDED with zero rows, and whose stores.list FAILED —
  // a partial outage where one core endpoint answers and the other does not.
  // Cost of failing closed instead: every floating staff member of a
  // SINGLE-store salon — most of La Estro's roster today — blanked mid-shift,
  // with no way to fix it, for a fact that is not even true of them (a
  // one-store salon has nothing to isolate). A certain cost against a rare
  // exposure, and exactly what ⚖ reversible-by-default exists to prevent. If it
  // is ever wanted tighter, the honest edit is NOT flipping this arm — it is
  // removing the unknown: memoize the last successful store count per business
  // and consult it when stores.list throws.
  return 'unclamped' // single-store carve-out · zero stores · unreadable list
}

/**
 * THE GATE'S ONE RESOLUTION — is this actor a staff member of a multi-store
 * business whom nobody has placed in a store yet?
 *
 * Per-request memo (React cache, keyed on both args) so Layer 1 (the capability
 * seam) and Layer 2 (both front gates) resolve it ONCE. Cheap by construction:
 * a `stores.viewAll` holder never reaches it, an ASSIGNED staff member costs
 * one `staffStores.get`, and only a genuinely empty assignment pays the second
 * call.
 *
 * `businessId` is REQUIRED on the Bearer path and must come from the VERIFIED
 * token — resolving the client from the cookie session there would read another
 * tenant. Omitted = the cookie path, where getSynqedClient is the right client.
 *
 * FAIL SAFE, deliberately: every failure — no client, an unreadable assignment,
 * an unreadable store list, a graph that has no SDK at all — answers `false`,
 * i.e. today's behaviour. "Unknown" is never "unassigned": a core blip must not
 * blank a working salon mid-shift (⚖ reversible-by-default), and the gate's
 * whole value is that it fires on a FACT (a successful lookup with zero rows),
 * never on an absence of one.
 *
 * ⚠ The SDK import is LAZY — a top-level import would drag the ESM-only
 * @synqed-kk/client into every jest graph that touches this module, and this
 * module is imported by the capability seam, i.e. by nearly all of them.
 */
export const actorIsUnassigned = cache(
  async (uid: string, businessId?: string): Promise<boolean> => {
    try {
      const { getSynqedClient, newSynqedClient } = await import('@/lib/synqed/client')
      const synqed = businessId ? newSynqedClient(businessId) : await getSynqedClient()
      const assigned = await synqed.staffStores
        .get(uid)
        .then((r) => r.store_ids)
        .catch(() => null)
      if (assigned === null || assigned.length > 0) return false
      const storeCount = await synqed.stores
        .list()
        .then((r) => r.stores.length)
        .catch(() => null)
      return (
        storeAssignmentVerdict({ viewAll: false, assigned, storeCount }) === 'unassigned'
      )
    } catch {
      return false
    }
  },
)
