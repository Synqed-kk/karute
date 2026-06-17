/**
 * Fetch every page of a paginated list, deduped by id. synqed-core clamps
 * page_size at 500, so a single fetch silently drops everything past #500 — and
 * raising the cap is clamped server-side, so the ONLY correct fix is to loop.
 * We dedupe by id and stop at `total` because the sort key (name) is NOT unique:
 * offset paging on a non-unique key can skip or double-count rows straddling a
 * page boundary, so `accumulated >= total` alone could mask a dropped row — the
 * by-id map makes the count honest. Pure (no server deps) so it's unit-testable.
 */
export async function paginateDedupe<T extends { id: string }>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
  maxPages = 50,
): Promise<T[]> {
  const byId = new Map<string, T>()
  let total = 0
  for (let page = 1; page <= maxPages; page++) {
    const { items, total: t } = await fetchPage(page)
    total = t
    for (const it of items) byId.set(it.id, it)
    if (items.length === 0 || byId.size >= total) break
  }
  if (byId.size < total) {
    console.warn(`[customers cache] truncated at ${byId.size}/${total} after ${maxPages} pages`)
  }
  return [...byId.values()]
}
