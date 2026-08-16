'use server'

// The WEB door onto the 自動録音 per-store toggle (recording-integrity PR A4).
//
// This file is the 'use server' boundary and nothing else: it exports exactly
// ONE action, which resolves the actor from the cookie session before calling
// in. The shared write site lives in src/lib/settings/recording-autostart.ts,
// deliberately in a directive-free module — see its header.

import { revalidatePath, updateTag } from 'next/cache'
import { getSynqedClient } from '@/lib/synqed/client'
import { resolveWebActorId } from '@/lib/audit-web'
import { getBusinessId } from '@/lib/staff'
import { getMyCapabilities, ensureCapability } from '@/lib/auth/require-permission'
import {
  setRecordingAutostartWithClient,
  type SetRecordingAutostartResult,
} from '@/lib/settings/recording-autostart'

/** Web twin of the orgSettings.recordingAutostart facade route. Gate =
 *  `settings.manage`, the SAME capability upsertOrgSettings enforces (spec
 *  §8.1: "Controlled by settings.manage") — this action exists to add an
 *  audit row and a store-membership check to that write, never to widen who
 *  may perform it. */
export async function setRecordingAutostart(
  storeId: string,
  enabled: boolean,
): Promise<SetRecordingAutostartResult> {
  try {
    ensureCapability(await getMyCapabilities(), 'settings.manage')
  } catch {
    return { ok: false, error: 'forbidden' }
  }

  let businessId: string
  let synqed: Awaited<ReturnType<typeof getSynqedClient>>
  try {
    businessId = await getBusinessId()
    synqed = await getSynqedClient()
  } catch {
    return { ok: false, error: 'failed' }
  }

  const result = await setRecordingAutostartWithClient(
    synqed,
    {
      staffId: await resolveWebActorId(),
      businessId,
      source: 'web',
      // PR-M5 piece ④: minted once at the action boundary.
      requestId: crypto.randomUUID(),
    },
    storeId,
    enabled,
  )

  // The blob writer's own core is client-threaded and cannot invalidate (its
  // doc comment: updateTag is Server-Action-only) — the web wrapper owns it,
  // exactly as writeOrgSettingsBlob does.
  if (result.ok) {
    revalidatePath('/settings')
    updateTag('org-settings')
  }
  return result
}
