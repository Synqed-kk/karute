/**
 * The summary a reader should display for a karute record.
 *
 * Today this is simply the AI-generated `ai_summary`. It is the SINGLE place
 * Wave 2 flips to `edited_summary ?? ai_summary` once the edited-summary column
 * ships — every summary reader already routes through here, so that becomes a
 * one-line change with no reader-by-reader hunt. Behaviour-neutral until then.
 *
 * Null-safe: a null/undefined record, or a record with no summary, yields null.
 */
export function effectiveSummary(
  record: { ai_summary?: string | null } | null | undefined,
): string | null {
  return record?.ai_summary ?? null
}
