// THE UNASSIGNED STORE GATE — one home for the rule "a staff member with no
// store assigned sees nothing and does nothing" (⚖ Liam 2026-09-16).
//
// PURE + DEPENDENCY-FREE on purpose. Both resolvers, ~20 read backstops and the
// write-stamping doors all consult it, on both transports, and a predicate this
// widely used must never be something a suite has to stub: it lives apart from
// store-scope.ts (cookie session, service client) and store-clamp.ts (SDK) so
// importing it costs a caller nothing and mocking it is never necessary.

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
