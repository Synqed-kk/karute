import 'server-only'

// ─────────────────────────────────────────────────────────────
// Feature gate — the one question every paid-capability path asks (P4)
// ─────────────────────────────────────────────────────────────
// "May this business use <feature> right now?" true unless billing enforcement
// is ARMED (KARUTE_BILLING_ENFORCEMENT) and the plan genuinely lacks the
// feature. Fail-open on every soft failure — the paths this guards (AI karute
// generation, memory auto-extract, outreach drafts) all existed before billing
// did, so a billing-infra hiccup must never take them down:
//   • enforcement off            → allowed (today's behavior, byte-for-byte)
//   • entitlement read degraded  → allowed (core outage ≠ downgrade)
//   • identity/lookup throw      → allowed
// The only "no" is an armed, healthy read of a plan that lacks the feature.
// Callers that surface UX (再学習 button) branch on the false to show honest
// upgrade copy; background/best-effort callers just skip silently.

import type { SynqedClient } from '@synqed-kk/client'
import { getBusinessId, getStaffList } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { billingEnforced, loadEntitlement, loadEntitlementWithClient } from '@/lib/entitlements'
import {
  canAddStaffFor,
  entitlementHasFeature,
  type EntitlementFeature,
} from '@/lib/subscription/gating'

/** Entitlement gate for an EXPLICIT business id — the identity seam shared by the
 *  cookie path (featureAllowed) and the facade Bearer path (businessId from the
 *  verified token, no cookie). Same fail-open posture. */
export async function featureAllowedForBusiness(
  businessId: string,
  feature: EntitlementFeature,
): Promise<boolean> {
  if (!billingEnforced()) return true
  try {
    const ent = await loadEntitlement(businessId)
    if (!ent.enforced || ent.degraded) return true
    return entitlementHasFeature(ent, feature)
  } catch {
    return true
  }
}

export async function featureAllowed(
  feature: EntitlementFeature,
): Promise<boolean> {
  // Disarmed = today's behavior with ZERO added I/O — the arming switch is a
  // pure env read, so check it before the entitlement round-trips (audit
  // finding: 3 backend calls per AI request that decided nothing).
  if (!billingEnforced()) return true
  try {
    return await featureAllowedForBusiness(await getBusinessId(), feature)
  } catch {
    return true
  }
}

/** Staff-limit gate shared by BOTH staff-creation paths — createInvite (join
 *  link) and createStaff (direct owner add). One gate, so the two doors can't
 *  disagree. Counts live staff PLUS pending invites for brand-new people
 *  (invited_staff_id null; re-invites attach to an existing row and would
 *  double-count) — otherwise an owner at the cap could pre-send N join links
 *  that all land after the check. Fail-open like featureAllowed. */
export async function staffAddAllowed(): Promise<{
  allowed: boolean
  count: number
  limit: number | 'unlimited'
}> {
  // Same zero-I/O early exit as featureAllowed; the fallback shape matches
  // the catch below (callers already tolerate count 0 / unlimited — the cap
  // meter reads the separately-loaded entitlement, not this).
  if (!billingEnforced()) return { allowed: true, count: 0, limit: 'unlimited' }
  try {
    const businessId = await getBusinessId()
    const synqed = await getSynqedClient()
    return await staffAddAllowedWithClient(synqed, businessId, async () => (await getStaffList()).length)
  } catch {
    return { allowed: true, count: 0, limit: 'unlimited' }
  }
}

/** Client-threaded twin of staffAddAllowed — the identity seam the facade
 *  staff-create route uses (businessId from the verified token, Bearer-scoped
 *  client, roster count from the caller's own lookup; the cookie path above
 *  delegates here so the two can never diverge). Same counting rules + the
 *  same fail-open posture. staffCount is a thunk so the roster read only
 *  happens once enforcement is armed. */
export async function staffAddAllowedWithClient(
  synqed: Pick<SynqedClient, 'entitlements' | 'stores' | 'invites'>,
  businessId: string,
  staffCount: () => Promise<number>,
): Promise<{ allowed: boolean; count: number; limit: number | 'unlimited' }> {
  if (!billingEnforced()) return { allowed: true, count: 0, limit: 'unlimited' }
  try {
    const ent = await loadEntitlementWithClient(synqed, businessId)
    const staff = await staffCount()
    let pendingNew = 0
    try {
      const { invites } = await synqed.invites.list()
      pendingNew = invites.filter(
        (i) => i.status === 'pending' && !i.invited_staff_id,
      ).length
    } catch {
      /* count what we can — invites unreadable ≠ blocked */
    }
    const count = staff + pendingNew
    if (!ent.enforced || ent.degraded) {
      return { allowed: true, count, limit: ent.staffLimit }
    }
    return {
      allowed: canAddStaffFor({
        tier: ent.tier,
        isUnlimited: ent.isUnlimited,
        staffCount: count,
      }),
      count,
      limit: ent.staffLimit,
    }
  } catch {
    return { allowed: true, count: 0, limit: 'unlimited' }
  }
}
