// The signed-upload-URL mint, shared by both doors (web action + facade route).
//
// NO 'use server' directive, deliberately — same rule as discard.ts and
// session-cleanup.ts: `businessId` is the AUTHENTICATED tenant the caller
// vouches for. Exported from a 'use server' module it would become a
// client-invokable action taking any tenant id, which is the exact escape the
// grammar exists to prevent.
//
// WHAT CHANGED (capture pipeline PR2). The mint used to name the take itself
// (`crypto.randomUUID()`, hardcoded `.webm`). It now ACCEPTS a take id and a
// container from the client, because the device already owns the take id
// (take-store) and the recorder already negotiated the container — and a
// `.webm` name on iOS mp4 bytes is the live mislabelling bug. Accepting them
// costs a fence, which is composeTakeKey: validate, compose, then parse our
// own output. With no input the behaviour is byte-identical to before.

import { audit } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
import { composeTakeKey } from '@/lib/recording/key-grammar'

/** WHO asked for this key — resolved by the caller from its own session
 *  (cookie on web, Bearer identity on the facade), never read from a body.
 *  Same shape and same id space as FinalizeTakeActor (finalize-take.ts). */
export interface MintTakeActor {
  /** The AUTHENTICATED staff identity (auth user id on both surfaces). */
  staffId: string | null
  /** The caller's verified tenant — the prefix the composed key carries. */
  businessId: string
  source: 'web' | 'facade'
  requestId?: string
}

export interface MintTakeUrlInput {
  /** The device's own take id. Absent → the server names the take, as before. */
  takeId?: string | null
  /** The recorder's negotiated MIME. Absent → audio/webm, as before. */
  mimeType?: string | null
}

export type MintTakeUrlResult =
  | { path: string; url: string; token: string; contentType: string }
  | { error: 'bad_mime' | 'bad_take_id' | 'upstream' }

/** What the mint composed with no client input — today's exact shape. */
const DEFAULT_MIME = 'audio/webm'

/**
 * The ONE row a CLIENT-NAMED mint files (⚖ 8/17 doc law — ids, numbers and
 * flags only; the key is the tenant prefix plus these two fields).
 *
 * Its own body emits unconditionally, and it is AUDITED_CORES-registered — the
 * private auditLockout pattern (pin-throttle.ts, ai-reengagement.ts), used here
 * for the same reason: the mint below conditions the CALL, so the emit stays
 * provable while a server-named take still files nothing.
 */
function auditTakeNamed(actor: MintTakeActor, takeId: string, ext: string): void {
  audit({
    category: 'recording',
    action: 'recording.take_named',
    actorId: actor.staffId,
    actorType: 'staff',
    businessId: actor.businessId,
    severity: 'info',
    detail: { take_id: takeId, ext },
    requestId: actor.requestId,
    source: actor.source,
  })
}

/**
 * Mint a signed UPLOAD url for ONE finalized-take key.
 *
 * NO `upsert` (supersedes ⚖ v2 item 4, which asked for it). The key IS the
 * take's identity, so a second PUT to a key that already holds bytes must be
 * REFUSED by storage, never accepted: with upsert on a name the DEVICE chose,
 * a same-tenant staffer who names another recorder's take id overwrites that
 * take's finalized audio, and an audit row does not undo an overwrite.
 *
 * The legitimate retry (the PUT landed, the finalize call was lost) still
 * works: 409 is the client's SUCCESS signal — "the object is already there" —
 * and it proceeds to finalize, which verifies size and ownership.
 *
 * Known ceiling: a FIRST upload that landed with the WRONG bytes cannot be
 * replaced under this key. Finalize refuses on the size mismatch and the take
 * surfaces as 要対応 (R10) for a human. That is the price of immutable evidence.
 */
export async function mintTakeUploadUrl(
  actor: MintTakeActor,
  input: MintTakeUrlInput = {},
): Promise<MintTakeUrlResult> {
  const businessId = actor.businessId
  const takeId = input.takeId ?? crypto.randomUUID()
  const mimeType = input.mimeType ?? DEFAULT_MIME
  // Separate refusals so the caller can say WHICH field it rejected — a client
  // that sent a container we do not store must be able to renegotiate.
  if (composeTakeKey(businessId, takeId, DEFAULT_MIME) === null) return { error: 'bad_take_id' }
  const composed = composeTakeKey(businessId, takeId, mimeType)
  if (composed === null) return { error: 'bad_mime' }

  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from('recordings')
    .createSignedUploadUrl(composed.key)

  if (error || !data?.signedUrl) return { error: 'upstream' }

  // A CLIENT-NAMED key is the only mint where the caller can name a take it may
  // not own, so the CLAIM on that take id is the fact worth keeping (storage
  // refuses the overwrite; this row says who reached for the name). A
  // server-named take is a fresh uuid nobody could have claimed before it — no
  // row, as before.
  if (input.takeId) auditTakeNamed(actor, takeId, composed.ext)
  return {
    // The FENCED value, never the upstream echo — `data.path` is Supabase's
    // own report of what it signed, not a second source of truth to trust.
    path: composed.key,
    url: data.signedUrl,
    token: data.token,
    contentType: composed.contentType,
  }
}
