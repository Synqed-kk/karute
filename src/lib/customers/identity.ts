/**
 * Customer-identity display helpers — initials for avatars and
 * sequential per-tenant karute numbers.
 *
 * Both are display-only stand-ins. The "real" karute number wants
 * to be a column on the customer row populated by a Postgres
 * sequence on insert (see ANTHONY note in
 * `assignSequentialKaruteNumbers` below). Until then, we compute it
 * at render time so customers see clean #00001 / #00012 / #00120
 * salon-industry-standard numbers instead of hash-derived
 * #66314 / #08448 noise.
 */

/**
 * Avatar initials.
 *
 * Heuristic — Japanese names prefer the FAMILY name (first part)
 * because that's how JP salons reference customers visually:
 *   "伊藤 大輝"   → 伊藤   (2-char family, show whole)
 *   "田中健太"    → 田中   (no space, take first 2 chars)
 *   "ぴあそん りえむ" → ぴあ (4-char family, compress to 2)
 *
 * ASCII names fall back to the first+last-initial pattern that
 * works for Latin script:
 *   "Jon Chan"   → JC
 *   "Madonna"    → MA  (single word, take first 2)
 *
 * Detection is by character set — if every char is ASCII we use
 * the Latin pattern, otherwise the JP family-name pattern.
 *
 * Always returns 1-2 chars. Empty / whitespace-only input returns
 * "?" so the avatar slot is never blank.
 */
export function deriveFamilyInitials(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'

  const isAscii = /^[\x00-\x7f]+$/.test(trimmed)
  const parts = trimmed.split(/\s+/)

  if (isAscii) {
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }

  // Japanese: prefer the family name (first part), compressed to
  // 2 chars if longer. Single-word JP names (no space) still take
  // 2 chars off the front for visual density.
  const familyName = parts[0]
  return familyName.length <= 2 ? familyName : familyName.slice(0, 2)
}

/**
 * Assign sequential per-tenant karute numbers (#00001, #00002, …)
 * to every customer in the input list. Numbers reflect creation
 * order — oldest customer gets #00001, newest gets the highest.
 *
 * Returns a Map keyed by customer id → display string. Caller
 * looks up by id at render time.
 *
 * Sort is by created_at ASC with id as tiebreaker (stable across
 * customers that share an exact timestamp — possible with seeded
 * data).
 *
 * Stand-in caveat: numbers can shift if customers are deleted (a
 * row vacating slot #5 means the next-newer customer's number
 * drops by one). For a real salon CRM this is wrong — a customer's
 * number should be immutable for life.
 *
 * ANTHONY: the production fix is a `customers.karute_number` text
 * column with `unique (business_id, karute_number)` and a Postgres
 * sequence per tenant. Insert trigger:
 *   lpad(nextval('karute_number_seq_' || NEW.business_id)::text, 5, '0')
 * Once that's live, both pages read the field directly and we
 * delete this helper.
 */
export function assignSequentialKaruteNumbers<
  T extends { id: string; created_at?: string | null },
>(customers: T[]): Map<string, string> {
  const sorted = [...customers].sort((a, b) => {
    const aDate = a.created_at ?? ''
    const bDate = b.created_at ?? ''
    if (aDate !== bDate) return aDate.localeCompare(bDate)
    return a.id.localeCompare(b.id)
  })
  const map = new Map<string, string>()
  sorted.forEach((c, i) => {
    map.set(c.id, `#${String(i + 1).padStart(5, '0')}`)
  })
  return map
}
