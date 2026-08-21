'use server'

// 録音履歴 — the web arm's read (Build F1). The thin arm calls the facade twin
// (/api/app/v1/recordings/inbox) through thin/ports/actions.vite.ts; both run
// the SAME readRecordingsInbox, so the two worlds cannot disagree about what
// happened to a recording.
//
// SECURITY: the staff id comes from the SIGNED-IN user and nothing else — this
// action takes no arguments, so there is no id for a caller to supply.

import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { requireCapability } from '@/lib/auth/require-permission'
import { readRecordingsInbox } from '@/lib/recordings/inbox-read'
import type { InboxServerSession } from '@/lib/recordings/inbox'

export async function listRecordingsInbox(): Promise<InboxServerSession[]> {
  // Same gate as the rest of the recording family: only a recorder has
  // recordings, and every action a row offers (save / retry) is records.write.
  await requireCapability('records.write')
  const [synqed, staffId] = await Promise.all([getSynqedClient(), getCurrentUserStaffId()])
  // No staff identity → no sessions of your own. Empty, not an error: the
  // inbox still shows this device's recoverable takes.
  if (!staffId) return []
  // businessId is the tenant key for the shared read's server-side customer
  // name fill (⚖ Liam 2026-08-17). Request-memoized, and getSynqedClient
  // already resolved it internally, so it costs no extra roundtrip.
  return readRecordingsInbox({
    synqed,
    staffId,
    businessId: await getBusinessId(),
    now: new Date(),
  })
}
