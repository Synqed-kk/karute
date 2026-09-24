// "The recorder was shown the at-risk notice" — the ONE server body that turns
// that raise into a FACT on the session (recording hole PR-7, FIX-PLAN §4).
//
// WHY IT EXISTS. When a take later fails, the inbox and the bell can only say
// 「処理エラー」. The phone knew earlier — it showed the staffer a yellow warning
// that the device could not keep the audio, or that the server was not
// receiving it. This leaves that fact where the failure readers can find it:
// one `recording.capture_warned` audit row, the same table and shape as the
// sibling `recording.capture_unlinked` (finalize-take.ts). No migration, no
// storage, no provider, no money, nothing deleted.
//
// ONE row per call, deliberately no dedupe: each raise is its own fact, and
// the bound on how many is the client's own raise count.
//
// NO 'use server', same rule as finalize-take.ts: `actor` is the identity the
// CALLER resolved and vouches for. Two doors share this body — the web action
// (src/actions/recordings.ts#recordCaptureWarning) and the facade route
// (…/recordings/capture-warning) — so FACADE_AUDIT_MAP['recordings.captureWarning']
// is a 'skip' citing this function: one raise, one row.

import type { Recording, SynqedClient } from '@synqed-kk/client'
import { audit } from '@/lib/audit'
import { CaptureWarningSchema } from '@/lib/app-api/record-schemas'
import { assertRecorderOwnsRow, statusOf } from '@/lib/recording/take-binding'
import type { FinalizeTakeActor } from '@/lib/recording/finalize-take'

type Core = Pick<SynqedClient, 'recordings'>

/** Finalize's actor minus the owner's-hand fields: a warning is the RECORDER's
 *  own fact, so there is no colleague's-session branch to reach. */
export type CaptureWarningActor = Pick<FinalizeTakeActor, 'staffId' | 'businessId' | 'source' | 'requestId'>

export interface CaptureWarningInput {
  recordingSessionId: string
  takeId: string
  reason: 'device' | 'server'
  warnedAt: string
}

export type CaptureWarningResult =
  | { ok: true }
  | { error: 'bad_input' | 'forbidden' | 'not_found' | 'failed' }

export async function recordCaptureWarningWithClient(
  synqed: Core,
  actor: CaptureWarningActor,
  rawInput: CaptureWarningInput,
): Promise<CaptureWarningResult> {
  // THE parse, for both doors (the finalize idiom): the web door is a server
  // action, so its argument is caller-supplied JSON however it is typed.
  const parsed = CaptureWarningSchema.safeParse(rawInput)
  if (!parsed.success) return { error: 'bad_input' }
  const input = parsed.data
  if (!actor.staffId) return { error: 'forbidden' }

  try {
    let row: Recording
    try {
      row = await synqed.recordings.get(input.recordingSessionId)
    } catch (err) {
      if (statusOf(err) === 404) return { error: 'not_found' }
      throw err
    }
    // Same tenant AND her own session — the one predicate the take doors use,
    // with the owner's hand held shut: nobody files a warning on a colleague's
    // recording.
    if (assertRecorderOwnsRow(row, { ...actor, holdsOwnerKeys: false, allowedStoreIds: null })) {
      return { error: 'forbidden' }
    }

    // ⚖ 8/17 doc law — ids, codes and the stamp only.
    audit({
      category: 'recording',
      action: 'recording.capture_warned',
      actorId: actor.staffId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'recording',
      targetId: input.recordingSessionId,
      severity: 'notice',
      detail: { reason: input.reason, warned_at: input.warnedAt, take_id: input.takeId },
      requestId: actor.requestId,
      source: actor.source,
    })
    return { ok: true }
  } catch (err) {
    console.warn('[capture-warning] failed:', err)
    return { error: 'failed' }
  }
}
