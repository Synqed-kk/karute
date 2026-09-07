// Versioned, runtime-validated DTO for the 録音履歴 inbox facade read (Build
// F1). This is the SERVER half only — the device-local takes are merged on the
// client, so nothing here can carry another device's audio.
//
// RECORDING-PRIVACY: metadata only. No transcript, no summary, no audio path —
// the row says which session, whether a record exists, and what its job is
// doing. `jobLastError` is a core error CODE the client maps to a localized
// string; it is never rendered raw.

import { z } from 'zod'

const InboxSessionSchema = z.object({
  recordingSessionId: z.string(),
  customerId: z.string().nullable(),
  /** Server-resolved display name (⚖ Liam 2026-08-17). These rows are
   *  STAFF-scoped while the record screen's customer array is STORE-scoped, so
   *  a clamped staffer's own recording of an out-of-store customer has an id
   *  that array cannot resolve — the name is filled server-side instead, from
   *  the business-wide list used strictly as a `.get(id)` lookup (only the
   *  names these rows reference ship, never the roster).
   *
   *  `nullish` on purpose, matching InboxServerSession: absent/null = "not
   *  resolved", and the client falls back to its own map exactly as before. A
   *  pre-fill bake receives the field and ignores it (its own fold reads only
   *  the take snapshot), so this is additive in both directions. */
  customerName: z.string().nullish(),
  createdAt: z.string(),
  durationSeconds: z.number().nullable(),
  karuteRecordId: z.string().nullable(),
  // A plain string, NOT an enum, and that is load-bearing: phones run a BAKED
  // bundle, so a narrow enum would start rejecting this whole payload the day
  // core adds a fifth status value — every phone's inbox blank until the next
  // release. The fold narrows it instead, and treats anything it doesn't
  // recognise as "unknown, still in flight" (the same handling a failed probe
  // gets). null = a DEFINITIVE no-job answer.
  jobStatus: z.string().nullable(),
  /** The probe failed with something other than a 404 — "we don't know", which
   *  is a different fact from "there is no job". */
  jobProbeFailed: z.boolean(),
  jobLastError: z.string().nullable(),
  /** The shared reader computes this from ONE batched discard-ledger read
   *  (inbox-read.ts) — zod object schemas STRIP unknown keys on `.parse`, so
   *  without this field the flag never left this facade door, silently
   *  hiding a staff member's discarded take from phones (it renders correctly
   *  everywhere else, since the web server action reads the fold's output
   *  directly, with no DTO in between). `nullish` on purpose, matching
   *  `customerName`'s idiom above: an old baked bundle's payload without this
   *  key stays valid, and the fold already treats absence as "not
   *  discarded". */
  discardedByStaff: z.boolean().nullish(),
  /** What the server holds for this session's audio — 'object' (the whole
   *  finalized take, unprocessed) or 'segments' (part of it, the nightly job
   *  will finish what it can). Build 23 slice ③.
   *
   *  A PLAIN STRING, not an enum, and that is load-bearing for the SAME reason
   *  `jobStatus` above is one: phones run a BAKED bundle, so a narrow enum
   *  would start rejecting this whole payload — every phone's inbox blank —
   *  the day a third value lands. The fold narrows it with `===` and reads
   *  anything it does not recognise as absent, i.e. as today's behaviour.
   *
   *  RECORDING-PRIVACY, restated because this is the field that could break
   *  the header rule above: it says WHETHER, never WHERE. No path and no key
   *  is derivable from it, and the save door reads the path off the ROW. */
  serverAudio: z.string().nullish(),
})

export const RecordingsInboxDTO = z.object({
  sessions: z.array(InboxSessionSchema),
})

export type RecordingsInboxDTOType = z.infer<typeof RecordingsInboxDTO>
