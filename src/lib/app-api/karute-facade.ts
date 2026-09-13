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
function classifyGetError(err: unknown, resource: string): never {
  const status =
    err && typeof err === 'object' && 'status' in err
      ? (err as { status: unknown }).status
      : undefined
  if (status === 404) {
    throw new AppApiError('not_found', `${resource} not found in this business`)
  }
  throw new AppApiError('upstream_unavailable', `${resource} read failed`)
}

export async function readKaruteRaw(synqed: KaruteClient, id: string) {
  try {
    return await synqed.karuteRecords.get(id)
  } catch (err) {
    classifyGetError(err, 'karute')
  }
}

type KaruteClientWithFetch = Pick<
  Awaited<ReturnType<typeof newSynqedClient>>,
  'karuteRecords' | 'fetch'
>

/**
 * Discarded-record sibling of {@link readKaruteRaw} (R8 discarded-record
 * door, ⚖ Liam 2026-09-13). NEVER edits readKaruteRaw in place. The retry is
 * NOT conditioned on the caller — own-ness cannot be known before the read —
 * so this is the tenancy-proof read for EVERY /karute/[id] facade GET; a live
 * record's ordinary get() succeeds directly and the retry never fires (zero
 * behavior change there).
 *
 * A 404 retries ONCE, inside the classify boundary, via a raw business-scoped
 * fetch with `include_discarded=true` (SDK 1.34 predates the typed option —
 * same raw-transport idiom as synqed-records.ts's listMixedKaruteRecords). A
 * retry that ALSO 404s throws the exact same classified not_found
 * classifyGetError throws for an ordinary missing/cross-tenant id — the
 * caller (canOpenDiscardedRecord's refusal) reuses that same classification
 * for a byte-identical body. Any non-404 on either leg is upstream_unavailable,
 * untouched.
 */
export async function readKaruteRawIncludingDiscarded(
  synqed: KaruteClientWithFetch,
  id: string,
) {
  try {
    return await synqed.karuteRecords.get(id)
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: unknown }).status
        : undefined
    if (status !== 404) {
      throw new AppApiError('upstream_unavailable', 'karute read failed')
    }
    try {
      return await synqed.fetch<Awaited<ReturnType<typeof synqed.karuteRecords.get>>>(
        `/karute-records/${id}?include_discarded=true`,
      )
    } catch (retryErr) {
      classifyGetError(retryErr, 'karute')
    }
  }
}

type CustomerClient = Pick<Awaited<ReturnType<typeof newSynqedClient>>, 'customers'>

/** Status-aware customer tenancy proof (packet 07 §Build 4) — a cross-tenant /
 *  missing id → not_found BEFORE any LLM/cache call; a genuine upstream failure →
 *  502. Used by the AI body-prediction read (the customer is its tenancy anchor). */
export async function readCustomerRaw(synqed: CustomerClient, id: string) {
  try {
    return await synqed.customers.get(id)
  } catch (err) {
    classifyGetError(err, 'customer')
  }
}
