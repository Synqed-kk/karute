// Playback-url facade GET result DTO — the wire shape of the play button's one
// server call. Same role the discard DTOs beside this file play: the route
// serves the shared twin's return value straight out, so without a parse at the
// door a field RENAME inside the twin passes tsc, passes both suites, and
// reaches a baked phone as a player that never starts.
//
// A plain success shape, not a discriminated union: every refusal leaves this
// route as an ERROR STATUS (404/403/502), never a 2xx carrying a failure — the
// same honesty rule the discard reads obey.

import { z } from 'zod'

export const PlaybackUrlDTO = z.object({
  /** Signed READ url, service-minted over the take's own key. */
  url: z.string(),
  /** ISO. The player re-mints ONCE on an element error past this point and
   *  resumes at the same position — an honest second listen, one more row. */
  expiresAt: z.string(),
  /** The row's own length. Nullable, never absent: a take finalized before the
   *  duration landed is a real state, and the player falls back to the audio
   *  element's own metadata for the total. */
  durationSeconds: z.number().nullable(),
})

export type PlaybackUrlDTOType = z.infer<typeof PlaybackUrlDTO>
