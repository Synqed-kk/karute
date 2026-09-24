'use server'

import { revalidatePath } from 'next/cache'
import { auditWeb } from '@/lib/audit-web'
import { getCurrentUserStaffId } from '@/lib/staff'
import { can } from '@/lib/auth/require-permission'
import {
  removeRedemption,
  updatePackStatus,
  type ContactChannel,
} from '@/lib/packs/store'
import type { PackStatus } from '@/lib/packs/types'
// The six WithClient cores live in a server-only module (PKT-SEC-CORES-D4,
// 2026-09-23): every runtime export of this 'use server' file is a
// browser-callable endpoint, so only the web actions below stay here.
import {
  createPackActionWithClient,
  dismissPackAlertActionWithClient,
  dismissVisitReconcileActionWithClient,
  logCustomerContactActionWithClient,
  redeemSessionActionWithClient,
  setLifecycleActionWithClient,
  type CreatePackActionInput,
  type RedeemSessionActionInput,
  type SetLifecycleActionInput,
} from '@/lib/packs/packs.core'

// 回数券 server actions — the ONLY write path to the pack tables (they're
// RLS-locked; browser clients can't reach them). Each action stamps the acting
// staff id and revalidates the customer profile so the pack card refreshes.
// The client-threaded cores these wrap live in src/lib/packs/packs.core.ts.

const revalidateProfile = () =>
  revalidatePath('/[locale]/(app)/customers/[id]', 'page')

export async function createPackAction(
  input: CreatePackActionInput,
): Promise<{ ok: boolean; error?: string }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  // getSynqedClient() unguarded here would THROW the whole server action on a
  // transient session/DB failure — RecordPageView's onResolve now runs this
  // and redeemSessionAction as two INDEPENDENT writes (F1, PR-0 fix round);
  // an unguarded throw here would still surface as a rejected promise, and
  // must degrade to the SAME { ok: false } contract every other guarded
  // action in this file uses, not an uncaught rejection.
  const [synqed, staffId] = await Promise.all([
    getSynqedClient().catch((err) => {
      console.warn('[packs] synqed client init failed:', err)
      return null
    }),
    getCurrentUserStaffId().catch(() => null),
  ])
  if (!synqed) return { ok: false, error: 'write failed' }
  const result = await createPackActionWithClient(synqed, staffId, input)
  if (result.ok) revalidateProfile()
  return result
}

export async function setPackStatusAction(
  packId: string,
  status: PackStatus,
): Promise<{ ok: boolean }> {
  if (!packId) return { ok: false }
  const result = await updatePackStatus(packId, status)
  if (result.ok) revalidateProfile()
  return result
}

/** Check one session off a pack (manual check-off; date defaults to today JST).
 *
 *  NO idempotencyKey here, deliberately. Core dedupes on key EQUALITY, so a key
 *  only protects anything if the same one is sent twice. This action is a
 *  server action: one invocation = one execution = one addRedemption call, with
 *  no retry between them (the SDK's fetch does not retry — client.js:82-96), so
 *  a key minted on this side would be unique per execution and dedupe exactly
 *  nothing — protection on paper, none in the field. The phone is no better off
 *  yet: idemPost mints the key INSIDE the call (thin/ports/actions.vite.ts
 *  :243-250), so a re-tap after a failure toast sends a NEW key. A STABLE
 *  per-gesture key — web AND phone — is the QUEUED client half; what stops a
 *  double-tap on either side today is the callers' single-flight latches
 *  (RecordPageView usingRecording/resolvingOutcomeRef).
 *  ponytail: unkeyed until a key is minted per user gesture and threaded in —
 *  a UI-side change, deliberately out of this PR's fence. */
export async function redeemSessionAction(
  input: RedeemSessionActionInput,
): Promise<{ ok: boolean; redemptionId?: string; error?: string }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  // getSynqedClient() unguarded here would THROW the whole server action on a
  // transient session/DB failure — RecordPageView's onResolve now runs this
  // and createPackAction as two INDEPENDENT writes (F1, PR-0 fix round); an
  // unguarded throw here would still surface as a rejected promise, and must
  // degrade to the SAME { ok: false } contract every other guarded action in
  // this file uses, not an uncaught rejection.
  const [synqed, staffId] = await Promise.all([
    getSynqedClient().catch((err) => {
      console.warn('[packs] synqed client init failed:', err)
      return null
    }),
    getCurrentUserStaffId().catch(() => null),
  ])
  if (!synqed) return { ok: false, error: 'write failed' }
  const result = await redeemSessionActionWithClient(synqed, staffId, input)
  if (result.ok) revalidateProfile()
  // D7 (⚖ 8/21 ②) — recovery-resolved burns are visible to reconcile. VERIFIED
  // against @synqed-kk/client 1.28.0, the version package.json PINS (re-checked
  // on a clean npm ci — an earlier pass read a stale 1.19.0 tree, so the version
  // is named here on purpose): a `source` surface DOES exist end-to-end
  // (AddRedemptionInput → SDK `source?: string`), but it is a BARE string — no
  // union, no 'recovery' value, no enumeration at all — so the typings say
  // nothing about what the DB accepts, and the package ships compiled .d.ts only
  // (packs/store.ts's own header: assume nothing beyond the error-string
  // contract). Sending an unknown literal on a MONEY write is not a risk worth
  // taking blind, so the tag lives at the audit layer instead — never a
  // client-side shadow ledger.
  // THIS IS THE WEB HALF. The PHONE half rides the facade route's ctx.auditDetail
  // seam (customers/[id]/packs/redeem) — the build round wrongly claimed the
  // facade twin could carry no per-call detail; it can, and now does. What is
  // still missing on BOTH is a queryable source column, which stays the OPTIONAL
  // Anthony one-liner: add 'recovery' to the redemption source enum.
  if (result.ok && input.recovery) {
    await auditWeb({
      category: 'customer',
      action: 'customer.pack_redeem',
      targetType: 'customer',
      targetId: input.customerId,
      severity: 'notice',
      detail: {
        resolved_via: 'recovery',
        pack_id: input.packId,
        appointment_id: input.appointmentId ?? null,
        redemption_id: result.redemptionId ?? null,
        redeemed_on: input.redeemedOn ?? null,
      },
      // B-10: the repo's defensive form — crypto.randomUUID is absent in some
      // runtimes/test envs, and an audit emit must never break the burn.
      requestId: globalThis.crypto?.randomUUID?.(),
    })
  }
  return result
}

/** 来店なし — the visit didn't actually happen; the reconcile row never
 *  re-surfaces. ANY staff (unlike alert dismissal): correcting a record is
 *  not the manager-gated "give up". Audit-trailed via dismissed_by. */
export async function dismissVisitReconcileAction(input: {
  customerId: string
  appointmentId?: string | null
  visitDay: string
}): Promise<{ ok: boolean }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  // getSynqedClient() unguarded here would THROW the whole server action on a
  // transient session/DB failure — ReconcileStrip awaits with no try/catch
  // (stranded spinner, no toast). Catch to null and degrade to the SAME
  // { ok: false } origin/main produced when the old cookie fn's internal
  // try/catch swallowed this exact failure.
  const [synqed, staffId] = await Promise.all([
    getSynqedClient().catch((err) => {
      console.warn('[packs] synqed client init failed:', err)
      return null
    }),
    getCurrentUserStaffId().catch(() => null),
  ])
  if (!synqed) return { ok: false }
  const result = await dismissVisitReconcileActionWithClient(synqed, staffId, input)
  if (result.ok) revalidatePath('/dashboard')
  return result
}

export async function undoRedemptionAction(redemptionId: string): Promise<{ ok: boolean }> {
  if (!redemptionId) return { ok: false }
  // WHO undid the burn — recorded on the redemption row (removed_by) so the
  // undo is auditable without a join.
  const staffId = await getCurrentUserStaffId().catch(() => null)
  const result = await removeRedemption(redemptionId, staffId)
  if (result.ok) revalidateProfile()
  return result
}

/** Log a 連絡済み (win-back contact attempt) — ANY staff, no capability gate.
 *  Snoozes the alert into 対応中 for 7 days; auto-resolves when the customer
 *  books/visits. Also the labeled outcome stream coaching trains on. */
export async function logCustomerContactAction(input: {
  customerId: string
  channel: ContactChannel
  note?: string
}): Promise<{ ok: boolean; error?: string }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  // getSynqedClient() unguarded here would THROW the whole server action on a
  // transient session/DB failure — PackAlertsCard awaits with no try/catch
  // (stranded spinner, no toast). Catch to null and degrade to the SAME
  // { ok:false, error:'write failed' } origin/main produced when the old
  // cookie fn's internal try/catch swallowed this exact failure.
  const [synqed, staffId] = await Promise.all([
    getSynqedClient().catch((err) => {
      console.warn('[packs] synqed client init failed:', err)
      return null
    }),
    getCurrentUserStaffId().catch(() => null),
  ])
  if (!synqed) return { ok: false, error: 'write failed' }
  const result = await logCustomerContactActionWithClient(synqed, staffId, input)
  if (result.ok) {
    revalidatePath('/[locale]/(app)/dashboard', 'page')
  }
  return result
}

/** Dismiss a customer's 要連絡 alert — MANAGER+ ONLY (Kitano's rule: staff show
 *  the manager they contacted the customer; the manager silences the alert).
 *  Audit-trailed (who/when/why); the alert re-arms automatically after the
 *  customer's next visit resets their absence clock. */
export async function dismissPackAlertAction(input: {
  customerId: string
  reason?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.customerId) return { ok: false, error: 'customerId required' }
  // An outage (the capability read failed) is not a permission answer (Round 2).
  const allowed = await can('alerts.manage').catch(() => null)
  if (allowed === null) return { ok: false, error: 'write failed' }
  if (!allowed) return { ok: false, error: 'forbidden' }
  const { getSynqedClient } = await import('@/lib/synqed/client')
  // getSynqedClient() unguarded here would THROW the whole server action on a
  // transient session/DB failure — PackAlertsCard awaits with no try/catch
  // (stranded spinner, no toast). Catch to null and degrade to the SAME
  // { ok:false, error:'write failed' } origin/main produced when the old
  // cookie fn's internal try/catch swallowed this exact failure.
  const [synqed, staffId] = await Promise.all([
    getSynqedClient().catch((err) => {
      console.warn('[packs] synqed client init failed:', err)
      return null
    }),
    getCurrentUserStaffId().catch(() => null),
  ])
  if (!synqed) return { ok: false, error: 'write failed' }
  const result = await dismissPackAlertActionWithClient(synqed, staffId, input)
  if (result.ok) {
    revalidatePath('/[locale]/(app)/dashboard', 'page')
    revalidatePath('/[locale]/(app)/customers', 'page')
  }
  return result
}

export async function setLifecycleAction(
  input: SetLifecycleActionInput,
): Promise<{ ok: boolean }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  const [synqed, staffId] = await Promise.all([getSynqedClient(), getCurrentUserStaffId().catch(() => null)])
  const result = await setLifecycleActionWithClient(synqed, staffId, input)
  if (!result.ok) return { ok: false }
  revalidateProfile()
  // Wave W3: the web twin of the facade customer.lifecycle.set row (that side
  // is the generic success hook on the lifecycle route) — success only.
  await auditWeb({
    category: 'customer',
    action: 'customer.lifecycle_set',
    targetType: 'customer',
    targetId: input.customerId,
    requestId: crypto.randomUUID(),
  })
  return result
}
