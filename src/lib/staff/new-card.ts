// A NEW STAFF CARD, BORN IN A STORE (⚖ Liam 2026-09-16).
//
// One home for the whole "store at creation" rule, shared by the TWO doors that
// mint a staff card: the 追加 button (actions/staff.ts → createStaffCore) and a
// FRESH invite (actions/invites.ts → createInviteCore, which now makes the card
// up front so accept only attaches the login).
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
  /** The CREATOR's own allowed stores; `null` = unclamped. The new card's
   *  stores must be a subset of it (setStaffStoresAtCreationCore). */
  creatorAllowedStoreIds?: readonly string[] | null
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
): Promise<{ id: string } | { error: string }> {
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
  }

  const created = await synqed.staff.create({
    name: card.name,
    email: card.email,
    user_id: card.userId,
  })

  if (card.storeIds.length > 0 && synqed.staffStores) {
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
      deps.creatorAllowedStoreIds ?? null,
    )
    if ('error' in placed) {
      await synqed.staff.delete(created.id).catch((err: unknown) => {
        console.error('[new-card] rollback of an unplaced card failed:', err)
      })
      return { error: placed.error }
    }
  }

  return { id: created.id }
}
