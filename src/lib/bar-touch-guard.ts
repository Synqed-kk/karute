// ─────────────────────────────────────────────────────────────
// barTouchGuard — a touch AT the tab bar belongs to the tab bar
// ─────────────────────────────────────────────────────────────
// Field report (S102/S103, 2026-10-06): on 予約, tapping the カルテ tab or the
// red record button sometimes opened the booking row underneath instead. The
// bar is a `fixed` overlay over a scrolling document (thin/shell.tsx), so a
// row is always passing under its top edge; when the engine hands a bar-aimed
// touch to that row, the bar's own handlers (tap-activation.ts) never run.
// Why the engine does that is NOT known — so this enforces the rule without
// needing the cause:
//
//   a touch whose POSITION is inside the bar's rect (or the record button's
//   rect plus its painted ring, which sticks out above the bar) belongs to
//   the bar, whatever element the engine says received it.
//
// One choke point: capture-phase listeners on document, installed once by the
// thin shell. Inert unless the target is inside the PAGE (<main>) — a target
// inside the bar is the normal case and is never touched, and portaled
// dialogs/sheets live outside <main>. A page element stacked ABOVE the bar
// (fixed, z > 40: inline sheets like CancelBookingSheet) also keeps its touch.
// An intercepted touch is stopped before the page sees it and, once per
// touch, the bar control under the finger is activated through the bar's own
// click handler (clickAsTap) — no second navigation path.

import { clickAsTap } from './tap-activation'

/** ring-4 on the record button: painted (box-shadow), not hit-testable. */
const RING_PX = 4
/** Same slop as tap-activation / useLongPress. */
const SLOP_PX = 10
/** A click this soon after a guarded touchend belongs to that touch. */
const CLICK_AFTER_TOUCH_MS = 800
const BAR_Z = 40

type Box = { left: number; right: number; top: number; bottom: number; height: number }
const within = (b: Box, x: number, y: number, pad = 0) =>
  b.height > 0 && x >= b.left - pad && x <= b.right + pad && y >= b.top - pad && y <= b.bottom + pad

/** Some page element between target and <main> paints above the bar. */
function aboveBar(t: Element | null, page: Element): boolean {
  for (; t && t !== page; t = t.parentElement) {
    const s = getComputedStyle(t)
    if (s.position === 'fixed' && Number(s.zIndex) > BAR_Z) return true
  }
  return false
}

export function installBarTouchGuard(wrapper: HTMLElement, page: HTMLElement): () => void {
  let start: { id: number; x: number; y: number } | null = null
  let lastTouchEnd = -Infinity
  let own = false

  const bar = () => wrapper.querySelector('[aria-label="Primary navigation"]')
  const record = () => wrapper.querySelector('[data-bar-record]')

  /** Is (x,y) the bar's? */
  const inside = (x: number, y: number) => {
    const b = bar()
    const r = record()
    return !!b && (within(b.getBoundingClientRect(), x, y) || (!!r && within(r.getBoundingClientRect(), x, y, RING_PX)))
  }

  /** The bar control whose own rect holds (x,y); null → nothing to do. */
  const controlAt = (x: number, y: number): HTMLElement | null => {
    const r = record() as HTMLElement | null
    if (r && within(r.getBoundingClientRect(), x, y, RING_PX)) return r
    for (const el of bar()?.querySelectorAll<HTMLElement>('a,button') ?? []) {
      if (within(el.getBoundingClientRect(), x, y)) return el
    }
    return null
  }

  const activate = (x: number, y: number) => {
    const el = controlAt(x, y)
    if (!el) return
    own = true
    try {
      clickAsTap(el)
    } finally {
      own = false
    }
  }

  const onEvent = (e: Event) => {
    if (own) return
    const te = (e as TouchEvent).changedTouches
    const p = te ? te[0] : (e as MouseEvent)
    if (!p) return
    const { clientX: x, clientY: y } = p
    const id = te ? te[0].identifier : -1
    const now = Date.now()
    // The click trailing a touch this guard already handled: whatever it now
    // targets (the bar included), the touch's activation was the tap.
    if (e.type === 'click' && now - lastTouchEnd < CLICK_AFTER_TOUCH_MS && inside(x, y)) {
      e.stopPropagation()
      e.preventDefault()
      return
    }
    const t = e.target
    if (!(t instanceof Element) || wrapper.contains(t) || !page.contains(t)) return
    if (!inside(x, y) || aboveBar(t, page)) {
      if (e.type === 'touchstart') start = null
      return
    }
    e.stopPropagation()
    if (e.type !== 'touchstart' && e.cancelable) e.preventDefault()
    if (e.type === 'touchstart') {
      start = { id, x, y }
    } else if (e.type === 'touchend') {
      lastTouchEnd = now
      const s = start
      start = null
      if (s && s.id === id && (x - s.x) ** 2 + (y - s.y) ** 2 <= SLOP_PX ** 2) activate(x, y)
    } else if (e.type === 'click') {
      activate(x, y)
    }
  }

  const types = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click'] as const
  for (const type of types) document.addEventListener(type, onEvent, { capture: true, passive: type === 'touchstart' })
  return () => {
    for (const type of types) document.removeEventListener(type, onEvent, { capture: true })
  }
}
