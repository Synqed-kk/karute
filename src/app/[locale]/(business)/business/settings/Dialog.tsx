'use client'

/** ⚖ R93 (S49 fresh eyes) — the room's ONE dialog primitive. Sections that ask
 *  a question in a dialog use this rather than a local copy, so the four rules
 *  below hold everywhere at once:
 *  1. PORTALED to the room root (`.page.pg-settings`), OUTSIDE `.st-main`'s and
 *     `.st-body`'s containers: `container-type` makes an element the containing
 *     block of its `position: fixed` descendants, so a scrim rendered inside the
 *     reading column would cover the column, not the screen.
 *  2. Esc closes it and STOPS there — the room's own Esc handlers never see it.
 *  3. The Tab trap counts only controls that can take focus: a `disabled` button
 *     is skipped (the mock's 業種 dialog leaked when 戻す was disabled — SPECCHECK
 *     fix 2). An `aria-disabled` control stays reachable, as the room intends.
 *  4. Initial focus is the caller's choice (`initialFocus`); on close focus
 *     returns to the control that opened it — or, ⚖ S66 R260, to `returnFocus`
 *     when the caller names one (WebKit never focuses a clicked button, so the
 *     focused element at a pointer/tap open is BODY).
 *  5. ⚖ R112 — a click on the SCRIM itself closes it too (the mock's three cancel
 *     paths: Esc · scrim · やめる). Only a click whose target IS the scrim counts
 *     (never one that bubbles up from the panel), and never a press that began
 *     in the panel and was released over the scrim (a browser fires that click
 *     on the scrim). Esc and the scrim share one close path, `requestClose`.
 *  6. ⚖ S52 R4 — the keys are heard at the DOCUMENT (capture) while open, so Esc
 *     and the Tab trap work even when focus has fallen outside the panel; Esc
 *     during IME composition is the IME's, never the dialog's.
 *  7. ⚖ S54 R165 — a scrim close needs the press to START on the scrim AND to be
 *     RELEASED on it (pointerup/mouseup target is the scrim), then the click.
 *  8. ⚖ S54 R165 — dialogs STACK: only the top-most open dialog hears Esc, Tab
 *     and its scrim; the ones below ignore them until they are on top again.
 *  9. ⚖ S62 R227 — `sheet` draws the SAME dialog as a bottom sheet: the scrim's
 *     class becomes `st-dlg-scrim is-sheet` and the box gains `st-sheet` (CSS in
 *     dialog.css). Every rule above is shared, untouched. Without it the DOM is
 *     exactly what it was.
 * 10. ⚖ S63 R235 — the trap's list is only what Tab can reach: never a negative
 *     `tabIndex`, never anything under `aria-hidden="true"` or `inert` within the box.
 *     Tab is always handled while the dialog is top-most, so a control under aria-hidden can be reached by a click but never by Tab, and Tab from it continues in DOM order (S71).
 * 11. S71 (Greptile #1130 R4) — focus returns only to a target that can take it: returnFocus, else the opener, else the first reachable control in the room; a return target hidden by CSS (the sheet's opener above 899 px) never swallows focus. */

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import './dialog.css'

export const ROOM_ROOT_SELECTOR = '.page.pg-settings'

/** The open dialogs, bottom → top. Pushed on open, removed on close AND on
 *  unmount (the open effect's cleanup runs for both). Reassigned, never mutated. */
let openStack: readonly symbol[] = []
const isTop = (id: symbol) => openStack[openStack.length - 1] === id

const FOCUSABLE = 'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** Rendered and shown: no `display: none` on it or any ancestor up to `box`, not
 *  `visibility: hidden`, not inside `[hidden]`. focus() on anything else does
 *  nothing in a browser, so the trap must never aim at it. */
function isShown(el: HTMLElement, box: HTMLElement): boolean {
  if (el.closest('[hidden]')) return false
  const vis = getComputedStyle(el).visibility
  if (vis === 'hidden' || vis === 'collapse') return false
  for (let n: HTMLElement | null = el; n; n = n === box ? null : n.parentElement) {
    if (getComputedStyle(n).display === 'none') return false
  }
  return true
}

/** Rule 10: under `aria-hidden="true"` or `inert` inside the box (closest = the nearest, so inside wins). */
function hiddenFromTab(el: HTMLElement, box: HTMLElement): boolean {
  const h = el.closest('[aria-hidden="true"], [inert]')
  return h !== null && box.contains(h)
}

/** The controls the trap cycles through, in order — never a disabled, hidden or
 *  undrawn one, nor one Tab cannot reach (rule 10). */
export function focusablesIn(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.matches(':disabled') && el.tabIndex >= 0 && !hiddenFromTab(el, box) && isShown(el, box),
  )
}

export function Dialog({
  open,
  onClose,
  labelledBy,
  describedBy,
  initialFocus,
  root,
  className,
  sheet,
  returnFocus,
  children,
}: {
  open: boolean
  onClose: () => void
  /** id of the dialog's visible title. */
  labelledBy: string
  describedBy?: string
  /** Where focus lands on open; falls back to the first focusable control when
   *  it is missing, outside the panel, disabled or not shown. */
  initialFocus?: RefObject<HTMLElement | null>
  /** Override of the portal target (tests, or a room that is not the settings room). */
  root?: HTMLElement | null
  className?: string
  /** ⚖ S62 R227 (rule 9) — draw the dialog as a bottom sheet. */
  sheet?: boolean
  /** ⚖ S66 R260 — where focus returns on close, however the dialog was opened (falls back to the opener). */
  returnFocus?: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  /** True while the current press began ON the scrim itself (not the panel). */
  const pressedOnScrim = useRef(false)
  /** True when the current press was RELEASED on the scrim itself. */
  const releasedOnScrim = useRef(false)
  const idRef = useRef<symbol>(Symbol('dialog'))
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => { onCloseRef.current = onClose }, [onClose])
  const returnRef = useRef(returnFocus)
  useLayoutEffect(() => { returnRef.current = returnFocus }, [returnFocus])

  // Opening: remember the opener (fresh on every open — the target is cleared on
  // close, so nothing renders before this runs), find the room root. Closing:
  // give focus back.
  useLayoutEffect(() => {
    if (!open) return
    const id = idRef.current
    openStack = [...openStack, id]
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const home =
      root ??
      opener?.closest<HTMLElement>(ROOM_ROOT_SELECTOR) ??
      document.querySelector<HTMLElement>(ROOM_ROOT_SELECTOR) ??
      document.body
    setTarget(home)
    return () => {
      openStack = openStack.filter((x) => x !== id)
      // NOT dead (S54 R165(5), tested): without it a reopen renders into the old
      // target first, an autoFocus child takes focus in that commit, and this
      // effect would capture the child as the opener.
      setTarget(null)
      // Rule 11: only a target that is connected AND shown can take focus.
      const canTake = (el: HTMLElement | null | undefined): el is HTMLElement => !!el && el.isConnected && isShown(el, document.body)
      const back = returnRef.current?.current
      const dest = canTake(back)
        ? back
        : canTake(opener)
          ? opener
          : [...home.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => !el.matches(':disabled') && el.tabIndex >= 0 && isShown(el, home))
      dest?.focus()
    }
  }, [open, root])

  useEffect(() => {
    const box = boxRef.current
    if (!open || !target || !box) return
    const list = focusablesIn(box)
    const wanted = initialFocus?.current
    const first = wanted && list.includes(wanted) ? wanted : list[0]
    ;(first ?? box).focus()
  }, [open, target, initialFocus])

  // The keys, heard at the document in the capture phase while open: Esc and
  // the Tab trap hold wherever focus is, and Esc stops there.
  useEffect(() => {
    if (!open || !target) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      const box = boxRef.current
      if (!box || !isTop(idRef.current)) return
      if (e.key === 'Escape') {
        if (e.isComposing || e.keyCode === 229) return
        e.stopPropagation()
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusablesIn(box)
      const active = document.activeElement
      if (list.length === 0) { e.preventDefault(); box.focus(); return }
      const first = list[0]
      const last = list[list.length - 1]
      const n = list.length
      const idx = active instanceof HTMLElement ? list.indexOf(active) : -1
      let next: HTMLElement
      if (idx >= 0) next = list[(idx + (e.shiftKey ? -1 : 1) + n) % n]
      else if (active instanceof HTMLElement && box.contains(active)) {
        // Inside the box but not in the list (the box, or a control Tab cannot reach): continue in DOM order.
        next = e.shiftKey
          ? ([...list].reverse().find((el) => active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) ?? last)
          : (list.find((el) => active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) ?? first)
      } else next = e.shiftKey ? last : first
      e.preventDefault()
      next.focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, target])

  /** The ONE close path: Esc and a scrim click both end here; focus goes back to
   *  the opener in the layout effect's cleanup when the caller sets open=false. */
  const requestClose = () => onCloseRef.current()

  /** pointerdown AND mousedown both record where the press began: a control in
   *  the panel that cancels pointerdown suppresses mousedown, not pointerdown. */
  const onScrimPress = (e: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
    pressedOnScrim.current = e.target === e.currentTarget
    releasedOnScrim.current = false
  }
  /** pointerup AND mouseup both record where the press was released. */
  const onScrimRelease = (e: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
    releasedOnScrim.current = e.target === e.currentTarget
  }
  const onScrimClick = (e: MouseEvent<HTMLDivElement>) => {
    const startedOnScrim = pressedOnScrim.current
    const endedOnScrim = releasedOnScrim.current
    pressedOnScrim.current = false
    releasedOnScrim.current = false
    if (e.target !== e.currentTarget || !startedOnScrim || !endedOnScrim || !isTop(idRef.current)) return
    requestClose()
  }

  if (!open || !target) return null
  return createPortal(
    <div className={sheet ? 'st-dlg-scrim is-sheet' : 'st-dlg-scrim'} onPointerDown={onScrimPress} onMouseDown={onScrimPress} onPointerUp={onScrimRelease} onMouseUp={onScrimRelease} onClick={onScrimClick}>
      <div
        ref={boxRef}
        className={`st-dlg${sheet ? ' st-sheet' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    target,
  )
}
