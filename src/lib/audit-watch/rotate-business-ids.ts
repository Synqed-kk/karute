/**
 * Greptile round 3 finding 2 (PACKET-PR-C2-FIX-ROUND2-LENS-2026-09-11.md
 * round 3, route.ts ~:50): a serial walk in the same allowlist order every
 * hour let one slow early business eat the whole budget every run and the
 * tail was never audited. Rotate the starting business per run —
 * deterministic and stateless (no cursor to persist), the assembler's own
 * golden-ratio ring walk (src/lib/recording/assembler.ts) in its simplest
 * form: with an hourly cron every business takes first position once per N
 * businesses. The per-business 30s reserve (BUSINESS_RESERVE_MS in run.ts)
 * is unaffected — this only changes visit order, not the per-business
 * budget.
 *
 * Kept in its own zero-dependency file (rather than inside run.ts) so
 * route.ts's mock in tests never has to pull in run.ts's SDK-client import
 * chain just to get this pure function.
 */
export function rotateBusinessIds(ids: readonly string[], now: Date): string[] {
  if (ids.length === 0) return []
  const start = now.getUTCHours() % ids.length
  return [...ids.slice(start), ...ids.slice(0, start)]
}
