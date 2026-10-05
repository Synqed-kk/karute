/**
 * @jest-environment jsdom
 */
/** ⚖ R93 + R70 (S50 P5c) — the room's shared Switch and ONE dialog primitive,
 *  and the end of width-driven touch sizing. Behaviour pins: what a user (and
 *  assistive tech) meets, not the source text. jsdom cannot see scrim
 *  containment or thumb travel — that is R104's browser look. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useRef, useState, type ReactNode } from 'react'
import postcss from 'postcss'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { Switch } from '@/app/[locale]/(business)/business/settings/Switch'
import { Dialog, focusablesIn } from '@/app/[locale]/(business)/business/settings/Dialog'

const ROOM_DIR = 'src/app/[locale]/(business)/business/settings'
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const SETTINGS_CSS = strip(readFileSync(join(process.cwd(), ROOM_DIR, 'settings.css'), 'utf8'))
const SWITCH_CSS = strip(readFileSync(join(process.cwd(), ROOM_DIR, 'switch.css'), 'utf8'))

const switchSheet = () => postcss.parse(readFileSync(join(process.cwd(), ROOM_DIR, 'switch.css'), 'utf8'))
/** The switch's px tokens: the top-level `.st-switch` rule, overlaid by the coarse one. */
function switchTokens(coarse: boolean): Record<string, number> {
  const out: Record<string, number> = {}
  const take = (r: postcss.Rule) => r.walkDecls(/^--st-sw-/, (d) => { if (/^\d+(\.\d+)?px$/.test(d.value)) out[d.prop] = parseFloat(d.value) })
  const sheet = switchSheet()
  sheet.walkRules('.biz .pg-settings .st-switch', (r) => { if (r.parent?.type === 'root') take(r) })
  if (coarse) sheet.walkAtRules('media', (m) => { if (/pointer:\s*coarse/.test(m.params)) m.walkRules('.biz .pg-settings .st-switch', take) })
  return out
}
/** Evaluate a `calc(...)` of `var(--x)` px tokens and integers — the arithmetic only. */
function evalCalc(expr: string, tokens: Record<string, number>): number {
  const body = expr.replace(/^calc\((.*)\)$/, '$1').replace(/var\((--[\w-]+)\)/g, (_m, n: string) => {
    if (!(n in tokens)) throw new Error(`unknown token ${n}`)
    return String(tokens[n])
  })
  if (!/^[\d\s.+\-*/()]+$/.test(body)) throw new Error(`not arithmetic: ${body}`)
  return Function(`return (${body})`)() as number
}

afterEach(cleanup)

describe('⚖ R93 — the shared Switch', () => {
  function Harness({ locked = false }: { locked?: boolean }) {
    const [on, setOn] = useState(false)
    return (
      <Switch
        on={on}
        aria="受付"
        onLabel="オン"
        offLabel="オフ"
        inert={locked ? { 'aria-disabled': 'true', title: 'locked' } : {}}
        reduced
        onToggle={locked ? undefined : () => setOn((v) => !v)}
      />
    )
  }

  it('is a switch with a name, whose aria-checked follows the value', () => {
    const { getByRole, container } = render(<Harness />)
    const sw = getByRole('switch', { name: '受付' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(container.querySelector('.st-state')?.textContent).toBe('オフ')
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('.st-state')?.textContent).toBe('オン')
  })

  it('is keyboard-operable: a native button in the tab order (Enter/Space press it)', () => {
    const { getByRole } = render(<Harness />)
    const sw = getByRole('switch')
    expect(sw.tagName).toBe('BUTTON')
    expect(sw.getAttribute('type')).toBe('button')
    expect(sw.tabIndex).toBe(0)
    sw.focus()
    expect(document.activeElement).toBe(sw)
  })

  it('locked: still reachable (aria-disabled, not disabled), and a press changes nothing', () => {
    const { getByRole } = render(<Harness locked />)
    const sw = getByRole('switch')
    expect(sw.getAttribute('aria-disabled')).toBe('true')
    expect(sw.hasAttribute('disabled')).toBe(false)
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('labelled by a visible field label when one is given', () => {
    const { getByRole } = render(
      <>
        <span id="lbl">24:00閉店</span>
        <Switch on ariaLabelledBy="lbl" inert={{}} reduced />
      </>,
    )
    const sw = getByRole('switch', { name: '24:00閉店' })
    expect(sw.hasAttribute('aria-label')).toBe(false)
  })
})

describe('⚖ R93 — the ONE dialog primitive', () => {
  function Room({ onClose = () => {}, onParentKey = () => {} }: { onClose?: () => void; onParentKey?: () => void }) {
    const [open, setOpen] = useState(false)
    const keep = useRef<HTMLButtonElement>(null)
    return (
      <div className="biz">
        <div className="page pg-settings">
          <div className="st-body">
            <div className="st-main" onKeyDown={onParentKey}>
              <button type="button" onClick={() => setOpen(true)}>open</button>
              <Dialog open={open} onClose={() => { onClose(); setOpen(false) }} labelledBy="dlg-t" initialFocus={keep}>
                <h2 id="dlg-t">title</h2>
                <button type="button">reset</button>
                <button type="button" ref={keep}>keep</button>
                <button type="button" disabled>off</button>
              </Dialog>
            </div>
          </div>
        </div>
      </div>
    )
  }
  const openIt = () => {
    const r = render(<Room />)
    const opener = r.getByText('open')
    opener.focus()
    fireEvent.click(opener)
    return { ...r, opener }
  }

  it('portals to the room root, outside .st-body / .st-main', () => {
    const { getByRole, container } = openIt()
    const dlg = getByRole('dialog', { name: 'title' })
    const root = container.querySelector('.page.pg-settings')
    expect(dlg.parentElement?.parentElement).toBe(root)
    expect(dlg.closest('.st-main')).toBeNull()
    expect(dlg.closest('.st-body')).toBeNull()
    expect(dlg.getAttribute('aria-modal')).toBe('true')
  })

  it('initial focus = the prop', () => {
    const { getByText } = openIt()
    expect(document.activeElement).toBe(getByText('keep'))
  })

  it('the Tab trap skips a disabled control at either end', () => {
    const { getByText, getByRole } = openIt()
    expect(focusablesIn(getByRole('dialog')).map((b) => b.textContent)).toEqual(['reset', 'keep'])
    getByText('keep').focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(getByText('reset'))
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(getByText('keep'))
  })

  it('Esc closes it and stops there: neither a React ancestor nor a document listener hears it', () => {
    const onClose = jest.fn()
    const onParentKey = jest.fn()
    const docKey = jest.fn()
    document.addEventListener('keydown', docKey)
    const r = render(<Room onClose={onClose} onParentKey={onParentKey} />)
    fireEvent.click(r.getByText('open'))
    fireEvent.keyDown(r.getByText('keep'), { key: 'Escape' })
    document.removeEventListener('keydown', docKey)
    expect({ closed: onClose.mock.calls.length, parent: onParentKey.mock.calls.length, doc: docKey.mock.calls.length })
      .toEqual({ closed: 1, parent: 0, doc: 0 })
    expect(r.queryByRole('dialog')).toBeNull()
  })

  it('focus returns to the opener on close', () => {
    const { getByText, opener, queryByRole } = openIt()
    act(() => { fireEvent.keyDown(getByText('keep'), { key: 'Escape' }) })
    expect(queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('R112: a click on the scrim itself closes it, through the same path, and focus returns to the opener', () => {
    const onClose = jest.fn()
    const r = render(<Room onClose={onClose} />)
    const opener = r.getByText('open')
    opener.focus()
    fireEvent.click(opener)
    const scrim = r.getByRole('dialog').parentElement as HTMLElement
    act(() => { fireEvent.mouseDown(scrim); fireEvent.mouseUp(scrim); fireEvent.click(scrim) })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(r.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('R112: a click inside the panel never closes it (on a control, on the panel, or keyboard-activated)', () => {
    const onClose = jest.fn()
    const r = render(<Room onClose={onClose} />)
    fireEvent.click(r.getByText('open'))
    const dlg = r.getByRole('dialog')
    fireEvent.mouseDown(r.getByText('reset')); fireEvent.click(r.getByText('reset'))
    fireEvent.mouseDown(dlg); fireEvent.click(dlg)
    fireEvent.click(r.getByText('keep'))
    expect(onClose).not.toHaveBeenCalled()
    expect(r.getByRole('dialog')).toBeTruthy()
  })

  it('R112: a press that starts in the panel and is released over the scrim does not close it', () => {
    const onClose = jest.fn()
    const r = render(<Room onClose={onClose} />)
    fireEvent.click(r.getByText('open'))
    const dlg = r.getByRole('dialog')
    fireEvent.mouseDown(r.getByText('reset'))
    fireEvent.click(dlg.parentElement as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
    expect(r.getByRole('dialog')).toBeTruthy()
  })
})

describe('⚖ R70 — 44px is a hit area under (pointer: coarse), never a width rule', () => {
  /** Every `@media (...)` block whose query names max-width, brace-matched. */
  const maxWidthBlocks = (css: string): string[] => {
    const out: string[] = []
    const re = /@media[^{]*max-width[^{]*\{/g
    for (let m = re.exec(css); m; m = re.exec(css)) {
      let depth = 1
      let i = m.index + m[0].length
      for (; i < css.length && depth > 0; i += 1) {
        if (css[i] === '{') depth += 1
        else if (css[i] === '}') depth -= 1
      }
      out.push(css.slice(m.index, i))
    }
    return out
  }

  it.each([['settings.css', SETTINGS_CSS], ['switch.css', SWITCH_CSS]])('%s: no max-width rule sets height/min-height ≥ 44px', (_name, css) => {
    const offenders = maxWidthBlocks(css).flatMap((b) =>
      [...b.matchAll(/(?:^|[;{\s])((?:min-)?height):\s*(\d+(?:\.\d+)?)px/g)]
        .filter((d) => Number(d[2]) >= 44)
        .map((d) => `${d[1]}: ${d[2]}px`),
    )
    expect(offenders).toEqual([])
  })

  it('the coarse band carries the floor, and the switch draws its touch size only there', () => {
    expect(SETTINGS_CSS).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\.st-rail-item,[\s\S]*?min-height: 44px/)
    // the switch's size is its tokens: 42×24 fine, 68×44 only under (pointer: coarse)
    expect(switchTokens(false)).toMatchObject({ '--st-sw-w': 42, '--st-sw-h': 24 })
    expect(switchTokens(true)).toMatchObject({ '--st-sw-w': 68, '--st-sw-h': 44 })
    // …and settings.css no longer states the switch's box anywhere (one home)
    expect(SETTINGS_CSS).not.toMatch(/\.st-switch(?:-thumb)? \{/)
  })
})

describe('⚖ S54 R165(4) — the thumb travel is a CSS calc of the track tokens; nothing is measured (attack S1)', () => {
  const thumbDecl = (prop: string) => {
    let v = ''
    switchSheet().walkRules('.biz .pg-settings .st-switch-thumb', (r) => r.walkDecls(prop, (d) => { v = d.value }))
    return v
  }
  const travelCalc = () => {
    let v = ''
    switchSheet().walkRules('.biz .pg-settings .st-switch', (r) => { if (r.parent?.type === 'root') r.walkDecls('--st-sw-travel', (d) => { v = d.value }) })
    return v
  }

  it('the thumb rides --st-sw-p over the calc; the track, thumb and inset all read the same tokens', () => {
    expect(thumbDecl('transform')).toBe('translateX(calc(var(--st-sw-travel) * var(--st-sw-p, 0)))')
    expect(thumbDecl('left')).toBe('var(--st-sw-inset)')
    expect(thumbDecl('width')).toBe('var(--st-sw-thumb)')
    expect(travelCalc()).toBe('calc(var(--st-sw-w) - 2 * var(--st-sw-border) - var(--st-sw-thumb) - 2 * var(--st-sw-inset))')
  })

  /** S54 P5c-R5c (S1): the TRACK's own box reads the tokens too. Mutant `width: 42px`
   *  in place of the var left every other pin green while the coarse track stayed 42. */
  const topSwitchDecl = (prop: string) => {
    const vs: string[] = []
    switchSheet().walkRules('.biz .pg-settings .st-switch', (r) => { if (r.parent?.type === 'root') r.walkDecls(prop, (d) => { vs.push(d.value) }) })
    return vs
  }
  it('the track width / height / border-width read --st-sw-w / --st-sw-h / --st-sw-border', () => {
    expect(topSwitchDecl('width')).toEqual(['var(--st-sw-w)'])
    expect(topSwitchDecl('height')).toEqual(['var(--st-sw-h)'])
    const border = [...topSwitchDecl('border'), ...topSwitchDecl('border-width')]
    expect(border).toHaveLength(1)
    expect(border[0].split(/\s+/)[0]).toBe('var(--st-sw-border)')
  })
  it('the thumb width / height / top / left read the thumb and inset tokens', () => {
    expect(thumbDecl('width')).toBe('var(--st-sw-thumb)')
    expect(thumbDecl('height')).toBe('var(--st-sw-thumb)')
    expect(thumbDecl('top')).toBe('var(--st-sw-inset)')
    expect(thumbDecl('left')).toBe('var(--st-sw-inset)')
  })
  it('the coarse block restates ONLY switch tokens on .st-switch (no width/height literal)', () => {
    const TOKENS = new Set(['--st-sw-w', '--st-sw-h', '--st-sw-border', '--st-sw-thumb', '--st-sw-inset'])
    const props: string[] = []
    switchSheet().walkAtRules('media', (m) => {
      if (!/\(\s*pointer:\s*coarse\s*\)/i.test(m.params)) return
      m.walkRules(/\.st-switch(?![-\w])/, (r) => r.walkDecls((d) => { props.push(d.prop) }))
    })
    expect(props.length).toBeGreaterThan(0)
    expect(props.filter((p) => !TOKENS.has(p.toLowerCase()))).toEqual([])
  })

  it.each([
    ['fine: 42 track − 2×1 border − 18 thumb − 2×2 inset', false, 18],
    ['coarse: 68 track − 2×1 border − 34 thumb − 2×4 inset', true, 24],
  ])('%s (coarse=%s) = travel %ipx, and the far gap equals the near gap (never flush right)', (_n, coarse, travel) => {
    const t = switchTokens(coarse)
    expect(evalCalc(travelCalc(), t)).toBe(travel)
    // the thumb's far edge at full travel, against the track's inner right edge
    const inner = t['--st-sw-w'] - 2 * t['--st-sw-border']
    expect(inner - (t['--st-sw-inset'] + travel + t['--st-sw-thumb'])).toBe(t['--st-sw-inset'])
  })

  function Flip({ start }: { start: boolean }) {
    const [on, setOn] = useState(start)
    return <Switch on={on} aria="s" inert={{}} reduced onToggle={() => setOn((v) => !v)} />
  }
  const p = (c: HTMLElement) => (c.querySelector('.st-switch-thumb') as HTMLElement).style.getPropertyValue('--st-sw-p')

  it('mounts ON at progress 1 and flips 0/1 WITHOUT reading a single size (a hidden mount cannot go wrong)', () => {
    const reads = [
      jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get'),
      jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get'),
      jest.spyOn(Element.prototype, 'getBoundingClientRect'),
      jest.spyOn(window, 'getComputedStyle'),
    ]
    try {
      const a = render(<Flip start />)
      expect(Number(p(a.container))).toBe(1)
      fireEvent.click(a.container.querySelector('.st-switch') as HTMLElement)
      expect(Number(p(a.container))).toBe(0)
      a.unmount()
      const b = render(<Flip start={false} />)
      expect(Number(p(b.container))).toBe(0)
      fireEvent.click(b.container.querySelector('.st-switch') as HTMLElement)
      expect(Number(p(b.container))).toBe(1)
      for (const spy of reads) expect(spy).not.toHaveBeenCalled()
    } finally { for (const spy of reads) spy.mockRestore() }
  })
})

describe('⚖ S52 R4 — the dialog: focus, keys and scrim, wherever focus is', () => {
  function Box({ onClose = () => {}, pick, kids }: { onClose?: () => void; pick?: string; kids: (r: (n: string) => (el: HTMLElement | null) => void) => ReactNode }) {
    const [open, setOpen] = useState(false)
    const refs = useRef<Record<string, HTMLElement | null>>({})
    const initial = useRef<HTMLElement | null>(null)
    const reg = (n: string) => (el: HTMLElement | null) => { refs.current[n] = el; if (n === pick) initial.current = el }
    return (
      <div className="biz">
        <div className="page pg-settings">
          <button type="button" onClick={() => setOpen(true)}>open</button>
          <button type="button" onClick={() => setOpen(true)}>open2</button>
          <Dialog open={open} onClose={() => { onClose(); setOpen(false) }} labelledBy="t" initialFocus={pick ? initial : undefined}>
            <h2 id="t">title</h2>
            {kids(reg)}
          </Dialog>
        </div>
      </div>
    )
  }
  const show = (ui: ReactNode, opener = 'open') => {
    const r = render(<>{ui}</>)
    const o = r.getByText(opener)
    o.focus()
    fireEvent.click(o)
    return r
  }
  const names = (r: ReturnType<typeof render>) => focusablesIn(r.getByRole('dialog')).map((e) => e.textContent || e.getAttribute('name'))

  it('focusablesIn skips [hidden] subtrees, display:none (self or ancestor), visibility:hidden and input[type=hidden] (M1, NIT 4)', () => {
    const r = show(<Box kids={() => (<>
      <div hidden><button type="button">in-hidden</button></div>
      <button type="button" style={{ display: 'none' }}>none</button>
      <div style={{ display: 'none' }}><button type="button">none-parent</button></div>
      <button type="button" style={{ visibility: 'hidden' }}>invisible</button>
      <input type="hidden" name="h" />
      {/* author CSS that overrides the UA's display:none must not resurrect either */}
      <div hidden style={{ display: 'block' }}><button type="button">hidden-but-styled</button></div>
      <input type="hidden" name="h2" style={{ display: 'inline-block' }} />
      <button type="button">a</button>
      <input name="b" />
    </>)} />)
    expect(names(r)).toEqual(['a', 'b'])
    expect(document.activeElement?.textContent).toBe('a')
  })

  it.each([
    ['disabled (M2)', <button key="x" type="button" disabled>x</button>],
    ['inside [hidden] (attack 4)', <div key="x" hidden><button type="button">x</button></div>],
    ['display:none', <button key="x" type="button" style={{ display: 'none' }}>x</button>],
  ])('an initialFocus that is %s falls back to the first focusable in the panel, never stays behind', (_n, el) => {
    const r = show(<Box pick="x" kids={(reg) => (<>
      {/* the wanted node: the fixture tags it through a ref callback on its first control */}
      <span ref={(s) => { const c = s?.querySelector('button') ?? null; reg('x')(c as HTMLElement | null) }}>{el}</span>
      <button type="button">first</button>
    </>)} />)
    expect(document.activeElement).toBe(r.getByText('first'))
    expect(r.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('Tab and shift-Tab from OUTSIDE the panel are pulled back in (M6)', () => {
    const r = show(<Box kids={() => (<><button type="button">one</button><button type="button">two</button></>)} />)
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(r.getByText('two'))
    r.getByText('open').focus()
    fireEvent.keyDown(r.getByText('open'), { key: 'Tab' })
    expect(document.activeElement).toBe(r.getByText('one'))
  })

  it('Esc with focus outside the panel still closes it, and still stops there (NIT 5)', () => {
    const onClose = jest.fn()
    const docKey = jest.fn()
    document.addEventListener('keydown', docKey)
    const r = show(<Box onClose={onClose} kids={() => <button type="button">one</button>} />)
    ;(document.activeElement as HTMLElement).blur()
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    document.removeEventListener('keydown', docKey)
    expect({ closed: onClose.mock.calls.length, doc: docKey.mock.calls.length }).toEqual({ closed: 1, doc: 0 })
    expect(r.queryByRole('dialog')).toBeNull()
  })

  it('Esc during IME composition belongs to the IME: the dialog stays open (NIT 6)', () => {
    const onClose = jest.fn()
    const r = show(<Box onClose={onClose} kids={() => <input name="n" />} />)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', keyCode: 229 })
    expect(onClose).not.toHaveBeenCalled()
    expect(r.getByRole('dialog')).toBeTruthy()
  })

  it('a scrim close needs the press to START on the scrim too (NIT 8)', () => {
    const onClose = jest.fn()
    const r = show(<Box onClose={onClose} kids={() => <button type="button">one</button>} />)
    const scrim = r.getByRole('dialog').parentElement as HTMLElement
    fireEvent.click(scrim) // no press began anywhere
    // a panel control that cancels pointerdown suppresses mousedown; pointerdown still tells
    fireEvent.pointerDown(r.getByText('one')); fireEvent.click(scrim)
    expect(onClose).not.toHaveBeenCalled()
    act(() => { fireEvent.pointerDown(scrim); fireEvent.pointerUp(scrim); fireEvent.click(scrim) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the opener is captured fresh on every open: focus returns to the second opener', () => {
    const r = show(<Box kids={() => <button type="button">one</button>} />)
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    expect(document.activeElement).toBe(r.getByText('open'))
    const o2 = r.getByText('open2'); o2.focus(); fireEvent.click(o2)
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    expect(document.activeElement).toBe(o2)
  })
})

describe('⚖ S52 R4 — only transform/opacity animate; reduced motion collapses them (M11, NIT 9)', () => {
  const sheet = (n: string) => postcss.parse(readFileSync(join(process.cwd(), ROOM_DIR, n), 'utf8'))
  const ALLOWED = /^(transform|opacity)$/
  it.each([['switch.css'], ['dialog.css']])('%s: every transition and keyframe touches only transform/opacity', (n) => {
    const bad: string[] = []
    sheet(n).walkDecls(/^transition(-property)?$/, (d) => {
      if (d.value.trim() === 'none') return
      for (const part of d.value.split(',')) if (!ALLOWED.test(part.trim().split(/\s+/)[0])) bad.push(`${d.prop}: ${d.value}`)
    })
    sheet(n).walkAtRules('keyframes', (k) => k.walkDecls((d) => { if (!ALLOWED.test(d.prop)) bad.push(`@keyframes ${k.params} ${d.prop}`) }))
    expect(bad).toEqual([])
  })
  it('under prefers-reduced-motion the scrim fade is gone and the switch has no transition', () => {
    const found: Record<string, string> = {}
    for (const n of ['switch.css', 'dialog.css']) {
      sheet(n).walkAtRules('media', (m) => {
        if (!/prefers-reduced-motion:\s*reduce/.test(m.params)) return
        m.walkRules((r) => r.walkDecls((d) => { for (const s of r.selectors) found[`${s.trim()} ${d.prop}`] = d.value }))
      })
    }
    expect(found['.biz .pg-settings .st-dlg-scrim animation']).toBe('none')
    expect(found['.biz .pg-settings .st-switch transition']).toBe('none')
  })
})

describe('⚖ S54 R165 — scrim release, the dialog stack, the live onClose, the fresh opener', () => {
  function One({ onClose = () => {}, autoKid = false }: { onClose?: () => void; autoKid?: boolean }) {
    const [open, setOpen] = useState(false)
    return (
      <div className="biz">
        <div className="page pg-settings">
          <button type="button" onClick={() => setOpen(true)}>open</button>
          <Dialog open={open} onClose={() => { onClose(); setOpen(false) }} labelledBy="t1">
            <h2 id="t1">title</h2>
            <button type="button" autoFocus={autoKid}>one</button>
          </Dialog>
        </div>
      </div>
    )
  }
  const openOne = (ui: ReactNode) => {
    const r = render(<>{ui}</>)
    const o = r.getByText('open'); o.focus(); fireEvent.click(o)
    return { r, o, scrim: () => r.getByRole('dialog').parentElement as HTMLElement }
  }

  it('(1) start on the scrim, release in the panel → stays open', () => {
    const onClose = jest.fn()
    const { r, scrim } = openOne(<One onClose={onClose} />)
    const s = scrim()
    act(() => { fireEvent.pointerDown(s); fireEvent.mouseDown(s); fireEvent.pointerUp(r.getByText('one')); fireEvent.mouseUp(r.getByText('one')); fireEvent.click(s) })
    expect(onClose).not.toHaveBeenCalled()
    expect(r.getByRole('dialog')).toBeTruthy()
  })
  it('(1) start in the panel, release on the scrim → stays open', () => {
    const onClose = jest.fn()
    const { r, scrim } = openOne(<One onClose={onClose} />)
    const s = scrim()
    act(() => { fireEvent.pointerDown(r.getByText('one')); fireEvent.mouseDown(r.getByText('one')); fireEvent.pointerUp(s); fireEvent.mouseUp(s); fireEvent.click(s) })
    expect(onClose).not.toHaveBeenCalled()
    expect(r.getByRole('dialog')).toBeTruthy()
  })
  it('(1) start AND release on the scrim → closes, once', () => {
    const onClose = jest.fn()
    const { r, scrim } = openOne(<One onClose={onClose} />)
    const s = scrim()
    act(() => { fireEvent.pointerDown(s); fireEvent.mouseDown(s); fireEvent.pointerUp(s); fireEvent.mouseUp(s); fireEvent.click(s) })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(r.queryByRole('dialog')).toBeNull()
  })

  /** A opens B from inside itself; both stay mounted while open. */
  function Two({ log, showB = true }: { log: string[]; showB?: boolean }) {
    const [a, setA] = useState(false)
    const [b, setB] = useState(false)
    return (
      <div className="biz">
        <div className="page pg-settings">
          <button type="button" onClick={() => setA(true)}>openA</button>
          <Dialog open={a} onClose={() => { log.push('A'); setA(false) }} labelledBy="ta">
            <h2 id="ta">A</h2>
            <button type="button">a1</button>
            <button type="button" onClick={() => setB(true)}>openB</button>
          </Dialog>
          {showB && (
            <Dialog open={b} onClose={() => { log.push('B'); setB(false) }} labelledBy="tb">
              <h2 id="tb">B</h2>
              <button type="button">b1</button>
              <button type="button">b2</button>
            </Dialog>
          )}
        </div>
      </div>
    )
  }
  const openTwo = (log: string[]) => {
    const r = render(<Two log={log} />)
    const oa = r.getByText('openA'); oa.focus(); fireEvent.click(oa)
    const ob = r.getByText('openB'); ob.focus(); fireEvent.click(ob)
    return r
  }
  const esc = () => act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }) })

  it('(3) two open: one Esc closes ONLY the top; the lower one stays, gets focus back on its opener, and takes the next Esc', () => {
    const log: string[] = []
    const r = openTwo(log)
    expect(r.getAllByRole('dialog')).toHaveLength(2)
    esc()
    expect(log).toEqual(['B'])
    expect(r.getAllByRole('dialog')).toHaveLength(1)
    expect(document.activeElement).toBe(r.getByText('openB'))
    esc()
    expect(log).toEqual(['B', 'A'])
    expect(r.queryByRole('dialog')).toBeNull()
  })
  it('(3) two open: Tab cycles inside the top only, both ways', () => {
    const r = openTwo([])
    const b1 = r.getByText('b1'); const b2 = r.getByText('b2')
    expect(document.activeElement).toBe(b1)
    // Tab from a middle control is the browser's own move: no trap (A's least of all) cancels it
    expect(fireEvent.keyDown(b1, { key: 'Tab' })).toBe(true)
    expect(document.activeElement).toBe(b1)
    b2.focus()
    fireEvent.keyDown(b2, { key: 'Tab' })
    expect(document.activeElement).toBe(b1)
    fireEvent.keyDown(b1, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(b2)
  })
  it('(3) two open: the lower scrim does not close anything while it is not on top', () => {
    const log: string[] = []
    const r = openTwo(log)
    const lower = r.getAllByRole('dialog')[0].parentElement as HTMLElement
    act(() => { fireEvent.pointerDown(lower); fireEvent.pointerUp(lower); fireEvent.click(lower) })
    expect(log).toEqual([])
  })
  it('(3) unmounting the top without a close pops it: the lower one hears the next Esc', () => {
    const log: string[] = []
    const r = openTwo(log)
    r.rerender(<Two log={log} showB={false} />)
    expect(r.getAllByRole('dialog')).toHaveLength(1)
    esc()
    expect(log).toEqual(['A'])
    expect(r.queryByRole('dialog')).toBeNull()
  })

  it('(5) onClose is read live: swap it while open, Esc calls the NEW one only', () => {
    const first = jest.fn(); const second = jest.fn()
    function Swap({ cb }: { cb: () => void }) {
      return (
        <div className="biz"><div className="page pg-settings">
          <Dialog open onClose={cb} labelledBy="ts"><h2 id="ts">t</h2><button type="button">x</button></Dialog>
        </div></div>
      )
    }
    const r = render(<Swap cb={first} />)
    r.rerender(<Swap cb={second} />)
    esc()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('(5) a reopen captures the opener before an autoFocus child steals focus: Esc returns focus to the opener', () => {
    const { r, o } = openOne(<One autoKid />)
    esc()
    expect(document.activeElement).toBe(o)
    o.focus(); fireEvent.click(o)
    expect(document.activeElement).toBe(r.getByText('one'))
    esc()
    expect(document.activeElement).toBe(o)
  })
})
