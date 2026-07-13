// Versioned, runtime-validated DTO for the Ask-AI screen facade read (packet 04,
// screen inventory #1). Mirrors the /ask-ai page's server assembly: the three
// count-only synqed reads + the transcript-bearing subset of the fetched karute
// page, plus the org business type and the caller's display name.
//
// The business PROFILE + prompt templates are deliberately NOT serialized here:
// they are pure lookups over the shared constants module
// (src/lib/welcome/business-types.ts), which the thin bundle imports as-is —
// shipping them in the DTO would duplicate that content behind a second source
// of truth. The DTO carries the businessType KEY; the screen derives the rest
// with the exact same code the web page uses.

import { z } from 'zod'

export const AskAiScreenDTO = z.object({
  scope: z.object({
    /** Total karute records for this business. */
    karute: z.number(),
    /** Total customers. */
    customers: z.number(),
    /** Upcoming appointments (from now). */
    bookings: z.number(),
    /** Karute WITH a transcript, counted from the fetched page (≤200) — same
     *  ceiling as the web page; an exact count is a core-side ask (Anthony). */
    recordings: z.number(),
  }),
  /** Org settings business_type key ('' / absent → null → generic profile). */
  businessType: z.string().nullable(),
  /** Caller's display name (email local-part, page parity). */
  userName: z.string(),
})

export type AskAiScreenDTOType = z.infer<typeof AskAiScreenDTO>
