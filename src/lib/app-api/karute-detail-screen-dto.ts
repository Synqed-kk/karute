// Versioned, runtime-validated DTO for the session-detail (/karute/[id]) screen
// facade read (packet 07 §Build 2, inventory #5 — the highest customer-data
// class: recording-privacy + AI-on-PII). This IS the KaruteDetailView data-prop
// surface, serialized, assembled by the SAME buildKaruteDetailScreen the web page
// renders from — so web and thin can never derive a different view-model.
//
// The transcript ACL is applied SERVER-side: a restricted viewer's DTO carries
// transcript:null + transcriptRestricted:true; the raw text never leaves the
// server. The two Suspense-streamed AI cards are NOT here (Decision 1: two
// resource-scoped GETs fetched on mount). The photos slot IS folded in — it is a
// plain HTTP read, not an LLM call (the paint-timing deviation from web's Suspense
// stream is recorded, not a defect).

import { z } from 'zod'

// author/version/original_ai_content are .optional() (edit-layer Wave 2,
// PR-A) so a cached facade payload minted before this field existed still
// parses — an absent author renders no provenance chip, same as 'AI'.
export const SessionEntrySchema = z.object({
  id: z.string(),
  category: z.enum([
    'treatment',
    'concern',
    'condition',
    'preference',
    'lifestyle',
    'product',
    'next',
    'note',
  ]),
  time: z.string(),
  body: z.string(),
  author: z.enum(['AI', 'HUMAN_EDITED', 'HUMAN_CREATED']).optional(),
  version: z.number().optional(),
  original_ai_content: z.string().nullable().optional(),
})

const HeaderSchema = z.object({
  customerName: z.string(),
  initials: z.string(),
  karuteNumber: z.string(),
  service: z.string().nullable(),
  sessionDateLong: z.string(),
  staffName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  age: z.number().nullable(),
  gender: z.string().nullable(),
  visitNumber: z.number().nullable(),
  lastVisitDate: z.string().nullable(),
})

// KaruteOutcomeRow (src/lib/karute/outcome.ts) — raw shape; the thin view maps it
// to the OutcomeCard's props exactly as the web page does.
const OutcomeSchema = z
  .object({
    outcome: z.enum(['success', 'no_deal', 'pending']),
    reason: z
      .enum(['budget', 'considering', 'mismatch', 'follow_up', 'other'])
      .nullable(),
    is_first_visit: z.boolean(),
    decided_at: z.string().nullable(),
    auto_decided: z.boolean(),
  })
  .nullable()

// CustomerPhoto (PhotoRecordsCard) — folded in (Decision: plain HTTP read).
const PhotoSchema = z.object({
  id: z.string(),
  signedUrl: z.string().nullable(),
  category: z.string(),
  caption: z.string().nullable(),
})

export const KaruteDetailScreenDTO = z.object({
  karuteId: z.string(),
  customerId: z.string().nullable(),
  outcome: OutcomeSchema,
  header: HeaderSchema,
  sessionDateLong: z.string(),
  sessionDateIso: z.string().nullable(),
  entries: z.array(SessionEntrySchema),
  summaryBullets: z.array(z.string()),
  /** Raw effective summary (edited ?? ai) — seeds the 詳細記録 pencil's edit
   *  sheet. Same recording-privacy note as transcript does NOT apply: the
   *  summary is the shared record, never ACL-withheld. */
  summaryRaw: z.string().nullable(),
  summaryEdited: z.boolean(),
  /** The transcript AS THE VIEWER MAY SEE IT — server-withheld to null by the
   *  recording-privacy ACL; the DTO never carries restricted text. */
  transcript: z.string().nullable(),
  consentOnFile: z.boolean(),
  transcriptDurationLabel: z.string().nullable(),
  transcriptRestricted: z.boolean(),
  photos: z.array(PhotoSchema),
  /** The caller's display role — drives the staff-private coaching panel's
   *  owner-hides-it gate (the thin screen wraps the view in a SessionProvider so
   *  KaruteCoachingPanel's useSession() resolves; see the screen-provider trace). */
  viewerRole: z.string(),
})

export type KaruteDetailScreenDTOType = z.infer<typeof KaruteDetailScreenDTO>
