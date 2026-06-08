import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
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
 * save (the critical artifact) is never blocked by an outcome-write failure
 * (e.g. before the migration has run). Callers must not gate the save on it.
 *
 * TRANSITIONAL backing: the karute_outcomes table. The signature is the stable
 * contract — when synqed-core gains outcome fields, only this body changes.
 * See docs/karute-session-outcome-spec.md.
 */
export async function setKaruteOutcome(
  params: SetOutcomeParams,
): Promise<{ error?: string }> {
  const decided = params.status !== 'pending'
  try {
    const supabase = createServiceClient()
    const now = new Date().toISOString()
    const { error } = await supabase.from('karute_outcomes').upsert(
      {
        karute_record_id: params.karuteRecordId,
        customer_id: params.customerId,
        outcome: params.status,
        reason: params.status === 'no_deal' ? (params.reason ?? null) : null,
        is_first_visit: params.isFirstVisit ?? false,
        decided_by: decided ? (params.decidedBy ?? null) : null,
        decided_at: decided ? now : null,
        auto_decided: false,
        updated_at: now,
      },
      { onConflict: 'karute_record_id' },
    )
    if (error) {
      console.error('[outcome] setKaruteOutcome failed:', error.message)
      return { error: error.message }
    }
    return {}
  } catch (err) {
    console.error('[outcome] setKaruteOutcome threw:', err)
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

/** Read a session's outcome (null if none recorded). */
export async function getKaruteOutcome(
  karuteRecordId: string,
): Promise<KaruteOutcomeRow | null> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('karute_outcomes')
      .select('outcome, reason, is_first_visit, decided_at, auto_decided')
      .eq('karute_record_id', karuteRecordId)
      .maybeSingle()
    return (data as KaruteOutcomeRow | null) ?? null
  } catch {
    return null
  }
}
