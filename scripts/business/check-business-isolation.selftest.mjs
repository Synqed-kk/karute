#!/usr/bin/env node
// In-tier regression pins for the Business diff gate (same pattern as
// scripts/audit/parse-audit-source.selftest.mjs): runs in CI before the real
// check; one dependency, typescript, like the gate. Each case is a boundary a
// mutant actually crossed during the red-run proofs (prefix-vs-substring, trailing-slash config,
// rename smuggling) — not decoration.
// Cases 8+ pin the lock-3 door (⚖ Liam 9/24, R-A2-15): every clause has a
// green AND a red case, the red ones asserting the clause the gate NAMES, so
// a dropped check cannot hide behind a neighbouring one. Fixtures are the
// checkout's own audit-policy.ts + ledger, changed in memory (never on disk);
// the merge-base case builds a throwaway git repo under the OS temp dir.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  checkIsolation,
  checkAuditPolicyShape,
  checkLedgerAppend,
  gitPolicyVersions,
  loadTerritory,
} from './check-business-isolation.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

// The REAL config parses and is well-formed (trailing slashes enforced).
const territory = loadTerritory(root)
assert.ok(territory.includes('src/business/'), 'src/business/ must be territory')

// 1. Not a Business PR → gate does not apply.
assert.equal(checkIsolation(['src/lib/foo.ts', 'thin/router.tsx'], territory), null)

// 2. Business-only PR → clean.
assert.deepEqual(
  checkIsolation(['src/business/OwnerHome.tsx', 'src/app/api/business/summary/route.ts'], territory),
  [],
)

// 3. Mixed PR → every outside file reported (the lock itself).
assert.deepEqual(
  checkIsolation(['src/business/OwnerHome.tsx', 'thin/router.tsx', 'messages/ja.json'], territory),
  ['thin/router.tsx', 'messages/ja.json'],
)

// 4. Prefix means PREFIX: a sibling that merely starts with the same letters
//    is NOT territory (kills a startsWith→includes-style loosening AND a
//    trailing-slash-less config).
assert.equal(checkIsolation(['src/business-analytics.ts'], territory), null)

// 5. Substring elsewhere in the path is NOT territory (kills includes()).
assert.equal(checkIsolation(['docs/src/business/notes.md'], territory), null)

// 6. Rename smuggling: a phone file moved INTO territory shows both paths in
//    the CI feed (filename + previous_filename) — the old path is outside →
//    fail. This case pins that the gate judges BOTH.
assert.deepEqual(
  checkIsolation(['src/business/Stolen.tsx', 'src/components/dashboard/Old.tsx'], territory),
  ['src/components/dashboard/Old.tsx'],
)

// 7. CLI entrypoint fails closed on empty stdin (verify-round pin: without
//    this, a refactor of the main block could silently restore the
//    empty-feed-passes behavior an API flake exploits).
assert.throws(
  () =>
    execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'check-business-isolation.mjs')], {
      input: '',
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  (err) => err.status === 1,
)

// ── The lock-3 door (⚖ Liam 9/24, R-A2-15) ──────────────────────────────────
const POLICY_PATH = 'src/lib/audit-policy.ts'
const LEDGER_PATH = 'docs/audit-weakening-ledger.md'
const TERRITORY_FILE = 'src/business/lib/practice-door/door.ts'
// The checkout's own audit-policy.ts minus PR-2's entry once it has landed (the
// write branch, then main): every fixture appends to a base that does not hold
// it yet, so case 8 stays PR-2's first landing on any checkout (case 36: one
// entry per file::call).
const POLICY = withoutLanded(readFileSync(join(root, POLICY_PATH), 'utf8'))
const LEDGER = readFileSync(join(root, LEDGER_PATH), 'utf8')

/** The registry array literal `name` (unwrapping `as const`) + its declaration. */
function registry(text, name) {
  const sf = ts.createSourceFile('audit-policy.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s)) continue
    for (const d of s.declarationList.declarations) {
      if (d.name.text !== name) continue
      return { decl: d, arr: ts.isAsExpression(d.initializer) ? d.initializer.expression : d.initializer }
    }
  }
  throw new Error(`fixture: ${name} not found`)
}
function withoutLanded(text) {
  const landed = registry(text, 'SDK_WRITE_ALLOWLIST').arr.elements.find(
    (e) => e.getText().includes(`file: '${TERRITORY_FILE}'`) && e.getText().includes("call: 'orgSettings.upsert'"),
  )
  if (!landed) return text
  assert.equal(text[landed.end], ',', "fixture: PR-2's landed entry ends '},'")
  return text.slice(0, landed.pos) + text.slice(landed.end + 1)
}
/** Append `entry` as the array's new last element — a pure insertion before its `]`. */
function append(text, name, entry) {
  const close = registry(text, name).arr.end - 1
  assert.equal(text[close], ']')
  assert.match(text.slice(0, close), /,\n$/, `fixture: ${name} must end '},\\n]' for a pure-insertion append`)
  return text.slice(0, close) + entry + text.slice(close)
}
const entry = (body) => `  {\n${body}\n  },\n`
const policyRed = (head, clause) => {
  const why = checkAuditPolicyShape(POLICY, head, territory)
  assert.ok(why && why.startsWith(clause), `expected '${clause}…', got ${JSON.stringify(why)}`)
}
const ledgerRed = (head) => {
  const why = checkLedgerAppend(LEDGER, head, territory)
  assert.ok(why && why.startsWith('clause 3:'), `expected 'clause 3:…', got ${JSON.stringify(why)}`)
}

// PR-2's exact texts (BUILD-A2-RESULT Round 3 ready text, R-A2-11 wording,
// <who ruled> filled per R-A2-11) — appended at the END of the array.
const PR2_ENTRY = entry(
  [
    `    file: '${TERRITORY_FILE}',`,
    "    call: 'orgSettings.upsert',",
    "    symbols: ['writeReserveCardColor'],",
    '    justification:',
    "      'Parity with writeOrgSettingsBlobWithClient above (org settings are unaudited by design). ⚖ Liam 9/24 A2 (PKT-A2-CORE-WRITE R-A2-4/R-A2-11): one structured server log line per real write; a core audit row is R5 (later).',",
    "    dated: '2026-09-24',",
  ].join('\n'),
)
const PR2_LEDGER_LINE =
  `- 2026-09-24 · SDK_WRITE_ALLOWLIST:${TERRITORY_FILE}::orgSettings.upsert · the Business card-colour writer (A2): one key, palette-or-null, settings.manage, read-before-write; server log line per write, core audit row = R5 later · Fable 5.1 (lead, R-A2-4/R-A2-11) under the 7/27 parity rule · Liam's 9/24 fence yes · Liam is told before the merge word · core audit row = R5\n`
const PR2_POLICY = append(POLICY, 'SDK_WRITE_ALLOWLIST', PR2_ENTRY)
const PR2_LEDGER = LEDGER + PR2_LEDGER_LINE
const versionsOf = (byPath) => (p) => byPath[p] ?? null
const PR2_VERSIONS = versionsOf({
  [POLICY_PATH]: { base: POLICY, head: PR2_POLICY },
  [LEDGER_PATH]: { base: LEDGER, head: PR2_LEDGER },
})

// 8. GREEN (clause 1+2+3) — PR-2's exact shape: territory files + the entry
//    appended + the ledger line → nothing outside is an offender.
assert.deepEqual(checkIsolation([TERRITORY_FILE, 'src/app/api/business/card-color/route.ts', POLICY_PATH, LEDGER_PATH], territory, PR2_VERSIONS), [])
assert.equal(checkAuditPolicyShape(POLICY, PR2_POLICY, territory), null)
assert.equal(checkLedgerAppend(LEDGER, PR2_LEDGER, territory), null)

// 9. GREEN — an unchanged policy file in the feed (mode change, no bytes) and
//    new entries in the other two file-bearing registries.
assert.equal(checkAuditPolicyShape(POLICY, POLICY, territory), null)
const coresAndRaw = append(
  append(POLICY, 'AUDITED_CORES', entry(`    file: '${TERRITORY_FILE}',\n    symbols: ['writeReserveCardColor'],\n    note: 'fixture',`)),
  'RAW_SUPABASE_WRITE_ALLOWLIST',
  entry(`    file: 'src/app/api/business/x/route.ts',\n    call: 't.insert',\n    symbols: ['POST'],\n    justification: 'fixture',\n    dated: '2026-09-24',\n    pendingWave: 'fixture',`),
)
assert.equal(checkAuditPolicyShape(POLICY, coresAndRaw, territory), null)

// 10. RED (clause 1) — every other outside file stays refused in a territory
//     PR, the two policy files notwithstanding: the audit emitter, the gate
//     itself, its selftest, the territory/writers JSON, the data-access
//     scanner, ci.yml, a Karute app path, the CP3 suite.
const stillRefused = [
  'src/lib/audit.ts',
  'scripts/business/check-business-isolation.mjs',
  'scripts/business/check-business-isolation.selftest.mjs',
  'scripts/business/business-territory.json',
  'scripts/business/check-business-data-access.mjs',
  '.github/workflows/ci.yml',
  'src/actions/org-settings.ts',
  'src/__tests__/integration/audit-sdk-write-sites.test.ts',
]
for (const f of stillRefused) {
  assert.deepEqual(checkIsolation([TERRITORY_FILE, POLICY_PATH, f], territory, PR2_VERSIONS), [f], `${f} must stay refused`)
}

// 11. RED (clause 1) — the two paths are matched EXACTLY, never as a prefix.
assert.deepEqual(
  checkIsolation([TERRITORY_FILE, 'src/lib/audit-policy.tsx', 'docs/audit-weakening-ledger.md.bak'], territory, () => ({ base: '', head: '' })),
  ['src/lib/audit-policy.tsx', 'docs/audit-weakening-ledger.md.bak'],
)

// 12. RED (clause 1) — a policy file whose two texts cannot be read (no
//     --base/--head, a deleted file, shallow history) is refused, never waved.
const unread = checkIsolation([TERRITORY_FILE, POLICY_PATH], territory)
assert.equal(unread.length, 1)
assert.match(unread[0], /^src\/lib\/audit-policy\.ts — its merge-base and head texts could not be read/)

// 13. GREEN (clause 1) — a NON-territory PR touching audit-policy.ts in ANY way
//     (the probe included) is not a Business PR: the door is never consulted.
const neverRead = () => {
  throw new Error('the door must not read a non-Business PR')
}
assert.equal(checkIsolation([POLICY_PATH, LEDGER_PATH, 'src/actions/org-settings.ts'], territory, neverRead), null)

// 14. GREEN (clause 1) — this fences PR's own diff is not a Business PR.
assert.equal(
  checkIsolation(
    [
      '.github/workflows/ci.yml',
      'scripts/business/business-territory.json',
      'scripts/business/check-business-data-access.mjs',
      'scripts/business/check-business-data-access.selftest.mjs',
      'scripts/business/check-business-isolation.mjs',
      'scripts/business/check-business-isolation.selftest.mjs',
      'src/__tests__/integration/audit-sdk-write-sites.test.ts',
      'src/lib/audit.ts',
    ],
    territory,
    neverRead,
  ),
  null,
)

// 15. RED (clause 2a) — THE COLDREAD PROBE: two appended module-scope lines,
//     zero deletions, that would make CP3's `allowlist.some(…)` true forever.
const PROBE = POLICY + '\nSDK_WRITE_ALLOWLIST.some = () => true\nRAW_SUPABASE_WRITE_ALLOWLIST.some = () => true\n'
policyRed(PROBE, 'clause (a)')
assert.deepEqual(
  checkIsolation([TERRITORY_FILE, POLICY_PATH], territory, versionsOf({ [POLICY_PATH]: { base: POLICY, head: PROBE } })).map((o) => o.split(' — ')[0]),
  [POLICY_PATH],
)
// …also when it rides WITH a legitimate appended entry.
policyRed(PR2_POLICY + '\nSDK_WRITE_ALLOWLIST.some = () => true\n', 'clause (a)')

// 16. RED (clause 2a) — a one-byte change to a comment outside the arrays.
const nl = POLICY.indexOf('\n')
assert.ok(POLICY.startsWith('//'), 'fixture: audit-policy.ts line 1 is a comment')
policyRed(POLICY.slice(0, nl - 1) + (POLICY[nl - 1] === 'x' ? 'y' : 'x') + POLICY.slice(nl), 'clause (a)')

// 17. RED (clause 2a) — a changed type annotation on an array's head
//     (`file: string` → `file: any`).
const sdkType = registry(POLICY, 'SDK_WRITE_ALLOWLIST').decl.type
const typeText = POLICY.slice(sdkType.getStart(), sdkType.end)
assert.ok(typeText.includes('file: string'), 'fixture: SDK_WRITE_ALLOWLIST head types file: string')
policyRed(POLICY.slice(0, sdkType.getStart()) + typeText.replace('file: string', 'file: any') + POLICY.slice(sdkType.end), 'clause (a)')

// 18. RED (clause 2a) — a new top-level statement of any other kind.
policyRed(POLICY + '\nexport const EXTRA = 1\n', 'clause (a)')

// 19. RED (clause 2b) — a removed base entry (the first one, with its comma).
const sdk = registry(POLICY, 'SDK_WRITE_ALLOWLIST').arr.elements
policyRed(POLICY.slice(0, sdk[0].pos) + POLICY.slice(sdk[1].pos), 'clause (b)')

// 20. RED (clause 2b) — a reordered pair (entries 0 and 1 swapped).
const full = (n) => POLICY.slice(n.pos, n.end)
policyRed(POLICY.slice(0, sdk[0].pos) + full(sdk[1]) + POLICY.slice(sdk[0].end, sdk[1].pos) + full(sdk[0]) + POLICY.slice(sdk[1].end), 'clause (b)')

// 21. RED (clause 2b) — a base entry edited by one byte, and a comment INSIDE
//     an array (the leading comment of a base entry) edited.
const e0 = sdk[0].getStart()
policyRed(POLICY.slice(0, e0 + 1) + ' ' + POLICY.slice(e0 + 1), 'clause (b)')
const cores = registry(POLICY, 'AUDITED_CORES').arr.elements
const withComment = cores.findIndex((e) => POLICY.slice(e.pos, e.getStart()).includes('//'))
assert.ok(withComment >= 0, 'fixture: some AUDITED_CORES entry has a leading comment')
const c = POLICY.indexOf('//', cores[withComment].pos)
policyRed(POLICY.slice(0, c + 2) + ' EDITED' + POLICY.slice(c + 2), 'clause (b)')

// 22. RED (clause 2c) — a new entry with a getter (code that runs when read).
policyRed(
  append(POLICY, 'SDK_WRITE_ALLOWLIST', entry(`    file: '${TERRITORY_FILE}',\n    get call() { return 'orgSettings.upsert' },\n    symbols: ['w'],\n    justification: 'x',\n    dated: '2026-09-24',`)),
  'clause (c)',
)

// 23. RED (clause 2c) — a new entry whose `file` is outside territory, and
//     one that only LOOKS inside (a `..` walk out of the prefix).
policyRed(append(POLICY, 'SDK_WRITE_ALLOWLIST', entry("    file: 'src/actions/org-settings.ts',\n    call: 'orgSettings.upsert',\n    symbols: ['w'],\n    justification: 'x',\n    dated: '2026-09-24',")), 'clause (c)')
policyRed(append(POLICY, 'SDK_WRITE_ALLOWLIST', entry("    file: 'src/business/../actions/org-settings.ts',\n    call: 'orgSettings.upsert',\n    symbols: ['w'],\n    justification: 'x',\n    dated: '2026-09-24',")), 'clause (c)')

// 24. RED (clause 2c) — every other non-data shape in a new entry.
for (const [label, body] of [
  ['method', `    file: '${TERRITORY_FILE}',\n    call() { return 'x' },`],
  ['spread', `    file: '${TERRITORY_FILE}',\n    ...{ call: 'x' },`],
  ['shorthand', `    file: '${TERRITORY_FILE}',\n    call,`],
  ['computed name', `    file: '${TERRITORY_FILE}',\n    ['call']: 'x',`],
  ['identifier value', `    file: '${TERRITORY_FILE}',\n    call: SOME_CONST,`],
  ['call value', `    file: '${TERRITORY_FILE}',\n    call: String('x'),`],
  ['template value', `    file: \`${TERRITORY_FILE}\`,\n    call: 'x',`],
  ['arrow value', `    file: '${TERRITORY_FILE}',\n    call: 'x',\n    symbols: () => ['w'],`],
  ['duplicate file', `    file: '${TERRITORY_FILE}',\n    file: 'src/actions/org-settings.ts',\n    call: 'x',`],
  ['__proto__', `    file: '${TERRITORY_FILE}',\n    __proto__: ['x'],\n    call: 'x',`],
  ['no file', "    call: 'x',\n    symbols: ['w'],"],
]) {
  const why = checkAuditPolicyShape(POLICY, append(POLICY, 'SDK_WRITE_ALLOWLIST', entry(body)), territory)
  assert.ok(why?.startsWith('clause (c)'), `${label}: expected clause (c), got ${JSON.stringify(why)}`)
}
policyRed(append(POLICY, 'AUDITED_CORES', `  '${TERRITORY_FILE}',\n`), 'clause (c)')

// 25. RED (clause 2d, R-A2-16) — a new AUDIT_ACTIONS string.
policyRed(append(POLICY, 'AUDIT_ACTIONS', "  'zzz.business_selftest',\n"), 'clause (d)')

// 26. RED (clause 2e) — a new SDK entry CP8's own parser cannot read (no `call`).
policyRed(append(POLICY, 'SDK_WRITE_ALLOWLIST', entry(`    file: '${TERRITORY_FILE}',\n    symbols: ['w'],\n    justification: 'x',\n    dated: '2026-09-24',`)), 'clause (e)')

// 27. RED (clause 2) — a head that does not parse is unreadable, never trusted.
policyRed(POLICY + '\nexport const = [\n', 'unreadable')

// 28. RED (clause 3) — a deleted base line; an edited base line.
const ledgerLines = LEDGER.split('\n')
const firstEntry = ledgerLines.findIndex((l) => l.startsWith('- '))
ledgerRed(ledgerLines.filter((_, i) => i !== firstEntry).join('\n'))
ledgerRed(ledgerLines.map((l, i) => (i === firstEntry ? l + ' ' : l)).join('\n'))

// 29. RED (clause 3) — an inserted entry whose key names no territory file
//     (a Karute file; a territory prefix hiding in the call; a `..` walk out).
for (const key of [
  'SDK_WRITE_ALLOWLIST:src/actions/org-settings.ts::orgSettings.upsert',
  'SDK_WRITE_ALLOWLIST:src/actions/org-settings.ts::src/business/',
  'SDK_WRITE_ALLOWLIST:src/business/../actions/org-settings.ts::orgSettings.upsert',
  'action:business.card_color',
]) {
  ledgerRed(LEDGER + `- 2026-09-24 · ${key} · why · who\n`)
}

// 30. RED (clause 3) — a bare inserted line; an inserted blank line; an
//     indented line wrapping a BASE entry (an edit of an approved entry).
ledgerRed(LEDGER + 'free text\n')
ledgerRed(LEDGER + '\n')
ledgerRed(ledgerLines.flatMap((l, i) => (i === firstEntry ? [l, '  appended to an approved entry'] : [l])).join('\n'))

// 31. GREEN (clause 3) — a territory entry with its indented wrap lines, and
//     two new entries back to back.
assert.equal(
  checkLedgerAppend(
    LEDGER,
    LEDGER + `- 2026-09-24 · cores:${TERRITORY_FILE}#writeReserveCardColor · why\n  wrapped why · who\n` + PR2_LEDGER_LINE,
    territory,
  ),
  null,
)

// 32. GREEN (merge-base) — main's own registry growth after the branch point
//     is NOT this branch's change. Real git in a temp repo: base commit →
//     main gains a Karute AUDITED_CORES entry mid-array, an AUDIT_ACTIONS
//     member and a Karute ledger line (the shape of main's real drift) →
//     the branch (from base) appends PR-2's entry + line. The door reads
//     merge-base(main, branch) = base → green. Judged against main's tip
//     instead it would be red (b) + red 3 — which is why the door uses the
//     merge-base.
const repo = mkdtempSync(join(tmpdir(), 'bizdoor-'))
const git = (...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=selftest', '-c', 'user.email=selftest@invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
const put = (rel, text) => {
  mkdirSync(join(repo, dirname(rel)), { recursive: true })
  writeFileSync(join(repo, rel), text)
}
const coresAt1 = registry(POLICY, 'AUDITED_CORES').arr.elements[1].pos
const MAIN_POLICY = append(
  POLICY.slice(0, coresAt1) + "\n  { file: 'src/lib/recording/selftest-drift.ts', symbols: ['driftWithClient'] }," + POLICY.slice(coresAt1),
  'AUDIT_ACTIONS',
  "  'zzz.main_drift',\n",
)
assert.notEqual(MAIN_POLICY, POLICY)
const MAIN_LEDGER = LEDGER + '- 2026-09-25 · SDK_WRITE_ALLOWLIST:src/lib/recording/selftest-drift.ts::recordings.update · main drift · selftest\n'
try {
  git('init', '-q')
  put(POLICY_PATH, POLICY)
  put(LEDGER_PATH, LEDGER)
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('branch', 'feature')
  put(POLICY_PATH, MAIN_POLICY)
  put(LEDGER_PATH, MAIN_LEDGER)
  git('commit', '-q', '-am', 'main drift')
  git('branch', '-M', 'main')
  git('checkout', '-q', 'feature')
  put(POLICY_PATH, PR2_POLICY)
  put(LEDGER_PATH, PR2_LEDGER)
  put(TERRITORY_FILE, 'export const w = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'feature')
  const changed = [TERRITORY_FILE, POLICY_PATH, LEDGER_PATH]
  assert.deepEqual(checkIsolation(changed, territory, gitPolicyVersions(repo, 'main', 'feature')), [])
  // the contrast: main's tip as the base
  assert.ok(checkAuditPolicyShape(MAIN_POLICY, PR2_POLICY, territory)?.startsWith('clause (b)'))
  assert.ok(checkLedgerAppend(MAIN_LEDGER, PR2_LEDGER, territory)?.startsWith('clause 3:'))
  // 33. RED — the same run with the coldread probe on the branch.
  put(POLICY_PATH, PROBE)
  git('commit', '-q', '-am', 'probe')
  const probed = checkIsolation(changed, territory, gitPolicyVersions(repo, 'main', 'feature'))
  assert.equal(probed.length, 1)
  assert.match(probed[0], /^src\/lib\/audit-policy\.ts — clause \(a\)/)
  // 34. RED — an unknown ref: git cannot answer → unreadable → refused.
  assert.equal(gitPolicyVersions(repo, 'no-such-ref', 'feature')(POLICY_PATH), null)
  assert.equal(gitPolicyVersions(repo, undefined, 'feature')(POLICY_PATH), null)
} finally {
  rmSync(repo, { recursive: true, force: true })
}

// 35. CLI — an unknown flag and a territory policy change without refs both
//     exit 1; a non-Business feed exits 0.
const cli = join(dirname(fileURLToPath(import.meta.url)), 'check-business-isolation.mjs')
const run = (input, args = []) => execFileSync(process.execPath, [cli, ...args], { input, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' })
assert.throws(() => run('src/lib/foo.ts\n', ['--bogus']), (err) => err.status === 1)
assert.throws(() => run(`${TERRITORY_FILE}\n${POLICY_PATH}\n`), (err) => err.status === 1 && /could not be read/.test(err.stderr))
assert.match(run(`${POLICY_PATH}\n`), /not a Business PR/)

// ── one entry per CP8 key (blind read finding 5): `file` / `file::call` ──────
const PR2_KEY = `${TERRITORY_FILE}::orgSettings.upsert`
const WIDENED = entry(
  `    file: '${TERRITORY_FILE}',\n    call: 'orgSettings.upsert',\n    symbols: ['writeReserveCardColor', 'someOtherWriter'],\n    justification: 'x',\n    dated: '2026-09-25',`,
)
const dupRed = (base, head, name, key) => {
  const why = checkAuditPolicyShape(base, head, territory)
  assert.ok(
    why?.startsWith(`clause (c): ${name} new entry #`) && why.includes(`repeats the key '${key}'`),
    `expected clause (c) one-entry-per-key on '${key}', got ${JSON.stringify(why)}`,
  )
}

// 36. RED (clause 2c) — a second door.ts::orgSettings.upsert entry, `symbols`
//     widened, on a base that already holds PR-2's grant.
dupRed(PR2_POLICY, append(PR2_POLICY, 'SDK_WRITE_ALLOWLIST', WIDENED), 'SDK_WRITE_ALLOWLIST', PR2_KEY)

// 37. RED (clause 2c) — two new entries under one key in the same PR (SDK and RAW).
dupRed(POLICY, append(PR2_POLICY, 'SDK_WRITE_ALLOWLIST', WIDENED), 'SDK_WRITE_ALLOWLIST', PR2_KEY)
const RAW = entry(`    file: 'src/app/api/business/x/route.ts',\n    call: 't.insert',\n    symbols: ['POST'],\n    justification: 'x',\n    dated: '2026-09-25',`)
dupRed(POLICY, append(append(POLICY, 'RAW_SUPABASE_WRITE_ALLOWLIST', RAW), 'RAW_SUPABASE_WRITE_ALLOWLIST', RAW), 'RAW_SUPABASE_WRITE_ALLOWLIST', 'src/app/api/business/x/route.ts::t.insert')

// 38. RED (clause 2c) — a duplicate AUDITED_CORES `file` (its key is the file alone).
dupRed(coresAndRaw, append(coresAndRaw, 'AUDITED_CORES', entry(`    file: '${TERRITORY_FILE}',\n    symbols: ['someOtherWriter'],`)), 'AUDITED_CORES', TERRITORY_FILE)

// 39. GREEN — the allowlist key is file::call, not file: the same file with
//     another call is a new grant.
assert.equal(
  checkAuditPolicyShape(PR2_POLICY, append(PR2_POLICY, 'SDK_WRITE_ALLOWLIST', WIDENED.replace("call: 'orgSettings.upsert'", "call: 'orgSettings.delete'")), territory),
  null,
)

// 40. RED (clause 3, the tail — stress mutant h) — the LAST base line deleted:
//     head's lines are a strict prefix of base's, so only the after-loop check
//     sees it.
const tailCut = LEDGER.replace(/\n[^\n]*\n?$/, '')
assert.ok(LEDGER.startsWith(tailCut) && tailCut.length < LEDGER.length, 'fixture: the ledger has a last line to cut')
assert.equal(
  checkLedgerAppend(LEDGER, tailCut, territory),
  `clause 3: base ledger line ${tailCut.split('\n').length + 1} was deleted or edited (append-only)`,
)

// 41. RED (clause 3) — the last base line edited by one byte.
const lastAt = tailCut.length + 1 // the last line's first byte
ledgerRed(LEDGER.slice(0, lastAt) + (LEDGER[lastAt] === 'x' ? 'y' : 'x') + LEDGER.slice(lastAt + 1))

console.log('✓ business isolation gate selftest: 41 cases green')
