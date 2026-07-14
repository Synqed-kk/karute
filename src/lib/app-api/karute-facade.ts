// Shared helpers for the session-detail facade (packet 07). HTTP-layer concerns
// only — the status-aware tenancy-proof read that turns a synqed 404 into a clean
// not_found and any other upstream failure into a retryable 502. The MAPPING to
// KaruteWithRelations + the assembly live in their own single-source modules.

import { AppApiError } from './errors'
import type { newSynqedClient } from '@/lib/synqed/client'

type KaruteClient = Pick<Awaited<ReturnType<typeof newSynqedClient>>, 'karuteRecords'>

/**
 * Read a karute by id on the business-scoped client, classifying the failure so
 * the tenancy proof stays crisp (packet 07 §Build 4):
 *   - a 404 (missing OR cross-tenant — the business-scoped client reads a foreign
 *     id as not-found, per packet-03 disc. #5) → `not_found`, thrown BEFORE any
 *     LLM call / write;
 *   - ANY OTHER upstream failure → `upstream_unavailable` (502), never a false
 *     not_found that a mobile client would cache as "record deleted".
 * Returns the RAW synqed record (the caller maps it with a customer name in hand).
 *
 * NOTE: this is a deliberate improvement over the web page's getKaruteRecord,
 * which collapses EVERY failure to null → notFound(). The facade errs toward a
 * retryable 5xx on a genuine outage (errors.ts contract; batch-1 ruling 3).
 */
export async function readKaruteRaw(synqed: KaruteClient, id: string) {
  try {
    return await synqed.karuteRecords.get(id)
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: unknown }).status
        : undefined
    if (status === 404) {
      throw new AppApiError('not_found', 'karute not found in this business')
    }
    throw new AppApiError('upstream_unavailable', 'karute record read failed')
  }
}
