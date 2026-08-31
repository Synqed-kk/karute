// 破棄の記録 facade GET result DTOs — the wire shape of the two manager reads
// (…/recordings/discards and …/discards/transcript). Same role the audit-log
// DTO beside this file plays: the routes serve a twin's return value straight
// out, so without a parse at the door a field RENAME inside the twin passes
// tsc, passes both new suites, and reaches the phone as a missing name or an
// Invalid Date row — the shared body succeeds at drifting precisely because
// both doors call it.
//
// Unlike AuditLogListResultDTO these are plain success shapes, not
// discriminated unions: both discard twins THROW on failure (the A2-4 honesty
// law — an unreadable ledger must never come back as an empty one), so a
// failure never travels in the body. It is a facade error status.
//
// Mirrors DiscardReasonRow / DiscardReasonCounts / GetDiscardTranscriptResult
// (src/actions/recording-discards.ts) field-for-field. Deliberately not
// `.strict()`: an ADDED field is add-only for an old baked phone, exactly as
// the audit DTO treats one.

import { z } from 'zod'

/** Mirrors DiscardReasonRow. `staffName`/`staffId` are nullable by contract —
 *  a departed staffer or the card/profile id-space split leaves the row
 *  readable and the name honestly unknown. */
const DiscardReasonRowSchema = z.object({
  id: z.string(),
  recordingSessionId: z.string(),
  createdAt: z.string(),
  staffId: z.string().nullable(),
  staffName: z.string().nullable(),
  reason: z.string(),
  // The recording behind the row (⚖ 8/31). Nullable for the same reason the
  // staff name is: every one of these joins is best-effort, and a row whose
  // recording fell outside the read window is still a row worth showing.
  // NULLABLE, not optional: the twin always emits the key, so an absent one
  // means a field was RENAMED inside the twin — precisely the drift this parse
  // exists to catch before it reaches a baked phone.
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  recordingCreatedAt: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  storeName: z.string().nullable(),
})

/** Mirrors DiscardReasonCounts. Past the read cap these are FLOORS, not
 *  totals (⚖ 8/25) — `truncated` on the result below is what says so, which is
 *  why it is a required boolean here rather than an optional flag. */
const DiscardReasonCountsSchema = z.object({
  thisMonth: z.number(),
  total: z.number(),
  byStaff: z.array(
    z.object({
      staffId: z.string(),
      staffName: z.string().nullable(),
      thisMonth: z.number(),
    }),
  ),
})

export const DiscardReasonsListDTO = z.object({
  rows: z.array(DiscardReasonRowSchema),
  counts: DiscardReasonCountsSchema,
  truncated: z.boolean(),
})

export const DiscardTranscriptDTO = z.object({
  segments: z.array(
    z.object({
      text: z.string(),
      /** Seconds into the recording — what the panel's 5-minute markers are
       *  placed from. Nullable rather than optional for the rename reason
       *  above: this route parses the SERVER's own object, where the key is
       *  always emitted, so tolerating its ABSENCE here would tolerate exactly
       *  the drift being guarded against. An older SERVER answering a newer
       *  phone is a different boundary and is handled at the thin port, which
       *  normalises a missing value to null. */
      startTime: z.number().nullable(),
    }),
  ),
  /** null when the metadata read failed or the recording is gone — the section
   *  needs it to tell "under the accidental-tap floor" from "no transcript was
   *  kept", so it is nullable, never absent. */
  durationSeconds: z.number().nullable(),
})
