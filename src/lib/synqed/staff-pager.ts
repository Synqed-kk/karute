// The core roster read, PAGED — one home for every caller that needs the whole
// staff list rather than its first page.
//
// ⚖ R1-5/R1-7 (E33, "the 201st"): core 400s a page_size above 200 on this
// family and does not clamp, so a single `staff.list({ page_size: 200 })` is a
// silent truncation at exactly 200 rows. That was tolerable while the roster
// only fed a picker; it is not tolerable now that its SIZE is a capacity
// divisor — a 250-staff business divided every store's booked minutes by at
// most 200 lanes, understating capacity and overstating 稼働% with nothing on
// the wire to say the read was short.
//
// Structural typing on purpose: the SDK is ESM-only and this module is reached
// from graphs (and tests) that must not load it. Callers pass their own
// authenticated `client.staff`.

/** Core 400s a page_size above 200 on this family. 25 pages = 5,000 cards,
 *  current AND historical, far past any real roster. */
const STAFF_PAGE_SIZE = 200
const STAFF_MAX_PAGES = 25

interface StaffPage<T> {
  staff: T[]
  total?: number
}

interface StaffApi<T> {
  list(opts: { page: number; page_size: number }): Promise<StaffPage<T>>
}

/**
 * Every core staff row for the client's business, paged to exhaustion.
 *
 * Throws whatever the client throws — a caller that wants to degrade catches
 * it itself, because "the read failed" and "this business has no staff" must
 * never become the same answer at a call site that divides by the count.
 */
export async function listAllCoreStaff<T>(staffApi: StaffApi<T>): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; page <= STAFF_MAX_PAGES; page++) {
    const res = await staffApi.list({ page, page_size: STAFF_PAGE_SIZE })
    rows.push(...res.staff)
    // `?? 0` mirrors staff-map.ts: a fixture with no `total` terminates after
    // one call, so single-page test doubles keep their exactly-one-call shape.
    if (res.staff.length === 0 || rows.length >= (res.total ?? 0)) break
  }
  return rows
}
