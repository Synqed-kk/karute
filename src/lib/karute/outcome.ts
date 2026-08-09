import 'server-only'
import { getSynqedClient } from '@/lib/synqed/client'
import type { Outcome, DeclineReason } from './outcome-types'
import {
  isReturningCustomerServerSide,
  type RevisitEligibility,
  type RevisitGuardClient,
} from './revisit-guard'

/** Returned (never thrown) when a 'revisit' write is rejected as DETERMINISTICALLY
 *  ineligible — every eligibility read succeeded and the customer is genuinely
 *  new. Pre-persist boundaries map this to a 400; post-persist paths drop the
 *  label and warn. Retrying can never change it. */
export const REVISIT_NOT_ELIGIBLE = 'revisit_not_eligible'

/** Returned when eligibility could not be VERIFIED (a read failed and the retry
 *  didn't recover) — an infra fault, not a client error. Pre-persist boundaries
 *  map this to a retryable upstream error, never a validation 400. Post-persist
 *  callers never see it: they pass onUnverifiable:'write'. Distinct literal so
 *  callers branch on the cause, not on a shared "something went wrong". */
export const REVISIT_CHECK_UNAVAILABLE = 'revisit_check_unavailable'

/** The outcome enum baked into every fielded shell ≤4.6/code-12 — FROZEN by
 *  definition (those bundles ship as-is until the phone takes the 4.7/code-13
 *  bake). Both facade halves gate on it: the screens read serves anything
 *  outside this set as null to header-absent clients, and the outcome write
 *  refuses to overwrite such a value from one. Same list, one source. */
export const OLD_SHELL_OUTCOMES = ['success', 'no_deal', 'pending']

/** The chokepoint's client surface: the upsert itself plus what the revisit
 *  eligibility derivation reads. Every caller already passes a full client. */
export type OutcomeWriteClient = Pick<
  Awaited<ReturnType<typeof getSynqedClient>>,
  'karuteOutcomes'
> &
  RevisitGuardClient

interface SetOutcomeParams {
  karuteRecordId: string
  customerId: string
  status: Outcome
  reason?: DeclineReason | null
  isFirstVisit?: boolean
  decidedBy?: string | null
  /** What to do when eligibility is UNKNOWN (a read failed, retry didn't
   *  recover) — never about a genuine 'not_returning', which always drops.
   *  'write'  = post-persist caller: the karute already exists, so a silently
   *             lost label is the worse harm. Deliberate fail-open on infra
   *             failure only, with a loud warn (see revisit-guard).
   *  'reject' = pre-persist caller (default): nothing is written yet, so
   *             failing honestly costs nothing. */
  onUnverifiable?: 'write' | 'reject'
}

/**
 * Record a session's outcome — the coaching training-data label.
 *
 * BEST-EFFORT: returns `{ error }` on failure and NEVER throws, so the karute
 * save (the critical artifact) is never blocked by an outcome-write failure.
 * Callers must not gate the save on it.
 *
 * Backed by synqed-core (`karute_outcomes`), upserted on karute_record_id within
 * the caller's business. See docs/karute-session-outcome-spec.md.
 */
/** setKaruteOutcome on an EXPLICIT business-scoped client — the facade Bearer
 *  path (packet 07 §Build 3). Same best-effort upsert contract (never throws). */
export async function setKaruteOutcomeWithClient(
  synqed: OutcomeWriteClient,
  params: SetOutcomeParams,
): Promise<{ error?: string }> {
  const decided = params.status !== 'pending'
  // THE chokepoint. Every outcome write on both surfaces lands here (web save
  // ×2, web edit, facade save, facade edit, processJob), so the eligibility
  // rule lives here once instead of at six call sites — including processJob,
  // which must never throw post-AI (a retry re-runs Deepgram/OpenAI). Returning
  // instead of throwing keeps the best-effort contract intact: an ineligible
  // revisit writes nothing and never blocks the save.
  if (params.status === 'revisit') {
    const eligibility = await revisitAllowed(synqed, params)
    if (eligibility === 'not_returning') return { error: REVISIT_NOT_ELIGIBLE }
    if (eligibility === 'unknown') {
      if (params.onUnverifiable !== 'write') return { error: REVISIT_CHECK_UNAVAILABLE }
      console.warn(
        '[revisit] eligibility unverifiable after retry; label written on client gate',
        { karuteRecordId: params.karuteRecordId, customerId: params.customerId },
      )
    }
  }
  try {
    const now = new Date().toISOString()
    await synqed.karuteOutcomes.upsert({
      karute_record_id: params.karuteRecordId,
      customer_id: params.customerId,
      outcome: params.status,
      reason: params.status === 'no_deal' ? (params.reason ?? null) : null,
      is_first_visit: params.isFirstVisit ?? false,
      decided_by: decided ? (params.decidedBy ?? null) : null,
      decided_at: decided ? now : null,
      auto_decided: false,
    })
    return {}
  } catch (err) {
    console.error('[outcome] setKaruteOutcomeWithClient failed:', err)
    return { error: err instanceof Error ? err.message : 'outcome write failed' }
  }
}

export async function setKaruteOutcome(
  params: SetOutcomeParams,
): Promise<{ error?: string }> {
  // Cookie-path twin: same body, own client. Delegating (rather than the
  // second copy this used to be) means the eligibility guard above cannot be
  // enforced on one surface and missed on the other.
  return setKaruteOutcomeWithClient(await getSynqedClient(), params)
}

/** 'revisit' is legal when the customer really is returning, OR when the row
 *  being edited is ALREADY revisit — the stored row is its own proof, the same
 *  rationale that lets 編集 re-offer the card. Checked first: it costs one read
 *  and short-circuits the three the derivation needs. */
async function revisitAllowed(
  synqed: OutcomeWriteClient,
  params: SetOutcomeParams,
): Promise<RevisitEligibility> {
  const existing = await getKaruteOutcomeWithClient(synqed, params.karuteRecordId)
  if (existing?.outcome === 'revisit') return 'returning'
  // Exclude THIS session's own record: it already exists by the time any
  // outcome write runs, so counting it would let a save prove prior history
  // with the record it just created.
  return isReturningCustomerServerSide(synqed, params.customerId, {
    karuteRecordId: params.karuteRecordId,
  })
}

export interface KaruteOutcomeRow {
  /** READ shape — a plain string, not the write side's `Outcome` union. The
   *  core column is permissive text, so a row written by a NEWER server can
   *  carry a value this build has never heard of; the card renders a neutral
   *  fallback for it instead of the read path lying with an `as Outcome` cast
   *  (and a baked shell hard-failing the whole screen). Writes stay strict. */
  outcome: string
  reason: DeclineReason | null
  is_first_visit: boolean
  decided_at: string | null
  auto_decided: boolean
}

/** Read a session's outcome on an EXPLICIT business-scoped client — the facade
 *  Bearer path (packet 07). Best-effort null-on-failure, EXACTLY like the cookie
 *  reader below (product semantics — a missing/failed outcome is "none recorded",
 *  the pre-ruled exception to the screen GET's must-502 rule). */
export async function getKaruteOutcomeWithClient(
  synqed: Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'karuteOutcomes'>,
  karuteRecordId: string,
): Promise<KaruteOutcomeRow | null> {
  try {
    const o = await synqed.karuteOutcomes.get(karuteRecordId)
    if (!o) return null
    return {
      outcome: o.outcome,
      reason: o.reason as DeclineReason | null,
      is_first_visit: o.is_first_visit,
      decided_at: o.decided_at,
      auto_decided: o.auto_decided,
    }
  } catch {
    return null
  }
}

/** Read a session's outcome (null if none recorded). */
export async function getKaruteOutcome(
  karuteRecordId: string,
): Promise<KaruteOutcomeRow | null> {
  return getKaruteOutcomeWithClient(await getSynqedClient(), karuteRecordId)
}
