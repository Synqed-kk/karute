// A NEW STAFF CARD, BORN IN A STORE (⚖ Liam 2026-09-16).
//
// One home for the whole "store at creation" rule, shared by the TWO doors that
// mint a staff card: the 追加 button's createStaff (→
// lib/staff/staff.core.ts#createStaffCore) and a FRESH invite
// (lib/invites/invites.core.ts → createInviteCore, which now makes the card up
// front so accept only attaches the login).
//
// It lives here, not inside actions/staff.ts, for a load-bearing reason: the
// /join page's pre-auth bundle is held down to the `invite` message namespace
// by i18n-client-messages-closure.test.ts, and actions/staff.ts reaches
// `settings` + `common` translations. An invite door that imported it — even
// dynamically — would ship the settings dictionary to a logged-out page. This
// module carries NO translations at all, so both doors can reach it.
//
// It deliberately does NOT audit. Each door emits its own staff.add row at the
// point it knows what it made, which is also what keeps CP7's dominating-emit
// walker able to read them.

import type { SynqedClient } from '@synqed-kk/client'
import { storeCountForGate, STAFF_STORE_REQUIRED } from '@/lib/auth/store-gate'
import { audit } from '@/lib/audit'

/**
 * The placement failed AND the rollback that undoes it failed too (⚖ fold
 * round 3, fresh-eyes F8). A card nobody asked for is on the roster and only a
 * person can clear it, so the door says so instead of reporting the placement
 * error and going quiet. Machine code, mapped to copy at each door — this
 * module carries no translations by design (see the header).
 */
export const STAFF_CARD_LEFT_BEHIND = 'STAFF_CARD_LEFT_BEHIND'

/** The ports a card mint needs. `staffStores`/`stores` are Partial because a
 *  caller in a single-store salon (or a test double) legitimately has neither;
 *  every rule below degrades safely without them. */
export type NewCardClient = Pick<SynqedClient, 'staff'> &
  Partial<Pick<SynqedClient, 'staffStores' | 'stores'>>

export interface NewCardDeps {
  /** Audit actor for the placement row. */
  actorId: string | null
  source: 'web' | 'facade'
  requestId?: string
  /** The CREATOR's own allowed stores; `null` = EXPLICITLY unclamped
   *  (stores.viewAll, or a floating creator in a one-store salon). REQUIRED
   *  on purpose: omitted is not unclamped. The new card's stores must be a
   *  subset of it (setStaffStoresAtCreationCore). */
  creatorAllowedStoreIds: readonly string[] | null
}

/**
 * Create the staff card and place it, as ONE act.
 *
 *   - a multi-store business REFUSES a card with no store — that card would be
 *     a staff member who meets the 担当店舗が未設定です screen on their first
 *     login, which is the exact hole this closes. The rule is server-side
 *     because it turns on the store COUNT, which no client decides;
 *   - an UNREADABLE store list never blocks hiring. Unknown is not "two or more
 *     stores", and stopping a salon from adding staff during a core outage is
 *     worse than the thing being prevented — the gate is the backstop, so an
 *     unplaced hire meets the honest screen, never another store's data;
 *   - a FAILED placement DELETES the card it just made. Never a floating card
 *     the salon can neither see nor assign.
 *
 * Deliberately REJECTS when staff.create itself rejects: each door catches
 * and maps that inside its own try/catch (⚖ G6). The { error } arm carries
 * refusals and placement failures only.
 */
export async function createAndPlaceStaffCard(
  synqed: NewCardClient,
  businessId: string | null,
  deps: NewCardDeps,
  card: {
    name: string
    email: string | null
    /** Supabase profile id when the person already has a login here, else null. */
    userId: string | null
    storeIds: string[]
  },
): Promise<{ id: string; storeUnknown?: true } | { error: string }> {
  // ⚖ I2 — the store count could not be read, so we do not know whether this
  // card NEEDS a store. It is still created (unknown never blocks hiring), and
  // the doors say so. Remembered here, answered after the card exists.
  let storeCountUnknown = false
  if (card.storeIds.length === 0) {
    // try/catch, not `.catch()`: a client with no stores port at all is the
    // same UNKNOWN as a failed call, and UNKNOWN never blocks.
    let storeCount: number | null = null
    try {
      // ⚖ FOLD ROUND 3 (fresh-eyes F2) — the gate's own helper, not a raw row
      // count. Three spellings of "how many stores" is three chances to
      // disagree with the screen the refusal points at.
      storeCount = storeCountForGate((await synqed.stores!.list()).stores)
    } catch {
      storeCount = null
    }
    if (storeCount !== null && storeCount >= 2) return { error: STAFF_STORE_REQUIRED }
    storeCountUnknown = storeCount === null
  }

  // A cast or a JS caller can omit the REQUIRED clamp decision. Refuse
  // before creating a card, so there is nothing to roll back.
  if (card.storeIds.length > 0 && deps.creatorAllowedStoreIds === undefined) {
    return { error: 'STORE_SCOPE_DENIED' }
  }

  const created = await synqed.staff.create({
    name: card.name,
    email: card.email,
    user_id: card.userId,
  })

  if (card.storeIds.length > 0) {
    // ⚖ FOLD ROUND 3 (fresh-eyes F8) — stores were ASKED FOR and this client
    // cannot honour them. The card used to be created and simply never placed,
    // with no error: a floating card born of a silent skip, which is the one
    // thing this module exists to prevent. Refuse in the STORE_SCOPE_DENIED
    // class (the literal both doors already map), and roll the card back.
    if (!synqed.staffStores) {
      return rollback(synqed, businessId, deps, created.id, 'STORE_SCOPE_DENIED')
    }
    // LAZY import, load-bearing: actions/stores' static graph reaches
    // org-settings (unstable_cache) through business-name, and dragging that
    // into every graph that mints a card is what this module's siblings avoid
    // by the same idiom (see store-clamp's resolveSelfStaffId).
    const { setStaffStoresAtCreationCore } = await import('@/actions/stores')
    const placed = await setStaffStoresAtCreationCore(
      synqed as Parameters<typeof setStaffStoresAtCreationCore>[0],
      businessId ?? '',
      { staffList: [], selfUserId: deps.actorId, source: deps.source, requestId: deps.requestId },
      created.id,
      card.storeIds,
      deps.creatorAllowedStoreIds,
    )
    if ('error' in placed) return rollback(synqed, businessId, deps, created.id, placed.error)
  }

  // ⚖ I2 — an unplaced card is never SILENT. The flag rides back to the door,
  // which stamps its own staff.add row as a warning and puts a line on the
  // screen; this module still audits nothing on its success path, which is
  // what keeps CP7's dominating-emit walker able to read both doors.
  if (storeCountUnknown) return { id: created.id, storeUnknown: true }
  return { id: created.id }
}

/**
 * Undo a card that could not be placed, and say which failure the caller is
 * actually looking at.
 *
 * ⚖ FOLD ROUND 3 (fresh-eyes F8) — the delete was awaited but its own error
 * only reached console.error, so a FAILED rollback returned the PLACEMENT
 * error and left a card on the roster that nobody knew to look for. The
 * comment above says "the degraded outcome is honest, not silent"; here it was
 * silent. A double failure is rare, and it is exactly the case a person has to
 * be told about, because only a person can clear it.
 */
async function rollback(
  synqed: NewCardClient,
  businessId: string | null,
  deps: NewCardDeps,
  staffId: string,
  placementError: string,
): Promise<{ error: string }> {
  try {
    await synqed.staff.delete(staffId)
  } catch (err) {
    // ⚖ G8 — A CARD THAT STAYED BEHIND LEAVES A TRACE. The door's own
    // staff.add never fires for a rolled-back card, so when the rollback
    // ITSELF fails the roster grows with nothing in 監査ログ to explain it and
    // no id anywhere to go and find it by. The dialog tells the person at the
    // screen; this tells whoever looks later.
    console.error('[new-card] rollback of an unplaced card failed:', staffId, err)
    audit({
      category: 'staff',
      action: 'staff.add',
      severity: 'warning',
      actorId: deps.actorId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: staffId,
      detail: { reason: 'rollback_failed', placement_error: placementError },
      requestId: deps.requestId,
      source: deps.source,
    })
    return { error: STAFF_CARD_LEFT_BEHIND }
  }
  return { error: placementError }
}
