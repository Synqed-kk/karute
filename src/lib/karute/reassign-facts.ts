// F4 reassign — the shared money/photo detection helper (packet §2e). Feeds
// the confirm panel's honesty disclosure AND the audit receipt's detail.
// COUNTS ONLY — this file never mutates, never moves/deletes a redemption or
// a photo. Shared by the web action and the facade route so both surfaces
// see the identical count.

import type { SynqedClient } from '@synqed-kk/client'
import { isSameJstDay } from '@/lib/date/jst'
import { scopeKarutePhotos } from './scoped-photos'

export interface ReassignFacts {
  /** 回数券 redemptions linked to this karute (or its appointment) that stay
   *  with the OLD customer — money never moves. */
  burnCount: number
  /** Session photos that stay in the OLD customer's gallery — SDK 1.28.0 has
   *  no photo re-point verb (census B, verified), so this is a day-1 ceiling,
   *  not a bug: the confirm panel discloses it rather than hiding it. */
  photoCount: number
}

interface ReassignFactsRecord {
  id: string
  appointment_id: string | null
  recording_session_id: string | null
  /** YYYY-MM-DD business date (KaruteRecord.session_date). null → the
   *  same-day arm below is skipped (link arms only) — a fix-round-1 ceiling
   *  stated honestly, not hidden. */
  session_date: string | null
}

/** The redemption fields census B's write-side (AddRedemptionInput) accepts
 *  but the installed listRedemptions() .d.ts (SDK 1.28.0) does not declare on
 *  its READ shape ({pack_id, redeemed_on} only). ponytail: same SDK-skew cast
 *  idiom src/lib/customers/cached.ts already uses (installed types lag the
 *  live API elsewhere in this codebase) — if the runtime genuinely omits
 *  these two fields, every optional read below resolves to undefined and the
 *  count safely UNDERcounts to 0 (never crashes, never over-claims money that
 *  isn't there). Flagged in the builder report: verify against live core
 *  before trusting a non-zero burnCount in production. redeemed_on IS on the
 *  declared read shape (not part of the skew) — kept non-optional here. */
type RedemptionReadSkew = {
  redeemed_on: string
  karute_record_id?: string | null
  appointment_id?: string | null
}

/**
 * Money + photo counts for a reassign confirm panel / audit detail.
 *
 * Money: packs.listRedemptions(fromCustomerId) has no karute- or
 * appointment-scoped query (census B §Q4) — client-filter, the same idiom
 * reconcile-core.ts already uses for the unrelated 未処理来店 feature. A
 * web-created burn carries ONLY appointment_id (no karute_record_id on that
 * path); a phone-created burn carries karute_record_id. Both link shapes are
 * counted so the panel is honest regardless of which surface recorded it.
 *
 * Fix round 1 (F-1): the installed SDK's listRedemptions() rows don't
 * actually carry karute_record_id/appointment_id at runtime (RedemptionReadSkew
 * above), so the two link arms alone left burnCount always 0. A third arm
 * counts a redemption whose redeemed_on falls on the SAME JST calendar day as
 * the record's session_date — isSameJstDay, the recovery-burn guard's own
 * idiom (src/actions/packs.ts), reused here rather than a second hand-rolled
 * JST rule. record.session_date === null skips this arm (link arms only).
 *
 * Photos: customers.listPhotos(fromCustomerId) filtered to this karute's
 * recording_session_id via the shared scopeKarutePhotos helper — a manual
 * karute (recording_session_id === null) resolves to photoCount 0 without a
 * listPhotos crash (scopeKarutePhotos's own null rule).
 *
 * R3-2 (fix round 3, Greptile issue 2 — REAL): the same-day arm above means
 * burnCount can attribute MULTIPLE same-day redemptions to this one karute —
 * core's narrow read gives no stronger link than "happened the same JST
 * calendar day". That's the honest attribution CEILING under today's data,
 * not a bug to hide: the confirm-panel copy and the audit detail key are
 * both scoped to the day claim on purpose (i18n `burnTitle` reads "this
 * day's ticket redemptions: {n}"; the audit detail key is
 * `same_day_burn_count`, not `burn_count`) so the receipt never claims more
 * precision than the count actually has. The link arms (karute_record_id /
 * appointment_id) tighten the claim automatically whenever a redemption
 * actually carries one — this ceiling only bites when neither link exists.
 */
export async function reassignFacts(
  synqed: Pick<SynqedClient, 'packs' | 'customers'>,
  fromCustomerId: string,
  record: ReassignFactsRecord,
): Promise<ReassignFacts> {
  const [redemptions, photosResult] = await Promise.all([
    synqed.packs.listRedemptions(fromCustomerId),
    synqed.customers.listPhotos(fromCustomerId),
  ])

  const burnCount = (redemptions as unknown as RedemptionReadSkew[]).filter((r) => {
    if (r.karute_record_id && r.karute_record_id === record.id) return true
    if (record.appointment_id && r.appointment_id === record.appointment_id) return true
    if (record.session_date && isSameJstDay(r.redeemed_on, record.session_date)) return true
    return false
  }).length

  const photoCount = scopeKarutePhotos(photosResult.photos, record.recording_session_id).length

  return { burnCount, photoCount }
}
