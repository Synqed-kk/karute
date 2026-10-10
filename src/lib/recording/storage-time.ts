// ⚖ S116 round 4 (#1088, N1) — no imports: a test runs this file in a child
// process under a non-UTC zone (jest pins UTC, which hid the trap).

/** ⚖ S116 round 4 (N1) — a storage timestamp as epoch ms, or null. One with no
 *  offset (`YYYY-MM-DD[T ]HH:MM[:SS[.f]]`) is UTC — storage's clock is UTC, and
 *  Date.parse alone reads it as THIS server's local time (9 h off in Tokyo).
 *  ⚖ S117 (N-4): a lowercase `t`/`z` and a short `±HH` / `±HHMM` offset are read too
 *  (Date.parse took the `t` as local time and gave `-07` NaN). */
export function parseStorageTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  const m = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([Zz]|[+-]\d{2}(?::?\d{2})?)?$/.exec(s)
  const z = m?.[3] ?? 'Z'
  const zone = z.length === 3 ? `${z}:00` : z.length === 5 ? `${z.slice(0, 3)}:${z.slice(3)}` : z.toUpperCase()
  const at = Date.parse(m ? `${m[1]}T${m[2]}${zone}` : s)
  return Number.isFinite(at) ? at : null
}
