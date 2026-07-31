import 'server-only'
import { getSynqedClient } from '@/lib/synqed/client'
import type { Outcome, DeclineReason } from './outcome-types'

interface SetOutcomeParams {
  karuteRecordId: string
  customerId: string
  status: Outcome
  reason?: DeclineReason | null
  isFirstVisit?: boolean
  decidedBy?: string | null
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
  synqed: Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'karuteOutcomes'>,
  params: SetOutcomeParams,
): Promise<{ error?: string }> {
  const decided = params.status !== 'pending'
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
  const decided = params.status !== 'pending'
  try {
    const synqed = await getSynqedClient()
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
    console.error('[outcome] setKaruteOutcome failed:', err)
    return { error: err instanceof Error ? err.message : 'outcome write failed' }
  }
}

export interface KaruteOutcomeRow {
  outcome: Outcome
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
      outcome: o.outcome as Outcome,
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
