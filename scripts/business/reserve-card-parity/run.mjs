#!/usr/bin/env node
// Reserve member-card PARITY harness (PKT-A1a) — ONE command:
//   node scripts/business/reserve-card-parity/run.mjs
//
// Proves src/business/lib/reserve-card/ (the port) draws the member card's three surfaces exactly as
// Reserve @ c2a9f95 draws them, pixel for pixel, in the same headless Chromium:
//   1. exports Reserve at the pin (git archive, never a checkout), proves the copy's tree IS the pin's
//      tree, `npm ci`; the ONLY file it ever rewrites there is the mock seed src/lib/mock.ts (a case's
//      card colour / display name) — `git diff --stat` in the copy is printed at the end as the fence;
//   2. runs Reserve's own vite dev server (mock mode) and a throwaway vite app that renders the port
//      inside Business's own globals.css (Tailwind + base layer, as the Business app loads it) — no
//      route is added to the Business app, no karute e2e suite runs, nothing reaches core;
//   3. Playwright's own headless Chromium, 393×852 @2x: screenshots the element boxes of .mcard,
//      .tcard, .salon-cover on both sides per case and compares RGB pixel by pixel;
//   4. emits src/__tests__/integration/business/reserve-card.expected-satin.json (Reserve's own satinVars
//      output, read by the unit test beside it), the module's PARITY.md, and
//      <PARITY_DIR>/parity/parity-report.md with every PNG + a diff PNG.
// PASS = 0 differing pixels on every surface of every case, and every verbatim block identical (any DIFFER
// fails the run). Exit code 1 otherwise.
//
// env: PARITY_REPO (the karute checkout holding src/business/lib/reserve-card/ — its module, globals.css,
//      node_modules and emitted files; default = the checkout this script sits in, so from a checkout
//      of the harness alone point it at the port's checkout) · PARITY_DIR (work dir; default
//      <tmpdir>/reserve-card-parity) · RESERVE_REPO (default <PARITY_REPO>/../reserve)
//      PARITY_W (the lane folder; when given, its satin fixtures are cross-checked) · PARITY_DIAG=1
//      (also dumps computed-style differences per surface — the first tool to reach for on a diff) ·
//      PARITY_ONLY=p01,long (a subset of cases, while investigating; the proof is the full run).
// Only the PIDs this script starts are ever stopped.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(process.env.PARITY_REPO ?? resolve(HERE, '../../..'))
const require = createRequire(join(ROOT, 'package.json'))
const PIN = 'c2a9f9543187bff689307e22a6fcfa29f02a5215'
const RESERVE = resolve(process.env.RESERVE_REPO ?? join(ROOT, '../reserve'))
const WORK = resolve(process.env.PARITY_DIR ?? join(tmpdir(), 'reserve-card-parity'))
const W = process.env.PARITY_W // the lane folder, optional: its satin fixtures are cross-checked when given
const COPY = join(WORK, 'reserve-c2a9f95')
const APP = join(WORK, 'port-app')
const OUT = join(WORK, 'parity')
const MOD = join(ROOT, 'src/business/lib/reserve-card')
const EXPECTED = join(ROOT, 'src/__tests__/integration/business/reserve-card.expected-satin.json')
const NOW = '2026-09-14T10:00:00+09:00' // the port's sample date (9/14（月）14:30) is Reserve's mock at this instant

// The 12 curated values (W/CARD-LOOK-HANDOVER.json) and the six extra satin fixtures
// (W/PARITY-SATIN-FIXTURES.json). Inputs only — every expected output is emitted by Reserve's module.
const PALETTE = [
  ['標準（紺）', '#1C2247'], ['藍', '#00304C'], ['深緑', '#1F3D33'], ['松葉色', '#2D4722'],
  ['墨', '#26282B'], ['焦茶', '#4A2E22'], ['えんじ', '#6B1F2B'], ['紫紺', '#3B2A4F'],
  ['生成り', '#EDE6D6'], ['白', '#F2F4F3'], ['桜', '#F1D9DC'], ['空色', '#D7E6F2'],
]
const EXTRA = ['#285643', '#9A5137', '#2563EB', '#808080', '#FFFFFF', '#000000']
// Reserve's mock seeds at the pin (src/lib/mock.ts): La Estro = the Home card + the cover, STUDIO FORCE
// = the small card (its name lives outside mock.ts, so the port's small card is compared under that name).
const SEED = {
  orgName: 'name: "La Estro",', laCard: '  cardColor: "#285643",', gymCard: '  cardColor: "#9a5137",',
  la: { name: 'La Estro', card: '#285643', primary: '#0d4a3a', store: '代官山院', address: '東京都渋谷区代官山町12-18 INO II ビル 2F' },
  gym: { name: 'STUDIO FORCE', card: '#9a5137', primary: '#a8412a' },
}
const LONG = 'アトリエ・ラエストロ東京代官山ヘアアンドスパ' // MOCK-SWITCHBOARD-v2 BIZ.laestro.long (M48), 22 characters
const CASES = [
  ...PALETTE.map(([label, hex], i) => ({ id: `p${String(i + 1).padStart(2, '0')}`, label: `${i + 1} ${label} ${hex}`, name: SEED.la.name, card: hex, gymCard: hex })),
  { id: 'long', label: `long name (${[...LONG].length} chars), seed colour`, name: LONG, card: null, gymCard: null },
  { id: 'seed', label: 'seed #285643 (legacy, off-palette)', name: SEED.la.name, card: null, gymCard: null },
]
const SIZE = { mcard: [353, 187], tcard: [353, 76], cover: [393, 295] }
// A sibling that paints over a surface's box on Reserve's page (not part of the surface): hidden there
// only, and the overlap probe below proves nothing else covers any surface on either side.
const RESERVE_HIDE = '.salon-rankfloat{visibility:hidden!important}'

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const log = (...a) => console.log(...a)
const started = []

function freePort() {
  return new Promise((ok, no) => {
    const s = createServer().on('error', no)
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) })
  })
}
async function startVite(cwd, args, env) {
  const port = await freePort()
  const child = spawn(process.execPath, [...args, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  started.push(child)
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`vite exited early in ${cwd}:\n${out}`)
    try { if ((await fetch(url)).ok) return { url, child } } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`vite did not come up in ${cwd}:\n${out}`)
}
function stopStarted() {
  for (const c of started) if (c.exitCode === null) c.kill('SIGTERM') // ONLY the PIDs started here
}

// ---- 1. Reserve at the pin ----
function exportReserve() {
  rmSync(COPY, { recursive: true, force: true })
  mkdirSync(COPY, { recursive: true })
  execFileSync('/bin/sh', ['-c', `git -C "${RESERVE}" archive ${PIN} | tar -x -C "${COPY}"`])
  const g = (...a) => sh('git', ['-C', COPY, ...a]).trim()
  g('init', '-q')
  g('add', '-A')
  g('-c', 'user.name=parity', '-c', 'user.email=parity@localhost', 'commit', '-qm', `export of ${PIN}`)
  const tree = g('write-tree'), pinTree = sh('git', ['-C', RESERVE, 'rev-parse', `${PIN}^{tree}`]).trim()
  if (tree !== pinTree) throw new Error(`export tree ${tree} != pin tree ${pinTree}`)
  log(`reserve copy: tree ${tree} == ${PIN.slice(0, 7)}^{tree} ✓`)
  sh('npm', ['ci', '--no-audit', '--no-fund'], { cwd: COPY })
  return readFileSync(join(COPY, 'src/lib/mock.ts'), 'utf8')
}
function seedMock(pristine, c) {
  let t = pristine
  const swap = (from, to) => {
    if (t.split(from).length !== 2) throw new Error(`mock.ts: expected exactly one ${JSON.stringify(from)}`)
    t = t.replace(from, to)
  }
  if (c.name !== SEED.la.name) swap(SEED.orgName, `name: ${JSON.stringify(c.name)},`)
  if (c.card) swap(SEED.laCard, `  cardColor: "${c.card}",`)
  if (c.gymCard) swap(SEED.gymCard, `  cardColor: "${c.gymCard}",`)
  writeFileSync(join(COPY, 'src/lib/mock.ts'), t)
  return t
}

// ---- 2. Reserve's own satin module → reserve-card.expected-satin.json ----
function emitExpectedSatin() {
  const inputs = [...PALETTE.map(([, h]) => h), ...EXTRA]
  const code = `import { satinVars } from ${JSON.stringify(join(COPY, 'src/lib/satin-material.ts'))};` +
    `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(inputs)}.map((h) => [h, satinVars(h)]))))`
  const out = JSON.parse(sh(process.execPath, ['--input-type=module', '--experimental-strip-types', '-e', code]))
  const doc = { source: `Synqed-kk/reserve src/lib/satin-material.ts @ ${PIN}, run under node`, emittedBy: 'scripts/business/reserve-card-parity/run.mjs', satinVars: out }
  writeFileSync(EXPECTED, JSON.stringify(doc, null, 1) + '\n')
  let cross = 'PARITY_W not given — lane fixture cross-check skipped'
  const fx = W && join(W, 'PARITY-SATIN-FIXTURES.json')
  if (fx && existsSync(fx)) {
    const rows = JSON.parse(readFileSync(fx, 'utf8')).rows
    const same = rows.filter((r) => JSON.stringify(r.real) === JSON.stringify(out[r.hex])).length
    cross = `PARITY-SATIN-FIXTURES.json real rows identical: ${same}/${rows.length}`
  }
  log(`reserve-card.expected-satin.json: ${inputs.length} inputs emitted by Reserve's module (node ${process.version}) · ${cross}`)
  return out
}

// ---- 3. the port app (Business's globals.css + the module) ----
function writePortApp() {
  rmSync(APP, { recursive: true, force: true })
  mkdirSync(APP, { recursive: true })
  symlinkSync(join(ROOT, 'node_modules'), join(APP, 'node_modules')) // scratch only: resolve react from Business
  writeFileSync(join(APP, 'index.html'), `<!doctype html>
<html lang="ja" data-theme="karute" class="font-sans antialiased">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
  <body><div id="root"></div><script type="module" src="/main.tsx"></script></body>
</html>
`)
  // Mirrors src/app/layout.tsx: <html lang="ja" data-theme="karute" class="… font-sans antialiased">.
  writeFileSync(join(APP, 'main.tsx'), `import ${JSON.stringify(join(ROOT, 'src/app/globals.css'))}
import { createRoot } from 'react-dom/client'
import { ReserveCardPreview } from ${JSON.stringify(join(MOD, 'ReserveCardPreview.tsx'))}
const q = new URLSearchParams(location.search)
createRoot(document.getElementById('root')!).render(
  <ReserveCardPreview name={q.get('name')!} storeLine={q.get('store') ?? ''} cardColor={q.get('card')}
    primaryColor={q.get('primary') ?? undefined} address={q.get('address') ?? undefined} view={q.get('view') as 'home' | 'store'} />,
)
`)
  writeFileSync(join(APP, 'vite.config.mjs'), `import { createRequire } from 'node:module'
const require = createRequire(${JSON.stringify(join(ROOT, 'package.json'))})
const tailwind = require('@tailwindcss/postcss')
export default {
  root: ${JSON.stringify(APP)},
  logLevel: 'warn',
  server: { fs: { allow: [${JSON.stringify(APP)}, ${JSON.stringify(ROOT)}] } },
  css: { postcss: { plugins: [tailwind({ base: ${JSON.stringify(ROOT)} })] } },
  esbuild: { jsx: 'automatic' },
}
`)
}

// ---- 4. the browser ----
const surfaceSel = { mcard: '.mcard', tcard: '.tcard', cover: '.salon-cover' }
async function settle(page) {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  let prev = ''
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => [...document.querySelectorAll('.mcard,.tcard,.salon-cover__wm')].map((e) => e.className + e.getBoundingClientRect().height).join('|'))
    if (now && now === prev) return
    prev = now
    await page.waitForTimeout(100)
  }
}
// What a surface looks like to the report: box, overlap probe, name lines, the long-name classes.
async function inspect(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const over = new Set()
    for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
      const top = document.elementFromPoint(r.left + (r.width * i) / 12, r.top + (r.height * j) / 12)
      if (top && top !== el && !el.contains(top)) over.add(top.tagName.toLowerCase() + '.' + String(top.className).split(' ')[0])
    }
    const lines = (node) => {
      if (!node?.firstChild) return []
      const t = node.firstChild, range = document.createRange(), rows = new Map()
      for (let i = 0; i < t.length; i++) {
        range.setStart(t, i); range.setEnd(t, i + 1)
        const b = range.getClientRects()[0]; if (!b) continue
        const k = Math.round(b.top); rows.set(k, (rows.get(k) ?? '') + t.data[i])
      }
      return [...rows.values()]
    }
    const wm = el.querySelector('.mcard__wm, .tcard__name, .salon-cover__wm')
    return {
      w: r.width, h: r.height, x: r.x, y: r.y,
      cls: el.className, wmCls: wm?.className ?? '',
      lines: lines(wm), fontSize: wm ? getComputedStyle(wm).fontSize : '',
      name: wm?.textContent ?? '', base: getComputedStyle(el).getPropertyValue('--satin-base').trim(),
      overlap: [...over],
    }
  }, sel)
}
async function grab(page, s, expect) {
  const sel = surfaceSel[s]
  const box = await inspect(page, sel)
  if (!box) throw new Error(`no ${sel} on ${page.url()}`)
  const [name, base] = expect[s]
  if (box.name !== name || box.base !== base) throw new Error(`${page.url()} ${sel}: shows ${JSON.stringify([box.name, box.base])}, expected ${JSON.stringify([name, base])}`)
  const png = await shoot(page, sel)
  const styles = process.env.PARITY_DIAG ? await diag(page, sel) : null
  return { box, png, styles }
}
async function shoot(page, sel) {
  return page.locator(sel).first().screenshot({ animations: 'disabled', caret: 'hide', scale: 'device' })
}
async function diag(page, sel) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel), out = {}
    const all = [root, ...root.querySelectorAll('*')]
    all.forEach((e, i) => {
      const key = i + ':' + e.tagName.toLowerCase() + '.' + String(e.className?.baseVal ?? e.className).split(' ')[0]
      const cs = getComputedStyle(e), o = {}
      for (const p of cs) if (!p.startsWith('--')) o[p] = cs.getPropertyValue(p)
      for (const pe of ['::before', '::after']) { const ps = getComputedStyle(e, pe); if (ps.content !== 'none') o[pe] = [...ps].filter((p) => !p.startsWith('--')).map((p) => p + ':' + ps.getPropertyValue(p)).join(';') }
      out[key] = o
    })
    return out
  }, sel)
}

// ---- 5. pixels ----
function compare(aBuf, bBuf, diffPath) {
  const { PNG } = require('playwright-core/lib/utilsBundle')
  const a = PNG.sync.read(aBuf), b = PNG.sync.read(bBuf)
  if (a.width !== b.width || a.height !== b.height) return { diff: -1, total: a.width * a.height, size: `${a.width}×${a.height} vs ${b.width}×${b.height}` }
  const d = new PNG({ width: a.width, height: a.height })
  let diff = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const same = a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2] // RGB only
    if (!same) diff++
    const fade = (v) => Math.round(255 - (255 - v) * 0.25)
    d.data[i] = same ? fade(a.data[i]) : 255
    d.data[i + 1] = same ? fade(a.data[i + 1]) : 0
    d.data[i + 2] = same ? fade(a.data[i + 2]) : 0
    d.data[i + 3] = 255
  }
  writeFileSync(diffPath, PNG.sync.write(d))
  return { diff, total: a.width * a.height }
}

// ---- 6. PARITY.md, from the files themselves ----
function writeParityMd(verbatim, scopedCheck) {
  const css = readFileSync(join(MOD, 'reserve-card.css'), 'utf8')
  const ranges = [...css.matchAll(/\/\* reserve index\.css:(\d+)–(\d+) \*\//g)].map((m) => `${m[1]}–${m[2]}`)
  // a SCOPED marker never matches the verbatim pattern above, so these blocks are neither checked nor listed as verbatim
  const scoped = [...css.matchAll(/\/\* reserve index\.css:(\d+)–(\d+) — SCOPED \(/g)].map((m) => `${m[1]}–${m[2]}`)
  const md = `# Reserve member-card port — parity record

Source pin: \`Synqed-kk/reserve\` @ \`${PIN}\` (2026-09-23 20:52:19 +0900).
Emitted by \`node scripts/business/reserve-card-parity/run.mjs\` — do not edit by hand.

## What is ported (file → Reserve range, byte-identical below each marker)
- \`satin-material.ts\` ← \`src/lib/satin-material.ts\` 1–30 (whole file)
- \`member-card-vars.ts\` ← \`src/lib/types.ts\` 162–185 (BrandTheme) · \`src/lib/reserve-api/member-ia.ts\` 238–253 (tenantGradientPair) · \`src/components/customer/salon-surface.tsx\` 36–61 (memberTenantVars)
- \`ReserveCardPreview.tsx\` ← \`studio-home.tsx\` 417–455 (the card's measure effect) · \`studio-salon.tsx\` 56–102 (the cover's measure effect) · \`membership-date.tsx\` 1–6; the JSX is Reserve's (studio-home.tsx MembershipCard 460–516, TenantCard 656–681; studio-salon.tsx StudioCover 145–230) with the edits listed in its header
- \`reserve-card.css\` ← \`src/index.css\` ${ranges.join(' · ')}, plus ONE marked context block (not verbatim: --font-sans/--font-num from index.css 33–34, body 185–191, the page root's bg-background/text-foreground, and the inherited text defaults Reserve's page hands down — re-scoped to the preview root so a host's inherited type cannot leak in), and the SCOPED blocks listed under Declared edits

Verbatim check (last run): ${verbatim}
Scoped blocks (declarations after prefix strip): ${scopedCheck}

## Declared edits (not verbatim)
- \`reserve-card.css\` ← \`src/index.css\` ${scoped.join(' · ')} (.pressable, .tap44) — SCOPED: selectors prefixed \`.member-ground \`, declarations byte-identical to Reserve. Reserve keeps both idioms global in its own app; here a global rule would reach any Business element carrying the class. Checked by the harness after stripping the prefix (see the scoped-blocks line above).
- \`ReserveCardPreview.tsx\` StudioCover, the no-store branch — fallback branch: same markup as Reserve, not pixel-proven (no store-less case in the harness set). Its category line is fixed to GENERIC 「お店」: the port carries no business type.

## Left out of index.css 4520–4685, and why
${EXCLUDED.map(([r, why]) => `- ${r} — ${why}`).join('\n')}

## Other rules the surfaces match that are NOT ported
${NOT_PORTED.map(([r, why]) => `- ${r} — ${why}`).join('\n')}

## Proof
The harness ships in its own non-Business PR (branch \`feat/business-reserve-card-parity-harness\`): a shared file never rides in a Business PR (scripts/business/check-business-isolation.mjs). From a checkout of that branch, point it at this one with \`PARITY_REPO=<this checkout>\`; once both are on main, no env is needed.

\`node scripts/business/reserve-card-parity/run.mjs\` — 12 palette values × {home, store} + a 22-character name × {home, store} + the seed's own #285643; .mcard 353×187 · .tcard 353×76 · .salon-cover 393×295 at 393px; PASS = 0 differing RGB pixels per surface and every verbatim block identical (any DIFFER fails the run). Report + PNGs: \`$PARITY_DIR/parity/\`.
The unit test (src/__tests__/integration/business/reserve-card.test.ts) reads \`reserve-card.expected-satin.json\` beside it, emitted by the harness from Reserve's own satin-material.ts.
Reserve's small card at the pin is STUDIO FORCE (its name lives outside mock.ts), so the port's small card is compared under that name and colour pair; Reserve's store page hides \`.salon-rankfloat\` (a sibling overlapping the cover's bottom edge) for the capture; the port's sample context is Reserve's demo member at 2026-09-14 10:00 JST, so Reserve's clock is frozen there.

## Shipping
\`reserve-card.css\` is imported by the client component; it ships in a route chunk only once a route imports \`ReserveCardPreview\` (Turbopack drops the unused import). Proven 2026-09-24 with a temporary probe route: \`.tap44\` and every port rule landed in the route chunk; absent from every chunk on the unwired tip.

## Keeping it in step
When Reserve changes any of these ranges, re-run the harness against the new pin; a diff = re-port, never patch.
`
  writeFileSync(join(MOD, 'PARITY.md'), md)
}
const EXCLUDED = [
  ['4521–4525 .member-shell-clearance--fab', 'the Home page root\'s bottom clearance for the tab tray + 受付 pill; the preview has neither'],
  ['4546 .salon-rankfloat', 'the rank chip under the cover (store page body), not a surface element'],
  ['4547–4549 .salon-next / __label / __date', 'the store page\'s 次回 block, not a surface element'],
  ['4591 .member-ground.salon-surface > main', 'the store page\'s main column'],
  ['4592–4630 .salon-rankfloat, .salon-next*, .salon-acts*, .salon-posts*', 'store page body (rank chip, next visit, points row, action buttons, posts) — the switchboard, LATER'],
]
const NOT_PORTED = [
  ['69–103, 302–306, 727–738 :root / .dark', 'app-wide tokens; every one the surfaces read is re-pointed by the ported .member-ground blocks (740–753, 774–825)'],
  ['193–195 ::selection', 'global text-selection tint; porting it would restyle every Business page'],
  ['322–337, 523–529, 539–542, 644–648 .member-ground (tray / column)', 'tab-tray geometry and the page column; nothing in the surfaces reads them'],
  ['930–932 .member-ground main.main--greet', 'the preview has no <main>; its only job (padding-top 0) is the wrapper\'s own default'],
  ['1427–1443 .copy-ok', 'no element opts back into selection'],
  ['1473–1512 button / row / deal press tiers', 'match no element of the three surfaces'],
  ['1513–1527 :focus-visible rings', 'the preview holds no focusable element (its anchors carry no href)'],
  ['146–170 .salon-surface', 'the store page root\'s tenant re-skin (ground, role tints); the cover reads none of it'],
  ['4509–4512 .member-shell-clearance', 'page-root clearance for the tray'],
]

// ---- main ----
async function main() {
  if (!existsSync(join(MOD, 'ReserveCardPreview.tsx'))) throw new Error(`no port module at ${MOD} — set PARITY_REPO to the checkout that holds it`)
  log(`module: ${MOD}`)
  rmSync(OUT, { recursive: true, force: true }) // no stale PNG can sit beside this run's
  mkdirSync(OUT, { recursive: true })
  const verbatim = checkVerbatim()
  log(`verbatim blocks: ${verbatim}`)
  const scopedCheck = checkScoped()
  log(`Scoped blocks (declarations after prefix strip): ${scopedCheck}`)
  const pristine = exportReserve()
  const satin = emitExpectedSatin()
  writePortApp()
  const reserve = await startVite(COPY, ['node_modules/vite/bin/vite.js'], { VITE_RESERVE_API: '', VITE_RESERVE_HOME_SLUG: '', VITE_PREVIEW_TOOLS: '' })
  const port = await startVite(APP, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--config', join(APP, 'vite.config.mjs')], {})
  log(`reserve (mock) ${reserve.url} pid ${reserve.child.pid} · port app ${port.url} pid ${port.child.pid}`)
  const { chromium } = require('playwright')
  const browser = await chromium.launch() // Playwright's own headless Chromium, never a shared browser
  const chromiumVersion = browser.version()
  log(`chromium ${chromiumVersion}`)
  const ctxOpts = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, reducedMotion: 'reduce', timezoneId: 'Asia/Tokyo', locale: 'ja-JP' }
  const rows = [], problems = [], fonts = {}, touched = new Set()
  let fenceStat = ''

  try {
    for (const c of CASES.filter((x) => !process.env.PARITY_ONLY || process.env.PARITY_ONLY.split(',').includes(x.id))) {
      seedMock(pristine, c)
      for (const f of sh('git', ['-C', COPY, 'diff', '--name-only']).split('\n').filter(Boolean)) touched.add(f)
      if (c.card) fenceStat = sh('git', ['-C', COPY, 'diff', '--stat']).trim().split('\n').join(' / ')
      const laCard = c.card ?? SEED.la.card, gymCard = c.gymCard ?? SEED.gym.card
      // wait until Reserve's dev server serves the rewritten seed (never screenshot a stale module)
      for (let i = 0; ; i++) {
        const served = await (await fetch(`${reserve.url}/src/lib/mock.ts`)).text()
        if (served.includes(`cardColor: "${laCard}"`) && served.includes(`cardColor: "${gymCard}"`)) break
        if (i > 100) throw new Error(`reserve never served the ${c.id} seed`)
        await new Promise((r) => setTimeout(r, 100))
      }
      // …and the page must show it: the name, and the satin Reserve's own module emits for each colour
      const expect = { mcard: [c.name, satin[laCard.toUpperCase()]['--satin-base']], tcard: [SEED.gym.name, satin[gymCard.toUpperCase()]['--satin-base']], cover: [c.name, satin[laCard.toUpperCase()]['--satin-base']] }
      const side = {}
      // Reserve
      {
        const ctx = await browser.newContext(ctxOpts)
        await ctx.addInitScript(() => {
          localStorage.setItem('reserve.demo.session', '1'); localStorage.setItem('reserve.preview.appShell', '1')
          sessionStorage.setItem('reserve.home.intro', '1'); sessionStorage.setItem('reserve.home.countup', '1')
        })
        const page = await ctx.newPage()
        await page.clock.setFixedTime(new Date(NOW))
        await page.goto(`${reserve.url}/me`, { waitUntil: 'networkidle' })
        await settle(page)
        side.reserve = { mcard: await grab(page, 'mcard', expect), tcard: await grab(page, 'tcard', expect) }
        await page.goto(`${reserve.url}/me/${'la-estro'}`, { waitUntil: 'networkidle' })
        await page.addStyleTag({ content: RESERVE_HIDE })
        await settle(page)
        side.reserve.cover = await grab(page, 'cover', expect)
        if (!fonts.reserve) fonts.reserve = await platformFonts(page, '.salon-cover__wm')
        await ctx.close()
      }
      // the port
      {
        const ctx = await browser.newContext(ctxOpts)
        const page = await ctx.newPage()
        const url = (p) => `${port.url}/?${new URLSearchParams(p)}`
        const la = { name: c.name, store: SEED.la.store, card: c.card ?? SEED.la.card, primary: SEED.la.primary }
        await page.goto(url({ ...la, view: 'home' }), { waitUntil: 'networkidle' })
        await settle(page)
        side.port = { mcard: await grab(page, 'mcard', expect) }
        await page.goto(url({ name: SEED.gym.name, store: SEED.la.store, card: c.gymCard ?? SEED.gym.card, primary: SEED.gym.primary, view: 'home' }), { waitUntil: 'networkidle' })
        await settle(page)
        side.port.tcard = await grab(page, 'tcard', expect)
        await page.goto(url({ ...la, address: SEED.la.address, view: 'store' }), { waitUntil: 'networkidle' })
        await settle(page)
        side.port.cover = await grab(page, 'cover', expect)
        if (!fonts.port) fonts.port = await platformFonts(page, '.salon-cover__wm')
        await ctx.close()
      }
      for (const s of ['mcard', 'tcard', 'cover']) {
        const r = side.reserve[s], p = side.port[s]
        const base = join(OUT, `${c.id}-${s}`)
        writeFileSync(`${base}-reserve.png`, r.png)
        writeFileSync(`${base}-port.png`, p.png)
        const cmp = compare(r.png, p.png, `${base}-diff.png`)
        const sizeOk = [r.box, p.box].every((b) => b.w === SIZE[s][0] && b.h === SIZE[s][1])
        const verdict = cmp.diff === 0 && sizeOk ? 'PASS' : 'FAIL'
        rows.push({ c, s, r: r.box, p: p.box, cmp, verdict })
        for (const [who, b] of [['reserve', r.box], ['port', p.box]]) if (b.overlap.length) problems.push(`${c.id} ${s} ${who}: overlapped by ${b.overlap.join(', ')}`)
        if (process.env.PARITY_DIAG && cmp.diff !== 0) writeFileSync(`${base}-diag.json`, JSON.stringify(diffStyles(r.styles, p.styles), null, 1))
      }
      if (c.id === 'long') {
        for (const who of ['reserve', 'port']) {
          const m = side[who].mcard.box, cv = side[who].cover.box
          const ok = / mcard--long( |$)/.test(' ' + m.cls) && /salon-cover__wm--long/.test(cv.wmCls) && m.lines.length === 2 && cv.lines.length === 2
          const same = JSON.stringify(m.lines) === JSON.stringify(cv.lines)
          log(`long name · ${who}: mcard--long=${/mcard--long/.test(m.cls)} card lines ${JSON.stringify(m.lines)} @${m.fontSize} · cover --long=${/--long/.test(cv.wmCls)} lines ${JSON.stringify(cv.lines)} @${cv.fontSize} · card breaks where the cover breaks: ${same}`)
          if (!ok) problems.push(`long name (${who}): expected mcard--long + salon-cover__wm--long and two lines on each`)
        }
        if (JSON.stringify(side.reserve.mcard.box.lines) !== JSON.stringify(side.port.mcard.box.lines)) problems.push('long name: card lines differ between Reserve and the port')
      }
      log(`${c.id.padEnd(5)} ${rows.slice(-3).map((x) => `${x.s} ${x.cmp.diff}`).join(' · ')}`)
    }

  } finally {
    await browser.close()
    stopStarted()
  }

  // fence: the only file ever rewritten in the Reserve copy, over every case
  const others = [...touched].filter((f) => f !== 'src/lib/mock.ts')
  const stray = sh('git', ['-C', COPY, 'status', '--porcelain']).trim().split('\n').filter((l) => l && !l.endsWith('src/lib/mock.ts'))
  if (others.length || stray.length) problems.push(`reserve copy: files other than src/lib/mock.ts changed: ${[...others, ...stray].join(', ')}`)
  const fence = `files changed across all cases: ${[...touched].join(', ') || 'none'} · last palette case: ${fenceStat}`

  const fmt = (b) => `${b.w}×${b.h}`
  const table = [
    '| case | surface | size reserve | size port | differing px | % | verdict |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((x) => `| ${x.c.label} | ${x.s} | ${fmt(x.r)} | ${fmt(x.p)} | ${x.cmp.diff < 0 ? x.cmp.size : x.cmp.diff} | ${x.cmp.diff < 0 ? '—' : ((100 * x.cmp.diff) / x.cmp.total).toFixed(4)} | ${x.verdict} |`),
  ].join('\n')
  if (/ — DIFFER: /.test(verbatim)) problems.push(`verbatim check: ${verbatim}`) // a verbatim block that drifted is a FAIL
  if (/ — DIFFER: /.test(scopedCheck)) problems.push(`scoped check: ${scopedCheck}`) // so is a scoped one
  const pass = rows.every((x) => x.verdict === 'PASS') && !problems.length
  const sizes = Object.keys(SIZE).map((s) => `${s} ${[...new Set(rows.filter((x) => x.s === s).flatMap((x) => [fmt(x.r), fmt(x.p)]))].join('/')}`).join(' · ')
  const report = `# Reserve card parity — ${pass ? 'PASS' : 'FAIL'}

pin ${PIN} · chromium ${chromiumVersion} · 393×852 @2x · reduced motion · clock ${NOW} · Asia/Tokyo
measured sizes (CSS px, both sides): ${sizes}
wordmark faces (CDP platform fonts, cover): reserve ${JSON.stringify(fonts.reserve)} · port ${JSON.stringify(fonts.port)}
reserve side: ${RESERVE_HIDE} (a sibling that overlaps the cover's bottom edge; not a surface element)
fence (git diff in the Reserve copy): ${fence}
verbatim blocks: ${verbatim}
Scoped blocks (declarations after prefix strip): ${scopedCheck}
${problems.length ? '\nproblems:\n' + problems.map((p) => '- ' + p).join('\n') + '\n' : ''}
${table}

PNGs: ${OUT}/<case>-<surface>-{reserve,port,diff}.png
`
  writeFileSync(join(OUT, 'parity-report.md'), report)
  writeParityMd(verbatim, scopedCheck)
  log('\n' + report)
  process.exitCode = pass ? 0 : 1
}

async function platformFonts(page, sel) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel })
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
  return fonts.map((f) => `${f.familyName}${f.postScriptName ? ' (' + f.postScriptName + ')' : ''}${f.isCustomFont ? ' [web font]' : ' [local]'}`)
}

function diffStyles(a, b) {
  const out = {}
  const ka = Object.keys(a), kb = Object.keys(b)
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const ea = a[ka[i]] ?? {}, eb = b[kb[i]] ?? {}, d = {}
    for (const p of new Set([...Object.keys(ea), ...Object.keys(eb)])) if (ea[p] !== eb[p]) d[p] = [ea[p], eb[p]]
    if (Object.keys(d).length || ka[i] !== kb[i]) out[`${ka[i]} ⇄ ${kb[i]}`] = d
  }
  return out
}

// Every block under a Reserve marker must equal the pin's lines, byte for byte.
function checkVerbatim() {
  const show = (p) => sh('git', ['-C', RESERVE, 'show', `${PIN}:${p}`]).split('\n')
  const checks = [
    ['reserve-card.css', /^\/\* reserve index\.css:(\d+)–(\d+) \*\/$/, () => 'src/index.css'],
    ['member-card-vars.ts', /^\/\/ reserve (\S+):(\d+)–(\d+) @ c2a9f95, verbatim$/, null],
    ['ReserveCardPreview.tsx', /^\s*\/\/ (?:reserve src\/components\/customer\/)?(\S+?\.tsx):(\d+)–(\d+) @ c2a9f95, verbatim$/, null],
  ]
  const where = { 'studio-home.tsx': 'src/components/customer/studio-home.tsx', 'studio-salon.tsx': 'src/components/customer/studio-salon.tsx', 'membership-date.tsx': 'src/components/customer/membership-date.tsx' }
  let ok = 0, all = 0
  const bad = []
  for (const [file, re, fixed] of checks) {
    const lines = readFileSync(join(MOD, file), 'utf8').split('\n')
    lines.forEach((l, i) => {
      const m = l.match(re)
      if (!m) return
      const [path, a, b] = fixed ? [fixed(), +m[1], +m[2]] : [where[m[1]] ?? m[1], +m[2], +m[3]]
      const want = show(path).slice(a - 1, b), got = lines.slice(i + 1, i + 1 + want.length)
      all++
      if (JSON.stringify(want) === JSON.stringify(got)) ok++
      else bad.push(`${file}:${i + 1} (${path}:${a}–${b})`)
    })
  }
  const whole = readFileSync(join(MOD, 'satin-material.ts'), 'utf8').split('\n').slice(1).join('\n') === show('src/lib/satin-material.ts').join('\n')
  all++; if (whole) ok++; else bad.push('satin-material.ts (whole file)')
  return `${ok}/${all} identical${bad.length ? ' — DIFFER: ' + bad.join(', ') : ''}`
}

// Every block under a SCOPED marker must equal the pin's lines once the literal `.member-ground ` prefix is
// stripped from the start of each selector (line start, or after `, `) — its press / reduced-motion
// declarations never show in a static screenshot, so this is their only guard.
function checkScoped() {
  const pin = sh('git', ['-C', RESERVE, 'show', `${PIN}:src/index.css`]).split('\n')
  const lines = readFileSync(join(MOD, 'reserve-card.css'), 'utf8').split('\n')
  let ok = 0, all = 0
  const bad = []
  lines.forEach((l, i) => {
    const m = l.match(/^\/\* reserve index\.css:(\d+)–(\d+) — SCOPED \(/)
    if (!m) return
    const want = pin.slice(+m[1] - 1, +m[2])
    const got = lines.slice(i + 1, i + 1 + want.length).map((x) => x.replace(/(^\s*|, )\.member-ground (?=\.)/g, '$1'))
    all++
    if (JSON.stringify(want) === JSON.stringify(got)) ok++
    else bad.push(`reserve-card.css:${i + 1} (src/index.css:${m[1]}–${m[2]})`)
  })
  return `${ok}/${all} identical${bad.length ? ' — DIFFER: ' + bad.join(', ') : ''}`
}

main().catch((e) => { console.error(e); stopStarted(); process.exit(1) })
