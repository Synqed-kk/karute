/**
 * Bottom-bar hit test — which control receives a touch at each point of the
 * bar, measured in a real browser layout (S106 FB7, Greptile on #1131: the
 * jest test pins class strings, not hit geometry). The REAL bottom-nav.tsx
 * with the REAL globals.css, built by build-harness.ts; runs in CI on every
 * pull request (ci.yml, step "Bottom bar hit test").
 *
 * Per engine — Chromium with a 34 px bottom safe area (CDP override), WebKit
 * with 0 — at 393x852 and 440x956, touch emulated (pointer: coarse):
 *  - idle / active-tab / recording-elsewhere: every sampled point of the bar
 *    resolves (elementFromPoint -> nearest a/button) to the control whose
 *    column it is in; above the bar's top edge only the record control owns
 *    points, and it owns its whole 12 px slop box.
 *  - recording-stop (/sessions while recording): no tab owns a point inside
 *    the middle column, and the stop button has no non-zero data-bar-hit.
 *  - mouse-only (no touch, pointer: fine): no data-bar-hit has a non-zero rect.
 *  - every touch state is first proven to BE that state, read from the DOM
 *    bottom-nav.tsx renders (cold read F1: a mock forced idle or an unknown
 *    path otherwise passed as a copy of idle): aria-current="page" on the
 *    tabs, the record control's element (idle <a href=/sessions…> vs the
 *    recording <button>), its mm:ss timer sibling, its data-bar-hit spans,
 *    and the stop control's aria-label (the one Japanese string used).
 *
 * Grid: every 2 px across and down the bar (a 4 px strip always holds a
 * sample), every 1 px in the 40 px above it, plus fractional samples at
 * +-0.25, +-0.6 and +-1 px around each column boundary.
 *
 * Tolerances (evidence: the S106 R6 proof grid and the R6 attack grid, two
 * independent runs; re-measured by this file's HITGRID log lines):
 *  - TOL_X = 1 px (strict): closer than 1 CSS px to a fractional column
 *    boundary either neighbour may own the point. Both engines round the
 *    probe point to a whole CSS px AND snap the span edge to a whole CSS px,
 *    so the two half-pixel errors add: x = boundary - 0.6 is owned by the
 *    right-hand column in Chromium and WebKit alike (measured here at all 16
 *    touch cells; the R6 proof used the same < 1 px band). The +-1 px samples
 *    must be exact, so a real strip of 1 px or more still fails.
 *  - TOL_BOTTOM = 0.5 px: rows in [bottom - 0.5, bottom) are not asserted;
 *    the last asserted row is bottom - 0.51. Chromium rounds y = vh - 0.5 up
 *    to vh, outside the viewport, and elementFromPoint returns null for the
 *    whole row (measured here: every x, all 8 Chromium touch cells; WebKit
 *    resolves it). The y = bottom - 0.5 row is logged (edgeOff), not asserted.
 */
import path from 'node:path'
import fs from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

const HARNESS_OUT = path.resolve(__dirname, '../../node_modules/.cache/bottom-nav-hit-harness')
const TOL_X = 1
const TOL_BOTTOM = 0.5
const SLOP = 12
const VIEWPORTS: [number, number][] = [
  [393, 852],
  [440, 956],
]
const STATES = {
  idle: 'path=/dashboard',
  'active-tab': 'path=/karute',
  'recording-elsewhere': 'path=/dashboard&rec=recording',
  'recording-stop': 'path=/sessions&rec=recording',
} as const

// owner: 0..4 = column of the control hit; -1 = inside the bar, no control;
// -2 = outside the bar (page / null); -3 = a control that is not a column.
type Cell = [x: number, y: number, owner: number]
type Probe = {
  coarse: boolean
  safe: number
  bar: [number, number, number, number]
  bounds: number[]
  rec: [number, number, number, number]
  cells: Cell[]
  edgeRow: Cell[]
  above: Cell[]
  stopHits: number
  nonZeroHits: number
  form: Form
}
// The branch bottom-nav.tsx actually rendered, read from its DOM.
type Form = {
  recTag: string
  recHref: string | null
  stop: boolean
  timer: string | null
  recHitSpans: number
  current: { col: number; href: string | null }[]
}
type State = keyof typeof STATES
const TIMER = /^\d{2,}:\d{2}$/

function assertState(state: State, f: Form) {
  const timerOk = f.timer !== null && TIMER.test(f.timer)
  const msg = `${state}: ${JSON.stringify(f)}`
  if (state === 'idle' || state === 'active-tab') {
    expect(f.recTag, msg + ' (idle record control is the <a>)').toBe('a')
    expect(f.recHref ?? '', msg).toMatch(/^\/sessions/)
    expect(f.stop, msg).toBe(false)
    expect(f.timer, msg + ' (no recording timer)').toBeNull()
    expect(f.recHitSpans, msg).toBeGreaterThan(0)
    expect(f.current, msg + ' (aria-current tabs)').toEqual(
      state === 'idle' ? [] : [{ col: 1, href: '/karute' }],
    )
  } else {
    expect(f.recTag, msg + ' (recording control is the <button>)').toBe('button')
    expect(timerOk, msg + ' (mm:ss recording timer beside the control)').toBe(true)
    expect(f.current, msg + ' (no tab is aria-current)').toEqual([])
    if (state === 'recording-elsewhere') {
      expect(f.stop, msg + ' (not the stop control)').toBe(false)
      expect(f.recHitSpans, msg + ' (keeps its hit spans)').toBeGreaterThan(0)
    } else {
      expect(f.stop, msg + ' (the stop control)').toBe(true)
      expect(f.recHitSpans, msg + ' (stop has no hit spans)').toBe(0)
    }
  }
}

async function open(page: Page, qs: string, safe: number, chromium: boolean) {
  if (chromium && safe) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: safe } })
  }
  await page.route('http://harness.local/**', (r) => {
    const f = path.join(HARNESS_OUT, new URL(r.request().url()).pathname)
    if (!fs.existsSync(f)) return r.fulfill({ status: 404 })
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html'
    return r.fulfill({ body: fs.readFileSync(f), contentType: type })
  })
  // No page.clock: a paused clock starves the rAF/timer waits and hangs WebKit.
  await page.goto('http://harness.local/index.html?' + qs, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav[aria-label="Primary navigation"] a')
  await page.evaluate(
    () =>
      document.fonts.ready.then(
        () => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 300)))),
      ),
  )
}

const probe = (page: Page, tol: { x: number; bottom: number }) =>
  page.evaluate(({ bottom: tolB }): Probe => {
    const nav = document.querySelector('nav[aria-label="Primary navigation"]') as HTMLElement
    const row = nav.querySelector('div.max-w-screen-sm') as HTMLElement
    const cols = Array.from(row.children).filter((k) => k.matches('a,button') || k.querySelector('a,button'))
    if (cols.length !== 5) throw new Error('expected 5 columns, got ' + cols.length)
    const recEl = cols[2].matches('a,button') ? cols[2] : (cols[2].querySelector('a,button') as Element)
    const own = (x: number, y: number) => {
      const e = document.elementFromPoint(x, y)
      if (!e || !nav.contains(e)) return -2
      const c = e.closest('a,button')
      if (!c) return -1
      const i = cols.findIndex((k) => k.contains(c))
      return i < 0 ? -3 : i
    }
    const b = nav.getBoundingClientRect()
    const bounds = cols.slice(0, 4).map((k) => k.getBoundingClientRect().right)
    const r = recEl.getBoundingClientRect()
    const xs: number[] = []
    for (let x = 0; x < innerWidth; x += 2) xs.push(x)
    xs.push(innerWidth - 1)
    for (const q of bounds) xs.push(q - 1, q - 0.6, q - 0.25, q + 0.25, q + 0.6, q + 1)
    const ys: number[] = [b.top, b.top + 0.5, b.bottom - 1, b.bottom - tolB - 0.01]
    for (let y = Math.ceil(b.top); y < b.bottom - tolB; y += 2) ys.push(y)
    const cells: Cell[] = []
    for (const y of ys) for (const x of xs) cells.push([x, y, own(x, y)])
    const edgeRow: Cell[] = xs.map((x) => [x, b.bottom - tolB, own(x, b.bottom - tolB)])
    const above: Cell[] = []
    for (let y = Math.floor(b.top - 40); y <= b.top - 1; y++) for (const x of xs) above.push([x, y, own(x, y)])
    const live = (s: Element) => {
      const q = s.getBoundingClientRect()
      return q.width > 0 && q.height > 0
    }
    const probeEl = document.createElement('div')
    probeEl.style.paddingBottom = 'env(safe-area-inset-bottom)'
    document.body.appendChild(probeEl)
    const safe = parseFloat(getComputedStyle(probeEl).paddingBottom)
    probeEl.remove()
    const timerEl = cols[2].querySelector(':scope > span.tabular-nums')
    const form = {
      recTag: recEl.tagName.toLowerCase(),
      recHref: recEl.getAttribute('href'),
      stop: recEl.getAttribute('aria-label') === '録音を停止',
      timer: timerEl ? (timerEl.textContent ?? '').trim() : null,
      recHitSpans: recEl.querySelectorAll('[data-bar-hit]').length,
      current: Array.from(row.querySelectorAll('[aria-current="page"]')).map((e) => ({
        col: cols.findIndex((k) => k.contains(e)),
        href: e.getAttribute('href'),
      })),
    }
    return {
      form,
      coarse: matchMedia('(pointer: coarse)').matches,
      safe,
      bar: [b.left, b.top, b.right, b.bottom],
      bounds,
      rec: [r.left, r.top, r.right, r.bottom],
      cells,
      edgeRow,
      above,
      stopHits: recEl.getAttribute('aria-label') === '録音を停止' ? Array.from(recEl.querySelectorAll('[data-bar-hit]')).filter(live).length : -1,
      nonZeroHits: Array.from(nav.querySelectorAll('[data-bar-hit]')).filter(live).length,
    }
  }, tol)

function judge(p: Probe, stop: boolean) {
  const fails: string[] = []
  let tolerated = 0
  let maxTolDx = 0
  const col = (x: number) => p.bounds.filter((q) => x >= q).length
  const dx = (x: number) => Math.min(...p.bounds.map((q) => Math.abs(x - q)))
  for (const [x, y, o] of p.cells) {
    const want = col(x)
    const d = dx(x)
    if (stop && want === 2) {
      if ([0, 1, 3, 4].includes(o) && d >= TOL_X) fails.push(`tab ${o} owns middle-column point ${x},${y}`)
      continue
    }
    if (o === want) continue
    if (d < TOL_X && o >= 0 && Math.abs(o - want) === 1) {
      tolerated++
      maxTolDx = Math.max(maxTolDx, d)
      continue
    }
    fails.push(`${x},${y}: owner ${o}, column ${want}`)
  }
  let slopPts = 0
  for (const [x, y, o] of p.above) {
    if (o >= 0 && o !== 2) fails.push(`above bar ${x},${y}: owned by ${o}, only the record control may`)
    const inSlop =
      x >= p.rec[0] - SLOP + TOL_X && x <= p.rec[2] + SLOP - TOL_X && y >= p.rec[1] - SLOP + TOL_X
    if (!stop && inSlop) {
      slopPts++
      if (o !== 2) fails.push(`slop ${x},${y}: owner ${o}, want the record control`)
    }
  }
  if (!stop && slopPts === 0) fails.push('no sampled point in the record slop box')
  const edgeOff = p.edgeRow.filter(([x, , o]) => o !== col(x)).length
  return { fails, tolerated, maxTolDx: +maxTolDx.toFixed(3), slopPts, edgeOff }
}

for (const [w, h] of VIEWPORTS) {
  for (const [state, qs] of Object.entries(STATES)) {
    test(`touch ${w}x${h} ${state}`, async ({ browser, browserName }) => {
      const chromium = browserName === 'chromium'
      const safe = chromium ? 34 : 0
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        hasTouch: true,
        isMobile: chromium,
        deviceScaleFactor: 3,
      })
      try {
        const page = await ctx.newPage()
        await open(page, qs, safe, chromium)
        const p = await probe(page, { x: TOL_X, bottom: TOL_BOTTOM })
        assertState(state as State, p.form)
        const stop = state === 'recording-stop'
        const j = judge(p, stop)
        console.log(
          'HITGRID ' +
            JSON.stringify({ browserName, vp: `${w}x${h}`, state, form: { tag: p.form.recTag, stop: p.form.stop, timer: p.form.timer, hits: p.form.recHitSpans, current: p.form.current }, safe: p.safe, pts: p.cells.length, above: p.above.length, ...j, fails: j.fails.length, first: j.fails.slice(0, 3), bar: p.bar, bounds: p.bounds, rec: p.rec }),
        )
        expect(p.coarse, 'touch context must match pointer: coarse').toBe(true)
        expect(j.fails.slice(0, 12), `${j.fails.length} hit-test failures`).toEqual([])
        if (stop) expect(p.stopHits, 'stop button data-bar-hit children with a non-zero rect').toBe(0)
        expect(p.safe, 'safe-area inset in effect').toBe(safe)
      } finally {
        await ctx.close()
      }
    })
  }
  test(`mouse ${w}x${h} no hit spans`, async ({ browser, browserName }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: false, isMobile: false, deviceScaleFactor: 3 })
    try {
      const page = await ctx.newPage()
      await open(page, STATES.idle, 0, browserName === 'chromium')
      const p = await probe(page, { x: TOL_X, bottom: TOL_BOTTOM })
      console.log('HITGRID ' + JSON.stringify({ browserName, vp: `${w}x${h}`, state: 'mouse', coarse: p.coarse, nonZeroHits: p.nonZeroHits }))
      expect(p.coarse, 'mouse context must not match pointer: coarse').toBe(false)
      expect(p.nonZeroHits, 'data-bar-hit spans with a non-zero rect under a mouse').toBe(0)
    } finally {
      await ctx.close()
    }
  })
}
