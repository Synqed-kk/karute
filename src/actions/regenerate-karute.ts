'use server'

import { revalidatePath } from 'next/cache'
import { getSynqedClient } from '@/lib/synqed/client'
import type { Entry } from '@/types/ai'

type SynqedCategory =
  | 'SYMPTOM'
  | 'TREATMENT'
  | 'BODY_AREA'
  | 'PREFERENCE'
  | 'LIFESTYLE'
  | 'NEXT_VISIT'
  | 'PRODUCT'
  | 'OTHER'

const toSynqedCategory = (c: string): SynqedCategory =>
  c.toUpperCase() as SynqedCategory

export interface RegenerateResult {
  /** Hard failure — no change applied (adds rolled back). The button surfaces this. */
  error?: string
  /** Soft caveat — change WAS applied but some old rows lingered. Non-blocking. */
  warning?: string
  added?: number
  removed?: number
}

/**
 * Replace an existing karute's AI entries with a freshly-extracted set.
 *
 * The caller (RegenerateEntriesButton) re-runs `/api/ai/extract` on the record's
 * stored transcript — which now uses the tightened, business-aware consolidation
 * prompt — and passes the new entries here.
 *
 * INTEGRITY MODEL (the synqed API only exposes single addEntry/deleteEntry — no
 * atomic replace), hardened after an adversarial review:
 *   1. snapshot the existing entry ids,
 *   2. add ALL the new entries (collecting their ids),
 *   3. delete the snapshotted old ids — per-id, resilient: a single stale/404 id
 *      can't abort the loop and strand the rest.
 *   If the add loop throws, OR every delete fails (e.g. a delete-endpoint outage),
 *   we ROLL BACK the just-added entries so a failed run is a clean no-op (old
 *   entries preserved, never empty, never compounding on retry). Worst surviving
 *   case is a few un-deleted old rows alongside the new ones — visibly recoverable
 *   by re-running, never data loss. Entries only: there is no summary-replace.
 *
 * KNOWN LIMITS (flagged for Anthony, acceptable for this confirm-gated manual
 * action):
 *   - Concurrency: two simultaneous runs (two tabs/devices) can each delete only
 *     their own snapshot and leave duplicates. A per-record lock / version check
 *     belongs in synqed-core.
 *   - Store split: entries are written to synqed-core. The detail page reads via
 *     getKaruteRecord, which is Supabase-primary and only falls back to synqed on
 *     PGRST116 (record absent from Supabase). Recording-flow records are
 *     synqed-only, so the refresh reflects the change; a legacy record that ALSO
 *     lives in Supabase would show stale entries after a "successful" regenerate.
 *     The durable fix is making entry reads synqed-authoritative.
 */
export async function regenerateKaruteEntries(
  karuteRecordId: string,
  newEntries: Entry[],
): Promise<RegenerateResult> {
  if (!karuteRecordId) return { error: 'karuteRecordId is required' }
  if (!Array.isArray(newEntries) || newEntries.length === 0) {
    // Never delete the old entries if there's nothing to replace them with.
    return { error: 'No new entries to write — keeping the existing record.' }
  }

  try {
    const synqed = await getSynqedClient()

    // 1. Snapshot existing entry ids BEFORE mutating (authoritative server read,
    //    not trusting any client-passed ids).
    const before = (await synqed.karuteRecords.get(karuteRecordId)) as
      | { entries?: Array<{ id?: string | null }> }
      | null
    const oldIds: string[] = (before?.entries ?? [])
      .map((e) => e?.id)
      .filter((id): id is string => Boolean(id))

    // Roll back partial adds so a failed run leaves the record exactly as it was.
    const rollback = async (ids: string[]) => {
      for (const id of ids) {
        try {
          await synqed.karuteRecords.deleteEntry(karuteRecordId, id)
        } catch {
          /* best-effort */
        }
      }
    }

    // 2. Add the new AI entries first — the record never goes empty. Collect the
    //    created ids so we can undo on failure.
    const addedIds: string[] = []
    try {
      for (const e of newEntries) {
        const created = (await synqed.karuteRecords.addEntry(karuteRecordId, {
          category: toSynqedCategory(e.category),
          content: e.title,
          is_manual: false,
          confidence: e.confidence_score,
          original_quote: e.source_quote,
        })) as { id?: string | null } | null
        if (created?.id) addedIds.push(created.id)
      }
    } catch (err) {
      await rollback(addedIds)
      return {
        error: `Could not save the regenerated entries (${
          err instanceof Error ? err.message : 'unknown'
        }). No changes applied.`,
      }
    }

    // 3. Remove the prior entries — per-id resilient: one bad id never strands
    //    the rest.
    let removed = 0
    let deleteFailures = 0
    for (const id of oldIds) {
      try {
        await synqed.karuteRecords.deleteEntry(karuteRecordId, id)
        removed += 1
      } catch {
        deleteFailures += 1
      }
    }

    // Total delete outage with old entries present → roll back the adds so we
    // don't leave (and, on retry, compound) a doubled set.
    if (oldIds.length > 0 && removed === 0) {
      await rollback(addedIds)
      return {
        error: 'Could not remove the old entries. No changes applied — please retry.',
      }
    }

    revalidatePath('/[locale]/(app)/karute/[id]', 'page')
    return {
      added: addedIds.length,
      removed,
      // Partial cleanup is a soft warning, NOT a hard error — the entries did get
      // replaced, so the caller should still refresh (a re-run finishes cleanup).
      ...(deleteFailures > 0
        ? { warning: `${deleteFailures} old row(s) could not be removed — re-run to finish cleanup.` }
        : {}),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
