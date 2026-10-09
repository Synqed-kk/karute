/**
 * @jest-environment jsdom
 */
/** ⚖ S60 R207 — the room's toast primitive (Toast.tsx): one timer of TOAST_MS,
 *  a second show replaces and restarts, the timer dies with the room, the host
 *  is always present, the same sentence twice is a new node, `show` is stable. */
import { useState } from 'react'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { useToast, TOAST_MS } from '@/app/[locale]/(business)/business/settings/Toast'

const shows: Array<(text: string) => void> = []

function Probe({ text = 'x' }: { text?: string }) {
  const { show, host } = useToast()
  const [, setTick] = useState(0)
  shows.push(show)
  return (
    <div>
      {host}
      <button type="button" onClick={() => show(text)}>go</button>
      <button type="button" onClick={() => setTick((n) => n + 1)}>tick</button>
    </div>
  )
}

const hostOf = (c: HTMLElement) => c.querySelector('.st-toast') as HTMLElement
const tick = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })

beforeEach(() => { jest.useFakeTimers(); shows.length = 0 })
afterEach(() => { cleanup(); jest.useRealTimers() })

describe('⚖ S60 R207 — useToast', () => {
  it('t1 idle: the host is in the DOM, role status, polite, atomic; not on; no text', () => {
    const { container } = render(<Probe />)
    const h = hostOf(container)
    expect(h).not.toBeNull()
    expect(h.getAttribute('role')).toBe('status')
    expect(h.getAttribute('aria-live')).toBe('polite')
    expect(h.getAttribute('aria-atomic')).toBe('true')
    expect(h.classList.contains('is-on')).toBe(false)
    expect(h.textContent).toBe('')
  })

  it('t2 show → text and is-on; still on at TOAST_MS - 1; off at TOAST_MS with the text kept', () => {
    expect(TOAST_MS).toBe(2600)
    const r = render(<Probe text="x" />)
    fireEvent.click(r.getByText('go'))
    const h = hostOf(r.container)
    expect(h.textContent).toBe('x')
    expect(h.classList.contains('is-on')).toBe(true)
    tick(2599)
    expect(h.classList.contains('is-on')).toBe(true)
    tick(1)
    expect(h.classList.contains('is-on')).toBe(false)
    expect(h.textContent).toBe('x')
  })

  it('t3 a second show at 2000 ms replaces the text and restarts the timer', () => {
    const r = render(<Probe text="first" />)
    fireEvent.click(r.getByText('go'))
    tick(2000)
    r.rerender(<Probe text="second" />)
    fireEvent.click(r.getByText('go'))
    const h = hostOf(r.container)
    expect(h.textContent).toBe('second')
    tick(2599)
    expect(h.classList.contains('is-on')).toBe(true)
    tick(1)
    expect(h.classList.contains('is-on')).toBe(false)
  })

  it('t4 unmount with the timer pending leaves no timer', () => {
    const r = render(<Probe />)
    fireEvent.click(r.getByText('go'))
    expect(jest.getTimerCount()).toBe(1)
    r.unmount()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('t5 the same text twice is a new span node', () => {
    const r = render(<Probe text="same" />)
    fireEvent.click(r.getByText('go'))
    const first = hostOf(r.container).querySelector('span')
    fireEvent.click(r.getByText('go'))
    const second = hostOf(r.container).querySelector('span')
    expect(second?.textContent).toBe('same')
    expect(second).not.toBe(first)
  })

  it('t6 show keeps one identity across renders', () => {
    const r = render(<Probe />)
    fireEvent.click(r.getByText('tick'))
    expect(shows.length).toBeGreaterThanOrEqual(2)
    expect(shows[shows.length - 1]).toBe(shows[0])
  })
})

// S60 P7A-R3 F-7 — the toast's light card and its level, pinned at the source (attack F6 / N5)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
describe('S60 P7A-R3 F-7 — toast.css: a light card at level 56', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/settings/toast.css'), 'utf8')
  const rule = css.match(/\.biz \.pg-settings \.st-toast \{([^}]*)\}/)?.[1] ?? ''
  it('the toast rule carries background #fff, color var(--ink), z-index 56', () => {
    expect(rule).toMatch(/(^|[\s;])background: #fff;/)
    expect(rule).toMatch(/(^|[\s;])color: var\(--ink\);/)
    expect(rule).toMatch(/(^|[\s;])z-index: 56;/)
  })
})
