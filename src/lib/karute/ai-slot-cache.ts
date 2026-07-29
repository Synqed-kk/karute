/** Session-lived memory for the thin AI cards (Liam ruling 2026-07-29: an
 *  unchanged draft must load instantly, not shimmer on every reopen). Keyed
 *  by fetch path, so every AI slot shares it. Bounded FIFO — Map iteration is
 *  insertion-ordered, so evicting the first key drops the oldest entry.
 *  Lives in src (not the thin screen) so wipeSessionVault can clear it on
 *  sign-out without importing a thin component: a soft logout only swaps
 *  React state — module scope survives — so without the wipe the next
 *  signer-in on the same device could render the previous user's cached
 *  card (blind-round find, 2026-07-29). Server ai_cache stays the durable
 *  layer; this only kills the reopen shimmer. */
const cache = new Map<string, unknown>()
const MAX = 50

export function getAiSlot(path: string): unknown {
  return cache.get(path)
}

export function setAiSlot(path: string, value: unknown): void {
  if (cache.size >= MAX && !cache.has(path)) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(path, value)
}

/** Authoritative server null (a 200 whose payload carries no card — e.g. the
 *  summary was cleared, so no draft exists anymore): the stale entry must
 *  die, or the card would keep pre-filling outreach text grounded in a
 *  deleted summary (blind-round P1, 2026-07-29). */
export function deleteAiSlot(path: string): void {
  cache.delete(path)
}

export function clearAiSlotCache(): void {
  cache.clear()
}
