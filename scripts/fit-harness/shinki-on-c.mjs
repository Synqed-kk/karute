#!/usr/bin/env node
// FIT PROOF — S46 LEG 1b: the 新規 chip ON, on top of option C (the カルテ chip
// row [month][新規 N][自分 | 全スタッフ ⌄] and its trim engine, step 2 =
// 'shinkiCount'). ONE command, offline:
//   node scripts/fit-harness/shinki-on-c.mjs --out <dir> [--no-build] [--shots]
//        [--cmeasure <c-measure.json>]
//
// Same method as ./staff-control-c.mjs (the option C proof): the fit harness
// build (./vite.config.ts — the REAL カルテ view on fixture data), served on
// 127.0.0.1, driven by Playwright's own headless Chromium and WebKit AS A
// PHONE (isMobile + hasTouch). Never a shared browser. Every request that is
// not the harness's own origin is aborted and counted (must be 0).
// The chip is ON only through the harness-only registry (`?shinki=<N>` →
// ./switches.ts; KARUTE_SWITCHES.shinkiChip stays false in source), and the
// page holds EXACTLY N 新規 rows under its pick (fixtures.ts
// karuteShinkiItems; a picked month gets the same N via ./actions-karute.ts).
//
// Matrix: 375 · 393 · 402 · 440 × ja/en × month 9 and 10 of the current year
// and month 10 of another year × 新規 count 0 · 12 · 120 × 全スタッフ /
// 鈴木 友梨佳 / 勅使河原 さくら (the S45 run's long name) / 勘解由小路美和子 (8
// characters). Page clock fixed (2026-09-15 / 2026-10-15 JST; another year =
// the clock at 2027-01-15 and 2026年10月 picked from the real panel).
//
// Per case, every number read off the page:
//   natural0 — one-line max-content width, NOTHING trimmed (the page at 800px);
//   natural1 — the same with the picked name's text hidden (step 1's look);
//   natural2 — step 1 (if a name) + the 新規 count hidden (step 2's look);
//   at each width, a FRESH load (first-paint walk) → the steps the engine
//   applied (data-trim), the END spare (one line: w − 32 − the row as
//   rendered; own row: w − 32 − the wider of its two lines), fit checks, the
//   chip's visible parts and its accessible name (Playwright's); and the 800px
//   page RESIZED to that width (the ResizeObserver walk) → its steps, which
//   must agree.
// Rule check: the engine's steps = the rule on these measured numbers
// (spare = (w − 32) − natural; a step only while < 6; order badgeOnly →
// shinkiCount → ownRow, badgeOnly left out without a name). END spare < 6 =
// FINDING (listed with its numbers, never tuned away).
// c-measure comparison (optional, S45's option-C numbers WITH the chip, ja/en
// cur-09 rows, count 12 and 128): expected natural0/1/2 = the c-measure row −
// its month chip (9月/Sep) + this case's month chip, ± one count digit per
// digit (C1 128 − C1 12; tabular numerals, so 120 ≡ 128). |Δ| > 1px or a
// different step = DEVIATION (reported with both numbers, never tuned away).
// Emits <out>/fit-proof-s46-shinki.md + .json (+ <out>/shots-shinki/*.png).
// Exit 1 on any FAIL (not on a deviation or a finding). Only the server this
// script starts is ever stopped.
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const require = createRequire(join(ROOT, 'package.json'))
const pw = require('playwright')
const DIST = join(ROOT, 'node_modules/.cache/fit-harness')

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d)
const OUT = resolve(opt('--out', join(ROOT, 'node_modules/.cache/fit-harness-out/shinki-on-c')))
const SHOTS = flag('--shots')
const CM = opt('--cmeasure', null)
const SHOT_DIR = join(OUT, 'shots-shinki')
mkdirSync(OUT, { recursive: true })
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true })

// ── 1. build (the same dummy, release-shaped env as run.mjs).
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

// ── 2. serve (static, loopback only).
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = join(DIST, p === '/' ? 'index.html' : p)
  if (!file.startsWith(DIST) || !existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${server.address().port}`

// ── 3. the matrix.
const ENGINES = ['chromium', 'webkit']
const WIDTHS = [375, 393, 402, 440]
const LANGS = ['ja', 'en']
const MONTHS = {
  'cur-09': { clock: '2026-09-15T12:00:00+09:00', pick: null, mm: '09', kind: 'short' },
  'cur-10': { clock: '2026-10-15T12:00:00+09:00', pick: null, mm: '10', kind: 'short' },
  'other-10': { clock: '2027-01-15T12:00:00+09:00', pick: '2026-10', mm: '10', kind: 'other' },
}
const PICK_LABEL = { ja: '2026年10月', en: 'Oct 2026' }
const COUNTS = [0, 12, 120]
const STAFF = {
  all: { s: null, name: '全スタッフ' },
  'staff-3': { s: 'staff-3', name: '鈴木 友梨佳' },
  'staff-long': { s: 'staff-long', name: '勅使河原 さくら' },
  'staff-8': { s: 'staff-8', name: '勘解由小路美和子' },
}
const WORD = { ja: '新規', en: 'New' }
const SPARE_MIN = 6
const TOL = 1

let blocked = 0
const failures = []
const cases = []
let retries = 0

async function open(...a) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await openOnce(...a)
    } catch (e) {
      if (attempt >= 2 || e?.name !== 'TimeoutError') throw e
      retries += 1
      console.error(`[fit] retry after ${e.name}: ${a.slice(1).join(' ')}`)
    }
  }
}

async function openOnce(browser, engine, w, lang, month, staff, n) {
  const phone = engine === 'webkit' ? { isMobile: true, hasTouch: true } : {}
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2, ...phone })
  const page = await ctx.newPage()
  await page.route('**/*', (route) => (route.request().url().startsWith(ORIGIN) ? route.continue() : (blocked++, route.abort())))
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript((origin) => {
    const real = window.fetch.bind(window)
    window.__heldFetches = 0
    window.fetch = (input, init) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(u, location.href).origin === origin) return real(input, init)
      window.__heldFetches += 1
      return new Promise(() => {})
    }
  }, ORIGIN)
  const M = MONTHS[month]
  await page.clock.setFixedTime(new Date(M.clock))
  const p = new URLSearchParams({ tab: 'karute', lang, roster: 'wide', shinki: String(n) })
  if (STAFF[staff].s) p.set('s', STAFF[staff].s)
  try {
    await page.goto(`${ORIGIN}/?${p}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForSelector('[data-chip-row] [data-staff-scope]', { timeout: 15000 })
    await page.waitForSelector('[data-chip-row] > button[aria-pressed]', { timeout: 15000 })
  } catch (e) {
    await ctx.close()
    throw e
  }
  await page.evaluate(() => document.fonts.ready)
  if (M.pick) {
    await page.locator('[data-chip-row] > div:first-child > button').click()
    await page.getByRole('option', { name: PICK_LABEL[lang] }).click()
    await page.waitForFunction((l) => document.querySelector('[data-chip-row] > div:first-child > button')?.getAttribute('aria-label') === l, PICK_LABEL[lang])
  }
  // The chip prints N under this pick (a picked month: once its read landed).
  await page.waitForFunction((n) => document.querySelector('[data-chip-row] > button[aria-pressed]')?.lastElementChild?.textContent === String(n), n, { timeout: 15000 })
  await settle(page)
  return { ctx, page, errors }
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

// A viewport change lands asynchronously (WebKit most visibly): wait until the
// page sees the new width, then two frames. (The row's track is w − 32 below
// md and w − 48 at 800px — md:px-6 — so the page width is what is waited on.)
async function resizeTo(page, w) {
  await page.setViewportSize({ width: w, height: 900 })
  await page.waitForFunction((w) => window.innerWidth === w && document.documentElement.clientWidth === w, w)
  await settle(page)
}
let lateResizeWalks = 0

// Everything read off the row. `oneLine(hideName, hideCount)` = the row's
// max-content width forced to one line (no wrap, the own-row break hidden),
// optionally with the picked name's text and/or the 新規 count hidden —
// measured, then every style restored.
async function read(page) {
  const m = await page.evaluate(() => {
    const row = document.querySelector('[data-chip-row]')
    const month = row.querySelector(':scope > div:first-child > button')
    const chip = row.querySelector(':scope > button[aria-pressed]')
    const word = chip.firstElementChild
    const count = chip.lastElementChild
    const scope = row.querySelector('[data-staff-scope]')
    const buttons = [...scope.querySelectorAll('button')]
    const brk = row.querySelector('[data-row-break]')
    const oneLine = (hideName, hideCount) => {
      const name = scope.querySelector('.truncate')
      const prev = [row.style.width, row.style.flexWrap, name?.style.display, brk?.style.display, count.style.display]
      row.style.width = 'max-content'
      row.style.flexWrap = 'nowrap'
      if (brk) brk.style.display = 'none'
      if (hideName && name) name.style.display = 'none'
      if (hideCount) count.style.display = 'none'
      const w = row.getBoundingClientRect().width
      row.style.width = prev[0]
      row.style.flexWrap = prev[1]
      if (brk) brk.style.display = prev[3] ?? ''
      if (name) name.style.display = prev[2] ?? ''
      count.style.display = prev[4] ?? ''
      return w
    }
    const kids = [...row.children].filter((k) => !k.hasAttribute('data-row-break'))
    const tops = kids.map((k) => Math.round(k.getBoundingClientRect().top))
    const seg2 = buttons.find((b) => b.hasAttribute('aria-pressed') && b !== buttons[0]) ?? buttons[0]
    const accName = (b) => b.getAttribute('aria-label') ?? b.textContent.trim()
    const r = (el) => el.getBoundingClientRect()
    const own = (row.getAttribute('data-trim') ?? '').includes('ownRow')
    // Line widths as rendered: one line = the row's own one-line width at its
    // current trims (an sr-only count takes no space); own row = line 1 (month
    // → 新規 chip) and line 2 (the control), the wider of the two.
    const line1 = r(chip).right - r(month).left
    const line2 = r(scope.parentElement).width
    const asRendered = own ? Math.max(line1, line2) : oneLine(false, false)
    const countBox = r(count)
    return {
      trim: row.getAttribute('data-trim') ?? '',
      natural: oneLine(false, false),
      naturalNoName: oneLine(true, false),
      naturalNoNameNoCount: oneLine(true, true),
      hasName: !!scope.querySelector('.truncate'),
      track: row.clientWidth,
      content: row.scrollWidth,
      lines: new Set(tops).size,
      chipTopIsMonthTop: Math.round(r(chip).top) === Math.round(r(month).top),
      asRendered,
      line1,
      line2,
      pageScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      monthW: r(month).width,
      monthText: month.textContent.trim(),
      monthName: month.getAttribute('aria-label'),
      chipW: r(chip).width,
      chipVisibleText: [word, count].filter((el) => r(el).width > 1).map((el) => el.textContent.trim()).join(' '),
      wordShown: r(word).width > 1,
      countShown: countBox.width > 1,
      countSrOnly: count.classList.contains('sr-only'),
      controlName: accName(seg2),
      held: window.__heldFetches ?? 0,
    }
  })
  // Playwright's own accessible-name computation for the 新規 chip.
  const snap = await page.locator('[data-chip-row] > button[aria-pressed]').ariaSnapshot()
  m.chipAccName = /button "([^"]*)"/.exec(snap)?.[1] ?? null
  return m
}

function ruleFor(avail, n0, n1, n2, hasName) {
  const steps = hasName ? ['badgeOnly', 'shinkiCount', 'ownRow'] : ['shinkiCount', 'ownRow']
  const seq = hasName ? [n0, n1, n2] : [n0, n2]
  for (let k = 0; k < seq.length; k++) if (avail - seq[k] >= SPARE_MIN) return steps.slice(0, k).join(' ')
  return steps.join(' ')
}

async function runEngine(engine) {
  const browser = await pw[engine].launch()
  const out = []
  for (const lang of LANGS) for (const month of Object.keys(MONTHS)) for (const n of COUNTS) for (const staff of Object.keys(STAFF)) {
    if (process.env.FIT_DEBUG) console.error(`[fit] ${engine} ${lang} ${month} n=${n} ${staff}`)
    const wide = await open(browser, engine, 800, lang, month, staff, n)
    const w0 = await read(wide.page)
    if (w0.trim) failures.push(`${engine} ${lang} ${month} n=${n} ${staff} @800: trimmed "${w0.trim}" where nothing should`)
    const natural0 = w0.natural
    const natural1 = w0.hasName ? w0.naturalNoName : null
    // Step 2's look: the name hidden (a no-op for 全スタッフ) + the count hidden.
    const natural2 = w0.naturalNoNameNoCount
    for (const w of WIDTHS) {
      const tag = `${engine} ${w} ${lang} ${month} n=${n} ${staff}`
      const { ctx, page, errors } = await open(browser, engine, w, lang, month, staff, n)
      const m = await read(page)
      if (SHOTS && n === 120 && (engine === 'chromium' ? w === 375 || w === 440 : w === 375))
        await page.screenshot({ path: join(SHOT_DIR, `${engine}-${w}-${lang}-${month}-n${n}-${staff}.png`), clip: { x: 0, y: 0, width: w, height: 200 } })
      await ctx.close()
      await resizeTo(wide.page, w)
      let r = await read(wide.page)
      // The ResizeObserver walk landing after those two frames is counted
      // (never hidden): read again 600ms later, and the LATER read is judged.
      if (r.trim !== m.trim) {
        await wide.page.waitForTimeout(600)
        const again = await read(wide.page)
        if (again.trim !== r.trim) {
          lateResizeWalks += 1
          console.error(`[fit] late resize walk: ${tag}: "${r.trim}" → "${again.trim}" after 600ms`)
        }
        r = again
      }
      await resizeTo(wide.page, 800)

      const avail = w - 32
      const rule = ruleFor(avail, natural0, natural1, natural2, natural1 != null)
      const own = m.trim.includes('ownRow')
      const dropped = m.trim.includes('shinkiCount')
      const spareEnd = avail - m.asRendered
      const bad = []
      if (m.trim !== rule) bad.push(`engine "${m.trim}" ≠ rule "${rule}"`)
      if (r.trim !== m.trim) bad.push(`resize walk "${r.trim}" ≠ first-paint "${m.trim}"`)
      if (m.track !== avail) bad.push(`track ${m.track} ≠ w − 32 = ${avail}`)
      if (m.content > m.track + TOL) bad.push(`overflow ${m.content}>${m.track}`)
      if (m.pageScrollX > 0) bad.push(`page scrolls sideways ${m.pageScrollX}px`)
      if (!own && m.lines !== 1) bad.push(`${m.lines} lines without the own-row step`)
      if (own && (m.lines !== 2 || !m.chipTopIsMonthTop)) bad.push(`own-row step but ${m.lines} line(s) / 新規 not on line 1`)
      if (!m.wordShown) bad.push('the word 新規 is not shown')
      if (m.countShown === dropped) bad.push(`count shown=${m.countShown} with step 2 ${dropped ? 'applied' : 'not applied'}`)
      if (dropped !== m.countSrOnly) bad.push(`count sr-only=${m.countSrOnly} vs step 2 ${dropped}`)
      if (m.chipAccName !== w0.chipAccName) bad.push(`chip name "${m.chipAccName}" ≠ untrimmed "${w0.chipAccName}"`)
      if (!m.chipAccName || !m.chipAccName.startsWith(WORD[lang]) || !m.chipAccName.includes(String(n))) bad.push(`chip name "${m.chipAccName}" lacks the word or the count ${n}`)
      if (!m.monthName || !m.monthName.includes(m.monthText)) bad.push(`month chip name "${m.monthName}" vs text "${m.monthText}"`)
      if (staff !== 'all' && m.controlName !== STAFF[staff].name) bad.push(`control name "${m.controlName}" ≠ "${STAFF[staff].name}"`)
      if (errors.length) bad.push(`page errors: ${errors.join(' | ')}`)
      if (bad.length) failures.push(`${tag}: ${bad.join('; ')}`)
      out.push({ engine, w, lang, month, n, staff, natural0, natural1, natural2, rule, applied: m.trim, resizeApplied: r.trim, spareEnd, m, pass: !bad.length, bad })
    }
    await wide.ctx.close()
    if (wide.errors.length) failures.push(`${engine} ${lang} ${month} n=${n} ${staff} @800: page errors ${wide.errors.join(' | ')}`)
  }
  await browser.close()
  return out
}

const results = await Promise.all(ENGINES.map((e) => runEngine(e)))
for (const r of results) cases.push(...r)
server.close()
if (blocked > 0) failures.push(`${blocked} request(s) left the harness origin (aborted)`)
const findings = cases.filter((c) => c.spareEnd < SPARE_MIN).map((c) => `${c.engine} ${c.w} ${c.lang} ${c.month} n=${c.n} ${c.staff}: end spare ${c.spareEnd.toFixed(1)} after "${c.applied}" (line 1 ${c.m.line1.toFixed(1)} · line 2 ${c.m.line2.toFixed(1)} · as rendered ${c.m.asRendered.toFixed(1)} of ${c.w - 32})`)

// ── 4. the S45 c-measure comparison (WITH the chip).
let expectations = null
const deviations = []
if (CM && existsSync(CM)) {
  const cm = JSON.parse(readFileSync(CM, 'utf8'))
  const cmRow = (engine, lang, s, shape, count) =>
    cm.rows.find((r) => r.engine === engine && r.lang === lang && r.month === 'cur-09' && r.s === s && r.shape === shape && r.count === count)?.natural
  const chip = (engine, lang, mm) => cm.chip.find((c) => c.engine === engine && c.lang === lang && c.mm === mm)
  expectations = []
  for (const c of cases) {
    const s = c.staff
    const C1 = cmRow(c.engine, c.lang, s, 'C1', '12')
    const C1x = cmRow(c.engine, c.lang, s, 'C1', '128')
    const C2 = cmRow(c.engine, c.lang, s, 'C2', '12')
    const Bx = cmRow(c.engine, c.lang, s, 'Bx', '')
    const M = MONTHS[c.month]
    const chip09 = chip(c.engine, c.lang, '09').short
    const monthW = chip(c.engine, c.lang, M.mm)[M.kind]
    const digit = C1x - C1
    const adj = (String(c.n).length - 2) * digit
    const exp0 = C1 - chip09 + monthW + adj
    const exp1 = c.natural1 == null ? null : C2 - chip09 + monthW + adj
    const exp2 = Bx - chip09 + monthW
    const avail = c.w - 32
    const expRule = ruleFor(avail, exp0, exp1, exp2, c.natural1 != null)
    const e = { ...c, exp0, exp1, exp2, expRule, expMonthW: monthW, d0: c.natural0 - exp0, d1: exp1 == null ? null : c.natural1 - exp1, d2: c.natural2 - exp2, dMonth: c.m.monthW - monthW }
    expectations.push(e)
    const t = `${c.engine} ${c.w} ${c.lang} ${c.month} n=${c.n} ${c.staff}`
    if (Math.abs(e.d0) > TOL) deviations.push(`${t}: natural ${c.natural0.toFixed(1)} vs c-measure-derived ${exp0.toFixed(1)} (Δ ${e.d0.toFixed(1)})`)
    if (e.d1 != null && Math.abs(e.d1) > TOL) deviations.push(`${t}: badge-only natural ${c.natural1.toFixed(1)} vs ${exp1.toFixed(1)} (Δ ${e.d1.toFixed(1)})`)
    if (Math.abs(e.d2) > TOL) deviations.push(`${t}: no-count natural ${c.natural2.toFixed(1)} vs ${exp2.toFixed(1)} (Δ ${e.d2.toFixed(1)})`)
    if (Math.abs(e.dMonth) > TOL) deviations.push(`${t}: month chip ${c.m.monthW.toFixed(1)} vs c-measure ${monthW.toFixed(1)}`)
    if (expRule !== c.applied) deviations.push(`${t}: steps "${c.applied}" vs c-measure-derived "${expRule}"`)
  }
}

// ── 5. the table (script-emitted; every number read off the page).
const f1 = (n) => (n == null ? '—' : (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1))
const px = (n) => (n == null ? '—' : n.toFixed(1))
const stepName = (t) => (t === '' ? 'none' : t.replace('badgeOnly', '1 badge').replace('shinkiCount', '2 no count').replace('ownRow', '3 own row'))
const pwv = require('playwright/package.json').version
let md = `# Fit proof — S46 LEG 1b: the 新規 chip ON on option C (the カルテ chip row [month][新規 N][自分 | 全スタッフ ⌄] + trim step 2)\n\n`
md += `Generated by \`node scripts/fit-harness/shinki-on-c.mjs\` (Playwright ${pwv}; headless Chromium, and WebKit as a phone — isMobile + hasTouch; dsf 2; the app's own fonts via thin/fonts.css; the REAL カルテ view, fixture data; the chip ON only through the harness-only registry, \`KARUTE_SWITCHES.shinkiChip\` = false in source). Every number is read off the page. Requests that left the harness origin: ${blocked}. Page loads re-opened after a navigation timeout: ${retries}. Page errors: ${cases.filter((c) => c.bad.some((b) => b.startsWith('page errors'))).length}.\n\n`
md += `Spare = (w − 32) − natural (one-line max-content width); a step applies only while spare < ${SPARE_MIN}, in the order 1 badge → 2 no count → 3 own row (1 left out without a picked name). **natural** = nothing trimmed; **badge** = the picked name's text hidden; **no count** = step 1 (if a name) + the 新規 count hidden; **applied** = the steps the engine chose on a fresh load (first-paint walk; the 800px page resized to w agreed unless listed under FAILURES); **end** = the spare left after the applied steps (own row: w − 32 − the wider of its two lines). WebKit values; Chromium in brackets where it differs by > 0.3px.\n\n`
md += `| w | lang | month (chip) | 新規 | picked | natural | spare | badge | spare | no count | spare | applied | end | rule |${expectations ? ' c-measure-derived natural · steps |' : ''}\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|${expectations ? '---|' : ''}\n`
for (const lang of LANGS) for (const month of Object.keys(MONTHS)) for (const n of COUNTS) for (const staff of Object.keys(STAFF)) for (const w of WIDTHS) {
  const k = cases.find((c) => c.engine === 'webkit' && c.w === w && c.lang === lang && c.month === month && c.n === n && c.staff === staff)
  const ch = cases.find((c) => c.engine === 'chromium' && c.w === w && c.lang === lang && c.month === month && c.n === n && c.staff === staff)
  const alt = (a, b, fmt) => fmt(a) + (a != null && b != null && Math.abs(a - b) > 0.3 ? ` (${fmt(b)})` : '')
  const av = w - 32
  const sp = (x) => (x == null ? null : av - x)
  const stepsCell = stepName(k.applied) + (ch.applied !== k.applied ? ` (${stepName(ch.applied)})` : '')
  const e = expectations?.find((x) => x.engine === 'webkit' && x.w === w && x.lang === lang && x.month === month && x.n === n && x.staff === staff)
  md += `| ${w} | ${lang} | ${month} (${k.m.monthText}) | ${n} | ${STAFF[staff].name} | ${alt(k.natural0, ch.natural0, px)} | ${alt(sp(k.natural0), sp(ch.natural0), f1)} | ${alt(k.natural1, ch.natural1, px)} | ${alt(sp(k.natural1), sp(ch.natural1), f1)} | ${alt(k.natural2, ch.natural2, px)} | ${alt(sp(k.natural2), sp(ch.natural2), f1)} | ${stepsCell} | ${alt(k.spareEnd, ch.spareEnd, f1)}${k.spareEnd < SPARE_MIN || ch.spareEnd < SPARE_MIN ? ' **FINDING**' : ''} | ${k.rule === k.applied && ch.rule === ch.applied ? 'matches' : '**MISMATCH**'} |${e ? ` ${px(e.exp0)} · ${stepName(e.expRule)} |` : ''}\n`
}
const passN = cases.filter((c) => c.pass).length
md += `\n## Checks per case (${cases.length} cases = ${ENGINES.length} engines × ${WIDTHS.length} widths × ${LANGS.length} langs × 3 months × ${COUNTS.length} counts × ${Object.keys(STAFF).length} picks)\n\n`
md += `- PASS ${passN} / ${cases.length}: the engine's steps = the rule on the measured numbers; the resize walk = the first-paint walk; track = w − 32; nothing overflows its track; no sideways page scroll; one line unless the own-row step (own row: exactly 2 lines, 新規 on line 1 with the month); the word 新規 always shown; the count shown exactly when step 2 is not applied (sr-only when it is); the chip's accessible name (Playwright's) = the untrimmed one and carries the word and the count; the month chip's name contains its visible label; a picked staffer's control is named by the FULL name.\n`
md += `- Steps seen: ${[...new Set(cases.map((c) => stepName(c.applied)))].join(' · ')}.\n`
md += `- Chip accessible names seen: ${[...new Set(cases.map((c) => `"${c.m.chipAccName}"`))].slice(0, 12).join(' · ')}.\n`
md += `- End spare ≥ ${SPARE_MIN} after the steps: ${cases.length - findings.length} / ${cases.length}${findings.length ? ` — ${findings.length} FINDING(s) below` : ''}.\n`
md += `- Resize walks that landed later than two frames after the page saw its new width (read again 600ms later; the later read is the one judged): ${lateResizeWalks}.\n`
md += `- Month picks (another year) went through the real panel; its month read answered from the harness fixture (./actions-karute.ts). Fetches the page tried to send to another origin (held, never sent): ${cases.reduce((a, c) => a + c.m.held, 0)}; requests that left the harness: ${blocked}.\n`
if (findings.length) md += `\n## FINDINGS — end spare < ${SPARE_MIN} even with the steps applied (${findings.length})\n\n${findings.map((x) => `- ${x}`).join('\n')}\n`
if (expectations) {
  md += `\n## Against S45's c-measure (with the 新規 chip)\n\nExpected natural = c-measure's cur-09 row (C1 = name, C2 = badge, count 12; Bx = badge, no count) − its month chip (9月 / Sep) + this case's month chip (c-measure chip table), ± one count digit per digit (C1 128 − C1 12; tabular numerals). The expected steps apply the same rule to these expected numbers.\n\n`
  md += deviations.length ? `### DEVIATIONS > ${TOL}px or a different step (${deviations.length})\n\n${deviations.map((d) => `- ${d}`).join('\n')}\n` : `No deviation > ${TOL}px, and the same steps as the c-measure-derived expectation, in all ${expectations.length} cases (max |Δ natural| ${Math.max(...expectations.map((e) => Math.abs(e.d0))).toFixed(2)}px, max |Δ badge| ${Math.max(...expectations.filter((e) => e.d1 != null).map((e) => Math.abs(e.d1))).toFixed(2)}px, max |Δ no count| ${Math.max(...expectations.map((e) => Math.abs(e.d2))).toFixed(2)}px, max |Δ month chip| ${Math.max(...expectations.map((e) => Math.abs(e.dMonth))).toFixed(2)}px).\n`
}
md += failures.length ? `\n## FAILURES (${failures.length})\n\n${failures.map((x) => `- ${x}`).join('\n')}\n` : `\n## Result: PASS${findings.length ? ` (with ${findings.length} finding(s))` : ''}\n`
writeFileSync(join(OUT, 'fit-proof-s46-shinki.md'), md)
writeFileSync(join(OUT, 'fit-proof-s46-shinki.json'), JSON.stringify({ playwright: pwv, blocked, retries, lateResizeWalks, failures, findings, deviations, cases: expectations ?? cases }, null, 1))
console.log(`cases ${cases.length} · pass ${passN} · failures ${failures.length} · findings ${findings.length} · deviations ${expectations ? deviations.length : 'n/a'} · late resize walks ${lateResizeWalks} · requests left ${blocked} · retries ${retries}`)
console.log(`table: ${join(OUT, 'fit-proof-s46-shinki.md')}`)
if (failures.length) {
  console.error(failures.slice(0, 40).join('\n'))
  process.exit(1)
}
