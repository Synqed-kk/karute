#!/usr/bin/env node
// FIT TEST (S44, ⚖ FIT BY DESIGN 04:2x) — ONE command, offline:
//   node scripts/fit-harness/run.mjs [--out <dir>] [--shots] [--no-assert] [--no-build]
//
// Builds the harness (./vite.config.ts = the phone target's config, entry =
// ./main.tsx: the three list tabs' REAL views on fixture data), serves it on
// 127.0.0.1, and drives Playwright's own headless Chromium (never a shared
// browser) through every tab × 375/393/430 × ja/en × staff state (全スタッフ /
// 自分 / the longest name) — plus the staff list OPEN from the カルテ 担当 chip
// and from the segment's chevron (予約/顧客). Every request that is not the
// harness's own origin is ABORTED and counted (must be 0): no core, no
// Supabase, no Vercel, nothing live.
//
// Asserts, per row: no header control row wraps (its items sit on one line
// and its height is one control), its content fits its track (scrollWidth ≤
// clientWidth) — except the words row at step C, the only row allowed to
// slide; the page never scrolls sideways; an open staff panel sits ≥ 8px
// inside both viewport edges. Emits <out>/fit-table.md (script-written, no
// hand columns) and, with --shots, one PNG per case. Exit 1 on any failure.
// Only the server this script starts is ever stopped.
//
// S45 — the 新規 chip. The matrix above runs with the committed registry
// (KARUTE_SWITCHES.shinkiChip = false) and also asserts the カルテ chip row
// has exactly its two main children (month, 担当). A second matrix renders
// the chip ON through the harness-only registry (`?shinki=on` →
// ./switches.ts; the source value is never flipped): カルテ × 375/393/430/440
// × ja/en × staff state × chip idle/active, with a 3-digit 新規 tally. Each
// case asserts the chip row is [month, 新規, 担当] on one line inside its
// track, no control clipped or overlapping, the 担当 list opening ≥ 8px
// inside both edges, no sideways page scroll.
//
// S46 (option C's trim engine) — ONE narrow exception to "the chip row never
// wraps": the designed own-row step. Only while the row's data-trim carries
// 'ownRow' may it be two lines (exactly two: the staff control on a line of
// its own under an 8px break, nothing past its track); a wrap without that
// step still fails, and the step without exactly two lines fails
// (judgeChipRow). The break is not a control, so it is not counted as an item
// or a line. Same shape as the 予約 en two-line exception; nothing else loosens.
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const require = createRequire(join(ROOT, 'package.json'))
const { chromium } = require('playwright')
const DIST = join(ROOT, 'node_modules/.cache/fit-harness')

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d)
const OUT = resolve(opt('--out', join(ROOT, 'node_modules/.cache/fit-harness-out')))
const SHOTS = flag('--shots')
const ASSERT = !flag('--no-assert')
const LABEL = opt('--label', 'tip')
mkdirSync(OUT, { recursive: true })

// ── 1. build (dummy, release-shaped env — the same fake values CI's thin
// bundle gate uses; nothing here is or resembles a credential).
if (!flag('--no-build')) {
  execFileSync('npx', ['--no', '--', 'vite', 'build', '--config', 'scripts/fit-harness/vite.config.ts', '--logLevel', 'error'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_SHELL_MODE: 'local',
      VITE_FACADE_URL: 'https://ci-dummy.invalid',
      VITE_SUPABASE_URL: 'https://ci-dummy-xxxxxxxxxxx.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'not-a-key',
    },
  })
}
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no harness build at ${DIST}`)

// ── 2. serve the build (static, loopback only).
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = join(DIST, path === '/' ? 'index.html' : path)
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${server.address().port}`

// ── 3. the matrix.
const TABS = ['karute', 'customers', 'appointments']
const WIDTHS = [375, 393, 430]
const LANGS = ['ja', 'en']
const STATES = { all: null, self: 'self', name: 'staff-long' }
const CONTROL_H = 38 // one control: h-9 (36) + a 1px border each side (search field, 日/週/月)
const TOL = 1

const browser = await chromium.launch()
const rows = []
const failures = []
let blocked = 0

function url(tab, lang, state, extra = {}) {
  const p = new URLSearchParams({ tab, lang, ...extra })
  const v = STATES[state]
  if (v) p.set(tab === 'appointments' ? 'staff' : 's', v)
  return `${ORIGIN}/?${p}`
}

async function open(tab, w, lang, state, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith(ORIGIN)) return route.continue()
    blocked += 1
    return route.abort()
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  if (process.env.FIT_DEBUG) page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)))
  await page.goto(url(tab, lang, state, extra))
  try {
    await page.waitForSelector('[data-harness-root] > *', { timeout: 15000 })
  } catch (e) {
    if (process.env.FIT_DEBUG) console.log('[debug]', page.url(), (await page.content()).slice(0, 400))
    throw e
  }
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)
  return { ctx, page, errors }
}

// Measures every header row the tab has, by the markers the app's own markup
// carries (a missing marker = that row does not exist on this build).
async function measure(page, tab) {
  return page.evaluate(({ tab, CONTROL_H }) => {
    const r = (el) => el.getBoundingClientRect()
    const box = (el) => {
      if (!el) return null
      const b = r(el)
      // Option C's own-row break ([data-row-break]) is spacing, not an item.
      const kids = [...el.children].filter(
        (k) => getComputedStyle(k).display !== 'none' && r(k).width > 0 && !k.hasAttribute('data-row-break'),
      )
      // Lines: an item that starts at or below the running line's bottom
      // opens a new line (items-center rows hold 36px and 38px controls side
      // by side — equal tops are not the test, overlap is).
      let lines = 0
      let lineBottom = -Infinity
      for (const k of [...kids].sort((a, b) => r(a).top - r(b).top)) {
        const kb = r(k)
        if (kb.top >= lineBottom - 1) {
          lines += 1
          lineBottom = kb.bottom
        } else lineBottom = Math.max(lineBottom, kb.bottom)
      }
      const right = Math.max(...kids.map((k) => r(k).right), b.left)
      const cs = getComputedStyle(el)
      return {
        top: b.top,
        bottom: b.bottom,
        h: +b.height.toFixed(1),
        w: +b.width.toFixed(1),
        lines,
        content: +(el.scrollWidth).toFixed(1),
        track: +(el.clientWidth).toFixed(1),
        overflowX: cs.overflowX,
        rightEdge: +right.toFixed(1),
        // px the row's items actually use, first item's left to last item's
        // right (gaps included) — against the track below.
        used: kids.length ? +(right - Math.min(...kids.map((k) => r(k).left))).toFixed(1) : 0,
        trackRight: +(b.right).toFixed(1),
      }
    }
    const input = document.querySelector('[data-harness-root] input[type="text"]')
    const dateChip = document.querySelector('[data-date-jump-chip]')
    const first =
      tab === 'appointments'
        ? dateChip?.closest('.justify-between')
        : input?.closest('label')?.parentElement?.closest('.flex.items-center') ?? null
    const out = { first: box(first) }
    out.chips = box(document.querySelector('[data-chip-row]'))
    const chipRow = document.querySelector('[data-chip-row]')
    out.chipKids = chipRow ? [...chipRow.children].filter((k) => !k.hasAttribute('data-row-break')).length : null
    out.chipTrim = chipRow?.getAttribute('data-trim') ?? ''
    // 予約's staff row; on a build without the marker (the pre-S44 baseline)
    // the same row is found from the date bar: the row inside the wrapper
    // that follows the date-jump anchor.
    out.staff =
      tab === 'appointments'
        ? box(
            document.querySelector('[data-staff-row]') ??
              dateChip?.closest('[class*="data-date-jump-chip"]')?.nextElementSibling?.firstElementChild ??
              null,
          )
        : box(document.querySelector('[data-staff-scope]'))
    out.scope = box(document.querySelector('[data-staff-scope]'))
    out.words = box(document.querySelector('[data-words-row]'))
    out.dayLine = box(document.querySelector('[data-day-line]'))
    // The list's top: カルテ = the rounded list card after the header; 顧客 =
    // the mobile card list; 予約 = the agenda card.
    const list =
      tab === 'karute'
        ? document.querySelector('main > div.mt-4')
        : tab === 'customers'
          ? document.querySelector('.md\\:hidden.overflow-hidden.rounded-2xl') ?? document.querySelector('.rounded-2xl.border-dashed')
          : document.querySelector('[data-day-line]')?.parentElement?.querySelector('.md\\:hidden > *')
    out.listTop = list ? +r(list).top.toFixed(1) : null
    out.pageScrollX = document.documentElement.scrollWidth - document.documentElement.clientWidth
    // Who pushes the page sideways: the outermost element past the right edge.
    const vw = document.documentElement.clientWidth
    const past = [...document.querySelectorAll('[data-harness-root] *')].filter((e) => r(e).right > vw + 1)
    const outer = past.filter((e) => !past.some((p) => p !== e && p.contains(e)))
    out.pastRight = outer.slice(0, 3).map((e) => ({
      what: e.hasAttribute('data-day-line') ? 'data-day-line' : e.closest('[data-day-line]') ? 'inside data-day-line' : e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0, 3).join('.'),
      by: +(r(e).right - vw).toFixed(1),
    }))
    out.CONTROL_H = CONTROL_H
    return out
  }, { tab, CONTROL_H })
}

function judge(tag, name, b, { slideOk = false } = {}) {
  if (!b) return 'n/a'
  const slides = b.content > b.track + TOL
  const bad = []
  if (b.lines > 1) bad.push('wraps')
  if (b.h > CONTROL_H + TOL) bad.push(`height ${b.h}`)
  if (slides && !(slideOk && (b.overflowX === 'auto' || b.overflowX === 'scroll'))) bad.push(`overflow ${b.content}>${b.track}`)
  if (b.rightEdge > b.trackRight + TOL && !(slideOk && b.overflowX !== 'visible')) bad.push('past track')
  if (bad.length) failures.push(`${tag} ${name}: ${bad.join(', ')}`)
  return bad.length ? `FAIL (${bad.join(', ')})` : slides ? 'slides' : 'ok'
}

// The カルテ chip row: ONE line — except option C's designed own-row step
// (data-trim carries 'ownRow'), which is exactly two lines: line 1 = what
// sits before the break, line 2 = the staff control. Height ≤ two controls +
// the 8px break, nothing past the track. A wrap without the step = judge()'s
// "wraps" failure, unchanged.
function judgeChipRow(tag, b, trim) {
  if (!b) return 'n/a'
  if (!String(trim ?? '').split(' ').includes('ownRow')) return judge(tag, 'chips', b)
  const bad = []
  if (b.lines !== 2) bad.push(`${b.lines} line(s) at the own-row step`)
  if (b.h > 2 * CONTROL_H + 8 + TOL) bad.push(`height ${b.h}`)
  if (b.content > b.track + TOL) bad.push(`overflow ${b.content}>${b.track}`)
  if (b.rightEdge > b.trackRight + TOL) bad.push('past track')
  if (bad.length) failures.push(`${tag} chips: ${bad.join(', ')}`)
  return bad.length ? `FAIL (${bad.join(', ')})` : 'ok (own-row step)'
}

for (const tab of TABS) {
  for (const lang of LANGS) {
    for (const w of WIDTHS) {
      for (const state of Object.keys(STATES)) {
        const tag = `${tab} ${w} ${lang} ${state}`
        const { ctx, page, errors } = await open(tab, w, lang, state)
        const m = await measure(page, tab)
        const row = { tab, w, lang, state, m, errors }
        // 予約's staff row: in en below 430 it is a defined TWO-line layout
        // (日/週/月, then the control under it) — each line is one control;
        // everywhere else it is one line.
        const stacked = tab === 'appointments' && lang === 'en' && w < 430
        if (m.staff) m.staff.stack = stacked
        row.verdict = {
          first: judge(tag, 'first', m.first),
          chips: judgeChipRow(tag, m.chips, m.chipTrim),
          staff: m.staff
            ? stacked
              ? (() => {
                  const ok =
                    m.staff.lines === 2 &&
                    m.staff.h <= 2 * CONTROL_H + 8 + TOL &&
                    m.staff.content <= m.staff.track + TOL
                  if (!ok) failures.push(`${tag} staff: expected the defined 2-line en layout, got ${m.staff.lines} lines`)
                  return ok ? 'ok (2-line en step)' : 'FAIL'
                })()
              : judge(tag, 'staff', m.staff)
            : 'n/a',
          words: judge(tag, 'words', m.words, { slideOk: true }),
        }
        // The 予約 numbers line (DayNumbersLine, whitespace-nowrap) runs past
        // the edge in English at 375/393 in build 29 already (the S43 mock
        // record: 「57h30m Free」 +21.6 / +39.6px). It is not a header control
        // row and 予約 is ruled build-29-exact, so it is reported, not failed —
        // anything else pushing the page sideways fails.
        const others = (m.pastRight ?? []).filter((p) => !p.what.includes('data-day-line'))
        row.known = (m.pastRight ?? []).filter((p) => p.what.includes('data-day-line'))
        if (m.pageScrollX > 0 && others.length)
          failures.push(`${tag}: page scrolls sideways by ${m.pageScrollX}px (${others.map((o) => o.what + ' +' + o.by).join(', ')})`)
        if (errors.length) failures.push(`${tag}: page errors ${errors.join(' | ')}`)
        // Switch OFF (the committed value) = main's chip row: month + 担当.
        if (tab === 'karute' && m.chipKids !== 2)
          failures.push(`${tag}: chip row has ${m.chipKids} children (switch OFF = month + 担当 only)`)
        if (SHOTS) await page.screenshot({ path: join(OUT, `${LABEL}-${tab}-${w}-${lang}-${state}.png`), fullPage: false })
        // The staff list OPEN — from the カルテ 担当 chip, or the segment's
        // chevron (予約/顧客): both edges ≥ 8px inside the viewport.
        const trigger =
          tab === 'karute'
            ? page.locator('[data-chip-row] button[aria-haspopup="listbox"]').last()
            : page.locator('[data-staff-scope-chevron]')
        if ((await trigger.count()) > 0) {
          await trigger.first().click()
          await page.waitForTimeout(300) // the chevron's turn settles before a shot
          const p = await page.evaluate(() => {
            const el = document.querySelector('[role="listbox"]')
            if (!el) return null
            const b = el.getBoundingClientRect()
            return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), vw: document.documentElement.clientWidth }
          })
          row.panel = p
          if (!p) failures.push(`${tag}: staff list did not open`)
          else if (p.left < 8 - TOL || p.right > p.vw - 8 + TOL)
            failures.push(`${tag}: staff list outside the 8px margin (${p.left}..${p.right} of ${p.vw})`)
          if (SHOTS) await page.screenshot({ path: join(OUT, `${LABEL}-${tab}-${w}-${lang}-${state}-open.png`), fullPage: false })
        } else row.panel = null
        rows.push(row)
        await ctx.close()
      }
    }
  }
}

// ── 3b. the 新規 chip ON (S45 invariant 3) — カルテ only, through the
// harness-only registry (`?shinki=on` → ./switches.ts). The chip row's own
// controls, read off the page: which, box, and whether any of them is cut
// (an element narrower than its content) or overlaps its neighbour.
async function chipDetail(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-chip-row]')
    if (!row) return null
    const cs = getComputedStyle(row)
    const rb = row.getBoundingClientRect()
    const trackRight = rb.right - parseFloat(cs.paddingRight)
    // 新規 = the row's one aria-pressed button; the listbox chips in order =
    // the month chip, then the 担当 chip.
    let listboxes = 0
    const kids = [...row.children].map((k) => {
      const b = k.getBoundingClientRect()
      const btn = k.matches('button') ? k : k.querySelector(':scope > button')
      const which = !btn
        ? 'other'
        : btn.hasAttribute('aria-pressed')
          ? 'shinki'
          : btn.getAttribute('aria-haspopup') === 'listbox'
            ? ++listboxes === 1
              ? 'month'
              : 'staff'
            : 'other'
      const cut = btn
        ? [btn, ...btn.querySelectorAll('*')].filter(
            (el) => el instanceof HTMLElement && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1,
          ).length
        : 0
      return {
        which,
        left: +b.left.toFixed(1),
        right: +b.right.toFixed(1),
        w: +b.width.toFixed(1),
        h: +b.height.toFixed(1),
        text: (btn?.textContent ?? '').trim(),
        pressed: btn?.getAttribute('aria-pressed') ?? null,
        cut,
      }
    })
    const overlaps = kids.slice(1).filter((k, i) => k.left < kids[i].right - 0.5).length
    return { kids, overlaps, rowLeft: +rb.left.toFixed(1), trackRight: +trackRight.toFixed(1) }
  })
}

const CHIP_WIDTHS = [375, 393, 430, 440]
const chipRows = []
for (const lang of LANGS) {
  for (const w of CHIP_WIDTHS) {
    for (const state of Object.keys(STATES)) {
      for (const chip of ['idle', 'active']) {
        const tag = `karute+新規 ${w} ${lang} ${state} ${chip}`
        const { ctx, page, errors } = await open('karute', w, lang, state, { shinki: 'on' })
        const shinkiBtn = page.locator('[data-chip-row] > button[aria-pressed]')
        if ((await shinkiBtn.count()) === 1 && chip === 'active') {
          await shinkiBtn.click()
          await page.waitForTimeout(250)
        }
        const m = await measure(page, 'karute')
        const d = await chipDetail(page)
        const bad = []
        const order = d ? d.kids.map((k) => k.which).join(',') : 'none'
        if (order !== 'month,shinki,staff') bad.push(`chip row is [${order}], not [month,shinki,staff]`)
        const sk = d?.kids.find((k) => k.which === 'shinki')
        if (sk && sk.pressed !== String(chip === 'active')) bad.push(`新規 aria-pressed=${sk.pressed}`)
        if (d?.overlaps) bad.push(`${d.overlaps} overlap(s)`)
        for (const k of d?.kids ?? []) {
          if (k.cut) bad.push(`${k.which} cut (${k.cut} element(s) narrower than their content)`)
          if (k.left < d.rowLeft - TOL || k.right > d.trackRight + TOL) bad.push(`${k.which} outside the row (${k.left}..${k.right} of ${d.rowLeft}..${d.trackRight})`)
        }
        const verdict = { chips: judgeChipRow(tag, m.chips, m.chipTrim), words: judge(tag, 'words', m.words, { slideOk: true }) }
        if (m.pageScrollX > 0) bad.push(`page scrolls sideways by ${m.pageScrollX}px`)
        if (errors.length) bad.push(`page errors ${errors.join(' | ')}`)
        for (const b of bad) failures.push(`${tag}: ${b}`)
        if (SHOTS) await page.screenshot({ path: join(OUT, `${LABEL}-karute-shinki-${w}-${lang}-${state}-${chip}.png`), fullPage: false })
        const trigger = page.locator('[data-chip-row] button[aria-haspopup="listbox"]').last()
        let panel = null
        if ((await trigger.count()) > 0) {
          await trigger.click()
          await page.waitForTimeout(300)
          panel = await page.evaluate(() => {
            const el = document.querySelector('[role="listbox"]')
            if (!el) return null
            const b = el.getBoundingClientRect()
            return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), vw: document.documentElement.clientWidth }
          })
          if (!panel) bad.push('staff list did not open'), failures.push(`${tag}: staff list did not open`)
          else if (panel.left < 8 - TOL || panel.right > panel.vw - 8 + TOL) {
            bad.push('staff list outside the 8px margin')
            failures.push(`${tag}: staff list outside the 8px margin (${panel.left}..${panel.right} of ${panel.vw})`)
          }
          if (SHOTS) await page.screenshot({ path: join(OUT, `${LABEL}-karute-shinki-${w}-${lang}-${state}-${chip}-open.png`), fullPage: false })
        } else bad.push('no 担当 chip'), failures.push(`${tag}: no 担当 chip`)
        chipRows.push({ w, lang, state, chip, m, d, panel, bad, verdict, errors })
        await ctx.close()
      }
    }
  }
}

await browser.close()
server.close()
if (blocked > 0) failures.push(`${blocked} request(s) left the harness origin (aborted)`)

// ── 4. the table (script-emitted; every number read off the page).
const f = (b) => (b ? `${b.h}h · ${b.lines}L · ${b.used}/${b.track}` : '—')
const gap = (a, b) => (a && b ? +(b.top - a.bottom).toFixed(1) : '—')
const lines = [
  `# Fit table — ${LABEL}`,
  '',
  `Generated by \`node scripts/fit-harness/run.mjs\` (Playwright ${require('playwright/package.json').version}, headless Chromium, dsf 2, the app's own fonts via thin/fonts.css). Cells: height · lines · used/track px (used = first item's left to last item's right, gaps included; a sliding row's used exceeds its track). Gaps = px between rows. Requests aborted (left the harness origin): ${blocked}.`,
  '',
  '| tab | w | lang | state | first row | chip row | staff row | words row | first→next | rows gap | header→list | panel L..R | verdict |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
]
for (const { tab, w, lang, state, m, verdict, panel } of rows) {
  const order = tab === 'karute' ? [m.first, m.chips, m.words] : tab === 'customers' ? [m.first, m.staff, m.words] : [m.first, m.staff, m.dayLine]
  const next = order[1]
  const between = tab === 'karute' ? gap(m.chips, m.words) : tab === 'appointments' ? gap(m.staff, m.dayLine) : '—'
  const last = tab === 'appointments' ? m.dayLine : m.words
  const toList = last && m.listTop != null ? +(m.listTop - last.bottom).toFixed(1) : '—'
  const v = Object.values(verdict).every((x) => !String(x).startsWith('FAIL')) ? 'PASS' : 'FAIL'
  const known = rows.find((x) => x.tab === tab && x.w === w && x.lang === lang && x.state === state)?.known ?? []
  lines.push(
    `| ${tab} | ${w} | ${lang} | ${state} | ${f(m.first)} | ${f(m.chips)} | ${f(m.staff)}${m.staff?.stack ? ' (en step)' : ''} | ${f(m.words)} ${verdict.words === 'slides' ? '(slides)' : ''} | ${gap(m.first, next)} | ${between} | ${toList} | ${panel ? `${panel.left}..${panel.right}/${panel.vw}` : '—'} | ${v}${known.length ? ` (numbers line +${known[0].by}px, build 29)` : ''} |`,
  )
}
const kid = (d, which) => {
  const k = d?.kids.find((x) => x.which === which)
  return k ? `${k.left}..${k.right} (${k.w})` : '—'
}
lines.push(
  '',
  '## 新規 chip ON — harness-only override (S45 invariant 3)',
  '',
  "`?shinki=on` → `scripts/fit-harness/switches.ts` (aliased for the harness build only; `KARUTE_SWITCHES.shinkiChip` stays `false` in source). 480 fixture rows, every row 新規 → a 3-digit tally in every staff state. Cells: chip row = height · lines · used/track px; the three controls' left..right (width) px; track right = the row's inner right edge; cut = elements narrower than their content; panel = the 担当 list opened from its chip.",
  '',
  '| w | lang | state | 新規 | chip row | month | 新規 chip (text) | 担当 | track right | overlaps · cut | words row | header→list | panel L..R | verdict |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
)
for (const { w, lang, state, chip, m, d, panel, bad, verdict } of chipRows) {
  const sk = d?.kids.find((x) => x.which === 'shinki')
  const cut = (d?.kids ?? []).reduce((a, k) => a + k.cut, 0)
  const toList = m.words && m.listTop != null ? +(m.listTop - m.words.bottom).toFixed(1) : '—'
  const ok = !bad.length && Object.values(verdict).every((x) => !String(x).startsWith('FAIL'))
  lines.push(
    `| ${w} | ${lang} | ${state} | ${chip} | ${f(m.chips)} | ${kid(d, 'month')} | ${kid(d, 'shinki')} ${sk ? `「${sk.text}」` : ''} | ${kid(d, 'staff')} | ${d?.trackRight ?? '—'} | ${d?.overlaps ?? '—'} · ${cut} | ${f(m.words)} ${verdict.words === 'slides' ? '(slides)' : ''} | ${toList} | ${panel ? `${panel.left}..${panel.right}/${panel.vw}` : '—'} | ${ok ? 'PASS' : 'FAIL'} |`,
  )
}
lines.push('', failures.length ? `## FAILURES (${failures.length})\n\n` + failures.map((x) => `- ${x}`).join('\n') : '## Result: PASS — every row one line, every track fits (or the words row slides at step C), no sideways page scroll, every open panel inside 8px, 0 requests left the harness.')
writeFileSync(join(OUT, `fit-table${LABEL === 'tip' ? '' : '-' + LABEL}.md`), lines.join('\n') + '\n')
writeFileSync(join(OUT, `fit-raw${LABEL === 'tip' ? '' : '-' + LABEL}.json`), JSON.stringify(rows, null, 1))
writeFileSync(join(OUT, `fit-raw-shinki${LABEL === 'tip' ? '' : '-' + LABEL}.json`), JSON.stringify(chipRows, null, 1))
console.log(lines.slice(-1)[0].split('\n')[0])
console.log(`table: ${join(OUT, `fit-table${LABEL === 'tip' ? '' : '-' + LABEL}.md`)}`)
if (ASSERT && failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
