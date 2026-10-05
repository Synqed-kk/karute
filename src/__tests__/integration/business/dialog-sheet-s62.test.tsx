/**
 * @jest-environment jsdom
 */
/** S62 P9-1 (R227-R229, R231) - the room's ONE Dialog in its `sheet` form.
 *  d1/d2: the class hooks with and without `sheet` · d3: the shared rules hold
 *  in sheet form · d4: dialog.css source pins (comments stripped) for the
 *  sheet's geometry and its motion (transform + opacity only, the mock's curve). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useState } from 'react'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { Dialog, focusablesIn } from '@/app/[locale]/(business)/business/settings/Dialog'

const ROOM_DIR = 'src/app/[locale]/(business)/business/settings'
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const DIALOG_CSS = strip(readFileSync(join(process.cwd(), ROOM_DIR, 'dialog.css'), 'utf8'))

afterEach(cleanup)

function Room({ sheet, className, onClose = () => {} }: { sheet?: boolean; className?: string; onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="biz">
      <div className="page pg-settings">
        <button type="button" onClick={() => setOpen(true)}>open</button>
        <Dialog open={open} onClose={() => { onClose(); setOpen(false) }} labelledBy="sh-t" sheet={sheet} className={className}>
          <h2 id="sh-t">title</h2>
          <button type="button">first</button>
          <button type="button">second</button>
        </Dialog>
      </div>
    </div>
  )
}
const openRoom = (props: { sheet?: boolean; className?: string; onClose?: () => void }) => {
  const r = render(<Room {...props} />)
  fireEvent.click(r.getByText('open'))
  const box = r.getByRole('dialog', { name: 'title' })
  return { r, box, scrim: box.parentElement as HTMLElement }
}

describe('d1 - `sheet` sets the two class hooks', () => {
  it('scrim = `st-dlg-scrim is-sheet`, box = `st-dlg st-sheet`', () => {
    const { box, scrim } = openRoom({ sheet: true })
    expect(scrim.getAttribute('class')).toBe('st-dlg-scrim is-sheet')
    expect(box.getAttribute('class')).toBe('st-dlg st-sheet')
  })
  it("the caller's class is kept, after `st-sheet`", () => {
    const { box, scrim } = openRoom({ sheet: true, className: 'x-look' })
    expect(scrim.getAttribute('class')).toBe('st-dlg-scrim is-sheet')
    expect(box.getAttribute('class')).toBe('st-dlg st-sheet x-look')
  })
})

describe('d2 - without `sheet` the classes are exactly as before', () => {
  it('no prop: scrim = `st-dlg-scrim`, box = `st-dlg`', () => {
    const { box, scrim } = openRoom({})
    expect(scrim.getAttribute('class')).toBe('st-dlg-scrim')
    expect(box.getAttribute('class')).toBe('st-dlg')
  })
  it('sheet={false} with a caller class: box = `st-dlg <class>`', () => {
    const { box, scrim } = openRoom({ sheet: false, className: 'x-look' })
    expect(scrim.getAttribute('class')).toBe('st-dlg-scrim')
    expect(box.getAttribute('class')).toBe('st-dlg x-look')
  })
})

describe('d3 - the shared rules hold in sheet form', () => {
  it('Esc closes', () => {
    const onClose = jest.fn()
    const { r } = openRoom({ sheet: true, onClose })
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(r.queryByRole('dialog')).toBeNull()
  })
  it('a press that starts AND ends on the scrim, then the click, closes', () => {
    const onClose = jest.fn()
    const { r, scrim: s } = openRoom({ sheet: true, onClose })
    act(() => { fireEvent.pointerDown(s); fireEvent.mouseDown(s); fireEvent.pointerUp(s); fireEvent.mouseUp(s); fireEvent.click(s) })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(r.queryByRole('dialog')).toBeNull()
  })
  it('a press that starts in the box and is released on the scrim does not close', () => {
    const onClose = jest.fn()
    const { r, scrim: s } = openRoom({ sheet: true, onClose })
    const inBox = r.getByText('first')
    act(() => { fireEvent.pointerDown(inBox); fireEvent.mouseDown(inBox); fireEvent.pointerUp(s); fireEvent.mouseUp(s); fireEvent.click(s) })
    expect(onClose).not.toHaveBeenCalled()
    expect(r.getByRole('dialog')).toBeTruthy()
  })
  it('focus lands on the first focusable control; on close it returns to the opener', () => {
    const r = render(<Room sheet />)
    const opener = r.getByText('open')
    opener.focus() // this test is about focus: the opener must hold it, as a real tap gives it
    fireEvent.click(opener)
    expect(document.activeElement).toBe(r.getByText('first'))
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(r.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

/** The body of the rule whose selector is exactly `sel` (top level or in a block). */
function ruleBody(css: string, sel: string): string {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`).exec(css)
  if (!m) throw new Error(`no rule ${sel}`)
  return m[1]
}
/** The text of `@keyframes name { ... }`, balanced. */
function keyframes(css: string, name: string): string {
  const i = css.indexOf(`@keyframes ${name}`)
  if (i < 0) throw new Error(`no @keyframes ${name}`)
  let depth = 0
  for (let j = css.indexOf('{', i); j < css.length; j++) {
    if (css[j] === '{') depth++
    else if (css[j] === '}' && --depth === 0) return css.slice(css.indexOf('{', i) + 1, j)
  }
  throw new Error('unbalanced')
}
/** The body of the one `@media (prefers-reduced-motion: reduce)` block. */
function reducedBlock(css: string): string {
  const all = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g) ?? []
  expect(all).toHaveLength(1)
  return all[0] ?? ''
}
const props = (body: string) => [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
const SHEET = '.biz .pg-settings .st-dlg.st-sheet'
const LAYOUT = ['height', 'min-height', 'max-height', 'width', 'max-width', 'top', 'bottom', 'left', 'right', 'inset', 'margin', 'padding']

describe('d4 - dialog.css pins the sheet (comments stripped)', () => {
  it('the `st-sheet-up` keyframe names ONLY transform and opacity, and ends at `transform: none`', () => {
    const kf = keyframes(DIALOG_CSS, 'st-sheet-up')
    const named = props(kf.replace(/\b(from|to)\s*\{/g, '{'))
    expect(named.length).toBeGreaterThan(0)
    expect(new Set(named)).toEqual(new Set(['transform', 'opacity']))
    expect(kf).toMatch(/from\s*\{\s*transform:\s*translateY\(16px\);\s*opacity:\s*0;?\s*\}/)
    expect(kf).toMatch(/to\s*\{\s*transform:\s*none;\s*opacity:\s*1;?\s*\}/)
  })
  it('the sheet rule: the mock curve, 92dvh, contain, safe area, will-change', () => {
    const body = ruleBody(DIALOG_CSS, SHEET)
    expect(body).toMatch(/animation:\s*st-sheet-up 220ms cubic-bezier\(\.32,\.72,0,1\) both;/)
    expect(body).toMatch(/max-height:\s*92dvh;/)
    expect(body).toMatch(/overscroll-behavior:\s*contain;/)
    expect(body).toMatch(/padding:\s*14px 14px calc\(20px \+ env\(safe-area-inset-bottom\)\);/)
    expect(body).toMatch(/will-change:\s*transform, opacity;/)
    expect(body).toMatch(/border-radius:\s*18px 18px 0 0;/)
    expect(ruleBody(DIALOG_CSS, '.biz .pg-settings .st-dlg-scrim.is-sheet')).toMatch(/align-items:\s*flex-end;\s*padding:\s*0;/)
  })
  it('no transition in the sheet rules, and nothing layout is animated anywhere in the sheet', () => {
    expect(ruleBody(DIALOG_CSS, SHEET)).not.toMatch(/transition/)
    expect(ruleBody(DIALOG_CSS, '.biz .pg-settings .st-dlg-scrim.is-sheet')).not.toMatch(/transition/)
    const kf = props(keyframes(DIALOG_CSS, 'st-sheet-up').replace(/\b(from|to)\s*\{/g, '{'))
    for (const p of LAYOUT) expect(kf).not.toContain(p)
  })
  it('the reduced-motion block names `.st-sheet` with `animation: none`', () => {
    const block = reducedBlock(DIALOG_CSS)
    expect(ruleBody(block, SHEET)).toMatch(/^\s*animation:\s*none;\s*$/)
    expect(ruleBody(block, '.biz .pg-settings .st-dlg-scrim')).toMatch(/animation:\s*none;/)
  })
  it('both type rules exclude the sheet, values unchanged', () => {
    expect(ruleBody(DIALOG_CSS, '.biz .pg-settings .st-dlg:not(.st-sheet) h4')).toMatch(/^\s*font-size:\s*14px;\s*font-weight:\s*700;\s*line-height:\s*1\.4;\s*$/)
    expect(ruleBody(DIALOG_CSS, '.biz .pg-settings .st-dlg:not(.st-sheet) p')).toMatch(/^\s*font-size:\s*12px;\s*font-weight:\s*400;\s*line-height:\s*1\.7;\s*$/)
    expect(DIALOG_CSS).not.toMatch(/\.st-dlg (h4|p)\s*\{/)
  })
})

/** ⚖ S63 R235 (rule 10) - the trap's list = what Tab can really reach. Each kind of unreachable control
 *  (a negative tabIndex · inside `aria-hidden="true"` · inside `inert`) sits both BETWEEN and AFTER the
 *  two real controls, so the list, the wrap and the reverse wrap each go wrong if any one kind leaks in. */
function TrapRoom() {
  const markInert = (n: HTMLDivElement | null) => { n?.setAttribute('inert', '') }
  return (
    <div className="page pg-settings">
      <Dialog open onClose={() => {}} labelledBy="tr-t" sheet>
        <h2 id="tr-t">trap</h2>
        <button type="button">first</button>
        <button type="button" tabIndex={-1}>neg-a</button>
        <div aria-hidden="true"><button type="button">hid-a</button></div>
        <div ref={markInert}><button type="button">inert-a</button></div>
        <button type="button">last</button>
        <div ref={markInert}><button type="button">inert-b</button></div>
        <div aria-hidden="true"><button type="button">hid-b</button></div>
        <button type="button" tabIndex={-1}>neg-b</button>
      </Dialog>
    </div>
  )
}
const trapBox = () => document.querySelector('[role="dialog"]') as HTMLElement
const byText = (t: string) => [...trapBox().querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement

describe('d5 - S63 R235: the Tab trap holds only what Tab can reach', () => {
  it('t1 focusablesIn holds neither a negative tabIndex nor anything under aria-hidden / inert', () => {
    render(<TrapRoom />)
    expect(focusablesIn(trapBox()).map((el) => el.textContent)).toEqual(['first', 'last'])
  })
  it('t2 Tab from the last REAL control wraps to the first (default prevented)', () => {
    render(<TrapRoom />)
    byText('last').focus()
    const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })
    expect(notPrevented).toBe(false)
    expect(document.activeElement).toBe(byText('first'))
  })
  it('t3 Shift+Tab from the first lands on the last REAL control, never inside a hidden block', () => {
    render(<TrapRoom />)
    byText('first').focus()
    const notPrevented = fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(notPrevented).toBe(false)
    expect(document.activeElement).toBe(byText('last'))
  })
  /** ⚖ S63 R238 - rule 10 is bounded to the box: an `aria-hidden="true"` / `inert` ancestor ABOVE the box
   *  (here the wrapper around `.page.pg-settings`, the room root the Dialog portals into) hides nothing. */
  function OuterHiddenRoom({ how }: { how: 'aria-hidden' | 'inert' }) {
    const markInert = (n: HTMLDivElement | null) => { if (how === 'inert') n?.setAttribute('inert', '') }
    return (
      <div className="biz-outer" aria-hidden={how === 'aria-hidden' ? 'true' : undefined} ref={markInert}>
        <TrapRoom />
      </div>
    )
  }
  it.each(['aria-hidden', 'inert'] as const)('t6 an ancestor ABOVE the box carrying %s does not empty the list; Tab still wraps', (how) => {
    render(<OuterHiddenRoom how={how} />)
    const outer = document.querySelector('.biz-outer') as HTMLElement
    expect(outer.matches(how === 'inert' ? '[inert]' : '[aria-hidden="true"]')).toBe(true)
    expect(outer.contains(trapBox())).toBe(true)
    expect(focusablesIn(trapBox()).map((el) => el.textContent)).toEqual(['first', 'last'])
    byText('last').focus()
    const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })
    expect(notPrevented).toBe(false)
    expect(document.activeElement).toBe(byText('first'))
  })
})
