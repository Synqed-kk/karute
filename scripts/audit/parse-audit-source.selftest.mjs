#!/usr/bin/env node
// Focused regression tests for the audit-gate machinery (Greptile #635):
// parser boundary cases (accepted shapes + every documented rejection),
// the CP8 weakening matrix (namespaced keys, coveredBy clauses), and the
// owner-approval verdict. Plain node + assert — runs inside the isolated
// audit-gates CI job on the pinned typescript install, NOT the jest tier,
// so it cannot be neutered by unprotected npm/jest plumbing. The red-run
// proof artifacts (real-git GREEN→RED runs of the whole gate) live in the
// lane's fleet log; this file pins the same boundaries per-PR.
import assert from 'node:assert/strict'
import { parseFacadeAuditMap, parseApiRouteDecisions, parseAuditActions, parseAllowlist } from './parse-audit-source.mjs'
import {
  findRowWeakenings,
  findActionWeakenings,
  findAllowlistWeakenings,
  ownerApprovalVerdict,
} from './check-audit-weakening.mjs'

let n = 0
function ok(name, fn) {
  fn()
  n += 1
}

// ── Parser: accepted shapes ──────────────────────────────────────────────
const HAPPY = `
export const FACADE_AUDIT_MAP = {
  'a.read': { kind: 'view', category: 'customer', action: 'customer.view', targetType: 'customer' },
  'a.skip': { kind: 'skip', category: 'customer', action: '', coveredBy: 'src/x.ts#core' },
  'a.parked': { kind: 'mutation', category: 'ai', action: \`ai.chat\`, pendingWave: 'Wave W' },
}
export const API_ROUTE_DECISIONS = {
  flat: { kind: 'skip', justification: 'free text — not compared', dated: '2026-01-01' },
  split: {
    GET: { kind: 'skip', justification: 'j', dated: '2026-01-01' },
    POST: { kind: 'mutation', justification: 'j', dated: '2026-01-01', coveredBy: 'src/y.ts#POST' },
  },
}
`
ok('happy map: literals, empty action, no-substitution template, coveredBy', () => {
  const rows = parseFacadeAuditMap(HAPPY)
  assert.equal(rows['a.read'].action, 'customer.view')
  assert.equal(rows['a.skip'].action, '')
  assert.equal(rows['a.skip'].coveredBy, 'src/x.ts#core')
  assert.equal(rows['a.parked'].action, 'ai.chat')
  assert.equal(rows['a.parked'].pendingWave, 'Wave W')
})
ok('decision rows: method-keyed flattening; non-compared fields not parsed', () => {
  const rows = parseApiRouteDecisions(HAPPY)
  assert.deepEqual(Object.keys(rows).sort(), ['flat', 'split.GET', 'split.POST'])
  assert.equal(rows['split.POST'].coveredBy, 'src/y.ts#POST')
  assert.equal(rows.flat.justification, undefined)
})
ok('decoy declarations are ignored: function body, namespace, block', () => {
  const decoyed = `
export function snapshot() {
  const FACADE_AUDIT_MAP = { 'a.read': { kind: 'skip', category: 'customer', action: '' } }
  return FACADE_AUDIT_MAP
}
namespace NS { const FACADE_AUDIT_MAP = { 'a.read': { kind: 'skip', category: 'customer', action: '' } } }
{ const FACADE_AUDIT_MAP = { 'a.read': { kind: 'skip', category: 'customer', action: '' } } }
${HAPPY}
`
  const rows = parseFacadeAuditMap(decoyed)
  assert.equal(rows['a.read'].kind, 'view') // the REAL map, not any decoy
})
ok('AUDIT_ACTIONS: as-const array parses; spread rejects', () => {
  assert.deepEqual(parseAuditActions(`export const AUDIT_ACTIONS = ['a.b', 'c.d'] as const`), ['a.b', 'c.d'])
  assert.equal(parseAuditActions(`const X = ['z']\nexport const AUDIT_ACTIONS = [...X] as const`), null)
})
ok('allowlist: file+call parse; symbol arrays; spread rejects', () => {
  const src = `export const SDK_WRITE_ALLOWLIST = [{ file: 'src/a.ts', call: 'x.y', symbols: ['one'] }]`
  assert.deepEqual(parseAllowlist(src, 'SDK_WRITE_ALLOWLIST'), [{ file: 'src/a.ts', call: 'x.y', symbols: ['one'] }])
  assert.equal(parseAllowlist(`export const SDK_WRITE_ALLOWLIST = [{ ...spread }]`, 'SDK_WRITE_ALLOWLIST'), null)
})

// ── Parser: documented rejection paths (all must fail the WHOLE parse) ───
const REJECTS = [
  ['spread in a row', `export const FACADE_AUDIT_MAP = { 'k': { ...base } }`],
  ['computed key', `export const FACADE_AUDIT_MAP = { [KEY]: { kind: 'skip', category: 'customer', action: '' } }`],
  ['identifier value on a compared field', `export const FACADE_AUDIT_MAP = { 'k': { kind: 'skip', category: CAT, action: '' } }`],
  ['call value on a compared field', `export const FACADE_AUDIT_MAP = { 'k': { kind: 'skip', category: cat(), action: '' } }`],
  ['template with substitution', `export const FACADE_AUDIT_MAP = { 'k': { kind: 'skip', category: 'customer', action: \`a.\${x}\` } }`],
  ['shorthand property', `export const FACADE_AUDIT_MAP = { 'k': { kind, category: 'customer', action: '' } }`],
  ['identifier row value', `export const FACADE_AUDIT_MAP = { 'k': SHARED_ROW }`],
  ['identifier map initializer', `const real = {}\nexport const FACADE_AUDIT_MAP = real`],
  ['missing declaration', `export const OTHER = {}`],
]
for (const [name, src] of REJECTS) {
  ok(`reject: ${name}`, () => assert.equal(parseFacadeAuditMap(src), null))
}

// ── CP8 weakening matrix (namespaced keys) ───────────────────────────────
const V = (mapRows = {}, decisionRows = {}) => ({ mapRows, decisionRows })
const keysOf = (ws) => ws.map((w) => w.key).sort()

ok('live→skip flagged with map: namespace', () => {
  const ws = findRowWeakenings(
    V({ x: { kind: 'mutation', category: 'karute', action: 'a.b' } }),
    V({ x: { kind: 'skip', category: 'karute', action: '' } }),
  )
  assert.deepEqual(keysOf(ws), ['map:x'])
})
ok('same rawKey in map and decision namespaces stays distinct', () => {
  const live = { kind: 'mutation', category: 'karute', action: 'a.b' }
  const ws = findRowWeakenings(V({ export: live }, { export: { kind: 'mutation' } }), V({}, {}))
  assert.deepEqual(keysOf(ws), ['decision:export', 'map:export'])
})
ok('action removal vs allowlist addition cannot share a ledger key', () => {
  const actions = findActionWeakenings({ actions: ['staff.update'] }, { actions: [] })
  const allow = findAllowlistWeakenings(
    { sdkAllowlist: [], rawAllowlist: [] },
    { sdkAllowlist: [{ file: 'src/x.ts', call: 'staff.update' }], rawAllowlist: [] },
    false,
  )
  assert.deepEqual(keysOf(actions), ['action:staff.update'])
  assert.deepEqual(keysOf(allow), ['SDK_WRITE_ALLOWLIST:src/x.ts::staff.update'])
})
ok('coveredBy repoint on a plain-skip row present both sides is flagged', () => {
  const ws = findRowWeakenings(
    V({ k: { kind: 'skip', category: 'karute', action: '', coveredBy: 'src/a.ts#one' } }),
    V({ k: { kind: 'skip', category: 'karute', action: '', coveredBy: 'src/b.ts#two' } }),
  )
  assert.deepEqual(keysOf(ws), ['map:k'])
})
ok('CITED skip row deletion flagged; UNCITED skip row deletion free', () => {
  const cited = findRowWeakenings(V({ k: { kind: 'skip', category: 'karute', action: '', coveredBy: 'src/a.ts#one' } }), V({}))
  const uncited = findRowWeakenings(V({ k: { kind: 'skip', category: 'karute', action: '' } }), V({}))
  assert.deepEqual(keysOf(cited), ['map:k'])
  assert.deepEqual(uncited, [])
})
ok('enrichment stays free: action/coveredBy added where main had none', () => {
  const ws = findRowWeakenings(
    V({}, { d: { kind: 'log', pendingWave: 'W' } }),
    V({}, { d: { kind: 'log', pendingWave: 'W', action: 'a.b', coveredBy: 'src/x.ts#f' } }),
  )
  assert.deepEqual(ws, [])
})
ok('row parked AS skip dropping its pendingWave is flagged', () => {
  const ws = findRowWeakenings(
    V({ k: { kind: 'skip', category: 'ai', action: '', pendingWave: 'Wave W' } }),
    V({ k: { kind: 'skip', category: 'ai', action: '' } }),
  )
  assert.equal(ws.length, 1)
  assert.match(ws[0].note, /promised writer dropped/)
})
ok('clean promotion (identical content, pendingWave removed) stays free', () => {
  const ws = findRowWeakenings(
    V({ k: { kind: 'mutation', category: 'ai', action: 'a.b', pendingWave: 'Wave W' } }),
    V({ k: { kind: 'mutation', category: 'ai', action: 'a.b' } }),
  )
  assert.deepEqual(ws, [])
})
ok('live kind swap view↔mutation is flagged', () => {
  const ws = findRowWeakenings(
    V({ k: { kind: 'view', category: 'customer', action: 'c.v' } }),
    V({ k: { kind: 'mutation', category: 'customer', action: 'c.v' } }),
  )
  assert.deepEqual(keysOf(ws), ['map:k'])
})

// ── Owner-approval verdict ───────────────────────────────────────────────
const OWNER = 'alee046'
const rev = (login, state, commit_id) => ({ user: { login }, state, commit_id })
ok('no reviews → not approved', () => assert.equal(ownerApprovalVerdict([], 'H', OWNER).ok, false))
ok('approval on a stale commit → not approved', () =>
  assert.equal(ownerApprovalVerdict([rev(OWNER, 'APPROVED', 'OLD')], 'H', OWNER).ok, false))
ok('approval on the exact head → approved', () =>
  assert.equal(ownerApprovalVerdict([rev(OWNER, 'APPROVED', 'H')], 'H', OWNER).ok, true))
ok('approval superseded by CHANGES_REQUESTED → not approved', () =>
  assert.equal(ownerApprovalVerdict([rev(OWNER, 'APPROVED', 'H'), rev(OWNER, 'CHANGES_REQUESTED', 'H')], 'H', OWNER).ok, false))
ok('trailing COMMENTED review does not cancel an approval', () =>
  assert.equal(ownerApprovalVerdict([rev(OWNER, 'APPROVED', 'H'), rev(OWNER, 'COMMENTED', 'H')], 'H', OWNER).ok, true))
ok("someone else's approval does not count", () =>
  assert.equal(ownerApprovalVerdict([rev('mallory', 'APPROVED', 'H')], 'H', OWNER).ok, false))

console.log(`[parse-audit-source.selftest] ${n} checks passed`)
