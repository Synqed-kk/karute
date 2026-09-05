'use server'

// The WEB door onto the discard receipt (recording-integrity PR A1).
//
// This file is the 'use server' boundary and nothing else: every export is a
// cookie-resolved wrapper that resolves the actor from the session before
// calling in. The shared choke points, their schemas and their writes live in
// src/lib/recording/discard.ts — deliberately in a directive-free module, so
// a function taking a caller-vouched `actor` can never be reachable as a
// client-invokable server action.

import { newSynqedClient } from '@/lib/synqed/client'
import { resolveWebActorId } from '@/lib/audit-web'
import { requireCapability } from '@/lib/auth/require-permission'
import { getBusinessId, getCurrentAccessToken } from '@/lib/staff'
import {
  discardRecordingWithClient,
  discardRecordingWithReasonRow,
  type DiscardRecordingActor,
  type DiscardRecordingResult,
} from '@/lib/recording/discard'

/** Web twin of the recordings.discard facade route. Gate = records.write, the
 *  same tier as the save action this discard is the alternative to (a
 *  frontdesk account that cannot record must not be able to file recording
 *  receipts). No finer capability check: the discard ACL matrix is Phase B
 *  (B6). Cross-tenant is impossible via the business-scoped client;
 *  within-tenant misattribution is staff-authenticated audit noise, accepted
 *  for Phase A receipts.
 *
 *  That accepted class now includes ONE DISPLAYED value, not only audit rows
 *  (names-fix 2026-08-31): the same call writes recordings.duration_seconds on
 *  the named session, and the 破棄の記録 panel reads it to say whether a take
 *  ran under the transcription floor. Core fences the write to the business,
 *  never to the session's owner, so a within-tenant caller can in principle
 *  stamp a colleague's session — a derived integer, from the duration that
 *  caller reported, on a session they are authenticated to discard anyway.
 *  Same acceptance, one surface wider, and the real fix is core-side ownership
 *  fencing on recordings.update (queued for Anthony), never an app-side
 *  build-around. */
export async function discardRecordingReceipt(input: unknown): Promise<DiscardRecordingResult> {
  const door = await openDiscardDoor()
  if (!door.ok) return door.result
  return discardRecordingWithClient(door.synqed, door.actor, input)
}

/** The STAFF door (P5-A, ⚖ 8/17): the same gate, but the input carries the
 *  REQUIRED WRITTEN reason. One action rather than two round trips, because
 *  the reason row and the receipt that points at it must not be separable by a
 *  dropped network call — and because the reason text may only ever travel to
 *  the discard row, never through the receipt schema. */
export async function discardRecordingWithReason(input: unknown): Promise<DiscardRecordingResult> {
  const door = await openDiscardDoor()
  if (!door.ok) return door.result
  return discardRecordingWithReasonRow(door.synqed, door.actor, input)
}

/** Capability gate + business-scoped client + resolved actor — identical for
 *  both doors, so it lives in one place. NOT exported: a 'use server' module's
 *  exports are all client-invokable. */
async function openDiscardDoor(): Promise<
  | { ok: true; synqed: ReturnType<typeof newSynqedClient>; actor: DiscardRecordingActor }
  | { ok: false; result: DiscardRecordingResult }
> {
  try {
    await requireCapability('records.write')
  } catch {
    return { ok: false, result: { ok: false, error: 'forbidden' } }
  }

  try {
    const businessId = await getBusinessId()
    return {
      ok: true,
      synqed: newSynqedClient(businessId, await getCurrentAccessToken()),
      actor: {
        staffId: await resolveWebActorId(),
        businessId,
        source: 'web',
        // PR-M5 piece ④: minted once at the action boundary.
        requestId: crypto.randomUUID(),
      },
    }
  } catch {
    return { ok: false, result: { ok: false, error: 'failed' } }
  }
}
