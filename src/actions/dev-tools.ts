'use server'

// 再学習 (memory relearn) is a dev tool, not a product feature (Liam ruling
// 2026-07-15/16): each press re-reads the customer's ENTIRE transcript history,
// so cost scales with session count. Only the owner account keeps the trigger;
// everyone else sees the plain trust chip. `business.manage` is owner-only by
// default, which makes it the right key in the current single-tenant world; at
// multi-tenant GA customer businesses lose the button entirely per the same
// ruling. Server-side enforcement inside relearnCustomerMemoryAction lands
// after the parked re-wrap stack merges (that file is stack-owned).

import { getMyCapabilities } from '@/lib/auth/require-permission'

export async function canUseDevRegen(): Promise<boolean> {
  try {
    const caps = await getMyCapabilities()
    // BOTH keys, not just the dev key: these tools read raw transcripts, and
    // recordings.viewAll is strip-protected owner-only (permissions.ts) while
    // business.manage is a grantable toggle. Requiring both pins the tools to
    // the owner IDENTITY — an owner granting business.manage to a manager can
    // never silently re-open bulk transcript access (3-lens fleet followup).
    return caps.has('business.manage') && caps.has('recordings.viewAll')
  } catch {
    // Fail closed: if capabilities can't be read, no dev tools.
    return false
  }
}
