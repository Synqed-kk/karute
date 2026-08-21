'use server'

// 録音履歴 — the web arm's read (Build F1). The thin arm calls the facade twin
// (/api/app/v1/recordings/inbox) through thin/ports/actions.vite.ts; both run
// the SAME readRecordingsInbox, so the two worlds cannot disagree about what
// happened to a recording.
//
// SECURITY: the staff id comes from the SIGNED-IN user and nothing else — this
// action takes no arguments, so there is no id for a caller to supply.

import { getSynqedClient } from '@/lib/synqed/client'
import { getCurrentUserStaffId } from '@/lib/staff'
import { requireCapability } from '@/lib/auth/require-permission'
import { readRecordingsInbox } from '@/lib/recordings/inbox-read'
import { getCachedCustomerList } from '@/lib/customers/cached'
import type { InboxServerSession } from '@/lib/recordings/inbox'

export async function listRecordingsInbox(): Promise<InboxServerSession[]> {
  // Same gate as the rest of the recording family: only a recorder has
  // recordings, and every action a row offers (save / retry) is records.write.
  await requireCapability('records.write')
  const [synqed, staffId] = await Promise.all([getSynqedClient(), getCurrentUserStaffId()])
  // No staff identity → no sessions of your own. Empty, not an error: the
  // inbox still shows this device's recoverable takes.
  if (!staffId) return []
  const sessions = await readRecordingsInbox({ synqed, staffId, now: new Date() })

  // Names are filled HERE rather than on the client (⚖ Liam 2026-08-17): the
  // record page's customer array is STORE-scoped for a clamped actor while
  // these rows are STAFF-scoped, so a staffer's own recording of a customer
  // outside their store would otherwise render 不明. The business-wide list is
  // used strictly as a `.get(id)` lookup — only the names these rows reference
  // ship, never the roster, which is what keeps the staff-roster rule (hide,
  // never filter-after-ship) intact.
  //
  // Degrades to today's behaviour: a failed list read leaves customerName
  // absent and the client's own map answers, exactly as before.
  if (!sessions.some((s) => s.customerId)) return sessions
  const list = await getCachedCustomerList().catch(() => [])
  const nameById = new Map(list.map((c) => [c.id, c.name]))
  return sessions.map((s) => {
    const name = s.customerId ? nameById.get(s.customerId) : undefined
    return name ? { ...s, customerName: name } : s
  })
}
