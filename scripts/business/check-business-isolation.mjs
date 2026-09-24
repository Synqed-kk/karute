#!/usr/bin/env node
// Business PR diff gate (phone-safety lock 3, clause 1): a PR that touches
// Business territory may touch NOTHING outside it — deny-by-default, so the
// phone-owned surface never needs enumerating (thin/, facade routes, shared
// screen components at every width, messages/, package.json … are all simply
// "outside"). A legitimate shared-file move ships as its OWN non-Business PR
// with the sim battery + byte-diff proof (savepoint four-locks section);
// this gate exists to make that split mandatory, not optional.
//
// THE ONE DOOR (⚖ Liam 9/24, R-A2-15 — lock 3 stays, it gets a structured
// door, not a hole): a territory PR may ALSO change exactly two files, each
// judged by SHAPE between the merge-base and the PR head, never by name alone:
//   - src/lib/audit-policy.ts — every byte outside the four registry arrays
//     identical (an appended module-scope line like
//     `SDK_WRITE_ALLOWLIST.some = () => true` defeats CP3 repo-wide, so this
//     is clause (a)); every base entry unchanged and in order; only NEW
//     entries appended, each a plain object literal of literal values whose
//     `file` is inside territory; no new AUDIT_ACTIONS member (R-A2-16); and
//     CP8's own parser must still read the head.
//     One entry per CP8 key (`file` / `file::call`): widening a grant is owner-routed (base entries never change).
//   - docs/audit-weakening-ledger.md — base lines unchanged and in order; new
//     lines only; each new entry's key names a territory file.
// Everything else outside territory stays refused exactly as before: Karute
// app paths, src/lib/audit.ts, the scanners, this gate, business-territory.json
// and ci.yml. The Business WRITERS list (business-territory.json "writers",
// read by CP3's pairing clause) is outside territory on purpose: it lands in
// its own non-Business PR before any territory code that writes.
//
// stdin = changed file paths, one per line (CI feeds the PR files API,
// including previous_filename on renames so a file can't be smuggled INTO
// territory). --base/--head name the two commits the door reads (base = the
// PR's base; the door diffs against git merge-base(base, head), so main's own
// later registry growth never counts as this branch's change). Local run:
//   git diff --name-only origin/main...HEAD | node scripts/business/check-business-isolation.mjs --base origin/main --head HEAD
// One dependency: typescript (the audit parser's; CI installs it exact-pinned,
// --ignore-scripts). Territory lives in business-territory.json (one source of
// truth, shared with the jest import-isolation suite and CP3's pairing clause).

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import ts from 'typescript'
import { parseAuditActions, parseAuditedCores, parseAllowlist } from '../audit/parse-audit-source.mjs'

export function loadTerritory(root) {
  const raw = JSON.parse(
    readFileSync(join(root, 'scripts/business/business-territory.json'), 'utf8'),
  )
  const territory = raw.territory
  if (!Array.isArray(territory) || territory.length === 0) {
    throw new Error('business-territory.json: territory must be a non-empty array')
  }
  for (const p of territory) {
    // A prefix without the trailing slash would also match siblings
    // (src/business-analytics.ts) — malformed config fails loud, never scans.
    if (typeof p !== 'string' || !p.endsWith('/')) {
      throw new Error(`business-territory.json: entry must end with '/': ${JSON.stringify(p)}`)
    }
  }
  return territory
}

/** A registry/ledger `file`: a normalized repo path inside territory
 *  (`src/business/../lib/x.ts` starts with the prefix but is not inside). */
function isTerritoryFile(f, territory) {
  return typeof f === 'string' && posix.normalize(f) === f && !f.includes('\\') && territory.some((p) => f.startsWith(p))
}

// ── audit-policy.ts, by shape ────────────────────────────────────────────────
const REGISTRIES = ['AUDIT_ACTIONS', 'AUDITED_CORES', 'SDK_WRITE_ALLOWLIST', 'RAW_SUPABASE_WRITE_ALLOWLIST']

/** The four top-level registry array literals + the text outside them, or
 *  null when the file does not parse cleanly or a registry is not exactly one
 *  top-level `const NAME = [...]` (optionally `as const`). Same
 *  createSourceFile call as parse-audit-source.mjs's (module-private) sourceFileOf. */
function registryView(text) {
  const sf = ts.createSourceFile('audit-policy.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (sf.parseDiagnostics?.length !== 0) return null
  const arrays = new Map()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !REGISTRIES.includes(d.name.text)) continue
      const init = d.initializer && ts.isAsExpression(d.initializer) ? d.initializer.expression : d.initializer
      if (!init || !ts.isArrayLiteralExpression(init) || arrays.has(d.name.text)) return null
      arrays.set(d.name.text, init)
    }
  }
  if (arrays.size !== REGISTRIES.length) return null
  const outside = []
  let at = 0
  for (const a of [...arrays.values()].sort((x, y) => x.pos - y.pos)) {
    outside.push(text.slice(at, a.getStart(sf)))
    at = a.end
  }
  outside.push(text.slice(at))
  return { sf, arrays, outside }
}

/** Inert data only: a string, a number, a boolean, or an array of strings. */
function isInertLiteral(n) {
  return (
    ts.isStringLiteral(n) ||
    ts.isNumericLiteral(n) ||
    n.kind === ts.SyntaxKind.TrueKeyword ||
    n.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isArrayLiteralExpression(n) && n.elements.every((e) => ts.isStringLiteral(e)))
  )
}

/** Why a NEW registry entry is not inert data about a territory file, or null. */
function newEntryProblem(el, territory) {
  if (!ts.isObjectLiteralExpression(el)) return 'is not an object literal'
  const keys = new Set()
  let file
  for (const p of el.properties) {
    // getters, methods, spreads and shorthand are code or references, not data
    if (!ts.isPropertyAssignment(p)) return `has a ${ts.SyntaxKind[p.kind]}, not a plain 'key: literal' property`
    if (!ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name)) return 'has a computed or numeric property name'
    const key = p.name.text
    if (key === '__proto__' || keys.has(key)) return `repeats or reserves the key '${key}'`
    keys.add(key)
    if (!isInertLiteral(p.initializer)) return `'${key}' is not a string, string[], boolean or number literal`
    if (key === 'file') file = p.initializer
  }
  if (!file || !ts.isStringLiteral(file) || !isTerritoryFile(file.text, territory)) {
    return "'file' is not a string literal naming a file inside Business territory"
  }
  return null
}

/** Clause 2 of the door. null = the head only APPENDED territory entries. */
export function checkAuditPolicyShape(baseText, headText, territory) {
  const base = registryView(baseText)
  const head = registryView(headText)
  if (!base || !head) return 'unreadable: it does not parse, or a registry is not exactly one top-level array'
  // (a) nothing outside the four arrays moves — statement count, heads, comments, bytes
  if (
    head.sf.statements.length !== base.sf.statements.length ||
    head.outside.some((s, i) => s !== base.outside[i])
  ) {
    return 'clause (a): text outside the four registry arrays changed (only new array entries may be added)'
  }
  for (const name of REGISTRIES) {
    const b = base.arrays.get(name).elements
    const h = head.arrays.get(name).elements
    // (b) base entries unchanged (leading comments included) and in order
    if (h.length < b.length || b.some((e, i) => e.getFullText(base.sf) !== h[i].getFullText(head.sf))) {
      return `clause (b): ${name} — a base entry was removed, edited or moved (entries may only be appended)`
    }
    // (d) R-A2-16: an action has no `file`, so it can never be shown to be Business's
    if (name === 'AUDIT_ACTIONS') {
      if (h.length > b.length) return 'clause (d): AUDIT_ACTIONS gained a member — a Business PR adds no actions (R-A2-16)'
      continue
    }
    // (c) every new entry is inert data about a territory file
    for (let i = b.length; i < h.length; i++) {
      const why = newEntryProblem(h[i], territory)
      if (why) return `clause (c): ${name} new entry #${i + 1} ${why}`
    }
    // …and files under a key no earlier entry holds — CP8's Map key (`file` /
    // `file::call`), so a second entry can never shadow or widen a grant's
    // `symbols`. CP8 unreadable → no keys here; (e) refuses below.
    const cores = name === 'AUDITED_CORES'
    const keys = ((cores ? parseAuditedCores(headText) : parseAllowlist(headText, name)) ?? []).map((e) =>
      cores ? e.file : `${e.file}::${e.call}`,
    )
    for (let i = b.length; i < keys.length; i++) {
      if (keys.indexOf(keys[i]) < i) return `clause (c): ${name} new entry #${i + 1} repeats the key '${keys[i]}' (one entry per key)`
    }
  }
  // (e) CP8 must still read the head with its own parser.
  if (
    parseAuditActions(headText) === null ||
    parseAuditedCores(headText) === null ||
    parseAllowlist(headText, 'SDK_WRITE_ALLOWLIST') === null ||
    parseAllowlist(headText, 'RAW_SUPABASE_WRITE_ALLOWLIST') === null
  ) {
    return "clause (e): CP8's parser (scripts/audit/parse-audit-source.mjs) cannot read the head's registries"
  }
  return null
}

// ── the ledger, append-only, territory keys ─────────────────────────────────
// CP8's own entry shape (check-audit-weakening.mjs LEDGER_ENTRY_RE): the key is
// the field between the date and the next ' · ' on the entry's FIRST line.
const LEDGER_ENTRY_RE = /^- \d{4}-\d{2}-\d{2} · (.+?) · /
// A key's file: `SDK_WRITE_ALLOWLIST:<file>::<call>`, `cores:<file>#<symbol>` …
const LEDGER_KEY_FILE_RE = /^[A-Za-z_]+:(.+?)(?:::|#|$)/

/** Clause 3 of the door. null = base lines intact and in order, and every
 *  inserted line is a territory-keyed entry or that entry's indented wrap. */
export function checkLedgerAppend(baseText, headText, territory) {
  const base = baseText.split('\n')
  let j = 0
  let inNewEntry = false
  for (const line of headText.split('\n')) {
    if (j < base.length && line === base[j]) {
      j++
      inNewEntry = false
      continue
    }
    const key = LEDGER_ENTRY_RE.exec(line)?.[1]
    if (key !== undefined) {
      if (!isTerritoryFile(LEDGER_KEY_FILE_RE.exec(key)?.[1], territory)) {
        return `clause 3: new ledger entry key '${key}' names no file inside Business territory`
      }
      inNewEntry = true
    } else if (!(inNewEntry && /^\s+\S/.test(line))) {
      return `clause 3: an inserted ledger line is neither a new '- YYYY-MM-DD · <key> · …' entry nor its indented wrap: ${JSON.stringify(line.slice(0, 80))}`
    }
  }
  if (j < base.length) return `clause 3: base ledger line ${j + 1} was deleted or edited (append-only)`
  return null
}

// The ONLY two outside files a territory PR may change, each with its check.
export const POLICY_FILES = new Map([
  ['src/lib/audit-policy.ts', checkAuditPolicyShape],
  ['docs/audit-weakening-ledger.md', checkLedgerAppend],
])

/** Pure core. changed = repo-relative paths; policyVersions(path) →
 *  { base, head } texts or null. Returns null when the diff touches no
 *  Business path (not a Business PR — gate and door do not apply), else the
 *  offenders (a bare path, or `path — the failed clause` for a policy file). */
export function checkIsolation(changed, territory, policyVersions = () => null) {
  const inTerritory = (f) => territory.some((p) => f.startsWith(p))
  if (!changed.some(inTerritory)) return null
  const offenders = []
  for (const f of changed) {
    if (inTerritory(f)) continue
    const check = POLICY_FILES.get(f)
    if (!check) {
      offenders.push(f)
      continue
    }
    const v = policyVersions(f)
    const why = v
      ? check(v.base, v.head, territory)
      : 'its merge-base and head texts could not be read (run with --base <ref> --head <ref>; the file must exist on both sides)'
    if (why) offenders.push(`${f} — ${why}`)
  }
  return offenders
}

/** policyVersions backed by git: base = merge-base(baseRef, headRef), head =
 *  headRef. Any git failure (missing ref, shallow history, deleted file) →
 *  null, which the door refuses. */
export function gitPolicyVersions(repo, baseRef, headRef) {
  if (!baseRef || !headRef) return () => null
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 })
  let mergeBase
  return (path) => {
    try {
      mergeBase ??= git('merge-base', baseRef, headRef).trim()
      return { base: git('show', `${mergeBase}:${path}`), head: git('show', `${headRef}:${path}`) }
    } catch {
      return null
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  const { values } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string' } } })
  const changed = readFileSync(0, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (changed.length === 0) {
    // Fail closed (blind-round catch): a PR always has ≥1 changed file, so an
    // empty feed means the API call upstream failed — without this, an API
    // flake would print "not a Business PR" and pass.
    console.error('✗ no changed files received on stdin — refusing to pass on an empty feed')
    process.exit(1)
  }
  const offenders = checkIsolation(changed, loadTerritory(root), gitPolicyVersions(root, values.base, values.head))
  if (offenders === null) {
    console.log(`✓ not a Business PR (${changed.length} changed files, none in Business territory)`)
  } else if (offenders.length === 0) {
    const via = changed.filter((f) => POLICY_FILES.has(f))
    console.log(
      '✓ Business PR stays inside Business territory' +
        (via.length ? ` (+ ${via.join(', ')}: territory registry entries appended, shape checked)` : ''),
    )
  } else {
    console.error('✗ Business PR touches files OUTSIDE Business territory — split them into their own PR:')
    for (const f of offenders) console.error('  ' + f)
    process.exit(1)
  }
}
