'use server'

// 再学習 (memory relearn) is a dev tool, not a product feature (Liam ruling
// 2026-07-15/16): each press re-reads the customer's ENTIRE transcript history,
// so cost scales with session count. The trigger belongs to the owner, or to a
// person the owner gave BOTH keys by hand (the pair checked below); everyone
// else sees the plain trust chip. `business.manage` rides no non-owner preset,
// which makes it the right key in the current single-tenant world; at
// multi-tenant GA customer businesses lose the button entirely per the same
// ruling. Server-side enforcement inside relearnCustomerMemoryAction lands
// after the parked re-wrap stack merges (that file is stack-owned).

import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { getMyCapabilities } from '@/lib/auth/require-permission'

export async function canUseDevRegen(): Promise<boolean> {
  try {
    const caps = await getMyCapabilities()
    // BOTH keys, not just the dev key: these tools read raw transcripts. ONE
    // spelling of the pair for the whole repo — holdsOwnerKeys (auth/permissions.ts)
    // carries the reasoning; granting business.manage ALONE never re-opens bulk
    // transcript access, and the named grant ALONE never reaches a dev tool
    // (⚖ 9/3 named grant — the pair is no longer a proxy for the owner IDENTITY,
    // see business/lib/admission.ts).
    return holdsOwnerKeys(caps)
  } catch {
    // Fail closed: if capabilities can't be read, no dev tools.
    return false
  }
}
