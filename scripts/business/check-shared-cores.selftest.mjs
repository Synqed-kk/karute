#!/usr/bin/env node
// Fixture red→green pins for the Business shared-cores fence
// (check-shared-cores.mjs, ⚖ 2026-09-28, W0 PR (1)). The live run scans a
// territory with ZERO sites today (the door file lands in Business PR (2)),
// so it exercises almost none of the rules — these fixtures pin every one of
// them, in both directions, each case asserting the exact finding labels.
// Fixtures live in a temp dir this selftest creates and removes; the deny set
// is built from COPIES of the real module files + audit-policy.ts, so a case
// is judged against the real exports, never a stand-in list. d1–d13 are the
// packet's cases; e1–e10 pin the rest (require(), built specifiers, relays, copies, the three
// rule-5 exemptions, row-shape checks, type positions, const-arrow symbols).
// The real-tree verdict (judgeTree) never asserts a literal site count: zero
// findings, and every site met is an approved one whose row is in that
// tree's own JSON — r1 runs the same verdict on a fixture door WITH approved
// sites, so the door landing in Business PR (2) cannot turn this step red.
// Exit 1 on any mismatch; the case table prints either way.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanSharedCores } from './check-shared-cores.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const CONFIG = 'scripts/business/business-territory.json'
const realConfig = JSON.parse(readFileSync(join(repo, CONFIG), 'utf8'))
const DOOR = realConfig.sharedCores.doorFile

const root = mkdtempSync(join(tmpdir(), 'sharedcores-'))
const write = (rel, src) => {
  mkdirSync(join(root, dirname(rel)), { recursive: true })
  writeFileSync(join(root, rel), src)
}
const copy = (rel) => {
  mkdirSync(join(root, dirname(rel)), { recursive: true })
  cpSync(join(repo, rel), join(root, rel))
}
for (const mod of realConfig.sharedCores.modules) copy(`${mod}.ts`)
copy('src/lib/audit-policy.ts')

/** Write the config with sharedCores.calls transformed (the real rows by default). */
const setCalls = (fn = (c) => c) =>
  write(CONFIG, JSON.stringify({ ...realConfig, sharedCores: { ...realConfig.sharedCores, calls: fn(realConfig.sharedCores.calls) } }, null, 2))
const clearTerritory = () => {
  for (const p of realConfig.territory) rmSync(join(root, p), { recursive: true, force: true })
}

const MUT = "import { updateAppointmentCore } from '@/lib/appointments/mutations'\n"
const AUDIT = "import { audit } from '@/lib/audit'\n"

// [case, files to write, calls transform, expected sorted labels, optional name check]
const CASES = [
  ['d1 door calls updateAppointmentCore inside moveBooking, row present → OK',
    { [DOOR]: MUT + 'export async function moveBooking(a) {\n  return updateAppointmentCore(a.c, a.id, a.p, a.actor, a.h, a.s)\n}\n' }, null, [], { sites: 1 }],
  ['d2 same call, its row removed → no calls row',
    { [DOOR]: MUT + 'export async function moveBooking(a) {\n  return updateAppointmentCore(a)\n}\n' },
    (c) => c.filter((r) => r.call !== 'updateAppointmentCore'), ['no calls row'], { name: 'updateAppointmentCore in moveBooking' }],
  ['d3 deleteAppointmentCore with a row → never (the row itself refused too)',
    { [DOOR]: "import { deleteAppointmentCore } from '@/lib/appointments/mutations'\nexport async function removeBooking(a) {\n  return deleteAppointmentCore(a)\n}\n" },
    (c) => [...c, { module: 'src/lib/appointments/mutations', call: 'deleteAppointmentCore', symbol: 'removeBooking', class: 'core-emits' }],
    ['bad calls row (call is in never)', 'never']],
  ['d4 import * as m from a listed module → namespace import',
    { [DOOR]: "import * as m from '@/lib/appointments/mutations'\nexport async function moveBooking(a) {\n  return m.updateAppointmentCore(a)\n}\n" }, null, ['namespace import']],
  ['d5 alias `as u` then u(...) with no row for its function → no calls row',
    { [DOOR]: "import { updateAppointmentCore as u } from '@/lib/appointments/mutations'\nexport async function moveLater(a) {\n  return u(a)\n}\n" },
    null, ['no calls row'], { name: 'updateAppointmentCore in moveLater' }],
  ['d6 run(updateAppointmentCore) — passed as a value, no row → no calls row',
    { [DOOR]: MUT + 'export async function queueMove(a) {\n  return run(updateAppointmentCore, a)\n}\n' }, null, ['no calls row']],
  ['d7 a NON-door territory file importing customers.core → import outside doorFile',
    { 'src/business/lib/data.ts': "import { createCustomerWithClient } from '@/lib/customers/customers.core'\nexport const x = 1\n" }, null, ['import outside doorFile']],
  ['d8 export { createCustomerWithClient } from a listed module → re-export',
    { [DOOR]: "export { createCustomerWithClient } from '@/lib/customers/customers.core'\n" }, null, ['re-export']],
  ['d9a audit(...) inside createCustomer, row present → OK (createCustomer is also an AUDITED_CORES name: exemption (b))',
    { [DOOR]: AUDIT + "export async function createCustomer(a) {\n  audit({ action: 'customer.create', source: 'business' })\n  return a\n}\n" }, null, []],
  ['d9b the same audit(...) inside moveBooking, no row → no calls row',
    { [DOOR]: AUDIT + "export async function moveBooking(a) {\n  audit({ action: 'booking.update', source: 'business' })\n}\n" },
    null, ['no calls row'], { name: 'audit in moveBooking' }],
  ['d10 a row with a misspelled call (updateAppointmentCor) → bad calls row',
    {}, (c) => c.map((r) => (r.call === 'updateAppointmentCore' ? { ...r, call: 'updateAppointmentCor' } : r)),
    ['bad calls row (call is not an export of its module)']],
  ['d11 rows with no site (no door file yet) → OK', {}, null, [], { sites: 0 }],
  ['d12 import type { StoreRow } from a listed module in the door → OK (types are not values)',
    { [DOOR]: "import type { StoreRow } from '@/lib/stores/stores.core'\nexport function label(s: StoreRow) {\n  return s.name\n}\n" }, null, [], { sites: 0 }],
  ['d13 await import(\'@/lib/audit\') → dynamic import',
    { [DOOR]: "export async function createCustomer() {\n  const m = await import('@/lib/audit')\n  return m\n}\n" }, null, ['dynamic import']],
  ['e1 require() of a listed module, relative spelling, in a non-door file → dynamic import',
    { 'src/business/lib/x.ts': "const m = require('../../lib/audit')\nexport default m\n" }, null, ['dynamic import']],
  ['e1b a BUILT specifier (import(`@/lib/${x}`)) cannot be judged → dynamic import',
    { [DOOR]: 'export async function moveBooking(x) {\n  return import(`@/lib/${x}/mutations`)\n}\n' }, null, ['dynamic import'],
    { name: '<non-literal specifier>' }],
  ['e2 a relay: data.ts imports updateAppointmentCore from the door → deny-set name without import',
    { 'src/business/lib/data.ts': "import { updateAppointmentCore } from './practice-door/door-writes'\nexport const m = 1\n" }, null, ['deny-set name without import']],
  ['e3 a local copy of a core (updateStaffCore) in any territory file → deny-set name without import',
    { 'src/business/lib/copy.ts': 'export async function updateStaffCore() {\n  return null\n}\n' }, null, ['deny-set name without import']],
  ['e4 exemption (a): POST in a territory route.ts → OK; POST in a non-route file → finding',
    { 'src/app/api/business/x/route.ts': 'export async function POST() {\n  return new Response(null)\n}\n',
      'src/business/lib/handlers.ts': 'export async function POST() {\n  return null\n}\n' }, null, ['deny-set name without import'],
    { rel: 'src/business/lib/handlers.ts' }],
  ["e5 exemption (c): a pinned name at its path → OK; the same name elsewhere → finding",
    { 'src/app/[locale]/(business)/business/today/today-interactions.ts': 'const warn = true\nexport const w = warn\n',
      'src/business/lib/other.ts': 'const warn = true\nexport const w = warn\n' }, null,
    ['deny-set name without import', 'deny-set name without import'], { rel: 'src/business/lib/other.ts' }],
  ['e6 exemption (b) is the door only: createCustomer declared in a non-door file → finding',
    { 'src/business/lib/customers-screen.ts': 'export async function createCustomer() {\n  return null\n}\n' }, null, ['deny-set name without import']],
  ['e7 a row whose class does not fit its call (audit as receipt) → bad calls row',
    {}, (c) => c.map((r) => (r.call === 'audit' ? { ...r, class: 'receipt' } : r)), ['bad calls row (class does not fit the call)']],
  ['e8 a row naming a module outside modules → bad calls row',
    {}, (c) => [...c, { module: 'src/lib/karute/karute.core', call: 'createOrUpdateKaruteRecord', symbol: 'saveKarute', class: 'core-emits' }],
    ['bad calls row (module not in modules)']],
  ['e9 typeof updateAppointmentCore in a TYPE is not a site → OK',
    { [DOOR]: MUT + 'export type Mover = typeof updateAppointmentCore\n' }, null, [], { sites: 0 }],
  ['e10 an exported const arrow is a symbol too; a module-level value pass has none',
    { [DOOR]: MUT + 'export const moveBooking = async (a) => updateAppointmentCore(a)\nexport const handle = updateAppointmentCore\n' },
    null, ['no calls row'], { name: 'updateAppointmentCore in <no exported function>' }],
]

/** The verdict CI relies on for a whole tree: zero findings, every site met is
 *  an approved one (sites === approved), and every approved site names a row
 *  of THAT tree's own calls list. rowsWithSite is computed from the JSON —
 *  never a literal (0 on the real tree today; the door lands in PR (2)). */
function judgeTree(treeRoot) {
  const { findings, stats } = scanSharedCores(treeRoot)
  const calls = JSON.parse(readFileSync(join(treeRoot, CONFIG), 'utf8')).sharedCores.calls
  const key = (r) => `${r.module}#${r.call} in ${r.symbol}`
  const hit = new Set(stats.approved.map(key))
  const rowsWithSite = calls.filter((r) => hit.has(key(r))).length
  const ok = findings.length === 0 && stats.sites === stats.approved.length && rowsWithSite === hit.size
  const got =
    findings.map((f) => `${f.rel}:${f.line} ${f.label} — ${f.name}`).join(' | ') ||
    `OK (${stats.sites} sites, ${rowsWithSite} of ${calls.length} calls rows with a site)`
  return { ok, got, stats, rowsWithSite }
}

const rows = []
let failed = 0
try {
  for (const [name, files, calls, expected, extra = {}] of CASES) {
    clearTerritory()
    setCalls(calls ?? undefined)
    for (const [rel, src] of Object.entries(files)) write(rel, src)
    const { findings, stats } = scanSharedCores(root)
    const got = findings.map((f) => f.label).sort()
    let ok = JSON.stringify(got) === JSON.stringify([...expected].sort())
    if (ok && extra.name) ok = findings.some((f) => f.name === extra.name)
    if (ok && extra.rel) ok = findings.every((f) => f.rel === extra.rel)
    if (ok && extra.sites !== undefined) ok = stats.sites === extra.sites
    if (!ok) failed++
    rows.push({ ok, name, expected: expected.join(', ') || 'OK', got: findings.map((f) => `${f.rel}:${f.line} ${f.label} — ${f.name}`).join(' | ') || 'OK' })
  }
  // r1 — the real-tree verdict on a fixture tree whose door HAS approved sites
  // (the shape Business PR (2) lands): must pass, sites counted, not assumed 0.
  clearTerritory()
  setCalls()
  write(DOOR, MUT + AUDIT +
    'export async function moveBooking(a) {\n  return updateAppointmentCore(a.c, a.id, a.p, a.actor, a.h, a.s)\n}\n' +
    "export async function createCustomer(a) {\n  audit({ action: 'customer.create', source: 'business' })\n  return a\n}\n")
  const fx = judgeTree(root)
  const fxOk = fx.ok && fx.stats.sites === 2 && fx.rowsWithSite === 2
  if (!fxOk) failed++
  rows.push({ ok: fxOk, name: 'r1 real-tree verdict on a fixture door with two approved sites → OK (sites 2, rows with a site 2)', expected: 'OK (2 sites, 2 of 3 calls rows with a site)', got: fx.got })
} finally {
  rmSync(root, { recursive: true, force: true })
}

// The REAL repo, as CI runs it: zero findings, every site approved (the count
// is whatever the tree holds — 0 today, computed by judgeTree, never assumed).
const real = judgeTree(repo)
if (!real.ok) failed++
rows.push({ ok: real.ok, name: 'real tree → OK line, zero findings, every site approved', expected: 'OK', got: real.got })

for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n        expected: ${r.expected}\n        got:      ${r.got}`)
if (failed) {
  console.error(`✗ shared-cores fence selftest: ${failed} of ${rows.length} cases mismatched`)
  process.exit(1)
}
console.log(`✓ shared-cores fence selftest: ${rows.length} cases green`)
