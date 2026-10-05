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
//   WHERE A TOUCH STARTS DECIDES. A touch (or mouse press) that STARTS inside
//   the bar's rect (or on the record button's circle plus its painted ring,
//   which sticks out above the bar, and on touch screens the record control's
//   grown hit area — its `data-bar-hit` spans, bottom-nav.tsx) on page content under the bar belongs to
//   the bar from start to finish, whatever element the engine says received
//   it. A touch that starts anywhere else is never touched, wherever it ends.
//
// One choke point: capture-phase listeners on document, installed once by the
// thin shell. Only page content under the bar is ever intercepted: a target
// inside the bar is the normal case and is never touched, portaled dialogs and
// sheets live outside <main>, and a page element stacked ABOVE the bar
// (positioned, z > 40: inline sheets, dropdowns, sticky footers) keeps its
// touch. An owned touch is stopped before the page sees it and, on its
// touchend, the bar control under its START point is activated through the
// bar's own click handler (clickAsTap) — no second navigation path. Keyboard
// and assistive-technology clicks (detail 0) are never intercepted.

import { clickAsTap } from './tap-activation'

/** ring-4 on the record button: painted (box-shadow), not hit-testable. */
const RING_PX = 4
/** Same slop as tap-activation / useLongPress. */
const SLOP_PX = 10
const BAR_Z = 40

// ── The silent recorder (local only) ──
// Each incident (an owned touch's touchend, an intercepted click with no touch,
// a swallowed ghost click) appends ONE line to a ring buffer in localStorage
// and console.debugs it — so the next field report can be read off the device.
// Nothing is shown to staff and nothing is sent anywhere. Never stored: any
// text, aria-label, name or id — only tag, a bare lowercase ARIA role (any
// other role value is stored as null), coordinates, timings, and the
// activated control as a bare route path (query dropped: the record button's
// href can carry a customerId) or 'record' / 'button'.
export const BAR_GUARD_LOG_KEY = 'karute.barTouchGuard.log'
const LOG_MAX = 50
let lastVisible = -1
let lastScroll = -1
const since = (t: number) => (t < 0 ? null : Date.now() - t)

function writeLog(e: Event, x: number, y: number, bar: Element | null, activated: string | null) {
  const t = e.target as Element
  const line = {
    at: new Date().toISOString(),
    type: e.type,
    x: Math.round(x),
    y: Math.round(y),
    tag: t.tagName.toLowerCase(),
    role: /^[a-z]+$/.test(t.getAttribute('role') ?? '') ? t.getAttribute('role') : null,
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
    scrollY: Math.round(window.scrollY),
    vvTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
    msSinceVisible: since(lastVisible),
    msSinceScroll: since(lastScroll),
    activated,
  }
  console.debug('[bar-touch-guard]', line)
  try {
    let log: unknown[] = []
    try {
      const prev: unknown = JSON.parse(localStorage.getItem(BAR_GUARD_LOG_KEY) ?? '[]')
      if (Array.isArray(prev)) log = prev
    } catch {
      // a corrupt entry: start again from an empty log
    }
    log.push(line)
    localStorage.setItem(BAR_GUARD_LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)))
  } catch {
    // storage full or blocked: the recorder is best-effort
  }
}

type Box = { left: number; right: number; top: number; bottom: number; height: number; width: number }
const within = (b: Box, x: number, y: number) =>
  b.height > 0 && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
/** The record button's area is its CIRCLE plus the ring — never its square. */
const onCircle = (b: Box, x: number, y: number) =>
  b.width > 0 && (x - (b.left + b.right) / 2) ** 2 + (y - (b.top + b.bottom) / 2) ** 2 <= (b.width / 2 + RING_PX) ** 2
/** A control's grown touch area: its own `data-bar-hit` spans (bottom-nav.tsx;
 *  laid out on touch screens only, zero-size and so never matched elsewhere). */
const hits = (c: Element) =>
  Array.from(c.children)
    .filter((h) => h.hasAttribute('data-bar-hit'))
    .map((h) => h.getBoundingClientRect())
/** The record control's area: its circle plus the ring, and its hit spans. */
const onRecord = (r: Element, x: number, y: number) =>
  onCircle(r.getBoundingClientRect(), x, y) || hits(r).some((b) => within(b, x, y))
const near = (s: { x: number; y: number }, x: number, y: number) => (x - s.x) ** 2 + (y - s.y) ** 2 <= SLOP_PX ** 2

/** Some page element between target and <main> paints above the bar:
 *  positioned (fixed, absolute, sticky, relative) with a z-index over 40. */
function aboveBar(t: Element | null, page: Element): boolean {
  for (; t && t !== page; t = t.parentElement) {
    const s = getComputedStyle(t)
    if (s.position !== 'static' && Number(s.zIndex) > BAR_Z) return true
  }
  return false
}

export function installBarTouchGuard(wrapper: HTMLElement, page: HTMLElement): () => void {
  /** The touch this guard owns (its touchstart was intercepted). */
  let start: { id: number; x: number; y: number } | null = null
  /** The mouse/pointer press since the last click: its start point when the
   *  guard owns it, null when it started elsewhere, undefined when none. */
  let down: { x: number; y: number } | null | undefined
  // Gesture-scoped, never timed: each is set at a touchend and cleared by the
  // click it expects or by the next gesture's pointerdown/touchstart.
  let owed = false // an owned touch lifted: its trailing click is swallowed silently, wherever it lands
  let barTouched = false // a touch lifted inside the bar on the bar itself: a ghost click under it is swallowed
  let otherEnd = false // a touch that was not ours lifted: the next click is that touch's click

  const bar = () => wrapper.querySelector('[aria-label="Primary navigation"]')
  const record = () => wrapper.querySelector<HTMLElement>('[data-bar-record]')

  /** Is (x,y) the bar's? */
  const inside = (x: number, y: number) => {
    const b = bar()
    const r = record()
    return !!b && (within(b.getBoundingClientRect(), x, y) || (!!r && onRecord(r, x, y)))
  }

  /** The enabled bar control under (x,y); null → nothing to do. A tab's area
   *  (its box or its hit span) wins over the record control's wide column
   *  span, as the tab's span paints over it in the bar. */
  const controlAt = (x: number, y: number): HTMLElement | null => {
    const r = record()
    let el: HTMLElement | null = null
    for (const c of bar()?.querySelectorAll<HTMLElement>('a,button') ?? []) {
      if (!el && c !== r && [c.getBoundingClientRect(), ...hits(c)].some((b) => within(b, x, y))) el = c
    }
    if (!el && r && onRecord(r, x, y)) el = r
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null
    return el
  }

  const activate = (x: number, y: number): string | null => {
    const el = controlAt(x, y)
    if (!el) return null
    clickAsTap(el)
    if (el.hasAttribute('data-bar-record')) return 'record'
    const href = el.getAttribute('href')
    return href ? href.split('?')[0] : 'button'
  }

  const onEvent = (e: Event) => {
    const te = (e as TouchEvent).changedTouches
    // The owned touch by its identifier: a two-finger lift may list it second.
    const p = te ? (Array.from(te).find((c) => c.identifier === start?.id) ?? te[0]) : (e as MouseEvent)
    if (!p) return
    const { clientX: x, clientY: y } = p
    const id = te ? (p as Touch).identifier : -1
    const t = e.target instanceof Element ? e.target : null
    /** Page content (in <main>, not in the bar, not stacked above it). */
    const underBar = () => !!t && !wrapper.contains(t) && page.contains(t) && !aboveBar(t, page)
    const stop = () => {
      e.stopPropagation()
      if (e.cancelable && e.type !== 'touchstart') e.preventDefault()
    }

    if (e.type === 'pointerdown' || e.type === 'touchstart') owed = barTouched = otherEnd = false
    if (e.type === 'pointerdown') {
      down = inside(x, y) && underBar() ? { x, y } : null
      if (down) stop()
    } else if (e.type === 'touchstart') {
      if (inside(x, y) && underBar()) {
        start = { id, x, y }
        stop()
      } else if (start?.id === id) start = null
    } else if (e.type === 'touchend') {
      const s = start
      if (!s || s.id !== id) {
        // A touch that started elsewhere is never touched.
        otherEnd = true
        if (t && wrapper.contains(t) && inside(x, y)) barTouched = true
        return
      }
      start = null
      owed = true
      stop()
      // No activation while another finger is down (as tap-activation.ts).
      const tap = (e as TouchEvent).touches.length === 0 && near(s, x, y)
      writeLog(e, x, y, bar(), tap ? activate(s.x, s.y) : null)
    } else if (e.type === 'touchcancel') {
      // The owned touch was cancelled: it owns nothing any more.
      if (start?.id === id) {
        start = null
        down = undefined
      }
    } else {
      const d = down
      down = undefined
      // Keyboard / assistive-technology clicks are never touched (the guard's
      // own re-entrant el.click() is one: it returns here, before `owed` is read).
      if ((e as MouseEvent).detail === 0) return
      // The owned touch's own click: swallowed wherever it lands (the bar
      // control itself, a portal, a layer above the bar, or page content).
      if (owed) {
        owed = otherEnd = false
        return stop()
      }
      // Any other click not on page content under the bar (the bar itself,
      // portals, layers above it) is never touched.
      if (!underBar()) return
      const other = otherEnd
      otherEnd = false
      if (barTouched && inside(x, y)) {
        barTouched = false
        stop()
        return writeLog(e, x, y, bar(), null)
      }
      if (other || d === null || (d === undefined && !inside(x, y))) return
      stop()
      const s = d ?? { x, y }
      writeLog(e, x, y, bar(), near(s, x, y) ? activate(s.x, s.y) : null)
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') lastVisible = Date.now()
  }
  const onScroll = () => {
    lastScroll = Date.now()
  }

  // No pointerup: stopping it would leave a row's hold timer running (a short
  // tap near the bar's top edge would open hold-to-cancel). pointerdown is
  // enough — a row never starts a press inside the bar.
  const types = ['pointerdown', 'touchstart', 'touchend', 'touchcancel', 'click'] as const
  for (const type of types) document.addEventListener(type, onEvent, { capture: true, passive: type === 'touchstart' })
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    for (const type of types) document.removeEventListener(type, onEvent, { capture: true })
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('scroll', onScroll)
  }
}
