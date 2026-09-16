/**
 * Karute-number search (⚖ Liam 2026-09-16, cross-branch search packet P3):
 * synqed-core's `customers.list({ search })` predicate has no karute_number
 * column, so a chart-number query ("0042") never matches through the normal
 * name/kana/phone/email search. The app closes the gap locally until core
 * ships the predicate (ticket filed) — this is the ONE place that decides
 * what counts as a karute-number query and does the match, shared by
 * `listAllCustomers` (list-all.ts) and the company-wide picker search
 * (actions/customers.ts) so the two can never disagree about it.
 */

/** Rows one customer search shows/returns at once. Exported because a caller
 *  that caps the list also has to tell the staff how many matches it left
 *  off — a header reading the capped array announces 8 matches over a salon
 *  of 20 (C-3). Fold round: one home — CustomerCombobox re-exports this
 *  instead of declaring its own copy, and the two server-side search paths
 *  (actions/customers.ts, the facade twin route) import it directly. */
export const CUSTOMER_SEARCH_LIMIT = 8

/** Same fold CustomerCombobox's phone-digit search already applies: full-width
 *  digits (０-９, the kana keyboard's default) → half-width, separators
 *  stripped, so "０/０４２" and "0042" and "00-42" all match the same way. */
export function foldSearchDigits(s: string): string {
  return s
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[-\s－]/g, '')
}

/**
 * Matches `term` against `rows` by karute_number. Only fires when the folded
 * term is ALL digits and ≤ 6 characters — real salons never reach a 7-digit
 * chart number, so anything longer is a phone/other search, not this one.
 * Returns [] (never throws) on a non-qualifying term, so callers can run it
 * unconditionally over whatever list they already have in hand.
 */
export function matchKaruteNumber<T extends { karute_number: number | null }>(
  term: string,
  rows: T[],
): T[] {
  const folded = foldSearchDigits(term)
  if (!folded || folded.length > 6 || !/^\d+$/.test(folded)) return []
  const n = Number(folded)
  return rows.filter((r) => r.karute_number === n)
}
