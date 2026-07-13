// ─────────────────────────────────────────────────────────────────────────
// Coaching prompt library — shared spine
// ─────────────────────────────────────────────────────────────────────────
// The coaching page's AI is a set of PROMPT MODULES, one per section, that all
// build on the same three things: a persona-pinned system base (so a gym never
// gets salon vocabulary), a small set of model/cadence/layer constants, and one
// module shape. Anthony wires each module behind the data contract (contract.ts);
// the frontend renders the result.
//
// A note that governs every module here: consistency comes from the prompt's own
// rubric + the structured-output schema, NOT from sampling params. These modules
// don't set temperature/top_p — set model defaults at the call site. (This is a
// deliberate correction of the old spike convention of "temp 0.2 for
// consistency": behaviourally-anchored rules make "same input → same output"
// achievable in a way a temperature dial never did.)

import { personaSystemFragment } from '@/lib/karute/business-ai-tokens'

/** Model tiers for coaching generation. The reasoning surfaces (findings,
 *  scoring, module generation) run on Sonnet 5; the single live in-session nudge
 *  runs on Haiku for latency + cost. IDs are the ones the environment lists as
 *  current (Claude 5 family + Haiku 4.5) — do not downgrade a reasoning surface
 *  to Haiku to save money; the judgment tasks here need the larger model. */
export const COACHING_MODELS = {
  reason: 'claude-sonnet-5',
  realtime: 'claude-haiku-4-5-20251001',
} as const

/** Which privacy layer a module's output belongs to (COACHING_VISIBILITY_MODEL).
 *  L1 = staff-private forever. L2 = banded/aggregate, owner/manager-visible.
 *  'L1+L2' = one pass emitting two separately-guarded outputs (the dual write). */
export type CoachingLayer = 'L1' | 'L2' | 'L1+L2'

/** How often a module runs. 'on-session' fires once per completed session;
 *  'realtime' runs live during the session; the rest are scheduled aggregates. */
export type CoachingCadence =
  | 'on-session'
  | 'weekly-batch'
  | 'monthly-batch'
  | 'on-demand'
  | 'realtime'

export interface CoachingPromptConfig {
  model: string
  layer: CoachingLayer
  cadence: CoachingCadence
  /** Output ceiling, sized per module so a rich, high-signal result never gets
   *  truncated mid-JSON (truncation silently drops exactly the richest sessions
   *  — never let the cap fail against the wrong inputs). */
  maxTokens: number
}

/** The shape every coaching prompt module in this directory exports. `Input` is
 *  the section's typed user-message input. The builders return finished strings
 *  (tokens already resolved) — nothing is left as a {{placeholder}} for the
 *  caller to fill. */
export interface CoachingPromptModule<Input> {
  /** Stable id, e.g. 'category-scoring'. Also the prompt_version namespace:
   *  Anthony stamps prompt_version = sha256(buildSystem(...) + buildUser(...))
   *  so an edit to EITHER template bumps the version and two incomparably-scored
   *  eras never blend into one trend line (COACHING_V2_DESIGN C11). */
  id: string
  config: CoachingPromptConfig
  /** Build the system prompt for a business type + locale. Always begins with
   *  the persona fragment via coachingSystemBase(). */
  buildSystem: (businessType: string | null | undefined, locale: string) => string
  /** Build the user message from the section's typed input. */
  buildUser: (input: Input) => string
  /** JSON schema the app parses the model's output against (structured output).
   *  Aligns to the shapes in contract.ts. */
  outputSchema: Record<string, unknown>
}

/** Prepend the persona fragment to a section's own rules. Every buildSystem uses
 *  this, so the business-type pinning is byte-identical across the library — and
 *  identical across staff at the same business + across weeks, which is what
 *  makes a prompt-cache breakpoint at the end of the system prompt a real cost
 *  lever for the weekly/monthly batch fan-outs. */
export function coachingSystemBase(
  businessType: string | null | undefined,
  locale: string,
  sectionRules: string,
): string {
  return `${personaSystemFragment(businessType, locale)}\n\n${sectionRules.trim()}`
}
