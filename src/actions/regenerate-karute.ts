'use server'

import { revalidatePath } from 'next/cache'
import { getSynqedClient } from '@/lib/synqed/client'
import { requireCapability, can } from '@/lib/auth/require-permission'
import { getCurrentUserStaffId } from '@/lib/staff'
import { AppApiError } from '@/lib/app-api/errors'
import { readKaruteRaw } from '@/lib/app-api/karute-facade'
import { canViewTranscript } from '@/lib/auth/recording-acl'
import {
  enforceAiRateLimitWithClient,
  reportAiUsageWithClient,
} from '@/lib/ai-rate-limit'
import { runKaruteExtraction } from '@/lib/ai/karute-extract'
import { runKaruteSummary } from '@/lib/ai/karute-summarize'
import { orgSettingsWithClient } from '@/actions/org-settings'
import type { Entry } from '@/types/ai'
import type { EntryAuthor } from '@synqed-kk/client'

type SynqedRecordsClient = Pick<
  Awaited<ReturnType<typeof getSynqedClient>>,
  'karuteRecords' | 'customers' | 'aiRateLimit' | 'orgSettings'
>

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
 *   1. snapshot the existing AI-authored entry ids (human rows are filtered
 *      out here — I1: regen never deletes a human-authored entry),
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
 *   - Edit-during-regen (edit-layer W2): a pencil edit that lands after the
 *     delete phase's fresh re-read but before that row's own delete call can
 *     still be deleted — deleteEntry has no CAS (Anthony ask sent 2026-07-25).
 *     Mitigations: the fresh re-read narrows the window to the delete loop
 *     itself; core's delete is SOFT (deletedAt + full before-content in
 *     entry_edits), so a casualty is recoverable, never destroyed; the
 *     regen-in-flight client lock (design §3) ships with the completion-state
 *     PR. Airtight close = core-side deleteEntry expected_version.
 *   - Entries are written to AND read from synqed-core — getKaruteRecord is
 *     synqed-authoritative — so a successful regenerate always reflects the
 *     change on the detail page.
 */
/** Integrity CORE (packet 07 Decision 2) — the add-then-delete rollback dance on
 *  an EXPLICIT business-scoped client, shared by the cookie web action and the
 *  server-side regenerate orchestration. NO capability check (the caller gates)
 *  and NO revalidatePath (the caller revalidates). The rollback is carried
 *  VERBATIM — it survived an adversarial review; do not redesign it. */
export async function regenerateKaruteEntriesWithClient(
  synqed: SynqedRecordsClient,
  karuteRecordId: string,
  newEntries: Entry[],
): Promise<RegenerateResult> {
  if (!karuteRecordId) return { error: 'karuteRecordId is required' }
  if (!Array.isArray(newEntries) || newEntries.length === 0) {
    // Never delete the old entries if there's nothing to replace them with.
    return { error: 'No new entries to write — keeping the existing record.' }
  }

  try {
    // 1. Snapshot existing entry ids BEFORE mutating (authoritative server read,
    //    not trusting any client-passed ids) — AI-authored only (I1: regen never
    //    deletes a human row). Primary signal is the author enum; legacy rows
    //    backfilled without one fall back to is_manual (belt-and-braces per the
    //    packet — the migration backfills author, so this should rarely fire).
    const before = (await synqed.karuteRecords.get(karuteRecordId)) as
      | {
          entries?: Array<{
            id?: string | null
            author?: EntryAuthor | null
            is_manual?: boolean | null
          }>
        }
      | null
    const oldIds: string[] = (before?.entries ?? [])
      .filter((e) => (e?.author != null ? e.author === 'AI' : e?.is_manual !== true))
      .map((e) => e?.id)
      .filter((id): id is string => Boolean(id))

    // Roll back partial adds so a failed run leaves the record exactly as it
    // was. Returns the count of deletes that themselves failed — callers that
    // claim "no changes applied" must not lie when cleanup partially failed
    // (Greptile #616).
    const rollback = async (ids: string[]): Promise<number> => {
      let failures = 0
      for (const id of ids) {
        try {
          await synqed.karuteRecords.deleteEntry(karuteRecordId, id)
        } catch {
          failures += 1
        }
      }
      return failures
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

    // 3. Remove the prior entries — re-filtered against a FRESH read taken
    //    AFTER the adds, not the pre-loop snapshot. edit-layer W2 PR-B made
    //    this reachable: a pencil edit can flip a row AI→HUMAN_EDITED while
    //    this add phase is running, and core's deleteEntry has no CAS/
    //    human-row refusal — deleting off the stale snapshot would silently
    //    kill an edit that landed in the interim. Residual: the gap between
    //    THIS read and each row's own delete below is still unguarded — the
    //    loop is one sequential round-trip PER id, so the real window spans
    //    the whole delete phase, not one call. A casualty is recoverable
    //    (core soft-deletes + entry_edits keeps the before-content); the
    //    airtight close is core-side deleteEntry CAS (Anthony ask sent
    //    2026-07-25). Per-id resilient: one bad id never strands the rest.
    let freshAfterAdds: {
      entries?: Array<{
        id?: string | null
        author?: EntryAuthor | null
        is_manual?: boolean | null
      }>
    } | null
    try {
      freshAfterAdds = (await synqed.karuteRecords.get(karuteRecordId)) as typeof freshAfterAdds
    } catch {
      // The fresh read is what keeps the delete phase from killing a mid-regen
      // edit — without it we must not delete at all. Roll the adds back so a
      // failed run leaves the record exactly as it was (the function's
      // standing invariant); best-effort like every other rollback here.
      const rollbackFailures = await rollback(addedIds)
      return {
        error:
          rollbackFailures > 0
            ? 'Could not re-check the current entries and some cleanup failed — re-run to finish cleanup.'
            : 'Could not re-check the current entries. No changes applied — please retry.',
      }
    }
    const freshAiIds = new Set(
      (freshAfterAdds?.entries ?? [])
        .filter((e) => (e?.author != null ? e.author === 'AI' : e?.is_manual !== true))
        .map((e) => e?.id),
    )
    const idsToDelete = oldIds.filter((id) => freshAiIds.has(id))

    let removed = 0
    let deleteFailures = 0
    for (const id of idsToDelete) {
      try {
        await synqed.karuteRecords.deleteEntry(karuteRecordId, id)
        removed += 1
      } catch {
        deleteFailures += 1
      }
    }

    // Total delete outage with old entries present → roll back the adds so we
    // don't leave (and, on retry, compound) a doubled set. idsToDelete (not
    // oldIds) is the right count here — a snapshot id that dropped out via the
    // fresh re-filter was never going to be deleted, so its absence must not
    // read as a failure.
    if (idsToDelete.length > 0 && removed === 0) {
      await rollback(addedIds)
      return {
        error: 'Could not remove the old entries. No changes applied — please retry.',
      }
    }

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

/** Cookie web wrapper — records.write gate + business-scoped client + revalidate,
 *  then the shared integrity core. Web callers keep the same signature/behavior. */
export async function regenerateKaruteEntries(
  karuteRecordId: string,
  newEntries: Entry[],
): Promise<RegenerateResult> {
  try {
    // Re-writing a record's AI entries = records.write. Thrown → caught below →
    // house { error } shape the RegenerateEntriesButton already surfaces.
    await requireCapability('records.write')
    const synqed = await getSynqedClient()
    const result = await regenerateKaruteEntriesWithClient(synqed, karuteRecordId, newEntries)
    revalidatePath('/[locale]/(app)/karute/[id]', 'page')
    return result
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Replace a karute's AI summary (the AI要約 card text) with a freshly-generated
 * one. Companion to regenerateKaruteEntries so "AIで再生成" refreshes BOTH the
 * entries (本日のセッション) and the summary (AI要約) — the summary is what the
 * pre-session brief's trajectory reads, so a backfill must update it too.
 *
 * `ai_summary` is the raw string the summarize route returns (・-bulleted), stored
 * exactly as the recording flow stores it. A single-field update — idempotent, no
 * rollback needed (unlike the add/delete entry dance).
 */
/** Summary-update CORE on an EXPLICIT client (shared by the cookie wrapper + the
 *  regenerate orchestration). Single-field, idempotent, no rollback; no cap check
 *  and no revalidate (the caller owns both). */
export async function updateKaruteSummaryWithClient(
  synqed: SynqedRecordsClient,
  karuteRecordId: string,
  summary: string,
): Promise<{ ok: true } | { error: string }> {
  if (!karuteRecordId) return { error: 'karuteRecordId is required' }
  if (!summary || !summary.trim()) {
    // Never blank an existing summary — keep the old one if there's nothing new.
    return { error: 'No new summary to write — keeping the existing one.' }
  }
  try {
    await synqed.karuteRecords.update(karuteRecordId, { ai_summary: summary })
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateKaruteSummary(
  karuteRecordId: string,
  summary: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    // Replacing a record's AI summary = records.write. Thrown → caught below →
    // house { error } shape.
    await requireCapability('records.write')
    const synqed = await getSynqedClient()
    const result = await updateKaruteSummaryWithClient(synqed, karuteRecordId, summary)
    revalidatePath('/[locale]/(app)/karute/[id]', 'page')
    return result
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Server-side regenerate orchestration (packet 07 Decision 2) — the SINGLE source
 * for BOTH worlds. Client sends NOTHING but the id; this reads the authoritative
 * transcript, enforces the recording-privacy ACL server-side (a viewer who can't
 * see the transcript can't regenerate — it reads the same raw text), consumes the
 * AI rate limit through the shared client-threaded accounting, runs the extract +
 * summarize cores in parallel, and applies via the integrity cores (entries
 * add-then-delete rollback; summary best-effort). Prompt anchors (customerName /
 * sessionDate) are DERIVED server-side — never client-supplied.
 *
 * Throws AppApiError for tenancy (not_found), ACL (forbidden), and rate limit
 * (rate_limited) so the facade maps a status; returns the button's RegenerateResult
 * shape ({error|warning|added|removed}) for the normal + soft-failure flow.
 */
export async function regenerateKaruteWithClient(
  synqed: SynqedRecordsClient,
  params: {
    karuteRecordId: string
    viewerStaffId: string | null
    canViewAll: boolean
    locale: string
    /** Facade Bearer path: the verified token's business id. Omitted on the
     *  cookie web path (featureAllowed resolves it). */
    businessId?: string
  },
): Promise<RegenerateResult> {
  const { karuteRecordId, viewerStaffId, canViewAll, locale, businessId } = params

  // Authoritative read — cross-tenant/missing → not_found, genuine upstream → 502.
  const record = await readKaruteRaw(synqed, karuteRecordId)
  const transcript = (record.transcript as string | null) ?? null
  if (!transcript || !transcript.trim()) {
    return { error: 'No transcript to regenerate from.' }
  }

  // Recording-privacy ACL server-gate (#4): withholding the transcript also
  // withholds the regenerate — it reads the same raw text. Fail closed.
  const ownerStaffId = (record.staff_id as string | null) ?? null
  if (!canViewTranscript({ ownerStaffId, viewerStaffId, canViewAll })) {
    throw new AppApiError('forbidden', 'You cannot regenerate a recording you are not allowed to view.')
  }

  // Plan gate (P4) — the legacy /api/ai/* routes wall aiKaruteGeneration behind
  // the paid plan; regenerate runs the same paid extraction, so it honors the
  // same wall on BOTH worlds (Fable spot-audit find: the orchestration bypassed
  // it — inert while billing is disarmed, a wall hole once armed). Dual-path
  // like ai-outreach: explicit businessId (facade Bearer) or the cookie
  // entitlement. Gated BEFORE the rate-limit consumes — a locked caller never
  // burns quota (deliberate ordering improvement over the legacy route).
  const { featureAllowed, featureAllowedForBusiness } = await import(
    '@/lib/subscription/feature-gate'
  )
  const planAllowed = businessId
    ? await featureAllowedForBusiness(businessId, 'aiKaruteGeneration')
    : await featureAllowed('aiKaruteGeneration')
  if (!planAllowed) {
    throw new AppApiError('forbidden', 'PLAN_LOCKED: aiKaruteGeneration')
  }

  // Cost guard BEFORE the LLM calls — ONE shared accounting path (extract +
  // summarize both bill at gpt-4o). Extract is the hard gate (cap hit throws
  // rate_limited → 429). Summarize's consume runs SECOND and a cap hit there
  // downgrades to the existing best-effort-summary path instead of aborting —
  // aborting would waste the extract slot already consumed (Greptile P2;
  // consume() is check-and-take, there is no refund API).
  await enforceAiRateLimitWithClient(synqed, 'extract')
  let summarizeAllowed = true
  try {
    await enforceAiRateLimitWithClient(synqed, 'summarize')
  } catch (err) {
    if (err instanceof AppApiError && err.code === 'rate_limited') {
      summarizeAllowed = false
    } else {
      throw err
    }
  }

  const orgSettings = await orgSettingsWithClient(synqed).catch(() => null)
  const businessType = orgSettings?.business_type
  const sessionDate = (record.created_at as string | null)?.slice(0, 10) ?? null
  // Server-derived name anchor (best-effort) — never client-supplied.
  const clientId = (record.customer_id as string | null) ?? null
  const customerName = clientId
    ? await synqed.customers.get(clientId).then((c) => c.name ?? null).catch(() => null)
    : null

  let entries: Entry[]
  let summaryText: string | null = null
  // Summary is best-effort — a summarize failure never fails the whole run, but
  // it IS surfaced as a soft warning (entries still get applied).
  let summaryFailed = false
  try {
    const [extract, summary] = await Promise.all([
      runKaruteExtraction({ transcript, locale, customerName, sessionDate, businessType }),
      summarizeAllowed
        ? runKaruteSummary({ transcript, locale, customerName, sessionDate, businessType }).catch(
            () => {
              summaryFailed = true
              return null
            },
          )
        : ((summaryFailed = true), Promise.resolve(null)),
    ])
    if (extract.usage) {
      void reportAiUsageWithClient(synqed, 'extract', extract.usage.tokensIn, extract.usage.tokensOut)
    }
    if (summary?.usage) {
      void reportAiUsageWithClient(synqed, 'summarize', summary.usage.tokensIn, summary.usage.tokensOut)
    }
    entries = extract.result.entries
    summaryText = summary?.result.summary ?? null
  } catch (err) {
    // Extract failure → NO write, old entries intact.
    return {
      error: `Could not regenerate (${err instanceof Error ? err.message : 'unknown'}). No changes applied.`,
    }
  }

  if (entries.length === 0) {
    // Nothing extracted → NO delete, old entries kept.
    return { error: 'No entries extracted — keeping the existing record.' }
  }

  const result = await regenerateKaruteEntriesWithClient(synqed, karuteRecordId, entries)
  if (result.error) return result // hard failure, already rolled back

  // Entries are applied — a summary miss (LLM or write) is a soft warning, not a
  // failure of the whole run.
  if (summaryText && summaryText.trim()) {
    const sum = await updateKaruteSummaryWithClient(synqed, karuteRecordId, summaryText)
    if ('error' in sum) summaryFailed = true
  }
  if (summaryFailed) {
    return { ...result, warning: result.warning ?? 'summary_update_failed' }
  }
  return result
}

/** Cookie web action (packet 07 Decision 2) — resolves the caller's identity
 *  server-side and runs the shared orchestration. Replaces the button's old
 *  client-orchestrated extract+summarize+apply round-trip. */
export async function regenerateKarute(karuteRecordId: string): Promise<RegenerateResult> {
  try {
    await requireCapability('records.write')
    const synqed = await getSynqedClient()
    // Dynamic next-intl import — repo convention (see actions/memory.ts): a
    // top-level import drags next-intl ESM into every jest graph that touches
    // this module (regen-list-owner-gate.test.ts broke on exactly that).
    const { getLocale } = await import('next-intl/server')
    const [viewerStaffId, canViewAll, locale] = await Promise.all([
      getCurrentUserStaffId(),
      can('recordings.viewAll'),
      getLocale(),
    ])
    const result = await regenerateKaruteWithClient(synqed, {
      karuteRecordId,
      viewerStaffId,
      canViewAll,
      locale,
    })
    revalidatePath('/[locale]/(app)/karute/[id]', 'page')
    return result
  } catch (err) {
    if (err instanceof AppApiError) return { error: err.message }
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * ⚠️ TEMPORARY BUILD TOOL (remove once historical data is backfilled).
 *
 * Lists a customer's karute (id + transcript) so the bulk "全カルテ再生成" button can
 * re-run the latest extraction/summary prompts across their whole history at once
 * — instead of opening each karute and clicking 再生成. Best-effort: [] on error;
 * only returns records that actually have a transcript to re-process.
 */
export async function listCustomerKaruteForRegen(
  customerId: string,
): Promise<Array<{ id: string; transcript: string }>> {
  if (!customerId) return []
  // This is the ONE action that RETURNS raw transcripts (the whole history at
  // once), and raw recordings are recorder-private — so it rides the owner dev
  // key, same as 再学習 (memory.ts). Server-side twin of the UI gate: hiding
  // the 全カルテ再生成 button is never the only defense. Dynamic import mirrors
  // that gate — keeps the auth chain out of the module graph for callers that
  // never bulk-regen.
  const { canUseDevRegen } = await import('@/actions/dev-tools')
  if (!(await canUseDevRegen())) return []
  try {
    const synqed = await getSynqedClient()
    const res = (await synqed.karuteRecords.list({
      customer_id: customerId,
      page_size: 200,
    })) as
      | { karute_records?: Array<{ id?: string | null; transcript?: string | null }> }
      | null
    return (res?.karute_records ?? [])
      .map((r) => ({ id: r.id ?? '', transcript: r.transcript ?? '' }))
      .filter((r) => r.id !== '' && r.transcript.trim() !== '')
  } catch (err) {
    console.error('[listCustomerKaruteForRegen] failed:', err)
    return []
  }
}
