// 初回 determination — the reservation system is the source of truth (Liam's
// rule, 2026-07-03): a booking whose course name carries the new-customer
// marker (新規〜) IS a first visit, and a booking on any other named course
// means the customer is RETURNING — even when our own records are seeing them
// for the first time (imports don't carry full history, so absence of history
// proves nothing). Provider-agnostic: QuickReserve writes the course into the
// appointment title today; any future connector that names its campaign
// courses the same way keeps working.

/** What the booking itself says about first-visit-ness.
 *  true = the course is a new-customer course; false = a named course that
 *  isn't; null = the booking carries no course info → caller falls back to
 *  history-based inference. */
export function firstVisitFromBooking(
  courseTitle: string | null | undefined,
): boolean | null {
  const t = courseTitle?.trim()
  if (!t) return null
  return t.includes('新規')
}
