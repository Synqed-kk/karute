// Disclosed recording discard — the RECEIPT (recording-integrity spec §3.6,
// §10, PR A1: server side only).
//
// A staff member throwing a take away is the one recording event that leaves
// no trace anywhere else: the take is deleted client-side and nothing reaches
// the karute. The receipt written here IS the deliverable — which is why this
// path uses auditDurable() (awaited, durable) instead of the fire-and-forget
// audit() every other writer uses: a 2xx may only be returned once the row
// has actually landed in core.
//
// ONE choke point, two doors (the appointments/mutations.ts *Core pattern):
// the web server action (src/actions/recording-discard.ts) and the facade
// route (src/app/api/app/v1/recordings/discard/route.ts) both call
// discardRecordingWithClient — `actor` is the only thing that differs, always
// resolved by the caller. FACADE_AUDIT_MAP['recordings.discard'] is therefore
// a deliberate 'skip': one discard, exactly one row.
//
// This module carries NO 'use server' directive, deliberately: `actor` is the
// authenticated identity the caller vouches for, so this function must never
// be reachable as a client-invokable server action where a caller could
// supply its own. The 'use server' boundary lives in src/actions/
// recording-discard.ts, which exports ONLY the cookie-resolved wrapper.
//
// NOT in this PR (spec §14.1): client wiring / offline queue / thin port (A3),
// the reason dialog (A2), abandoned-take call sites (A3b — the schema already
// accepts `abandoned` so A3b touches no server code), free text (there is
// deliberately no such field), seal machinery, and every Phase B row. Phase A
// behaviour is unchanged otherwise: the take is still deleted client-side and
// the server cohort still saves normally.

import { z } from 'zod'
import { auditDurable } from '@/lib/audit'
// Phase A discard vocabulary (spec §3.2). `abandoned` is the SYSTEM-only code
// — the dialog never offers it (A2's concern); it arrives from the three
// system paths A3b wires (recovery dismissal, TTL sweep, logout). The list
// lives in a client-safe module so the A2 dialog and this schema cannot drift.
import { DISCARD_CATEGORIES } from './discard-reasons'
import type { newSynqedClient } from '@/lib/synqed/client'

// Same F8 hygiene as the sibling recording schemas (record-schemas.ts): every
// field capped from birth, `.strict()` so an unknown key is REFUSED rather
// than silently stripped. That strictness is load-bearing twice over — it is
// what makes a spoofed `system_emitted` (server-derived, below) and any
// free-text field a 400 instead of something that rides through to core.
const MAX_ID_CHARS = 200

/** The accidental-tap floor (spec §3.5, ▶ spec-call: 10 seconds): below this,
 *  no transcription runs and the receipt records the take as sub-floor. The
 *  client reports only the DURATION — the flag is derived here, so a receipt
 *  can never carry a floor claim that disagrees with its own duration. */
const BELOW_FLOOR_SEC = 10

const DiscardRecordingSchema = z
  .object({
    recordingSessionId: z.string().max(MAX_ID_CHARS).nullish(),
    takeId: z.string().max(MAX_ID_CHARS).nullish(),
    category: z.enum(DISCARD_CATEGORIES),
    durationSeconds: z.number().finite().min(0),
    customerId: z.string().max(MAX_ID_CHARS).nullish(),
    appointmentId: z.string().max(MAX_ID_CHARS).nullish(),
    pipeline: z.enum(['in_tab', 'server']),
    // The real pipeline states — mirrors the SDK's own RecordingJobStatus
    // union, so an unrecognised state is a 400 rather than a free string
    // landing in the row.
    jobState: z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']).nullish(),
  })
  .strict()
  // A receipt with no subject is not a receipt. takeId covers the pre-mint
  // case (a take discarded before its recording_sessions row exists).
  .refine((v) => Boolean(v.recordingSessionId ?? v.takeId), {
    message: 'recordingSessionId or takeId is required',
  })

export interface DiscardRecordingActor {
  /** The AUTHENTICATED staff identity — resolved by the caller, NEVER taken
   *  from a request body (see this file's no-'use server' note above). Same
   *  id space the karute.save choke point stamps (auth user id on both
   *  surfaces). */
  staffId: string | null
  businessId: string | null
  storeId?: string
  source: 'web' | 'facade'
  /** Minted at the web action boundary / read off ctx.meta on the facade
   *  twin (PR-M5 piece ④). Doubles as the fallback receipt id. */
  requestId?: string
}

export type DiscardRecordingResult =
  | { ok: true; receiptId: string | null; duplicate: boolean }
  | { ok: false; error: 'validation' | 'forbidden' | 'failed' | 'receipt_write_failed' }

/** Client-threaded core: validate → idempotency probe → awaited receipt.
 *
 *  IDEMPOTENCY, honestly bounded (spec §3.6): the audit log has no unique
 *  constraint, so this is check-then-write. It covers the cases that actually
 *  happen — a retried request, and a second device discarding the same take
 *  after the first settled. Two GENUINELY concurrent discards (two devices,
 *  same second) can both pass the probe and write two rows. Exact-once lands
 *  with Phase B's core discard row (unique on recording_session_id); T17's
 *  full concurrent assertion belongs there. A duplicate is silent SUCCESS,
 *  never an error — the second caller's take is just as gone as the first's.
 */
export async function discardRecordingWithClient(
  synqed: ReturnType<typeof newSynqedClient>,
  actor: DiscardRecordingActor,
  input: unknown,
): Promise<DiscardRecordingResult> {
  // The receipt's whole value is its attribution, so an unattributable one is
  // refused before anything is read or written. Both callers resolve the actor
  // from an authenticated session, which makes this unreachable today — that
  // is the point: "the actor is always known" now holds by construction, not
  // by which call path happened to arrive.
  if (!actor.staffId || !actor.businessId) return { ok: false, error: 'forbidden' }

  const parsed = DiscardRecordingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'validation' }
  const data = parsed.data

  // Pre-mint takes key on takeId; everything else on the session id.
  const targetId = (data.recordingSessionId ?? data.takeId) as string

  // Probe EVERY key this take is known by, not just the one the row will be
  // stamped with: a take discarded before its session was minted filed its
  // receipt under take_id, so a post-mint retry arriving with both ids must
  // still find it. Session id first — the id a settled take is keyed by.
  const prior = await findPriorReceipt(
    synqed,
    [data.recordingSessionId, data.takeId].filter((k): k is string => Boolean(k)),
  )
  if (prior.found) return { ok: true, receiptId: prior.receiptId, duplicate: true }

  return writeDiscardReceipt(actor, data, targetId)
}

/** Has this take already been discarded under ANY of its keys? Core exposes no
 *  `action` filter, so the query narrows by target and the action match happens
 *  here (the audit-log.ts precedent) — which is exactly why the match must be
 *  `=== 'recording.discard'`: the same target legitimately carries other
 *  recording rows, and treating one of those as a prior receipt would drop a
 *  real discard on the floor.
 *
 *  MUST stay a call THROUGH `synqed.audit` — a bare method extraction loses the
 *  receiver and AuditClient.list reads `this.client`, which silently killed
 *  every probe in prod once already.
 *
 *  A failed probe degrades to "not found" rather than blocking the receipt:
 *  losing the receipt entirely is strictly worse than a possible duplicate
 *  row, and if core is genuinely down the awaited write below fails anyway
 *  and the caller gets a non-2xx.
 *
 *  ponytail: one page of 50 per key. Rows targeting a single recording id are
 *  rare (recording.discard is the only action that stamps one today) — page if
 *  a future action ever makes a take's row count approach the page size. */
async function findPriorReceipt(
  synqed: ReturnType<typeof newSynqedClient>,
  targetIds: string[],
): Promise<{ found: boolean; receiptId: string | null }> {
  for (const targetId of targetIds) {
    try {
      const res = await synqed.audit.list({
        category: 'recording',
        target_type: 'recording',
        target_id: targetId,
        page: 1,
        page_size: 50,
      })
      const rows = (res?.events ?? []) as { id?: unknown; action?: unknown; detail?: unknown }[]
      const hit = rows.find((r) => r.action === 'recording.discard')
      if (!hit) continue
      const detailRequestId = (hit.detail as { request_id?: unknown } | null)?.request_id
      return {
        found: true,
        receiptId:
          typeof hit.id === 'string'
            ? hit.id
            : typeof detailRequestId === 'string'
              ? detailRequestId
              : null,
      }
    } catch (err) {
      console.warn(JSON.stringify({ evt: 'discard_idempotency_probe_failed', err: String(err) }))
    }
  }
  return { found: false, receiptId: null }
}

/** The ONE write. Kept its own function so every success return is lexically
 *  dominated by the emit (the emitSave idiom, src/actions/karute.ts) — the
 *  proof suite's emission walker reads this shape directly. */
async function writeDiscardReceipt(
  actor: DiscardRecordingActor,
  data: z.infer<typeof DiscardRecordingSchema>,
  targetId: string,
): Promise<DiscardRecordingResult> {
  const receipt = await auditDurable({
    category: 'recording',
    action: 'recording.discard',
    // Authenticated actor, always — a discard is attributable by definition.
    // 'staff' even for `abandoned`: the actor is the take's owner (spec §3.7),
    // the system only noticed the take was gone.
    actorId: actor.staffId,
    actorType: 'staff',
    businessId: actor.businessId,
    storeId: actor.storeId,
    targetType: 'recording',
    targetId,
    // Consequential, staff-attributable, disputable — the same tier as
    // permissions/PIN/store/booking-cancel writes, not an ordinary 'info'.
    severity: 'notice',
    requestId: actor.requestId,
    source: actor.source,
    // spec §10.3 exactly. Ids, flags and counts only — never a word of what
    // was said or why in prose (there is no free-text field in Phase A, fix
    // B7).
    //
    // Four fields are computed here rather than accepted from the request:
    // `route` (a Phase A constant — category 6 does not exist yet),
    // `has_free_text` (no such field exists to set it), `staff_id` (the
    // authenticated actor, never a body value), and `below_floor` (derived
    // from the reported duration, so the flag cannot contradict it).
    //
    // `system_emitted` is honestly weaker and says so: it means THE CALLER'S
    // SYSTEM PATH FIRED THIS (§3.7 recovery dismissal / TTL sweep / logout),
    // attributed to the authenticated owner of the take. The server derives
    // the flag from the category and verifies the ATTRIBUTION — it cannot
    // verify the ABSENCE OF A HUMAN, because the §3.7 paths are client code
    // and `category` arrives in the body. Phase A carries no server-verifiable
    // signal that would let it; do not read this flag as proof no one chose.
    detail: {
      recording_session_id: data.recordingSessionId ?? null,
      take_id: data.takeId ?? null,
      staff_id: actor.staffId,
      customer_id: data.customerId ?? null,
      appointment_id: data.appointmentId ?? null,
      category: data.category,
      duration_sec: Math.round(data.durationSeconds),
      // Derived from the RAW duration, not the rounded one above: a 9.7s take
      // genuinely ran no transcription, and recording below_floor:false for it
      // would misstate what happened. The two disagree only in [9.5, 10) — a
      // display-rounding artifact on duration_sec, never a wrong flag.
      below_floor: data.durationSeconds < BELOW_FLOOR_SEC,
      route: 'operational',
      pipeline: data.pipeline,
      job_state: data.jobState ?? null,
      has_free_text: false,
      system_emitted: data.category === 'abandoned',
    },
  })

  // The §3.6 ordering guarantee, server half: a dropped write is a FAILURE,
  // never a success with a missing row. (The client half — keep the take
  // until the receipt is confirmed — is A3.)
  if (!receipt.ok) return { ok: false, error: 'receipt_write_failed' }

  // Core's row id when it hands one back, else the boundary-minted request id
  // that rode into detail.request_id — either way the row is findable.
  return { ok: true, receiptId: receipt.rowId ?? actor.requestId ?? null, duplicate: false }
}
