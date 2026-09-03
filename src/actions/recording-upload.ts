'use server'

// Web recording upload — SERVER-minted signed URLs (hotfix 2026-08-25).
//
// The browser can no longer write to the `recordings` bucket directly: the
// bucket's RLS rejects a user-token insert ("new row violates row-level
// security policy", 403), which killed every web take at its upload leg. These
// three actions give the web arm the shape the thin arm has always had — the
// server (service-role, no RLS) mints a signed UPLOAD url for a flat,
// TENANT-PREFIXED key, the browser PUTs the blob straight at it, and the read
// + delete legs come back through the server, which refuses any path outside
// the caller's own `app_${businessId}_` prefix.
//
// Capability records.write on all three (only recorders stage audio) — the same
// gate the upload-url facade twin and enqueueRecordingJob carry.

import { getMyCapabilities, requireCapability } from '@/lib/auth/require-permission'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { createServiceClient } from '@/lib/supabase/service'
import { isOwnRecordingKey } from '@/lib/recording/key-grammar'
import {
  mintTakeUploadUrl,
  type MintTakeUrlInput,
  type MintTakeUrlResult,
} from '@/lib/recording/mint-take-url'

/**
 * Tenant fence for a CLIENT-SUPPLIED storage key. The service-role client
 * below bypasses RLS, so this check is the only thing standing between a
 * caller and another tenant's audio — the same invariant enqueueRecordingJob
 * and processJob enforce on `audio_path`. Throws on a foreign or
 * non-tenant-scoped key.
 * Minted keys have exactly one shape (see mintRecordingUploadUrl), so the
 * grammar is matched POSITIVELY — kind 'take': own prefix, a lowercase uuid,
 * and one of the closed set of extensions — and anything that is not exactly
 * that shape is refused. The grammar itself lives
 * in @/lib/recording/key-grammar, shared with the three service-role call
 * sites that fence the same client-supplied key.
 */
async function requireOwnPath(path: string): Promise<void> {
  const businessId = await getBusinessId()
  if (!isOwnRecordingKey(path, businessId)) {
    throw new Error('recording not found in this business')
  }
}

/**
 * Mint a signed UPLOAD url for a take. Key shape is byte-identical to the
 * upload-url facade's (src/app/api/app/v1/recordings/upload-url/route.ts):
 * FLAT (so /api/cleanup's non-recursive bucket list still sweeps it) and
 * tenant-prefixed (so the worker can prove ownership before it reads or
 * deletes the object). No idempotency key needed — an unused signed URL mints
 * no durable state, it just expires.
 *
 * `input` is OPTIONAL and absent input is today's behaviour byte-for-byte
 * (server-named uuid, `.webm`, no row touched). Present, it is CALLER-SUPPLIED
 * and therefore fenced: the shared core validates the take id against the key
 * grammar and the container against the closed MIME map, composes, re-parses
 * its own output, and RESERVES the key on the caller's own recording row before
 * it signs anything (see mintTakeUploadUrl).
 *
 * Returns the result UNION rather than throwing (fix round 4), the same shape
 * finalizeTake gives: `exists` and `reserved_elsewhere` are answers the client
 * must branch on — "this take is spoken for, start a new one" — and a throw
 * flattens them all into one unusable failure.
 */
export async function mintRecordingUploadUrl(
  input?: MintTakeUrlInput,
): Promise<MintTakeUrlResult> {
  await requireCapability('records.write')
  // The cookie session is the ONLY source of every one of these: a caller names
  // neither its tenant, nor itself, nor its reach. staffId owns any row the
  // mint reserves, and is what the take_named row is attributed to.
  const [businessId, staffId, capabilities, scope] = await Promise.all([
    getBusinessId(),
    getCurrentUserStaffId(),
    getMyCapabilities(),
    resolveStoreScope(),
  ])

  return await mintTakeUploadUrl(
    newSynqedClient(businessId),
    {
      staffId,
      businessId,
      storeId: scope.storeId,
      canViewAll: capabilities.has('recordings.viewAll'),
      source: 'web',
    },
    input,
  )
}

/**
 * Mint a signed READ url for a take the caller already uploaded — what the web
 * transcribe route's `audioUrl` carries (its SSRF guard requires exactly this
 * host). Refuses any path outside the caller's own tenant prefix.
 */
export async function mintRecordingReadUrl(path: string): Promise<{ url: string }> {
  await requireCapability('records.write')
  await requireOwnPath(path)

  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from('recordings')
    .createSignedUrl(path, 3600)

  if (error || !data?.signedUrl) {
    throw new Error('could not read the recording')
  }
  return { url: data.signedUrl }
}

/**
 * Best-effort delete of a staged take (the in-tab pipeline's cleanup leg, fired
 * right after transcription resolves). Same tenant fence; NEVER throws — a
 * failed cleanup must not surface in the recording UX, the daily /api/cleanup
 * sweep is the backstop.
 */
export async function removeRecordingObject(
  path: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireCapability('records.write')
    await requireOwnPath(path)

    const supabase = createServiceClient()
    const { error } = await supabase.storage.from('recordings').remove([path])
    if (error) return { error: error.message }
    return { ok: true }
  } catch (err) {
    console.warn('[removeRecordingObject] failed:', err)
    return { error: 'failed' }
  }
}
