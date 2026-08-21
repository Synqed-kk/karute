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
})

export const RecordingsInboxDTO = z.object({
  sessions: z.array(InboxSessionSchema),
})

export type RecordingsInboxDTOType = z.infer<typeof RecordingsInboxDTO>
