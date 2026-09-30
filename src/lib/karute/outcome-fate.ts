import 'server-only'
import { randomUUID } from 'node:crypto'
import {
  setKaruteOutcomeWithClient,
  REVISIT_NOT_ELIGIBLE,
  type OutcomeWriteClient,
} from '@/lib/karute/outcome'
import type { Outcome, SessionOutcome } from '@/lib/karute/outcome-types'
import type { OutcomeMissingReason } from '@/lib/app-api/record-schemas'

/**
 * S2 + S5 (PR-O commit 2; RULING-S67-PRO-STOP1 R-O2): the ANSWER'S FATE.
 *
 * Both writers that save a take's karute — the facade save
 * (api/app/v1/karute/route.ts, through createOrUpdateKaruteRecord) and the job
 * worker (process-recording.ts) — used to emit their karute.save row BEFORE
 * the outcome write, so the row could not say what became of the staff's
 * answer. Now the outcome write runs FIRST, here, and hands back a fate
 * value; the ONE karute.save row is emitted after it, carrying
 * `outcome_link: <fate>`.
 *
 *   written                 the answer is on record
 *   kept                    no answer sent; the record already had a DECIDED one
 *                           (a converge; a 保留 placeholder is not decided)
 *   skipped:<reason>        no answer written: not_returning (the revisit guard
 *                           refused it) · not_sent (no answer, no reason given —
 *                           an old client) · kept_unknown (no answer, and the
 *                           read of what is on record FAILED — A17, S69 fix
 *                           round 4: a failure never wears the word for a true
 *                           no) · the client's own reason (it wins over both)
 *   failed:<ref>            the write failed; <ref> is a short reference to the
 *                           server log line that carries the technical cause —
 *                           the audit row never carries the cause itself
 *
 * NEVER THROWS. A failed write is a fate, not an exception, so the audit row
 * is always emitted; `cause` hands the original failure back to a caller that
 * must still fail (the worker, so core requeues the job).
 */
export type OutcomeSkipReason = 'not_returning' | 'not_sent' | 'kept_unknown' | OutcomeMissingReason
export type OutcomeLink = 'written' | 'kept' | `skipped:${OutcomeSkipReason}` | `failed:${string}`
export interface OutcomeFate {
  link: OutcomeLink
  /** The technical failure, only on `failed:` — for the server log / a rethrow. */
  cause?: unknown
}

export type OutcomeFateClient = OutcomeWriteClient

/** SF-3(b) (S67 fix round 2, commit 13): the ONE decided-answer predicate. A
 *  karute_outcomes row is the staff's DECIDED answer unless it is the 保留
 *  (`pending`) placeholder — a placeholder is not a choice (Business
 *  auto-flips a stale 保留 to 不成約 after 14 days), so a real answer may
 *  land over it and it is never reported as `kept`. Shared by the fate's
 *  kept-read below and the worker's existing-karute skip path
 *  (process-recording.ts) — one definition, never two spellings.
 *  A9 (S69 fix round 4, commit 28): the INCOMING answer is part of the test.
 *  A row the auto-decide wrote (`auto_decided: true` — Business shows it as
 *  「auto」 and lets staff edit it) is not the staff's choice: a real answer
 *  (success / no_deal / revisit) lands over it. An incoming 保留 never lands
 *  over any non-pending row — a stale job carrying 保留 must not clear a
 *  decided date and pull the visit out of the closing rate. A staff-decided
 *  row stays decided against every incoming answer (as before). `incoming`
 *  is null when no answer rides the save (nothing would be written). */
export type RecordedOutcomeRow = { outcome?: string | null; auto_decided?: boolean | null }
export function isDecidedOutcome(
  row: RecordedOutcomeRow | null | undefined,
  incoming: Outcome | null | undefined,
): boolean {
  if (!row || row.outcome === 'pending') return false
  if (incoming === 'pending') return true
  if (row.auto_decided === true && incoming) return false
  return true
}

export async function writeOutcomeFate(
  synqed: OutcomeFateClient,
  input: {
    karuteRecordId: string
    customerId: string
    staffId: string
    /** false = this save converged on an existing record (the only case where
     *  an earlier answer can already be on record). */
    fresh: boolean
    outcome?: SessionOutcome | null
    outcomeMissing?: OutcomeMissingReason | null
    /** The log prefix each writer already used ('[karute.save]' / '[job]'). */
    logTag: string
    /** SF-7 (S67 fix round 2, commit 17): the worker's run is STALE by the
     *  time it converges (R-O4: it must never clobber what staff set since).
     *  With an answer, on a converge AND (A4, S69 fix round 4, commit 26) on a
     *  create — core's create may return an existing record, `fresh` stays
     *  true for want of a signal — a DECIDED answer already
     *  on record (isDecidedOutcome — the skip path's predicate) is kept, not
     *  overwritten; the read is strict, as the skip path's: a read that fails
     *  is `failed:<ref>` (the job fails and its requeue asks again), never a
     *  blind write. The facade (the staff's own newest answer) never sets it. */
    keepDecidedAnswer?: boolean
  },
): Promise<OutcomeFate> {
  const failed = (cause: unknown): OutcomeFate => {
    const ref = randomUUID().slice(0, 8)
    console.error(
      JSON.stringify({
        evt: 'outcome_write_failed',
        ref,
        karuteRecordId: input.karuteRecordId,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
    )
    return { link: `failed:${ref}`, cause }
  }

  if (!input.outcome) {
    if (!input.fresh) {
      // A converge with no answer: a DECIDED answer an earlier save wrote
      // stays (a 保留 placeholder is not one — isDecidedOutcome).
      // try/await, not .catch(): a synchronous throw must not escape either.
      // A17 (S69 fix round 4, commit 28): a read that FAILS cannot say whether
      // an answer is on record — it answers `kept_unknown`, never `not_sent`
      // (the word for a true no). The failure is logged once; when the client
      // sent its own missing-answer reason, the CLIENT's reason wins (the row
      // says what the phone said).
      let recorded: RecordedOutcomeRow | null
      try {
        recorded = await synqed.karuteOutcomes.get(input.karuteRecordId)
      } catch (err) {
        console.warn(
          JSON.stringify({
            evt: 'outcome_keep_read_failed',
            karuteRecordId: input.karuteRecordId,
            cause: err instanceof Error ? err.message : String(err),
          }),
        )
        return { link: `skipped:${input.outcomeMissing ?? 'kept_unknown'}` }
      }
      if (isDecidedOutcome(recorded, null)) return { link: 'kept' }
    }
    return { link: `skipped:${input.outcomeMissing ?? 'not_sent'}` }
  }

  if (input.keepDecidedAnswer) {
    let recorded: RecordedOutcomeRow | null
    try {
      recorded = await synqed.karuteOutcomes.get(input.karuteRecordId)
    } catch (err) {
      return failed(err)
    }
    if (isDecidedOutcome(recorded, input.outcome.status)) return { link: 'kept' }
  }

  let result: { error?: string }
  try {
    result = await setKaruteOutcomeWithClient(synqed, {
      karuteRecordId: input.karuteRecordId,
      customerId: input.customerId,
      status: input.outcome.status,
      reason: input.outcome.reason ?? null,
      isFirstVisit: input.outcome.isFirstVisit,
      decidedBy: input.staffId,
      // Post-persist: the record this label attaches to already exists.
      onUnverifiable: 'write',
    })
  } catch (err) {
    return failed(err)
  }
  if (result.error === REVISIT_NOT_ELIGIBLE) {
    console.warn(`${input.logTag} revisit rejected server-side; record kept, label dropped`, {
      karuteRecordId: input.karuteRecordId,
    })
    return { link: 'skipped:not_returning' }
  }
  if (result.error) return failed(result.error)
  return { link: 'written' }
}

/** The facade save's reply field (S2): what the phone needs to tell staff an
 *  answer did not land — plain, never the technical cause. */
export function outcomeReply(link: OutcomeLink): { written: boolean; reason?: string } {
  if (link === 'written') return { written: true }
  if (link === 'kept') return { written: false, reason: 'kept' }
  if (link.startsWith('failed:')) return { written: false, reason: 'write_failed' }
  return { written: false, reason: link.slice('skipped:'.length) }
}
