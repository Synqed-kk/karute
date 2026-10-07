// The 今日の運営 whole-day axis — the HAND-RUN browser proof (⚖ 10/7 S25-1 / S25-2, D6 (b)). READ-ONLY by construction:
// it navigates, waits, measures and screenshots. It never drags, never moves the mouse, never presses a card, offer,
// cell or save control. The ONLY click is the sidebar's own rail toggle (「メニューを開閉」, a localStorage preference in
// this throwaway browser context — nothing is written to the business). The store is chosen by the page's own
// `?store=<id>` query param, so the store picker is never pressed either.
//
// NOT part of `test:e2e`: playwright.config's testDir is e2e/ and this file sits in scripts/ next to
// playwright-login.ts, so only a person running it by hand runs it:
//   PORT=<after port> [BEFORE_PORT=<a second server on an origin/main copy>] STATE=<storageState json> OUT=<dir> \
//     node scripts/today-axis-proof.mjs
//
// The servers it reads (no value is written here, and none belongs in this file): a LOCAL `next dev -p <port>` (or
// `next build` + `next start -p <port>`) of this worktree, started in a subshell that sources the repo's local env
// file into THAT PROCESS ONLY (`set -a; . <the env file>; set +a`), unsets VERCEL_ENV and exports
// BUSINESS_PRACTICE_TENANT=<the Dev Salon's tenant id> — practice mode on the Dev Salon. STATE is a Playwright
// storageState minted by scripts/playwright-login.ts against the same port (gitignored .auth/). Never point it at a
// deployed Business URL; never run it against anything but the practice tenant.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const PORT = process.env.PORT
if (!PORT) throw new Error('PORT is required (the local server of this worktree)')
const BEFORE_PORT = process.env.BEFORE_PORT ?? null
const STATE = process.env.STATE ?? '.auth/dev-user.json'
const OUT = process.env.OUT ?? join(tmpdir(), 'today-axis-proof')
mkdirSync(OUT, { recursive: true })

const STORES = { gym: 'c33e4c43-bc3b-4470-ac22-aa60fecdabe3', jiyugaoka: '0e8fd5dd-8da6-48c4-9ad2-2ab305aa907c' }
// [store, viewport width, sidebar wanted ('open' | 'collapsed' | 'default')]
const RUNS = [
  ['gym', 1280, 'open'], ['gym', 1180, 'open'], ['gym', 1280, 'collapsed'],
  ['jiyugaoka', 1280, 'open'], ['jiyugaoka', 1180, 'open'],
  ['gym', 1023, 'default'], ['jiyugaoka', 1023, 'default'],
]
const HEIGHT = 900
const SCROLL_PROBE = 200 // the scrollLeft the sticky / ruler checks set on the scroll box (a client-side scroll only)

/** Everything read off the page, in one evaluate. `probe` = scrollLeft to apply for the sticky/ruler check. */
function readBoard(probe) {
  const r = (e) => (e ? e.getBoundingClientRect() : null)
  const box = document.querySelector('.timeline-scroll')
  const timeline = box?.querySelector('.timeline')
  const hours = [...document.querySelectorAll('.time-head .hours span')]
  const edge = hours.find((s) => s.classList.contains('edge')) ?? null
  const cols = hours.filter((s) => !s.classList.contains('edge'))
  const label13 = cols.find((s) => s.textContent.trim() === '13') ?? null
  const laneLabel = document.querySelector('.lane-label')
  const nowLine = document.querySelector('.now-line')
  const textW = (el) => { if (!el) return null; const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); if (!t) return null; const g = document.createRange(); g.selectNodeContents(t); const w = g.getBoundingClientRect().width
    // the family name = the text before the first space (half- or full-width), measured as rendered on this page
    const cut = t.textContent.search(/[ \u3000]/); const f = document.createRange(); f.setStart(t, 0); f.setEnd(t, cut < 0 ? t.textContent.length : cut)
    return { text: t.textContent, w, family: t.textContent.slice(0, cut < 0 ? undefined : cut), familyW: f.getBoundingClientRect().width } }
  const fullW = (el) => { if (!el) return null; const g = document.createRange(); g.selectNodeContents(el); return g.getBoundingClientRect().width }
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'
  const type = (el) => { if (!el) return null; const c = getComputedStyle(el); return { size: c.fontSize, weight: c.fontWeight, family: c.fontFamily } }
  const cells = Number(timeline ? getComputedStyle(timeline).getPropertyValue('--board-cells') : NaN)
  const track = r(document.querySelector('.time-head .hours'))
  const cellPx = track && cells ? track.width / cells : null
  const cards = [...document.querySelectorAll('.event[data-book]')].map((e) => {
    const s = e.querySelector(':scope > strong'); const t = e.querySelector(':scope > .e-time'); const k = e.querySelector(':scope > .e-tkt')
    return {
      w: +r(e).width.toFixed(2), min: cellPx ? Math.round((r(e).width / cellPx) * 30) : null,
      name: textW(s), strongText: s?.textContent ?? null, nameScroll: s?.scrollWidth ?? null, nameClient: s?.clientWidth ?? null,
      time: t?.textContent.trim() ?? null, timeShown: shown(t), timeW: fullW(t) == null ? null : +fullW(t).toFixed(2),
      tkt: k?.textContent.trim() ?? null, tktShown: shown(k), tktW: fullW(k) == null ? null : +fullW(k).toFixed(2),
      nameType: type(s), timeType: type(t), tktType: type(k),
    }
  })
  const out = {
    url: location.href,
    sidebarOpen: !!document.querySelector('.sidebar-open'),
    boxLabel: box?.getAttribute('aria-label') ?? null,
    labels: hours.map((s) => s.textContent.trim()),
    edge: edge ? { text: edge.textContent.trim(), right: +r(edge).right.toFixed(2) } : null,
    lastColRight: cols.length ? +r(cols.at(-1)).right.toFixed(2) : null,
    trackRight: track ? +track.right.toFixed(2) : null, trackW: track ? +track.width.toFixed(2) : null,
    cells, cellPx: cellPx == null ? null : +cellPx.toFixed(2),
    box: box ? { sw: box.scrollWidth, cw: box.clientWidth, over: box.scrollWidth - box.clientWidth, left: box.scrollLeft } : null,
    page: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
    now: nowLine ? { text: nowLine.textContent.trim(), x: +r(nowLine).left.toFixed(2), inView: r(nowLine).left >= r(box).left && r(nowLine).right <= r(box).right } : null,
    boxRect: box ? { left: +r(box).left.toFixed(2), right: +r(box).right.toFixed(2) } : null,
    cards,
  }
  if (box && probe != null) {
    const loadLeft = box.scrollLeft
    box.scrollLeft = 0
    const a = { lane: r(laneLabel)?.left, l13: r(label13)?.left, cell13: r(document.querySelector('.guard-rail-cell[data-start="780"]'))?.left ?? null, left: box.scrollLeft }
    box.scrollLeft = probe
    const b = { lane: r(laneLabel)?.left, l13: r(label13)?.left, left: box.scrollLeft }
    box.scrollLeft = loadLeft
    out.scroll = { at0: a, atProbe: b, laneShift: b.lane - a.lane, l13Shift: a.l13 - b.l13, applied: b.left - a.left, stripVsRuler13: a.cell13 == null ? null : a.cell13 - a.l13 }
  }
  return out
}

async function one(browser, port, store, width, sidebar, tag) {
  const ctx = await browser.newContext({ viewport: { width, height: HEIGHT }, storageState: STATE, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' })
  const page = await ctx.newPage()
  const url = `http://localhost:${port}/ja/business/today?store=${STORES[store]}`
  await page.goto(url, { waitUntil: 'load', timeout: 240_000 })
  if (page.url().includes('/login')) throw new Error(`login wall at ${url} (${tag})`)
  await page.waitForSelector('.timeline-scroll .time-head .hours span', { timeout: 120_000 })
  await page.waitForTimeout(1500)
  const isOpen = await page.evaluate(() => !!document.querySelector('.sidebar-open'))
  if ((sidebar === 'open' && !isOpen) || (sidebar === 'collapsed' && isOpen)) {
    await page.locator('.sidebar .rail-toggle').click() // the ONLY click: the rail toggle (a local preference)
    await page.waitForTimeout(800)
  }
  const m = await page.evaluate(readBoard, SCROLL_PROBE)
  const side = m.sidebarOpen ? 'open' : 'collapsed'
  const shot = join(OUT, `${store}-${width}-${side}-${tag}.png`)
  await page.screenshot({ path: shot })
  await ctx.close()
  return { store, width, sidebar: side, tag, shot, ...m }
}

const browser = await chromium.launch() // Playwright's own headless Chromium
const results = []
try {
  for (const [store, width, sidebar] of RUNS) {
    results.push(await one(browser, PORT, store, width, sidebar, 'after'))
    if (BEFORE_PORT) results.push(await one(browser, BEFORE_PORT, store, width, sidebar, 'before'))
  }
} finally {
  await browser.close()
}
writeFileSync(join(OUT, 'today-axis-proof.json'), JSON.stringify({ chromium: browser.version(), results }, null, 2))
for (const x of results) {
  const c07 = x.cards.find((c) => c.time?.startsWith('07:00') && c.min === 30)
  console.log([
    `${x.store} ${x.width} ${x.sidebar} ${x.tag}`, `labels ${x.labels[0]}…${x.labels.at(-1)} edge=${x.edge?.text ?? '-'} edgeR=${x.edge?.right ?? '-'} lastColR=${x.lastColRight} trackR=${x.trackRight}`,
    `cells ${x.cells} cellPx ${x.cellPx} box over ${x.box?.over} (sw ${x.box?.sw} cw ${x.box?.cw} loadLeft ${x.box?.left}) page ${x.page.sw}/${x.page.cw}`,
    `now ${x.now ? `${x.now.text} inView=${x.now.inView}` : '-'}`,
    x.scroll ? `scroll applied ${x.scroll.applied} laneShift ${x.scroll.laneShift} l13Shift ${x.scroll.l13Shift} strip13−ruler13 ${x.scroll.stripVsRuler13}` : 'scroll -',
    c07 ? `07:00 30min card w ${c07.w} name ${c07.name?.text}(${c07.name?.w}) family ${c07.name?.family}(${c07.name?.familyW}) scroll/client ${c07.nameScroll}/${c07.nameClient} timeShown ${c07.timeShown}` : '07:00 30min card -',
    ((c) => (c ? `60min card w ${c.w} timeShown ${c.timeShown} tktShown ${c.tktShown}` : '60min card -'))(x.cards.find((c) => c.min === 60) ?? x.cards.find((c) => c.min === 45)),
  ].join(' | '))
}
console.log(`json: ${join(OUT, 'today-axis-proof.json')}`)
