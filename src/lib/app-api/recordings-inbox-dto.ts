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
  jobStatus: z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']).nullable(),
  jobLastError: z.string().nullable(),
})

export const RecordingsInboxDTO = z.object({
  sessions: z.array(InboxSessionSchema),
})

export type RecordingsInboxDTOType = z.infer<typeof RecordingsInboxDTO>
