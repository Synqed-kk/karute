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
// ONLY=gym-1280-open,gym-1180-open re-runs those runs alone; their results replace the same runs in OUT's existing
// today-axis-proof.json (the other runs are kept as they were). Round 3 (D5) + round 4: the name line is split into
// .e-fam · .e-given · .tg and the tiers print WIDE full name + tag · MID the family name + the time line · NARROW the
// family name; the script ASSERTS it on the gym at 1280/1180 open (exit code 1 + a FAIL line when a check does not hold).
//
// The servers it reads (no value is written here, and none belongs in this file): a LOCAL `next dev -p <port>` (or
// `next build` + `next start -p <port>`) of this worktree, started in a subshell that sources the repo's local env
// file into THAT PROCESS ONLY (`set -a; . <the env file>; set +a`), unsets VERCEL_ENV and exports
// BUSINESS_PRACTICE_TENANT=<the Dev Salon's tenant id> — practice mode on the Dev Salon. STATE is a Playwright
// storageState minted by scripts/playwright-login.ts against the same port (gitignored .auth/). Never point it at a
// deployed Business URL; never run it against anything but the practice tenant.
import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const ALL_RUNS = [
  ['gym', 1280, 'open'], ['gym', 1180, 'open'], ['gym', 1280, 'collapsed'],
  ['jiyugaoka', 1280, 'open'], ['jiyugaoka', 1180, 'open'],
  ['gym', 1023, 'default'], ['jiyugaoka', 1023, 'default'],
  // round 3: the gym's day has no card ≥ WIDE 95 px at 1280 / 1180 open (its widest, a 75-minute card, is 82.5 px), so
  // the WIDE check reads the same day at 1920 open, where a 60-minute card is ≥ 95 px
  ['gym', 1920, 'open'],
  // S26 C1: the salon at 1280 collapsed too (both stores at 1280 open / 1180 open / 1280 collapsed)
  ['jiyugaoka', 1280, 'collapsed'],
]
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const RUNS = ONLY ? ALL_RUNS.filter((r) => ONLY.includes(r.join('-'))) : ALL_RUNS
// S26 C8 — a MIRROR of today-board.ts familyNameOf, the same rule character for character (this .mjs runs in plain
// node and cannot import the TypeScript module): trimmed, cut before the first half/full-width space OR 「・」 (U+30FB).
// today-board.test.ts pins that the two regexes stay identical.
const familyNameOf = (n) => { const t = n.trim(); const c = t.search(/[\s\u30FB]/); return c < 0 ? t : t.slice(0, c) }
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
  // round 3: the name line's parts (.e-fam · .e-given · .tg); `line` = the text the tier actually prints (innerText
  // skips display:none parts), `full` = the full display name (family + given, never the tag)
  const nameParts = (el) => { if (!el) return null; const fam = el.querySelector(':scope > .e-fam'); const given = el.querySelector(':scope > .e-given'); const tg = el.querySelector(':scope > .tg')
    return { line: el.innerText, full: (fam?.textContent ?? '') + (given?.textContent ?? ''), family: fam?.textContent ?? null, familyW: fullW(fam) == null ? null : +fullW(fam).toFixed(2),
      givenShown: shown(given), tag: tg?.textContent ?? null, tagShown: shown(tg) } }
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
      name: nameParts(s), strongText: s?.textContent ?? null, nameScroll: s?.scrollWidth ?? null, nameClient: s?.clientWidth ?? null,
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
  // S26 C2 — the strip's cells per lane vs the ruler's --board-cells
  out.stripCells = [...document.querySelectorAll('.guard-rail-track')].map((t) => t.querySelectorAll('.guard-rail-cell').length)
  // S26 C3 — the box model chain from the scroll box to the first cell (rects + every padding/border/gap/margin)
  const geo = (el) => { if (!el) return null; const c = getComputedStyle(el); const b = r(el)
    return { left: +b.left.toFixed(2), right: +b.right.toFixed(2), w: +b.width.toFixed(2), cw: el.clientWidth, sw: el.scrollWidth, minW: c.minWidth, boxSizing: c.boxSizing,
      pad: [c.paddingLeft, c.paddingRight].join('/'), border: [c.borderLeftWidth, c.borderRightWidth].join('/'), margin: [c.marginLeft, c.marginRight].join('/'),
      gap: c.columnGap, cols: c.gridTemplateColumns, label: c.getPropertyValue('--label').trim(), floorSlots: c.getPropertyValue('--floor-slots').trim(), cellFloor: c.getPropertyValue('--cell-floor').trim(), gutter: c.scrollbarGutter, ox: c.overflowX, oy: c.overflowY } }
  const lane0 = document.querySelector('.timeline .lane')
  // the descendants whose right edge reaches past the timeline's own right edge (what makes scrollWidth > the timeline)
  const tlRight = timeline ? r(timeline).right : 0
  const past = timeline ? [...timeline.querySelectorAll('*')].filter((e) => r(e).width > 0 && r(e).right > tlRight + 0.5).slice(0, 12).map((e) => ({ tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 60), text: e.textContent.trim().slice(0, 12), right: +r(e).right.toFixed(2), over: +(r(e).right - tlRight).toFixed(2) })) : []
  out.geo = { box: geo(box), timeline: geo(timeline), timeHead: geo(document.querySelector('.time-head')), timeHeadLabel: geo(document.querySelector('.time-head > span')), hours: geo(document.querySelector('.time-head .hours')),
    lane: geo(lane0), laneLabel: geo(lane0?.querySelector('.lane-label') ?? laneLabel), track: geo(lane0?.querySelector('.track')), edge: geo(edge), pastTimeline: past }
  // S26 C4 + C5 — every block card (not a booking): its classes, content width, the label / time line as printed
  out.blocks = [...document.querySelectorAll('.event:not([data-book])')].map((e) => {
    const c = getComputedStyle(e); const s = e.querySelector(':scope > strong'); const t = e.querySelector(':scope > .e-time')
    const textLeft = (el) => { if (!el || !el.firstChild) return null; const g = document.createRange(); g.selectNodeContents(el); return g.getBoundingClientRect().left }
    const content = e.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight)
    return { cls: String(e.className), tag: e.tagName.toLowerCase(), w: +r(e).width.toFixed(2), content: +content.toFixed(2), label: s?.textContent ?? null, labelShown: shown(s),
      labelScroll: s?.scrollWidth ?? null, labelClient: s?.clientWidth ?? null, labelWhole: s ? s.scrollWidth <= s.clientWidth : null,
      time: t?.textContent ?? null, timeShown: shown(t), timeScroll: t?.scrollWidth ?? null, timeClient: t?.clientWidth ?? null,
      inset: s ? +(r(s).left - r(e).left).toFixed(2) : null, textInset: s && textLeft(s) != null ? +(textLeft(s) - r(e).left).toFixed(2) : null, printed: e.innerText.replace(/\n/g, ' / ') }
  })
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
const JSON_OUT = join(OUT, 'today-axis-proof.json')
const key = (x) => `${x.store}-${x.width}-${x.sidebar}-${x.tag}`
const kept = ONLY && existsSync(JSON_OUT) ? JSON.parse(readFileSync(JSON_OUT, 'utf8')).results.filter((x) => !results.some((y) => key(y) === key(x))) : []
const stamp = new Date().toISOString()
writeFileSync(JSON_OUT, JSON.stringify({ chromium: browser.version(), rerun: ONLY ? { at: stamp, runs: results.map(key) } : undefined, results: [...kept, ...results.map((x) => (ONLY ? { ...x, rerunAt: stamp } : x))] }, null, 2))
// round 3 (D5) — the asserted checks on the gym at 1280 / 1180, sidebar open (after): NARROW prints the family name
// whole, MID (round 4) the family name whole without the given name or the tag + 「07:00〜」, WIDE the tag.
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed += 1 }
for (const x of results.filter((r) => r.store === 'gym' && r.sidebar === 'open' && r.tag === 'after')) {
  if (x.width === 1920) {
    const wide = x.cards.filter((c) => c.w >= 95 && c.name.tag).sort((a, b) => a.w - b.w)[0]
    check(!!wide && wide.name.tagShown && wide.name.line === wide.name.full + wide.name.tag,
      `gym 1920 open WIDE card: ${wide ? `w ${wide.w} line 「${wide.name.line}」 = full + tag · tag shown ${wide.name.tagShown} · time 「${wide.time}」 shown ${wide.timeShown}` : 'none at ≥ 95 px with a tag'}`)
    continue
  }
  const at = `gym ${x.width} open`
  const c07 = x.cards.find((c) => c.time?.startsWith('07:00') && c.min === 30)
  check(!!c07 && c07.name.line === familyNameOf(c07.name.full) && c07.nameScroll <= c07.nameClient && !c07.timeShown,
    `${at} NARROW 07:00 30-min card: line 「${c07?.name.line}」 = familyNameOf(「${c07?.name.full}」) 「${c07 ? familyNameOf(c07.name.full) : '-'}」 · scroll/client ${c07?.nameScroll}/${c07?.nameClient} · time hidden ${c07 ? !c07.timeShown : '-'}`)
  const mid = x.cards.find((c) => c.min === 60 && c.w >= 53 && c.w < 95 && c.time?.startsWith('07:00'))
  check(!!mid && mid.name.line === familyNameOf(mid.name.full) && !mid.name.givenShown && !mid.name.tagShown && mid.nameScroll <= mid.nameClient && mid.timeShown && mid.time === '07:00〜',
    `${at} MID 60-min 07:00 card (w ${mid?.w}): line 「${mid?.name.line}」 = familyNameOf(「${mid?.name.full}」) · given shown ${mid?.name.givenShown} · tag 「${mid?.name.tag}」 shown ${mid?.name.tagShown} · scroll/client ${mid?.nameScroll}/${mid?.nameClient} · time 「${mid?.time}」 shown ${mid?.timeShown}`)
  // round 4: every card's name line at MID (53 ≤ w < 95) and NARROW (20 ≤ w < 53) — whole = scrollWidth ≤ clientWidth
  for (const [tier, lo, hi] of [['MID', 53, 95], ['NARROW', 20, 53]]) {
    const cs = x.cards.filter((c) => c.w >= lo && c.w < hi)
    const chopped = cs.filter((c) => c.nameScroll > c.nameClient)
    console.log(`INFO ${at} ${tier} name lines whole: ${cs.length - chopped.length}/${cs.length} · printed ${[...new Set(cs.map((c) => c.name.line))].map((t) => `「${t}」`).join(' ')}${chopped.length ? ` · chopped ${chopped.map((c) => `「${c.name.line}」 ${c.nameScroll}/${c.nameClient}`).join(' ')}` : ''}`)
  }
  console.log(`INFO ${at}: cards ≥ WIDE 95 px: ${x.cards.filter((c) => c.w >= 95).length} (widest ${Math.max(...x.cards.map((c) => c.w))}); the WIDE check runs at 1920`)
}
// S26 C1 + C2 + C5 — asserted on EVERY after-run at 1280 / 1180 (both stores, open and collapsed)
for (const x of results.filter((r) => r.tag === 'after' && (r.width === 1280 || r.width === 1180))) {
  const at = `${x.store} ${x.width} ${x.sidebar}`
  check(x.page.sw === x.page.cw, `${at} page never scrolls sideways: documentElement ${x.page.sw}/${x.page.cw}`)
  check(x.scroll && Math.abs(x.scroll.laneShift) < 0.5, `${at} name column moves 0 px: laneShift ${x.scroll?.laneShift} (scrollLeft applied ${x.scroll?.applied})`)
  check(x.scroll && Math.abs(x.scroll.l13Shift - x.scroll.applied) < 0.5, `${at} 13:00 ruler label moves exactly scrollLeft: l13Shift ${x.scroll?.l13Shift} = applied ${x.scroll?.applied}`)
  check(x.scroll && x.scroll.stripVsRuler13 != null && Math.abs(x.scroll.stripVsRuler13) <= 1, `${at} strip 13:00 cell x − ruler 13:00 label x = ${x.scroll?.stripVsRuler13} (±1)`)
  check(x.stripCells.length > 0 && x.stripCells.every((n) => n === x.cells), `${at} strip cells per lane == --board-cells ${x.cells}: lanes ${x.stripCells.length} · counts {${[...new Set(x.stripCells)].join(',')}}`)
  check(!!x.now && x.now.inView, `${at} now-line in view: ${x.now ? `${x.now.text} inView ${x.now.inView}` : 'none'}`)
  if (x.store === 'gym' && x.sidebar === 'open') {
    for (const [tier, lo, hi] of [['MID', 53, 95], ['NARROW', 20, 53]]) {
      const cs = x.cards.filter((c) => c.w >= lo && c.w < hi)
      check(cs.length > 0 && cs.every((c) => c.nameScroll <= c.nameClient), `${at} ${tier} names whole ${cs.filter((c) => c.nameScroll <= c.nameClient).length}/${cs.length}`)
    }
  }
  // C5: a block's time line shows only at ≥ WIDE (content ≥ 77 px) and is never a clipped fragment
  const bad = x.blocks.filter((b) => b.time != null && (b.timeShown !== (b.content >= 77) || (b.timeShown && b.timeScroll > b.timeClient)))
  check(bad.length === 0, `${at} block time lines: ${x.blocks.filter((b) => b.timeShown).length} shown (all content ≥ 77) · fragments/misplaced ${bad.length}${bad.length ? ` ${bad.map((b) => `「${b.printed}」 c${b.content}`).join(' ')}` : ''}`)
  console.log(`INFO ${at} labels ${x.labels.join(' ')} · edge ${x.edge?.text} — rows outside the served hours widen the ruler past them`)
  console.log(`INFO ${at} geo box w ${x.geo.box?.w} cw ${x.geo.box?.cw} sw ${x.geo.box?.sw} gutter ${x.geo.box?.gutter} · timeline w ${x.geo.timeline?.w} minW ${x.geo.timeline?.minW} sw ${x.geo.timeline?.sw} --label ${x.geo.timeline?.label} --floor-slots ${x.geo.timeline?.floorSlots} --cell-floor ${x.geo.timeline?.cellFloor} · laneLabel w ${x.geo.laneLabel?.w} border ${x.geo.laneLabel?.border} · track w ${x.geo.track?.w} · past timeline ${x.geo.pastTimeline.map((p) => `${p.tag}.${p.cls}「${p.text}」+${p.over}`).join(' ') || 'none'}`)
}
for (const x of results.filter((r) => r.store === 'gym' && (r.width === 1280 || r.width === 1180) && r.sidebar === 'open')) {
  for (const b of x.blocks) console.log(`BLOCK ${x.store} ${x.width} ${x.tag} ${b.tag}.${b.cls.replace(/\s+/g, '.')} w ${b.w} content ${b.content} label 「${b.label}」 ${b.labelWhole ? 'whole' : 'ellipsised'} ${b.labelScroll}/${b.labelClient} · time 「${b.time ?? '-'}」 shown ${b.timeShown} · inset ${b.inset} textInset ${b.textInset} · printed 「${b.printed}」`)
}
for (const x of results) {
  const c07 = x.cards.find((c) => c.time?.startsWith('07:00') && c.min === 30)
  console.log([
    `${x.store} ${x.width} ${x.sidebar} ${x.tag}`, `labels ${x.labels[0]}…${x.labels.at(-1)} edge=${x.edge?.text ?? '-'} edgeR=${x.edge?.right ?? '-'} lastColR=${x.lastColRight} trackR=${x.trackRight}`,
    `cells ${x.cells} cellPx ${x.cellPx} box over ${x.box?.over} (sw ${x.box?.sw} cw ${x.box?.cw} loadLeft ${x.box?.left}) page ${x.page.sw}/${x.page.cw}`,
    `now ${x.now ? `${x.now.text} inView=${x.now.inView}` : '-'}`,
    x.scroll ? `scroll applied ${x.scroll.applied} laneShift ${x.scroll.laneShift} l13Shift ${x.scroll.l13Shift} strip13−ruler13 ${x.scroll.stripVsRuler13}` : 'scroll -',
    c07 ? `07:00 30min card w ${c07.w} line ${c07.name?.line} full ${c07.name?.full} family ${c07.name?.family}(${c07.name?.familyW}) scroll/client ${c07.nameScroll}/${c07.nameClient} timeShown ${c07.timeShown}` : '07:00 30min card -',
    ((c) => (c ? `60min card w ${c.w} line ${c.name?.line} scroll/client ${c.nameScroll}/${c.nameClient} timeShown ${c.timeShown} tktShown ${c.tktShown}` : '60min card -'))(x.cards.find((c) => c.min === 60) ?? x.cards.find((c) => c.min === 45)),
  ].join(' | '))
}
console.log(`json: ${JSON_OUT}`)
if (failed) { console.log(`FAILED checks: ${failed}`); process.exitCode = 1 }
