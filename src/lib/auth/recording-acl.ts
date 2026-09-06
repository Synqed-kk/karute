// Recording privacy (#4). The raw transcript / recording audio of a karute is
// PRIVATE to the staff member who recorded it; the AI summary + entries are
// shared with the whole salon. This is the single decision point for "may this
// viewer see the raw recording", so the rule can't drift between the detail
// page and any future audio-playback route.

/**
 * Whether `viewerStaffId` may see the raw transcript/recording of a karute owned
 * by `ownerStaffId`.
 *
 *   - the recording staff always sees their own,
 *   - a recordings.viewAll holder (the owner, or a person the owner named)
 *     sees everyone's,
 *   - a record with NO owner (legacy / manual karute with no staff_id) is shared
 *     — there's no one to protect, and hiding it would strand old transcripts.
 */
export function canViewTranscript(opts: {
  ownerStaffId: string | null
  viewerStaffId: string | null
  canViewAll: boolean
}): boolean {
  const { ownerStaffId, viewerStaffId, canViewAll } = opts
  if (!ownerStaffId) return true
  if (canViewAll) return true
  return viewerStaffId != null && viewerStaffId === ownerStaffId
}

/**
 * The grant widens WHOSE recordings, never WHICH stores (⚖ Liam's store-
 * isolation law 8/17; Greptile #848 point 2).
 *
 * `recordings.viewAll` used to imply store reach for free, because before the
 * named grant its only holders were owners — and the owner preset carries
 * `stores.viewAll`. The first named grantee is the first person to hold the one
 * without the other, so the viewAll branch of `canViewTranscript` now has to be
 * asked the store question first.
 *
 *   - `allowedStoreIds === null` → unrestricted within the tenant
 *     (`stores.viewAll`, or floating staff assigned to no store) — hears anything.
 *   - `recordStoreId == null` → a 全店舗 / legacy record with no store to be
 *     outside of — hears it, exactly as the "no owner is shared" branch above.
 *   - otherwise the record's store must be one the viewer is assigned to.
 *
 * A DEGRADED scope lookup arrives here as `[]` and fails closed — the menus
 * precedent: an unreadable assignment is never widened into "every store".
 *
 * Own recordings and unowned records never reach this: they pass on the
 * unowned and own-recording branches; this narrows only the `canViewAll` branch.
 */
export function canViewAllInStore(opts: {
  canViewAll: boolean
  allowedStoreIds: readonly string[] | null
  recordStoreId: string | null | undefined
}): boolean {
  const { canViewAll, allowedStoreIds, recordStoreId } = opts
  if (!canViewAll) return false
  if (allowedStoreIds === null) return true
  if (recordStoreId == null) return true
  return allowedStoreIds.includes(recordStoreId)
}

/**
 * THE ACT DOORS' STORE LAW — the owner's two keys reach only where the person
 * can see, exactly as the named grant does (⚖ Liam's store-isolation law 8/17;
 * Greptile #848 review 2, point 2).
 *
 * The same correction O17 made for the read side applies here: before this PR
 * the only holders of the pair were owners, and the owner preset carries
 * `stores.viewAll`, so a CLAMPED pair-holder could not exist. Hand-granting
 * both keys to a branch manager creates that person for the first time — and
 * regenerating a record or rebuilding a customer's memory is a write, so it
 * must not cross an assignment the reads already respect.
 *
 * Two shapes, because the two doors ask different questions:
 *   - RECORD-LEVEL (`recordStoreId` given, may be null): one karute, so the
 *     ordinary store compare applies — `canViewAllInStore`'s rules verbatim,
 *     including "a record with no store is 全店舗/legacy" and "degraded `[]`
 *     fails closed".
 *   - CUSTOMER-WIDE (`recordStoreId` omitted): 再学習 and the bulk regen list
 *     read a customer's WHOLE history, which spans stores by construction
 *     (the customer door is cross-store by Liam's 8/17 ruling). There is no
 *     single record to compare, so only an UNRESTRICTED scope passes —
 *     `stores.viewAll`, or floating staff. A clamped person may not pull
 *     another branch's transcripts through a customer.
 *
 * Owners and preset managers hold `stores.viewAll` → `allowedStoreIds` is null
 * → unchanged on both shapes.
 */
export function ownerHandReach(opts: {
  holdsOwnerKeys: boolean
  allowedStoreIds: readonly string[] | null
  recordStoreId?: string | null
}): boolean {
  const { holdsOwnerKeys, allowedStoreIds, recordStoreId } = opts
  if (!holdsOwnerKeys) return false
  if (recordStoreId === undefined) return allowedStoreIds === null
  return canViewAllInStore({ canViewAll: true, allowedStoreIds, recordStoreId })
}
