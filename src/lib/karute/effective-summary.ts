/**
 * The summary every reader must display: the staff's overlay
 * (`edited_summary`, "the pencil") when one exists, else the AI's own
 * `ai_summary`. Regen only ever rewrites `ai_summary` and never touches the
 * overlay — this is the ONE place that resolves which wins
 * (EDIT-LAYER-DESIGN.md §4). Every summary reader (brief, outreach,
 * prediction, AI相談 context, display/DTO mappers) must route through this
 * instead of reading `ai_summary` directly, or a staff correction stays
 * invisible everywhere except the karute it was made on.
 *
 * Structural (not `KaruteRecord` directly): some DTO mappers carry both
 * fields as optional duck-typed properties rather than the SDK type itself.
 */
export function effectiveSummary(record: {
  ai_summary?: string | null
  edited_summary?: string | null
}): string | null {
  return record.edited_summary ?? record.ai_summary ?? null
}
