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
 *   - `recordStoreId === 'unreadable'` → the door's recording read FAILED, so
 *     this record's store is UNKNOWN (⚖ fix round 6, Greptile #849 review 2).
 *     Unknown is not 全店舗: a clamped viewer fails CLOSED, and an unrestricted
 *     one still passes, because no store could have excluded her anyway.
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
  recordStoreId: string | null | undefined | 'unreadable'
}): boolean {
  const { canViewAll, allowedStoreIds, recordStoreId } = opts
  if (!canViewAll) return false
  if (recordStoreId === 'unreadable') return allowedStoreIds === null
  if (allowedStoreIds === null) return true
  if (recordStoreId == null) return true
  return allowedStoreIds.includes(recordStoreId)
}

/**
 * ⚖ WHICH STORE A READ DOOR JUDGES A KARUTE BY — one spelling, three doors
 * (R1′, slice three ③ fix round 3; Greptile #849 point 2).
 *
 * The KARUTE's own store is where the record lives, and it leads: it is what
 * `resolveKaruteStoreId` (actions/karute.ts) writes on every save, and what the
 * audit viewer and the karute list already filter by.
 *
 * A karute that carries NONE — a store-less booking, a saver whose own scope
 * resolved to no store — inherits the RECORDING's store, which since ③ names
 * the branch the device was actually in (session-mint.ts). Without that
 * fallback a null-store karute reads as 全店舗 while its row plainly says
 * `store-9`, and a grantee clamped to `store-a` hears another branch's audio.
 *
 * Both null = a genuinely unlabelled record — 全店舗 / legacy, OPEN, the same
 * word `canViewAllInStore` uses one function down.
 *
 * ONE INPUT, THREE READ DOORS, and that is the whole point of it living here:
 * the transcript (web page · facade screen route) and the sound (playback-url)
 * must answer one karute the SAME way. A door that read only the karute would
 * open where its sibling closed — show-and-refuse, which the page's own rule
 * forbids; a door that read only the row would close on every pre-③ karute.
 *
 * ⚖ AND THE ACT DOORS TOO (③ fix round 4). The three 再生成 doors — the two
 * button flags (karute/[id]/page.tsx · screens/karute/[id]/route.ts) and the
 * server gate (actions/regenerate-karute.ts) — compare this same value, because
 * an act is never more permissive than the read: someone who cannot READ this
 * record must not be able to rewrite it. The TAKE doors are the one exception,
 * and by construction: they run before any karute exists to ask, so they read
 * the row's column alone (take-binding.ts#assertRecorderOwnsRow).
 *
 * ⚖ AN UNREADABLE ROW IS CLOSED FOR A CLAMPED VIEWER (fix round 6, Greptile
 * #849 review 2). A recording read that FAILED arrives here as the VALUE
 * `'unreadable'` — the `.catch` at all three doors returns it, the same
 * sentinel-is-a-value idiom `ownerHandReach` uses one function down (and
 * `packs.ts` / `auto-burn.ts` use elsewhere). It is NOT collapsed into `null`:
 * null means "this record names no store", and a store we could not READ is
 * not a store that does not exist. `canViewAllInStore` answers it in one line
 * — an unrestricted viewer passes (no store could have excluded her), a
 * clamped one fails CLOSED, on the words doors and the act doors alike.
 *
 * The round-4 ruling this replaces left the blip OPEN, to avoid 502ing a karute
 * page over an accessory read. That was the wrong trade, and the page never
 * needed it: the doors already have an honest answer for "you may not read
 * this" — the transcript's RESTRICTED rendering, which costs no status code.
 * So the whole remaining cost is one restricted render, for one clamped
 * viewer, during one blip: the recorder's own record never reaches this leg,
 * and an owner or preset manager carries `stores.viewAll`. The sound door pays
 * nothing at all — it returns `upstream` on a failed row read, before it ever
 * asks this question (playback-url.ts).
 */
export function readDoorStoreId(
  /** The karute row. `store_id` is optional on the app's own view-model type
   *  (KaruteWithRelations), and an ABSENT column means the same thing as an
   *  explicitly null one here: this record names no store of its own, so ask
   *  the recording. */
  karute: { store_id?: string | null },
  /** The recording row, `null` when there is none to read, or the value
   *  `'unreadable'` when the door's own read FAILED — see the ⚖ paragraph
   *  above. The row is consulted ONLY when the karute names no store, so an
   *  unreadable row on a karute that HAS one changes nothing. */
  row: { store_id?: string | null } | null | undefined | 'unreadable',
): string | null | 'unreadable' {
  if (karute.store_id != null) return karute.store_id
  if (row === 'unreadable') return 'unreadable'
  return row?.store_id ?? null
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
 *     including "a record with no store is 全店舗/legacy", "degraded `[]`
 *     fails closed", and (fix round 6) "an `'unreadable'` row fails closed for
 *     a clamped hand" — the value `readDoorStoreId` hands over when the act
 *     door's own recording read failed.
 *   - CUSTOMER-WIDE (`recordStoreId: 'customer-wide'`): 再学習 and the bulk list
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
  /** REQUIRED, and the sentinel is a VALUE, not an absent field (fix round 8).
   *  `canViewAllInStore` reads `undefined` as "no store to be outside of" —
   *  i.e. OPEN — so a legacy karute shape that simply omits `store_id` would
   *  have silently selected the customer-wide mode here and the open branch
   *  there. One spelling, no overlap: `'customer-wide'` picks the mode, and a
   *  real record passes its store, an explicit `null`, or `'unreadable'` when
   *  the door could not read the row (fix round 6) — three distinct words, and
   *  only the first picks a mode. */
  recordStoreId: string | null | 'customer-wide' | 'unreadable'
}): boolean {
  const { holdsOwnerKeys, allowedStoreIds, recordStoreId } = opts
  if (!holdsOwnerKeys) return false
  if (recordStoreId === 'customer-wide') return allowedStoreIds === null
  return canViewAllInStore({ canViewAll: true, allowedStoreIds, recordStoreId })
}
