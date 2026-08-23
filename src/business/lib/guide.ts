// THE GUIDED TOUR'S ENGINE — ONE SHARED HOME.
//
// ⚖ Liam 8/23: every Business page ships the 画面の説明 guided tour in the
// 今日の運営 style — a ? trigger, a spotlight walk of the page's sections in
// visual order, and tap-any-element-to-learn during the walk. The engine below
// is what makes that a rule rather than a per-room rebuild: a registry walk, a
// ring, a card placement and a hit-test, all pure functions over rects and
// nodes. Rooms wire their own trigger and their own overlay to it.
//
// THE CODE IS CARRIED VERBATIM out of `today-interactions.ts`, where it was
// written for 今日の運営 under Liam's flag 25. Every line of it is an
// adjudicated rule, so this move is an ADDRESS CHANGE and nothing else — not a
// tidy-up, not a rename, not an improvement. The today room now imports from
// here (no re-export shim left behind: one home, single-source law), and its
// behaviour is unchanged, which is what its own suites prove.
//
// PURE BY CONSTRUCTION, and the empty import inventory in foundation.test.ts is
// the pin. Nothing here reads data, holds state, or knows React: a room's own
// screen owns the step index, the overlay and the copy. That is why the same
// engine can serve a board of fourteen sections and a message desk of twelve
// without either room having to know about the other.

// ── ⚖ Liam flag 25 — the guided tour's positioning rules ───────────────────

export interface SpotRect { left: number; top: number; width: number; height: number }

/** canon `spotRender`'s card placement (:3357–3380). The card goes on the
 *  spotlight's WIDEST free side and never covers the region it is explaining —
 *  below if there is room, above if there is not, and beside it only when it
 *  had to be squeezed level with the target. */
export function spotCardAt(
  target: SpotRect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const bottom = target.top + target.height
  const right = target.left + target.width
  const below = viewport.height - bottom
  const above = target.top
  let top: number
  if (below >= card.height + 18) top = bottom + 12
  else if (above >= card.height + 18) top = target.top - card.height - 12
  else top = Math.max(10, Math.min(viewport.height - card.height - 10, target.top))
  const clear = top >= bottom + 12 || top + card.height <= target.top - 2
  const left = clear
    ? Math.max(10, Math.min(target.left, viewport.width - card.width - 10))
    : viewport.width - right - 18 >= card.width
      ? right + 12
      : Math.max(10, target.left - card.width - 12)
  return { top, left }
}

/** canon `spotHitIndex` (:3406–3416) — click-any-region-to-jump. Registered
 *  regions nest (the board contains its group headings), so the SMALLEST region
 *  under the pointer wins and a big section can never swallow its own children.
 *  `-1` = the click was on nothing registered, which closes the tour. */
export function spotHitIndex(x: number, y: number, rects: SpotRect[]): number {
  let best = -1
  let bestArea = Infinity
  rects.forEach((r, i) => {
    if (x < r.left || x > r.left + r.width || y < r.top || y > r.top + r.height) return
    const area = r.width * r.height
    if (area < bestArea) { bestArea = area; best = i }
  })
  return best
}

/** canon `spotTargets` (:3343). THE REGISTRY, and the whole adaptive property
 *  Liam built in: a section joins the tour by DECLARING itself with `data-guide`
 *  — there is no steps table to keep in sync, so a section that renders is a
 *  section that is explained, and one that is hidden (a popover, a strip behind
 *  a permission, the 自分の1日 header on a manager's board) silently drops out
 *  of the count. DOM order is visual order, so the walk needs no sort.
 *
 *  ⚖ LANE RULE (Liam, flag 25): every new section added to this board in any
 *  future round registers a `data-guide` + `data-guide-title` pair. */
/** canon `spotGo` (:3380): the walk is a RING — 次へ on the last step returns to
 *  the first, which is why its label reads 最初へ there. `-1` for an empty
 *  registry, because a board with nothing declared has no tour to be on. */
export function wrapStep(i: number, total: number): number {
  return total === 0 ? -1 : ((i % total) + total) % total
}

export function spotTargets(root: Document | Element | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('[data-guide]')).filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0
  })
}
