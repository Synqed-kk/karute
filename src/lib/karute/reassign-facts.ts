// F4 reassign — the shared money/photo detection helper (packet §2e). Feeds
// the confirm panel's honesty disclosure AND the audit receipt's detail.
// COUNTS ONLY — this file never mutates, never moves/deletes a redemption or
// a photo. Shared by the web action and the facade route so both surfaces
// see the identical count.

import type { SynqedClient } from '@synqed-kk/client'
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
}

/** The redemption fields census B's write-side (AddRedemptionInput) accepts
 *  but the installed listRedemptions() .d.ts (SDK 1.28.0) does not declare on
 *  its READ shape ({pack_id, redeemed_on} only). ponytail: same SDK-skew cast
 *  idiom src/lib/customers/cached.ts already uses (installed types lag the
 *  live API elsewhere in this codebase) — if the runtime genuinely omits
 *  these two fields, every optional read below resolves to undefined and the
 *  count safely UNDERcounts to 0 (never crashes, never over-claims money that
 *  isn't there). Flagged in the builder report: verify against live core
 *  before trusting a non-zero burnCount in production. */
type RedemptionReadSkew = { karute_record_id?: string | null; appointment_id?: string | null }

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
 * Photos: customers.listPhotos(fromCustomerId) filtered to this karute's
 * recording_session_id via the shared scopeKarutePhotos helper — a manual
 * karute (recording_session_id === null) resolves to photoCount 0 without a
 * listPhotos crash (scopeKarutePhotos's own null rule).
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
    return false
  }).length

  const photoCount = scopeKarutePhotos(photosResult.photos, record.recording_session_id).length

  return { burnCount, photoCount }
}
