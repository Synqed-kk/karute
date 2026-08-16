'use server'

// The WEB door onto the discard receipt (recording-integrity PR A1).
//
// This file is the 'use server' boundary and nothing else: it exports exactly
// ONE action, which resolves the actor from the cookie session before calling
// in. The shared choke point, its schema and its write live in
// src/lib/recording/discard.ts — deliberately in a directive-free module, so
// a function taking a caller-vouched `actor` can never be reachable as a
// client-invokable server action.

import { newSynqedClient } from '@/lib/synqed/client'
import { resolveWebActorId } from '@/lib/audit-web'
import { requireCapability } from '@/lib/auth/require-permission'
import { getBusinessId } from '@/lib/staff'
import {
  discardRecordingWithClient,
  type DiscardRecordingResult,
} from '@/lib/recording/discard'

/** Web twin of the recordings.discard facade route. Gate = records.write, the
 *  same tier as the save action this discard is the alternative to (a
 *  frontdesk account that cannot record must not be able to file recording
 *  receipts). No finer capability check: the discard ACL matrix is Phase B
 *  (B6). Cross-tenant is impossible via the business-scoped client;
 *  within-tenant misattribution is staff-authenticated audit noise, accepted
 *  for Phase A receipts. */
export async function discardRecordingReceipt(input: unknown): Promise<DiscardRecordingResult> {
  try {
    await requireCapability('records.write')
  } catch {
    return { ok: false, error: 'forbidden' }
  }

  let businessId: string
  let synqed: ReturnType<typeof newSynqedClient>
  try {
    businessId = await getBusinessId()
    synqed = newSynqedClient(businessId)
  } catch {
    return { ok: false, error: 'failed' }
  }

  return discardRecordingWithClient(
    synqed,
    {
      staffId: await resolveWebActorId(),
      businessId,
      source: 'web',
      // PR-M5 piece ④: minted once at the action boundary.
      requestId: crypto.randomUUID(),
    },
    input,
  )
}
