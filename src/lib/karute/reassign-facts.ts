// F4 reassign — the shared money/photo detection helper (packet §2e). Feeds
// the confirm panel's honesty disclosure AND the audit receipt's detail.
// COUNTS ONLY — this file never mutates, never moves/deletes a redemption or
// a photo. Shared by the web action and the facade route so both surfaces
// see the identical count.

import type { SynqedClient } from '@synqed-kk/client'
import { isSameJstDay } from '@/lib/date/jst'
import { scopeKarutePhotos } from './scoped-photos'

export interface ReassignFacts {
  /** 回数券 redemptions PROVABLY linked to this karute or its appointment
   *  (karute_record_id === record.id, or appointment_id match) — the only
   *  count strong enough to attribute to THIS session. R11-1 (Greptile
   *  round-6 closure): 0 today under core's narrow reads — the installed
   *  SDK's listRedemptions() rows don't actually carry karute_record_id /
   *  appointment_id at runtime (RedemptionReadSkew below, same F-1 skew) —
   *  goes live automatically, no code change needed here, the moment
   *  Anthony's SELECT widens to include them. */
  linkedBurnCount: number
  /** Redemptions landing on the SAME JST calendar day as this karute's
   *  session, EXCLUDING any row already counted in linkedBurnCount —
   *  presence information only, NEVER attribution: core gives no stronger
   *  link than "happened the same day", which can span multiple sessions.
   *  Every surface that shows this must label it explicitly as unconfirmed
   *  (紐付けは未確定), never imply it belongs to this karute. */
  sameDayBurnCount: number
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
 *  before trusting a non-zero linkedBurnCount in production. redeemed_on IS
 *  on the declared read shape (not part of the skew) — kept non-optional
 *  here. */
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
 * path); a phone-created burn carries karute_record_id. Both link shapes
 * count toward linkedBurnCount, the only count strong enough to attribute to
 * THIS session.
 *
 * Fix round 1 (F-1): the installed SDK's listRedemptions() rows don't
 * actually carry karute_record_id/appointment_id at runtime
 * (RedemptionReadSkew above), so the two link arms alone leave
 * linkedBurnCount at 0 under today's reads. A third arm — same JST calendar
 * day as the record's session_date, isSameJstDay, the recovery-burn guard's
 * own idiom (src/actions/packs.ts) — catches what the link arms miss.
 * record.session_date === null skips this arm.
 *
 * R11-1 (fix round 11, Greptile round-6 closure — REAL, ⚖ Liam ordered
 * 5/5): fix rounds 1-9 folded the same-day arm INTO one burnCount, so the
 * receipt attributed day-scoped hits to this karute as if proven. It isn't —
 * "same calendar day" can span multiple sessions. R3-2's honesty framing
 * (day-scoped label, not "every burn") narrowed the CLAIM but the number
 * itself still read as one attributed count. R11-1 stops conflating:
 * linkedBurnCount is the confident, attributable count; sameDayBurnCount is
 * presence-only and every surface showing it must label it unconfirmed. A
 * row counted in linkedBurnCount is NEVER also counted in sameDayBurnCount —
 * the two are mutually exclusive by construction below (if/else-if over one
 * pass), not a set-difference computed after the fact.
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

  let linkedBurnCount = 0
  let sameDayBurnCount = 0
  for (const r of redemptions as unknown as RedemptionReadSkew[]) {
    const linked =
      (!!r.karute_record_id && r.karute_record_id === record.id) ||
      (!!record.appointment_id && r.appointment_id === record.appointment_id)
    if (linked) {
      linkedBurnCount++
    } else if (record.session_date && isSameJstDay(r.redeemed_on, record.session_date)) {
      sameDayBurnCount++
    }
  }

  const photoCount = scopeKarutePhotos(photosResult.photos, record.recording_session_id).length

  return { linkedBurnCount, sameDayBurnCount, photoCount }
}
