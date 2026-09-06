'use server'

// Web recording upload — SERVER-minted signed URLs (hotfix 2026-08-25).
//
// The browser can no longer write to the `recordings` bucket directly: the
// bucket's RLS rejects a user-token insert ("new row violates row-level
// security policy", 403), which killed every web take at its upload leg. These
// two actions give the web arm the shape the thin arm has always had — the
// server (service-role, no RLS) mints a signed UPLOAD url for a flat,
// TENANT-PREFIXED key, the browser PUTs the blob straight at it, and the read
// leg comes back through the server, which refuses any path outside the
// caller's own `app_${businessId}_` prefix.
//
// ⚖ THERE IS NO DELETE LEG (capture pipeline PR4). `removeRecordingObject` — a
// client-invokable server action that erased a recording object by name — is
// GONE, not refused: the in-tab pipeline it existed for now transcribes the
// take's own finalized object, and audio is never deleted.
//
// Capability records.write on both (only recorders stage audio) — the same
// gate the upload-url facade twin and enqueueRecordingJob carry.

import { can, getMyCapabilities, requireCapability } from '@/lib/auth/require-permission'
import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { getBusinessId, getCurrentAccessToken, getCurrentUserStaffId } from '@/lib/staff'
import { newSynqedClient } from '@/lib/synqed/client'
import { createServiceClient } from '@/lib/supabase/service'
import { composeTakeKey, isOwnRecordingKey } from '@/lib/recording/key-grammar'
import {
  mintSegmentUploadUrls,
  mintTakeUploadUrl,
  type MintSegmentUrlsResult,
  type MintTakeUrlInput,
  type MintTakeUrlResult,
} from '@/lib/recording/mint-take-url'

/**
 * Tenant fence for a CLIENT-SUPPLIED storage key. The service-role client
 * below bypasses RLS, so this check is the only thing standing between a
 * caller and another tenant's audio — the same invariant enqueueRecordingJob
 * and processJob enforce on `audio_path`. Throws on a foreign or
 * non-tenant-scoped key.
 *
 * TENANT-ONLY, not row-scoped (fix round 6, I4): this proves the key is one
 * of THIS BUSINESS's takes, never that it is the CALLING STAFFER's own — any
 * staffer at the tenant can read any colleague's take through the one leg
 * below. The remove leg it also guarded is gone (PR4, as promised); the read
 * leg narrows to the reserving row's own recorder in the player round.
 *
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
 * tenant-prefixed (so the worker can prove ownership before it reads the
 * object — reads it and nothing else, since PR4). No idempotency key needed —
 * an unused signed URL mints no durable state, it just expires.
 *
 * `input` is OPTIONAL and absent input is today's behaviour byte-for-byte
 * (server-named uuid, `.webm`, no row touched). Present, it is CALLER-SUPPLIED
 * and therefore fenced: the shared core validates the take id against the key
 * grammar and the container against the closed MIME map, composes, re-parses
 * its own output, and RESERVES the key on the caller's own recording row before
 * it signs anything (see mintTakeUploadUrl).
 *
 * NO STORE any more (fix round 7): the mint never creates a row, so it has none
 * to place — startRecordingSession is the one door that mints, and it is where
 * a take's store comes from. Same deletion finalizeTake took in fix round 4.
 *
 * Returns the result UNION rather than throwing (fix round 4), the same shape
 * finalizeTake gives: `exists` and `reserved_elsewhere` are answers the client
 * must branch on — "this take is spoken for, start a new one" — and a throw
 * flattens them all into one unusable failure. The capability gate follows the
 * same rule (fix round 9): asked with can(), not requireCapability(), so a
 * denial settles as `{ error: 'forbidden' }` instead of throwing — aligned
 * with finalizeTake (src/actions/recordings.ts), which made the same call for
 * the same reason: a thrown denial the client reads as retryable would loop
 * forever against a permission it will never gain.
 *
 * NEVER THROWS (capture pipeline PR4, packet rider — parity with finalizeTake).
 * The three identity lookups below are network reads, and a rejected server
 * action reaches the recorder as an unnamed failure: secureTake's own catch
 * marks the take `failed`, which the 要対応 surface reads as TERMINAL, so one
 * flaky roster read at stop could strand a take whose retry would have worked.
 * Every failure is a settled `{ error: 'upstream' }` — this union's one
 * retryable code, the same one the port's deadline answers with.
 */
export async function mintRecordingUploadUrl(
  input?: MintTakeUrlInput,
): Promise<MintTakeUrlResult> {
  try {
    // Asked INSIDE the try but answered on its own (see the docstring): a
    // denied capability is TERMINAL, and folding it into the catch below would
    // hand the client the retryable 'upstream' for a permission it will never
    // gain. A THROW from the gate itself is still infrastructure, and still
    // maps to 'upstream'.
    if (!(await can('records.write'))) return { error: 'forbidden' }
    // The cookie session is the ONLY source of every one of these: a caller
    // names neither its tenant, nor itself, nor its reach. staffId owns any row
    // the mint reserves, and is what the take_named row is attributed to.
    const [businessId, staffId, capabilities] = await Promise.all([
      getBusinessId(),
      getCurrentUserStaffId(),
      getMyCapabilities(),
    ])

    return await mintTakeUploadUrl(
      newSynqedClient(businessId, await getCurrentAccessToken()),
      {
        staffId,
        businessId,
        holdsOwnerKeys: holdsOwnerKeys(capabilities),
        source: 'web',
      },
      input,
    )
  } catch (err) {
    console.warn('[mintRecordingUploadUrl] failed:', err)
    return { error: 'upstream' }
  }
}

/**
 * Mint signed upload URLs for a BATCH of one take's SEGMENTS (slice five packet
 * C, D6) — the bytes that reach the server WHILE the recording is running.
 *
 * BYTE-FOR-BYTE THE SHAPE OF `mintRecordingUploadUrl` above, and deliberately
 * so: same capability asked with `can()` so a denial SETTLES rather than throws,
 * same three cookie-derived identities (a caller names neither its tenant, nor
 * itself, nor its reach), same shared body, same never-throws contract with
 * every failure folded into the one retryable `upstream`. The two acts differ
 * only in which shared body they call — everything that makes calling one safe
 * makes calling the other safe.
 *
 * A SEPARATE EXPORT rather than a branch inside the mint above, because the two
 * answer DIFFERENT result unions: a caller that asked for segments and got a
 * take's single signed url (or the reverse) would be one `as` away from PUTting
 * a whole take at a segment key. The facade route branches on `seqs` before
 * either body runs, for the same reason.
 */
export async function mintRecordingSegmentUrls(
  input: MintTakeUrlInput,
): Promise<MintSegmentUrlsResult> {
  try {
    // Asked INSIDE the try but answered on its own, exactly as the mint above
    // does it: a denied capability is TERMINAL, and folding it into the catch
    // would hand the pump the retryable 'upstream' for a permission it will
    // never gain. A THROW from the gate itself is still infrastructure.
    if (!(await can('records.write'))) return { error: 'forbidden' }
    const [businessId, staffId, capabilities] = await Promise.all([
      getBusinessId(),
      getCurrentUserStaffId(),
      getMyCapabilities(),
    ])

    return await mintSegmentUploadUrls(
      newSynqedClient(businessId, await getCurrentAccessToken()),
      {
        staffId,
        businessId,
        holdsOwnerKeys: holdsOwnerKeys(capabilities),
        source: 'web',
      },
      input,
    )
  } catch (err) {
    console.warn('[mintRecordingSegmentUrls] failed:', err)
    return { error: 'upstream' }
  }
}

/**
 * The finalized KEY for one of this caller's own takes — composed, not looked
 * up (capture pipeline PR4 fix round 7).
 *
 * WHY A DOOR FOR A PURE COMPOSITION. The client must never assemble a tenant
 * key itself — that is the rule markTakeFinalized was written to (the value it
 * stores is the MINT's own answer, carried back) — and the tenant prefix is the
 * one ingredient the device does not have. So the composition stays here, where
 * the businessId comes off the cookie session and never off the caller, and the
 * take id + container are the same pair the mint composed from in the first
 * place. No DB read: the mint RESERVED exactly this key on the row, so
 * recomposing it is reading back a fact, not guessing one.
 *
 * WHO ASKS. A take finalized by slice three (which stamped `finalizedAt` alone)
 * and read by slice four (which gates on `finalizedPath`) reads as UNSECURED:
 * the in-tab leg stages a row-less duplicate of audio the server already holds,
 * and the discard sweep dead-ends. ensureFinalizedPath (take-store) asks this
 * once for such a take and backfills the answer.
 *
 * NEVER THROWS, same contract as the mint above: null is the settled "cannot
 * say" — a denied capability, a bad pair, an identity read that failed — and
 * every caller already has un-finalized behaviour to fall back on.
 */
export async function recordingFinalizedKey(input: {
  takeId: string
  mimeType: string
}): Promise<string | null> {
  try {
    if (!(await can('records.write'))) return null
    const businessId = await getBusinessId()
    // composeTakeKey validates both halves and re-parses its own output, so the
    // key this hands back is one isOwnRecordingKey would accept for this same
    // business — the property every downstream fence relies on.
    return composeTakeKey(businessId, input.takeId, input.mimeType)?.key ?? null
  } catch (err) {
    console.warn('[recordingFinalizedKey] failed:', err)
    return null
  }
}

/**
 * Mint a signed READ url for a take in the caller's own business — what the
 * web transcribe route's `audioUrl` carries (its SSRF guard requires exactly
 * this host). Refuses any path outside the caller's own tenant prefix
 * (requireOwnPath is tenant-scoped only — see its docstring).
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
