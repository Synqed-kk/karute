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
// rule-5 exemptions, row-shape checks, type positions, const-arrow symbols);
// p1–p8 pin the strict position rule (Greptile G2: the door calls a core, it
// never hands one around — aliases, destructuring, .bind/.call/.apply,
// indirect calls and shadowing all fail); c1–c6 pin the audit classes
// (Greptile G3: core-emits only for a proven AUDITED_CORES symbol, a
// caller-emits write needs its own trace/receipt row and audit call);
// new-1–new-16 pin THE RETURN-PATH CHECK (Greptile P1 #4: every non-error
// return of a function holding a caller-emits site is dominated by an audit
// emit — the shared emission walker, run with writePairs [] so it never needs
// the SDK; new-7 carries member calls to prove that path; new-13/new-14 pin
// that the walked function is the node holding the site, never a lookup by
// name; new-15 the foreign emit names; new-16 the function's own audit site).
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
const POLICY = 'src/lib/audit-policy.ts'
const realPolicy = readFileSync(join(repo, POLICY), 'utf8')
// c6's policy: the mutations entry marks updateAppointmentCore `unproven`.
const MUT_ENTRY_END = "      'updateAppointmentCore',\n    ],\n  },"
if (realPolicy.split(MUT_ENTRY_END).length !== 2) throw new Error('selftest: the mutations AUDITED_CORES entry moved — re-anchor c6')
const unprovenPolicy = realPolicy.replace(MUT_ENTRY_END, "      'updateAppointmentCore',\n    ],\n    unproven: [{ symbol: 'updateAppointmentCore', reason: 'selftest fixture' }],\n  },")

/** Write the config with sharedCores.calls transformed (the real rows by default). */
const setCalls = (fn = (c) => c) =>
  write(CONFIG, JSON.stringify({ ...realConfig, sharedCores: { ...realConfig.sharedCores, calls: fn(realConfig.sharedCores.calls) } }, null, 2))
const clearTerritory = () => {
  for (const p of realConfig.territory) rmSync(join(root, p), { recursive: true, force: true })
}

const MUT = "import { updateAppointmentCore } from '@/lib/appointments/mutations'\n"
const AUDIT = "import { audit } from '@/lib/audit'\n"
const CUST = "import { createCustomerWithClient } from '@/lib/customers/customers.core'\n"
const custRow = (symbol, cls) => ({ module: 'src/lib/customers/customers.core', call: 'createCustomerWithClient', symbol, class: cls })
// THE RETURN-PATH CHECK fixtures (new-1…new-16).
const DURABLE = "import { auditDurable } from '@/lib/audit'\n"
const A = "audit({ action: 'customer.create', source: 'business' })"
const CORE = 'createCustomerWithClient(a.c, a.f)'
const UNAUDITED = (symbol = 'createCustomer') => `unaudited write: ${symbol} needs an audit on every return path`
const callerEmits = (symbol = 'createCustomer') => (c) => [...c, custRow(symbol, 'caller-emits')]
// line 1 CUST, line 2 AUDIT, line 3 the function, its body from line 4.
const createCustomer = (body) => ({ [DOOR]: CUST + AUDIT + 'export async function createCustomer(a) {\n' + body + '\n}\n' })

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
  ['d6 run(updateAppointmentCore) — passed as a value → deny-set name in non-call position (G2: never a site)',
    { [DOOR]: MUT + 'export async function queueMove(a) {\n  return run(updateAppointmentCore, a)\n}\n' }, null, ['deny-set name in non-call position'],
    { name: 'updateAppointmentCore', line: 3 }],
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
  ['e10 an exported const arrow is a symbol too (its call is OK); a module-level value export → non-call position',
    { [DOOR]: MUT + 'export const moveBooking = async (a) => updateAppointmentCore(a)\nexport const handle = updateAppointmentCore\n' },
    null, ['deny-set name in non-call position'], { name: 'updateAppointmentCore', line: 3, sites: 1 }],
  ['p1 alias in moveBooking (f = updateAppointmentCore), then f(...) from another function → FAIL at the alias line',
    { [DOOR]: MUT + 'let f\nexport async function moveBooking(a) {\n  f = updateAppointmentCore\n  return updateAppointmentCore(a)\n}\n' +
      'export async function moveLater(a) {\n  return f(a)\n}\n' }, null, ['deny-set name in non-call position'],
    { name: 'updateAppointmentCore', line: 4, sites: 1 }],
  ['p2 an import alias handed on (const f = u) → non-call position, named through its alias',
    { [DOOR]: "import { updateAppointmentCore as u } from '@/lib/appointments/mutations'\nexport async function moveBooking(a) {\n  const f = u\n  return f(a)\n}\n" },
    null, ['deny-set name in non-call position'], { name: 'u → updateAppointmentCore', line: 3 }],
  ['p3 const { updateAppointmentCore: u } = mod → non-call position (destructuring a deny-set name)',
    { [DOOR]: 'export async function moveBooking(mod) {\n  const { updateAppointmentCore: u } = mod\n  return u(mod)\n}\n' },
    null, ['deny-set name in non-call position'], { name: 'updateAppointmentCore', line: 2 }],
  ['p4 updateAppointmentCore.bind(...) inside moveBooking (row present) → non-call position',
    { [DOOR]: MUT + 'export async function moveBooking(a) {\n  const g = updateAppointmentCore.bind(null, a)\n  return g()\n}\n' },
    null, ['deny-set name in non-call position'], { line: 3, sites: 0 }],
  ['p5 .call(...) and .apply(...) inside moveBooking (row present) → two non-call positions',
    { [DOOR]: MUT + 'export async function moveBooking(a) {\n  await updateAppointmentCore.call(null, a)\n  return updateAppointmentCore.apply(null, [a])\n}\n' },
    null, ['deny-set name in non-call position', 'deny-set name in non-call position'], { sites: 0 }],
  ['p6 indirect forms — (0, x)(…), (x as any)(…), new x(…), x`…`, typeof x in a value → five non-call positions',
    { [DOOR]: MUT + 'export async function moveBooking(a) {\n  (0, updateAppointmentCore)(a)\n  ;(updateAppointmentCore as any)(a)\n' +
      '  new (updateAppointmentCore as any)(a)\n  updateAppointmentCore`${a}`\n  return typeof updateAppointmentCore === "function"\n}\n' },
    null, Array(5).fill('deny-set name in non-call position'), { sites: 0 }],
  ['p7 await updateAppointmentCore(...) inside moveBooking, row present → OK (the direct call is the one legal position)',
    { [DOOR]: MUT + 'export async function moveBooking(a) {\n  const r = await updateAppointmentCore(a.c, a.id, a.p, a.actor, a.h, a.s)\n  return r\n}\n' },
    null, [], { sites: 1 }],
  ['p8 shadowing — a local named like a deny-set name (its use: without import), and a param named like an imported core → shadowing a deny-set name',
    { [DOOR]: MUT + 'export async function moveBooking(a) {\n  const updateStaffCore = a\n  return updateAppointmentCore(updateStaffCore)\n}\n' +
      'function helper(updateAppointmentCore) {\n  return 1\n}\n' },
    null, ['deny-set name without import', 'shadowing a deny-set name', 'shadowing a deny-set name'], { sites: 1 }],
  ['c1 a core-emits row for createCustomerWithClient (writes, emits no audit row) → bad calls row (not an audited core)',
    {}, (c) => [...c, custRow('createCustomer', 'core-emits')], ['bad calls row (not an audited core)']],
  ['c2 a caller-emits row with no trace/receipt row for its symbol → unaudited write',
    {}, (c) => [...c, custRow('addCustomer', 'caller-emits')], ['unaudited write: addCustomer needs an audit row']],
  ['c3 a valid caller-emits + trace pair, the door calling both inside createCustomer → OK',
    { [DOOR]: CUST + AUDIT + "export async function createCustomer(a) {\n  const r = await createCustomerWithClient(a.c, a.f)\n  audit({ action: 'customer.create', source: 'business' })\n  return r\n}\n" },
    (c) => [...c, custRow('createCustomer', 'caller-emits')], [], { sites: 2 }],
  ['c4 the same pair, but the door writes without its audit() call → unaudited write at the site',
    { [DOOR]: CUST + "export async function createCustomer(a) {\n  return createCustomerWithClient(a.c, a.f)\n}\n" },
    (c) => [...c, custRow('createCustomer', 'caller-emits')], [UNAUDITED()], { line: 3, sites: 1, offender: 'line 3: return createCustomerWithClient' }],
  ['c5 an audited core (updateAppointmentCore) filed as caller-emits → bad calls row (class does not fit the call)',
    {}, (c) => c.map((r) => (r.call === 'updateAppointmentCore' ? { ...r, class: 'caller-emits' } : r)), ['bad calls row (class does not fit the call)']],
  ['c6 an AUDITED_CORES symbol marked unproven is not an audited core → the real core-emits row fails',
    { [POLICY]: unprovenPolicy }, null, ['bad calls row (not an audited core)']],
  ['new-1 audit() only inside if (false) {} → unaudited write (the success return is not dominated)',
    createCustomer(`  const r = await createCustomerWithClient(a.c, { ...a.f, tags: a.tags.join(',') })\n  if (false) {\n    ${A}\n  }\n  return r`),
    callerEmits(), [UNAUDITED()], { line: 4, sites: 2, offender: 'line 8: return r' }],
  ['new-2 audit() only in the catch → unaudited write (the try\'s success return)',
    createCustomer(`  try {\n    const r = await ${CORE}\n    return r\n  } catch (e) {\n    ${A}\n    throw e\n  }`),
    callerEmits(), [UNAUDITED()], { line: 5, sites: 2, offender: 'line 6: return r' }],
  ['new-3 audit() textually after the return (dead code) → unaudited write',
    createCustomer(`  const r = await ${CORE}\n  return r\n  ${A}`),
    callerEmits(), [UNAUDITED()], { line: 4, sites: 2, offender: 'line 5: return r' }],
  ['new-4 audit() only inside a nested function that is never invoked → unaudited write',
    createCustomer(`  const r = await ${CORE}\n  function later() {\n    ${A}\n  }\n  return r`),
    callerEmits(), [UNAUDITED()], { line: 4, sites: 2, offender: 'line 8: return r' }],
  ['new-5 auditDurable() only inside if (false) {} (the receipt row) → unaudited write',
    { [DOOR]: CUST + DURABLE + `export async function setCustomerConsent(a) {\n  const r = await ${CORE}\n  if (false) {\n    await auditDurable({ action: 'customer.consent', source: 'business' })\n  }\n  return r\n}\n` },
    callerEmits('setCustomerConsent'), [UNAUDITED('setCustomerConsent')], { line: 4, sites: 2, offender: 'line 8: return r' }],
  ['new-6 audit() unconditionally BEFORE the core call, then return → OK',
    createCustomer(`  ${A}\n  const r = await ${CORE}\n  return r`), callerEmits(), [], { sites: 2 }],
  ['new-7 the core call, then audit() in sequence (c3 shape, member calls in the audit detail — no SDK needed) → OK',
    createCustomer(`  const r = await ${CORE}\n  audit({ action: 'customer.create', source: 'business', detail: JSON.stringify(a.f), tags: a.tags.join(',') })\n  return r`),
    callerEmits(), [], { sites: 2 }],
  ['new-8 return doCreate(a) — one-level call-through to a nested helper that does core call + audit → OK',
    createCustomer(`  const doCreate = async (x) => {\n    const r = await createCustomerWithClient(x.c, x.f)\n    ${A}\n    return r\n  }\n  return doCreate(a)`),
    callerEmits(), [], { sites: 2 }],
  ['new-9 a side-effect helper (emitAudit(); return r) → unaudited write (walker limitation, pinned by design)',
    createCustomer(`  const emitAudit = () => {\n    ${A}\n  }\n  const r = await ${CORE}\n  emitAudit()\n  return r`),
    callerEmits(), [UNAUDITED()], { line: 7, sites: 2, offender: 'line 9: return r' }],
  ['new-10 early return { ok: false, reason } and early return null BEFORE the core call → OK (error-shaped / bare)',
    createCustomer(`  if (!a.f) return { ok: false, reason: 'no fields' }\n  if (!a.c) return null\n  const r = await ${CORE}\n  ${A}\n  return r`),
    callerEmits(), [], { sites: 2 }],
  ['new-11 two return paths, the audit on one only → unaudited write naming the second return',
    createCustomer(`  if (a.x) {\n    const r = await ${CORE}\n    ${A}\n    return r\n  }\n  const r2 = await ${CORE}\n  return r2`),
    callerEmits(), [UNAUDITED()], { line: 5, sites: 3, offender: 'line 10: return r2' }],
  ['new-12 an early return WITH A VALUE before the core call (not error-shaped) → unaudited write (the convention: emit first or restructure)',
    createCustomer(`  if (a.existing) return a.existing\n  const r = await ${CORE}\n  ${A}\n  return r`),
    callerEmits(), [UNAUDITED()], { line: 5, sites: 2, offender: 'line 4: return a.existing' }],
  ['new-13 an exported const over a two-callback wrapper — the core call in the first, audit() in the second → unaudited write (the walked function is the one holding the site)',
    { [DOOR]: CUST + AUDIT + `export const createCustomer = wrap(async (a) => {\n  return ${CORE}\n}, async () => {\n  ${A}\n  return 1\n})\n` },
    callerEmits(), [UNAUDITED()], { line: 4, sites: 2, offender: 'no audit()/auditDurable() call in createCustomer' }],
  ['new-14 a same-named method declared first (a decoy a lookup by name would walk) → the real function is walked: unaudited write',
    { [DOOR]: CUST + AUDIT + `const decoy = {\n  createCustomer() {\n    return null\n  },\n}\nexport async function createCustomer(a) {\n  if (a.x) {\n    ${A}\n  }\n  return ${CORE}\n}\n` },
    callerEmits(), [UNAUDITED()], { line: 12, sites: 2, offender: 'line 12: return createCustomerWithClient' }],
  ['new-15 a local logFacadeAudit() stand-in dominating the return (the real audit() dead) → foreign emit name (declaration + call)',
    { [DOOR]: CUST + AUDIT + `export async function createCustomer(a) {\n  const r = await ${CORE}\n  if (false) {\n    ${A}\n  }\n  logFacadeAudit()\n  return r\n}\nfunction logFacadeAudit() {\n  return 1\n}\n` },
    callerEmits(), ['foreign emit name', 'foreign emit name'], { sites: 2 }],
  ['new-16 the core call, then return null, no audit() anywhere → unaudited write (the function\'s own audit site is required)',
    createCustomer(`  await ${CORE}\n  return null`),
    callerEmits(), [UNAUDITED()], { line: 4, sites: 1, offender: 'no audit()/auditDurable() call in createCustomer' }],
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
    write(POLICY, realPolicy)
    setCalls(calls ?? undefined)
    for (const [rel, src] of Object.entries(files)) write(rel, src)
    const { findings, stats } = scanSharedCores(root)
    const got = findings.map((f) => f.label).sort()
    let ok = JSON.stringify(got) === JSON.stringify([...expected].sort())
    if (ok && extra.name) ok = findings.some((f) => f.name === extra.name)
    if (ok && extra.offender) ok = findings.some((f) => f.name.includes(extra.offender))
    if (ok && extra.line !== undefined) ok = findings.some((f) => f.line === extra.line)
    if (ok && extra.rel) ok = findings.every((f) => f.rel === extra.rel)
    if (ok && extra.sites !== undefined) ok = stats.sites === extra.sites
    if (!ok) failed++
    rows.push({ ok, name, expected: expected.join(', ') || 'OK', got: findings.map((f) => `${f.rel}:${f.line} ${f.label} — ${f.name}`).join(' | ') || 'OK' })
  }
  // r1 — the real-tree verdict on a fixture tree whose door HAS approved sites
  // (the shape Business PR (2) lands): must pass, sites counted, not assumed 0.
  clearTerritory()
  write(POLICY, realPolicy)
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
