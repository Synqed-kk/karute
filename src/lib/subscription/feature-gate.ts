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

import { getBusinessId, getStaffList } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { billingEnforced, loadEntitlement } from '@/lib/entitlements'
import {
  canAddStaffFor,
  entitlementHasFeature,
  type EntitlementFeature,
} from '@/lib/subscription/gating'

export async function featureAllowed(
  feature: EntitlementFeature,
): Promise<boolean> {
  // Disarmed = today's behavior with ZERO added I/O — the arming switch is a
  // pure env read, so check it before the entitlement round-trips (audit
  // finding: 3 backend calls per AI request that decided nothing).
  if (!billingEnforced()) return true
  try {
    const businessId = await getBusinessId()
    const ent = await loadEntitlement(businessId)
    if (!ent.enforced || ent.degraded) return true
    return entitlementHasFeature(ent, feature)
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
    const ent = await loadEntitlement(businessId)
    const staff = await getStaffList()
    let pendingNew = 0
    try {
      const synqed = await getSynqedClient()
      const { invites } = await synqed.invites.list()
      pendingNew = invites.filter(
        (i) => i.status === 'pending' && !i.invited_staff_id,
      ).length
    } catch {
      /* count what we can — invites unreadable ≠ blocked */
    }
    const count = staff.length + pendingNew
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
