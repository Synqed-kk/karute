// ⚖ S116 round 4 (#1088, N1) — no imports: a test runs this file in a child
// process under a non-UTC zone (jest pins UTC, which hid the trap).

/** ⚖ S116 round 4 (N1) — a storage timestamp as epoch ms, or null. One with no
 *  offset (`YYYY-MM-DD[T ]HH:MM[:SS[.f]]`) is UTC — storage's clock is UTC, and
 *  Date.parse alone reads it as THIS server's local time (9 h off in Tokyo). */
export function parseStorageTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)
  const at = Date.parse(naive ? `${s.replace(' ', 'T')}Z` : s)
  return Number.isFinite(at) ? at : null
}
