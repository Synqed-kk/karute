#!/usr/bin/env node
// FIT PROOF — S46 option C (the カルテ chip row [month][自分 | 全スタッフ ⌄] with
// its trim engine). ONE command, offline:
//   node scripts/fit-harness/staff-control-c.mjs --out <dir> [--no-build] [--shots]
//        [--cmeasure <c-measure.json>] [--abmeasure <ab-measure.json>]
//
// Builds the fit harness (./vite.config.ts, entry ./main.tsx — the REAL カルテ
// view on fixture data, `&roster=wide` adds an 8-character name), serves it
// on 127.0.0.1 and drives Playwright's own headless Chromium and WebKit AS A
// PHONE (isMobile + hasTouch — a desktop headless WebKit keeps a 6px
// scrollbar that fakes a 6px loss). Never a shared browser. Every request that
// is not the harness's own origin is aborted and counted (must be 0); the
// page's fetch is held (never resolved, never sent) for non-origin URLs, so a
// month pick's data read goes nowhere.
//
// Matrix: 375 · 393 · 402 · 440 × ja/en × month 9 and 10 of the current year
// and month 10 of another year × 全スタッフ / 鈴木 友梨佳 / 勘解由小路美和子.
// The page clock is fixed (2026-09-15 / 2026-10-15 JST; another year = the
// clock at 2027-01-15 and 2026年10月 picked from the panel).
//
// Per case, every number read off the page:
//   natural0 — the row's one-line max-content width with NOTHING trimmed (a
//              fresh load at 800px, where nothing trims);
//   natural1 — the same with the picked name's text hidden (step 1's look);
//   at each width, a FRESH load (the first-paint walk) → the steps the engine
//   applied (data-trim), the row's one-line natural at those steps, whether
//   it fits (content ≤ track, no sideways page scroll, one line unless the
//   own-row step), the month chip's and the control's accessible names; and
//   the 800px page RESIZED to that width (the ResizeObserver walk) → its
//   steps, which must agree.
// Rule check: the engine's steps must equal the rule computed from these same
// measured numbers (spare = (w − 32) − natural; a step only while < 6).
// c-measure comparison (optional, the S45 numbers): the expected natural0 /
// natural1 WITHOUT the 新規 chip, derived as
//   control_badge = Bx − chip(09, month-only) − 8 − 新規(no count) − 8
//   control_full  = control_badge + (C1 − C2)            (count 12 rows)
//   expected      = chip(this case's label) + 8 + control
// with 新規(no count) from ab-measure's chipWidths. |mine − expected| > 1px =
// DEVIATION (reported, never tuned away).
// Emits <out>/fit-proof-s46.md + .json. Exit 1 on any FAIL (not on a
// deviation). Only the server this script starts is ever stopped.
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
const OUT = resolve(opt('--out', join(ROOT, 'node_modules/.cache/fit-harness-out/staff-control-c')))
const SHOTS = flag('--shots')
const CM = opt('--cmeasure', null)
const AB = opt('--abmeasure', null)
mkdirSync(OUT, { recursive: true })
if (SHOTS) mkdirSync(join(OUT, 'shots'), { recursive: true })

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
const STAFF = { all: { s: null, name: '全スタッフ', cm: 'all' }, 'staff-3': { s: 'staff-3', name: '鈴木 友梨佳', cm: 'staff-3' }, 'staff-8': { s: 'staff-8', name: '勘解由小路美和子', cm: 'staff-8' } }
const SPARE_MIN = 6
const TOL = 1

let blocked = 0
const failures = []
const cases = []

// A headless WebKit navigation very occasionally never reaches
// domcontentloaded on this harness (seen once in ~180 loads, S46); such a
// load is thrown away whole and re-opened in a fresh context, at most twice,
// and every retry is counted in the output.
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

async function openOnce(browser, engine, w, lang, month, staff) {
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
  const p = new URLSearchParams({ tab: 'karute', lang, roster: 'wide' })
  if (STAFF[staff].s) p.set('s', STAFF[staff].s)
  try {
    await page.goto(`${ORIGIN}/?${p}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForSelector('[data-chip-row] [data-staff-scope]', { timeout: 15000 })
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
  await settle(page)
  return { ctx, page, errors }
}

/** Two frames: a ResizeObserver walk and any font swap land before we read. */
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

// Everything read off the row. `oneLine(hideName)` = the row's max-content
// width forced to one line (no wrap, the own-row break hidden), optionally
// with the picked name's text hidden — measured, then every style restored.
async function read(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-chip-row]')
    const chip = row.querySelector(':scope > div:first-child > button')
    const scope = row.querySelector('[data-staff-scope]')
    const buttons = [...scope.querySelectorAll('button')]
    const brk = row.querySelector('[data-row-break]')
    const oneLine = (hideName) => {
      const name = scope.querySelector('.truncate')
      const prev = [row.style.width, row.style.flexWrap, name?.style.display, brk?.style.display]
      row.style.width = 'max-content'
      row.style.flexWrap = 'nowrap'
      if (brk) brk.style.display = 'none'
      if (hideName && name) name.style.display = 'none'
      const w = row.getBoundingClientRect().width
      row.style.width = prev[0]
      row.style.flexWrap = prev[1]
      if (brk) brk.style.display = prev[3] ?? ''
      if (name) name.style.display = prev[2] ?? ''
      return w
    }
    const kids = [...row.children].filter((k) => !k.hasAttribute('data-row-break'))
    const tops = kids.map((k) => Math.round(k.getBoundingClientRect().top))
    // The label segment: the pressed-state button that is not 自分 (自分 has
    // no aria-label; the label carries one only for a picked name).
    const seg2 = buttons.find((b) => b.hasAttribute('aria-pressed') && b !== buttons[0]) ?? buttons[0]
    const accName = (b) => b.getAttribute('aria-label') ?? b.textContent.trim()
    return {
      trim: row.getAttribute('data-trim') ?? '',
      rowClass: row.className,
      natural: oneLine(false),
      naturalNoName: oneLine(true),
      hasName: !!scope.querySelector('.truncate'),
      track: row.clientWidth,
      content: row.scrollWidth,
      lines: new Set(tops).size,
      pageScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chipW: chip.getBoundingClientRect().width,
      chipText: chip.textContent.trim(),
      chipName: chip.getAttribute('aria-label'),
      controlW: scope.parentElement.getBoundingClientRect().width,
      controlName: accName(seg2),
      controlText: seg2.textContent.trim(),
      held: window.__heldFetches ?? 0,
    }
  })
}

for (const engine of ENGINES) {
  const browser = await pw[engine].launch()
  for (const lang of LANGS) {
    for (const month of Object.keys(MONTHS)) {
      for (const staff of Object.keys(STAFF)) {
        if (process.env.FIT_DEBUG) console.error(`[fit] ${engine} ${lang} ${month} ${staff}`)
        // Wide: nothing trims — natural0 / natural1 for this content.
        const wide = await open(browser, engine, 800, lang, month, staff)
        const w0 = await read(wide.page)
        if (w0.trim) failures.push(`${engine} ${lang} ${month} ${staff} @800: trimmed "${w0.trim}" where nothing should`)
        const natural0 = w0.natural
        const natural1 = w0.hasName ? w0.naturalNoName : null
        for (const w of WIDTHS) {
          const tag = `${engine} ${w} ${lang} ${month} ${staff}`
          // Fresh load at w — the first-paint walk.
          const { ctx, page, errors } = await open(browser, engine, w, lang, month, staff)
          const m = await read(page)
          if (SHOTS && engine === 'chromium' && (w === 375 || w === 440) && (staff !== 'staff-3'))
            await page.screenshot({ path: join(OUT, 'shots', `${engine}-${w}-${lang}-${month}-${staff}.png`), clip: { x: 0, y: 0, width: w, height: 200 } })
          await ctx.close()
          // The wide page resized to w — the ResizeObserver walk.
          await wide.page.setViewportSize({ width: w, height: 900 })
          await settle(wide.page)
          const r = await read(wide.page)
          await wide.page.setViewportSize({ width: 800, height: 900 })
          await settle(wide.page)

          const avail = w - 32
          const spare0 = avail - natural0
          const spare1 = natural1 == null ? null : avail - natural1
          const steps = natural1 != null ? ['badgeOnly', 'ownRow'] : ['ownRow']
          const rule = spare0 >= SPARE_MIN ? '' : natural1 != null && spare1 >= SPARE_MIN ? 'badgeOnly' : steps.join(' ')
          const own = m.trim.includes('ownRow')
          const bad = []
          if (m.trim !== rule) bad.push(`engine "${m.trim}" ≠ rule "${rule}"`)
          if (r.trim !== m.trim) bad.push(`resize walk "${r.trim}" ≠ first-paint "${m.trim}"`)
          if (m.track !== avail) bad.push(`track ${m.track} ≠ w − 32 = ${avail}`)
          if (m.content > m.track + TOL) bad.push(`overflow ${m.content}>${m.track}`)
          if (m.pageScrollX > 0) bad.push(`page scrolls sideways ${m.pageScrollX}px`)
          if (!own && m.lines !== 1) bad.push(`${m.lines} lines without the own-row step`)
          if (own && m.lines !== 2) bad.push(`own-row step but ${m.lines} line(s)`)
          if (!m.chipName || !m.chipName.includes(m.chipText)) bad.push(`chip name "${m.chipName}" vs text "${m.chipText}"`)
          if (staff !== 'all' && m.controlName !== STAFF[staff].name) bad.push(`control name "${m.controlName}" ≠ "${STAFF[staff].name}"`)
          if (errors.length) bad.push(`page errors: ${errors.join(' | ')}`)
          if (bad.length) failures.push(`${tag}: ${bad.join('; ')}`)
          cases.push({ engine, w, lang, month, staff, natural0, natural1, spare0, spare1, rule, applied: m.trim, resizeApplied: r.trim, naturalApplied: m.natural, m, pass: !bad.length, bad })
        }
        await wide.ctx.close()
        if (wide.errors.length) failures.push(`${engine} ${lang} ${month} ${staff} @800: page errors ${wide.errors.join(' | ')}`)
      }
    }
  }
  await browser.close()
}
server.close()
if (blocked > 0) failures.push(`${blocked} request(s) left the harness origin (aborted)`)

// ── 4. the S45 c-measure expectation, WITHOUT the 新規 chip.
let expectations = null
let shinkiNone = null
const deviations = []
if (CM && AB && existsSync(CM) && existsSync(AB)) {
  const cm = JSON.parse(readFileSync(CM, 'utf8'))
  const ab = JSON.parse(readFileSync(AB, 'utf8'))
  shinkiNone = {}
  for (const line of ab.chipWidths) {
    const x = /^(ja|en) \w+ count=none: ([\d.]+)$/.exec(line)
    if (x) shinkiNone[x[1]] = Number(x[2])
  }
  const cmRow = (engine, lang, s, shape, count) =>
    cm.rows.find((r) => r.engine === engine && r.lang === lang && r.month === 'cur-09' && r.s === s && r.shape === shape && r.count === count)
  const chip = (engine, lang, mm) => cm.chip.find((c) => c.engine === engine && c.lang === lang && c.mm === mm)
  expectations = []
  for (const c of cases) {
    const S = STAFF[c.staff].cm
    const Bx = cmRow(c.engine, c.lang, S, 'Bx', '').natural
    const C1 = cmRow(c.engine, c.lang, S, 'C1', '12').natural
    const C2 = cmRow(c.engine, c.lang, S, 'C2', '12').natural
    const chip09 = chip(c.engine, c.lang, '09').short
    const M = MONTHS[c.month]
    const monthW = chip(c.engine, c.lang, M.mm)[M.kind]
    const controlBadge = Bx - chip09 - 8 - shinkiNone[c.lang] - 8
    const controlFull = controlBadge + (C1 - C2)
    const exp0 = monthW + 8 + controlFull
    const exp1 = c.natural1 == null ? null : monthW + 8 + controlBadge
    const avail = c.w - 32
    const expRule = avail - exp0 >= SPARE_MIN ? '' : exp1 != null && avail - exp1 >= SPARE_MIN ? 'badgeOnly' : c.natural1 != null ? 'badgeOnly ownRow' : 'ownRow'
    const e = { ...c, exp0, exp1, expMonthW: monthW, expRule, d0: c.natural0 - exp0, d1: exp1 == null ? null : c.natural1 - exp1, dMonth: c.m.chipW - monthW }
    expectations.push(e)
    if (Math.abs(e.d0) > TOL) deviations.push(`${c.engine} ${c.w} ${c.lang} ${c.month} ${c.staff}: natural ${c.natural0.toFixed(1)} vs c-measure-derived ${exp0.toFixed(1)} (Δ ${e.d0.toFixed(1)})`)
    if (e.d1 != null && Math.abs(e.d1) > TOL) deviations.push(`${c.engine} ${c.w} ${c.lang} ${c.month} ${c.staff}: badge-only natural ${c.natural1.toFixed(1)} vs ${exp1.toFixed(1)} (Δ ${e.d1.toFixed(1)})`)
    if (Math.abs(e.dMonth) > TOL) deviations.push(`${c.engine} ${c.w} ${c.lang} ${c.month}: month chip ${c.m.chipW.toFixed(1)} vs c-measure ${monthW.toFixed(1)}`)
    if (expRule !== c.applied) deviations.push(`${c.engine} ${c.w} ${c.lang} ${c.month} ${c.staff}: steps "${c.applied}" vs c-measure-derived "${expRule}"`)
  }
}

// ── 5. the table (script-emitted; every number read off the page).
const f1 = (n) => (n == null ? '—' : (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1))
const px = (n) => (n == null ? '—' : n.toFixed(1))
const stepName = (t) => (t === '' ? 'none' : t.replace('badgeOnly', '1 badge only').replace('ownRow', '3 own row'))
const pwv = require('playwright/package.json').version
let md = `# Fit proof — S46 option C (the カルテ chip row [month][自分 | 全スタッフ ⌄] + its trim engine)\n\n`
md += `Generated by \`node scripts/fit-harness/staff-control-c.mjs\` (Playwright ${pwv}; headless Chromium, and WebKit as a phone — isMobile + hasTouch; dsf 2; the app's own fonts via thin/fonts.css; the REAL カルテ view, fixture data). Every number is read off the page. Requests that left the harness origin: ${blocked}. Page loads re-opened after a navigation timeout: ${retries}. Page errors: ${cases.filter((c) => c.bad.some((b) => b.startsWith('page errors'))).length}.\n\n`
md += `Spare = (w − 32) − natural (one-line max-content width); a step applies only while spare < ${SPARE_MIN}. **natural** = nothing trimmed; **badge** = the picked name's text hidden (step 1's look); **applied** = the steps the engine chose on a fresh load at that width (its first-paint walk); the same page resized from 800px (its ResizeObserver walk) agreed in every row unless listed under FAILURES. WebKit values; Chromium in brackets where it differs by > 0.3px.\n\n`
md += `| w | lang | month (chip label) | picked | natural | spare | badge | spare | applied | rule on these numbers |${expectations ? ' c-measure-derived natural · steps |' : ''}\n|---|---|---|---|---|---|---|---|---|---|${expectations ? '---|' : ''}\n`
for (const lang of LANGS) for (const month of Object.keys(MONTHS)) for (const staff of Object.keys(STAFF)) for (const w of WIDTHS) {
  const k = cases.find((c) => c.engine === 'webkit' && c.w === w && c.lang === lang && c.month === month && c.staff === staff)
  const ch = cases.find((c) => c.engine === 'chromium' && c.w === w && c.lang === lang && c.month === month && c.staff === staff)
  const alt = (a, b, fmt) => fmt(a) + (a != null && b != null && Math.abs(a - b) > 0.3 ? ` (${fmt(b)})` : '')
  const stepsCell = stepName(k.applied) + (ch.applied !== k.applied ? ` (${stepName(ch.applied)})` : '')
  const e = expectations?.find((x) => x.engine === 'webkit' && x.w === w && x.lang === lang && x.month === month && x.staff === staff)
  md += `| ${w} | ${lang} | ${month} (${k.m.chipText}) | ${STAFF[staff].name} | ${alt(k.natural0, ch.natural0, px)} | ${alt(k.spare0, ch.spare0, f1)} | ${alt(k.natural1, ch.natural1, px)} | ${alt(k.spare1, ch.spare1, f1)} | ${stepsCell} | ${k.rule === k.applied && ch.rule === ch.applied ? 'matches' : '**MISMATCH**'} |${e ? ` ${px(e.exp0)} · ${stepName(e.expRule)} |` : ''}\n`
}
const passN = cases.filter((c) => c.pass).length
md += `\n## Checks per case (${cases.length} cases = 2 engines × ${WIDTHS.length} widths × 2 langs × 3 months × 3 picks)\n\n`
md += `- PASS ${passN} / ${cases.length}: the engine's steps = the rule on the measured numbers; the resize walk = the first-paint walk; the row's track = w − 32; nothing overflows its track; the page never scrolls sideways; one line unless the own-row step; the month chip's accessible name contains its visible label (full year + month); a picked staffer's control is named by the FULL name.\n`
md += `- Steps seen: ${[...new Set(cases.map((c) => stepName(c.applied)))].join(' · ')}.\n`
md += `- Month picks (another year) went through the real panel. Fetches the page tried to send to another origin (held, never sent) over the fresh loads: ${cases.reduce((a, c) => a + c.m.held, 0)}; requests that left the harness: ${blocked}.\n`
if (expectations) {
  md += `\n## Against S45's c-measure (the 新規 chip taken out)\n\nExpected natural = chip(this label) + 8 + control; control_badge = Bx − chip(09, month-only) − 8 − 新規(no count) − 8, control_full = control_badge + (C1 − C2), from c-measure's cur-09 rows (count 12) per engine and language; 新規(no count) = ${Object.entries(shinkiNone).map(([k, v]) => `${k} ${v}`).join(' · ')}px (ab-measure chipWidths). Month chip widths compared with c-measure's chip table directly. The expected steps apply the same 6px rule to these expected numbers.\n\n`
  md += deviations.length ? `### DEVIATIONS > ${TOL}px or a different step (${deviations.length})\n\n${deviations.map((d) => `- ${d}`).join('\n')}\n` : `No deviation > ${TOL}px, and the same steps as the c-measure-derived expectation, in all ${expectations.length} cases (max |Δ natural| ${Math.max(...expectations.map((e) => Math.abs(e.d0))).toFixed(2)}px, max |Δ badge| ${Math.max(...expectations.filter((e) => e.d1 != null).map((e) => Math.abs(e.d1))).toFixed(2)}px, max |Δ month chip| ${Math.max(...expectations.map((e) => Math.abs(e.dMonth))).toFixed(2)}px).\n`
}
md += failures.length ? `\n## FAILURES (${failures.length})\n\n${failures.map((x) => `- ${x}`).join('\n')}\n` : `\n## Result: PASS\n`
writeFileSync(join(OUT, 'fit-proof-s46.md'), md)
writeFileSync(join(OUT, 'fit-proof-s46.json'), JSON.stringify({ playwright: pwv, blocked, retries, failures, deviations, cases: expectations ?? cases }, null, 1))
console.log(`cases ${cases.length} · pass ${passN} · failures ${failures.length} · deviations ${expectations ? deviations.length : 'n/a'} · requests left ${blocked} · retries ${retries}`)
console.log(`table: ${join(OUT, 'fit-proof-s46.md')}`)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
