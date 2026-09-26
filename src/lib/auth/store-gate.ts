
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
 * It also fires on a DEGRADED web scope: since Round 2 (2026-09-24, D-S16-4)
 * an unreadable assignment arrives as `[]` too. The shapes it must NOT fire on:
 *   - `allowedStoreIds: null` → unclamped (stores.viewAll, floating staff).
 *   - a clamped actor WITH stores → their own lens, business-wide never.
 *   - a scope that failed to resolve at all — callers already catch and refuse.
 *
 * The (app) layout's front gate answers both `[]` shapes before any page
 * renders; this is the layer beneath it (⚖ the layer matrix: each layer must
 * hold with the layers above it OFF).
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
 * The refusal when the actor's assignment could not be READ (an outage, or a
 * caller the roster cannot place) and they try to PIN a store (Round 2). Not
 * the unassigned answer: the next move is to retry, not to ask a manager.
 */
export const STORE_SCOPE_UNVERIFIED_DENIAL =
  '担当店舗の割り当てを確認できないため、現在は店舗を切り替えられません。少し時間をおいてから、もう一度お試しください。'

/**
 * THE DEFINITION, in one place (⚖ Liam 2026-09-16, PKT-P2 §Definitions):
 *
 *   unassigned := NOT `stores.viewAll`
 *                 ∧ the staff_stores lookup SUCCEEDED with 0 rows
 *                 ∧ the business has ≥ 2 stores
 *
 * Each other verdict, and why it is kept apart:
 *
 *   - `viewAll` — the assignment is never consulted for a cross-store role.
 *   - `unknown` — a fact could not be READ: the assignment lookup failed
 *     (`assigned: null`), or it found 0 rows and the store list failed
 *     (`storeCount: null`). Never "unassigned" (an outage is not a staffing
 *     fact) and, since Round 2 (2026-09-24, D-S16-4, discussed, default),
 *     never "unclamped": it reaches NO store on both transports — the web shows
 *     its outage screen, the facade refuses. It supersedes, for the read
 *     plane, the 8/17 F-A split and the 9/16 "unknown ⇒ unclamped" arms.
 *   - SINGLE-STORE CARVE-OUT — with exactly one store, an empty assignment IS
 *     that store: there is nothing to isolate from. This returns `unclamped`,
 *     i.e. BYTE-IDENTICAL to today, rather than clamping to `[theOnlyStore]`.
 *     The packet's Layer-3 line suggested the latter; it would flip
 *     `sourceStoreOutOfScope` from false to TRUE for every legacy null-store
 *     record in a single-store salon (a write refusal La Estro would feel the
 *     day this ships) while buying no isolation at all. The packet's own proof
 *     line — "single-store floating = unchanged" — is the reading kept here.
 *     It needs a KNOWN count: with the store list unreadable nobody can say the
 *     business is single-store, so that case is `unknown` (above), not this.
 */
export type StoreAssignmentVerdict = 'viewAll' | 'clamped' | 'unassigned' | 'unclamped' | 'unknown'

/**
 * The ONE place the single-store carve-out's business size is computed
 * (Greptile G-2, 2026-09-17), used by BOTH `actorIsUnassigned` below and the
 * facade's `resolveWriteStoreScope` (store-clamp.ts) so they cannot drift.
 *
 * The rule: active stores, or all stores when none is active — an
 * all-archived multi-store business still has something to isolate. An
 * inactive (archived/closed) store is not a real second location a floating
 * staff member could be assigned to, so it must not turn the carve-out off
 * for a genuinely single-active-store business — but a business with ≥2
 * store ROWS that has archived every one of them is still multi-store for
 * this gate: an unassigned staffer there must not fall through to the
 * business-wide view just because nothing is currently marked active (⚖
 * session-model fold, 2026-09-17 — closes the posture note from the S2
 * delta-verify).
 *
 * ⚖ Greptile fold, G-2b (2026-09-17): only an EXPLICIT `false` counts as
 * inactive — a missing flag counts as active. A row with no `active` field at
 * all (SDK skew this codebase already casts around, cf. `deleted_at` /
 * `first_visit_at`) must not silently read as closed: that would let a
 * genuine multi-store business count as single-store and switch the
 * unassigned gate OFF. Unknown must never turn the gate off.
 */
export function storeCountForGate(rows: readonly { active?: boolean | null }[]): number {
  const active = rows.filter(isActiveStore).length
  return active === 0 && rows.length > 0 ? rows.length : active
}

/** One row's answer to "is this store active?" as the gate counts it — only an
 *  EXPLICIT `false` is inactive (G-2b above). Shared with the 1→2 backfill
 *  (lib/stores/stores.core.ts) so the two can never read "active" differently. */
export function isActiveStore(row: { active?: boolean | null }): boolean {
  return row.active !== false
}

export function storeAssignmentVerdict(facts: {
  viewAll: boolean
  /** staff_stores rows, or null when the lookup itself failed. */
  assigned: readonly string[] | null
  /** The business's store count for this gate (Greptile G-2, `storeCountForGate`
   *  above — active stores, or all stores when none is active); null = the
   *  list could not be read. */
  storeCount: number | null
}): StoreAssignmentVerdict {
  if (facts.viewAll) return 'viewAll'
  // Round 2 (D-S16-4): an unreadable fact reaches no store — a blip costs the
  // floor a retry (the outage screen), never another branch's data.
  if (facts.assigned === null) return 'unknown'
  if (facts.assigned.length > 0) return 'clamped'
  // Accepted cost: during a stores.list outage a SINGLE-store salon's floating
  // staff see the outage screen too. Shrink it by removing the unknown
  // (memoize the last good store count), never by returning `unclamped` here.
  if (facts.storeCount === null) return 'unknown'
  if (facts.storeCount >= 2) return 'unassigned'
  // ⚠ THE PACKET CONTRADICTS ITSELF HERE, and this line is the ruling (⚖ Liam
  // 2026-09-16 16:1x, confirmed): PKT-P2 §Layer-3 asked the carve-out to resolve
  // as `[theOnlyStore]`, while PKT-P2 §Proof asked for "single-store floating =
  // unchanged". The second wins — see the carve-out paragraph above for why
  // clamping would refuse legacy null-store writes for nothing.
  return 'unclamped' // single-store carve-out · zero stores
}

/**
 * THE GATE'S ONE RESOLUTION — where does this non-viewAll actor stand: clamped,
 * unassigned (a staff member of a multi-store business whom nobody has placed
 * in a store yet), floating (unclamped), or unknown?
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
 * Every failure — no client, an unreadable assignment or store list, a graph
 * with no SDK — is `unknown` (Round 2): never "unassigned" (the gate fires on a
 * FACT, never on an absence of one) and never "unclamped".
 *
 * ⚠ The SDK import is LAZY — a top-level import would drag the ESM-only
 * @synqed-kk/client into every jest graph that touches this module, and this
 * module is imported by the capability seam, i.e. by nearly all of them.
 */
export const actorStoreVerdict = cache(
  async (uid: string, businessId?: string): Promise<StoreAssignmentVerdict> => {
    try {
      const { getSynqedClient, newSynqedClient } = await import('@/lib/synqed/client')
      const synqed = businessId ? newSynqedClient(businessId) : await getSynqedClient()
      const assigned = await synqed.staffStores
        .get(uid)
        .then((r) => r.store_ids)
        .catch(() => null)
      if (assigned === null || assigned.length > 0) {
        return storeAssignmentVerdict({ viewAll: false, assigned, storeCount: null })
      }
      const storeCount = await synqed.stores
        .list()
        .then((r) => storeCountForGate(r.stores))
        .catch(() => null)
      return storeAssignmentVerdict({ viewAll: false, assigned, storeCount })
    } catch {
      return 'unknown'
    }
  },
)

/** True ONLY on the `unassigned` fact (shares actorStoreVerdict's memo). */
export async function actorIsUnassigned(uid: string, businessId?: string): Promise<boolean> {
  return (await actorStoreVerdict(uid, businessId)) === 'unassigned'
}

/**
 * The refusal when a new staff card is submitted with NO store in a business
 * that has more than one (⚖ Liam 2026-09-16: every new staff gets a store at
 * creation). Machine code, mapped to copy at each door.
 */
export const STAFF_STORE_REQUIRED = 'STORE_REQUIRED_AT_CREATION'

/**
 * The refusal when a FRESH invite arrives with no name (⚖ Liam 2026-09-16). A
 * fresh invite now mints the staff card, and a card must be named by a person,
 * never by their email address — so the invite is refused rather than guessed
 * at. Machine code, mapped to copy at each door.
 */
export const INVITE_NAME_REQUIRED = 'INVITE_NAME_REQUIRED'

/**
 * The refusal when a PENDING invite to this address already exists (⚖ fold
 * round 3, F4). It lived in actions/invites.ts until the G1 fold: that file is
 * `'use server'`, and Next refuses a non-async export from such a module — the
 * Vercel build failed on it while tsc and jest saw nothing. It joins its two
 * siblings above for the same bundle reason they are here: this module carries
 * no translations, so /join's pre-auth graph can reach it.
 */
export const INVITE_ALREADY_PENDING = 'INVITE_ALREADY_PENDING'

/**
 * The refusal when the staff card a FRESH invite has to mint could not be made
 * at all — the client has no staff port, or core rejected the write (⚖ G6).
 * The rejection used to escape createInviteCore as an unhandled Server Action
 * error, whose message production strips, so the dialog showed nothing usable;
 * the no-port case answered with an English literal. Machine code, mapped to
 * copy at each door, like its siblings above.
 */
export const STAFF_CREATE_FAILED = 'STAFF_CREATE_FAILED'

/**
 * The refusal when an invite's role would hand the new person a capability the
 * INVITER does not hold (hold what you grant — the rule setStaffPermissionsCore
 * already enforces on permission edits). The accepted role becomes that role's
 * full preset, so a custom role holding staff.invite could otherwise mint a
 * manager. Machine code, mapped to copy at each door, like its siblings above.
 */
export const INVITE_ROLE_EXCEEDS_CALLER = 'INVITE_ROLE_EXCEEDS_CALLER'
