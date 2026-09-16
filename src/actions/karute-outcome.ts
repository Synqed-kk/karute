'use server'

import { revalidatePath } from 'next/cache'
import { auditWeb } from '@/lib/audit-web'
import { getCurrentUserStaffId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { setKaruteOutcome } from '@/lib/karute/outcome'
import { ensureRecordStoreInScope, resolveStoreScope } from '@/lib/auth/store-scope'
import type { SessionOutcome } from '@/lib/karute/outcome-types'

/**
 * Change a karute's session outcome AFTER the fact — the customer came back
 * (不成約 → 成約) or wants a refund (成約 → 不成約), or a pending one is decided.
 * Same upsert contract as the save-time capture, so the outcome is never
 * locked: the 14-day auto-decide is just a default, always overridable here.
 *
 * The customer is DERIVED server-side from the karute record (Wave W3
 * blind-round fix — facade-route parity: "the path id is authoritative",
 * never caller-supplied). The business-scoped client makes the read the
 * tenancy proof too: a cross-tenant or missing id fails before any write.
 * The derived id feeds the write, the audit row, and the revalidate.
 */
export async function updateKaruteOutcome(
  karuteRecordId: string,
  outcome: SessionOutcome,
): Promise<{ error?: string }> {
  const staffId = await getCurrentUserStaffId()
  let customerId: string
  try {
    const synqed = await getSynqedClient()
    const record = await synqed.karuteRecords.get(karuteRecordId)
    // STORE LOCK (⚖ Liam 2026-09-16): the outcome is a write ON a record, so a
    // clamped actor must not be able to re-label another branch's karute by
    // id. The refusal falls into this same catch and comes out as the exact
    // 'karute record not found' a missing id already returns here — one
    // answer, no existence oracle. The lock lives at THIS door (not in
    // setKaruteOutcomeWithClient) because that core is also the save-embedded
    // and background-job writer, which carry no actor scope and stamp their
    // store through resolveKaruteStoreId instead.
    ensureRecordStoreInScope(
      { store_id: (record.store_id as string | null) ?? null },
      await resolveStoreScope(),
      'karute record not found',
    )
    const linked = (record.customer_id as string | null) ?? null
    if (!linked) return { error: 'karute has no linked customer' }
    customerId = linked
  } catch {
    return { error: 'karute record not found' }
  }
  const result = await setKaruteOutcome({
    karuteRecordId,
    customerId,
    status: outcome.status,
    reason: outcome.reason,
    isFirstVisit: outcome.isFirstVisit,
    decidedBy: staffId,
  })
  if (result.error) return { error: result.error }
  revalidatePath(`/karute/${karuteRecordId}`)
  revalidatePath(`/customers/${customerId}`)
  // Wave W3: the web twin of the facade karute.outcome.set row (that side is
  // the generic success hook on the dedicated outcome route). AFTER-THE-FACT
  // only — a save-embedded outcome write is covered by that path's
  // karute.save row instead. customer_id rides the detail for the viewer's
  // name join (Wave V karute-target canon).
  await auditWeb({
    category: 'karute',
    action: 'karute.outcome_set',
    targetType: 'karute',
    targetId: karuteRecordId,
    detail: { customer_id: customerId },
    requestId: crypto.randomUUID(),
  })
  return {}
}
