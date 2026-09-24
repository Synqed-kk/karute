#!/usr/bin/env node
// In-tier regression pins for the Business data-access guard (same pattern as
// check-business-isolation.selftest.mjs). Territory holds real files now, but
// they exercise only some of the rules — these fixtures are the red→green
// proof that every rule catches what it claims. Cases 2–5 pin Liam's
// play-phase ruling (core reach and writes banned everywhere, supabase reads
// only in the two lock files); cases 9–12 pin the bypasses the blind review
// round and Greptile found in the first cuts. Case 13 pins the bed-packing
// undo-log allowance against the DEFAULT ALLOW (Greptile P2, 2026-09-08 — the
// budget entry combining two match strings under one count had no coverage).
// Cases 15a–15f pin the ONE practice-door exemption (⚖ Liam 9/19): the exact
// factory import at the exact path is green, the same line elsewhere is red,
// a second occurrence is over budget, the SDK ban still holds there, and the
// relative spelling is green alone but shares the one-occurrence budget.
// Cases 16a–16d pin the ONE write exemption (⚖ Liam 9/24, A2): the exact
// card-colour line in door.ts is green, a copy of it is over budget, any other
// .upsert( in door.ts is a plain finding, and the same line elsewhere is too.

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanDataAccess } from './check-business-data-access.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const root = mkdtempSync(join(tmpdir(), 'bizdata-'))
// The fixture root needs the REAL territory config — scan roots come from it.
mkdirSync(join(root, 'scripts/business'), { recursive: true })
cpSync(join(repo, 'scripts/business/business-territory.json'), join(root, 'scripts/business/business-territory.json'))

const write = (rel, src) => {
  mkdirSync(join(root, dirname(rel)), { recursive: true })
  writeFileSync(join(root, rel), src)
}
const clear = (rel) => rmSync(join(root, rel), { recursive: true, force: true })

const FORBIDDEN = [
  "import { SynqedClient } from '@synqed-kk/client'",
  "import { createServiceClient } from '@/lib/supabase/server'",
  'const a = new SynqedClient({})',
  'const b = createServiceClient()',
  'const c = createClient()',
].join('\n')

// 1. RED — a screen opens its own door: every form caught.
write('src/business/screens/Home.tsx', FORBIDDEN)
const red = scanDataAccess(root)
assert.equal(red.length, 5, `expected 5 findings, got ${red.length}`)
assert.deepEqual(new Set(red.map((f) => f.rel)), new Set(['src/business/screens/Home.tsx']))
clear('src/business/screens')

// 2. GREEN — the lock files keep their supabase READ: the workspace-grant
//    lock stays real config, not a fixture.
write(
  'src/business/lib/grants.ts',
  "import { createServiceClient } from '@/lib/supabase/server'\nconst db = createServiceClient()\nexport const g = db.from('business_workspace_grants').select('workspace_id')\n",
)
assert.deepEqual(scanDataAccess(root), [])

// 3. RED — the SAME read in a lib file that is NOT a lock file (data.ts runs
//    on fixtures now, Liam's play-phase ruling).
write('src/business/lib/data.ts', "import { createServiceClient } from '@/lib/supabase/server'\nconst db = createServiceClient()\n")
const nonLock = scanDataAccess(root)
assert.equal(nonLock.length, 2, `expected the non-lock lib file flagged, got ${JSON.stringify(nonLock)}`)
assert.deepEqual(new Set(nonLock.map((f) => f.rel)), new Set(['src/business/lib/data.ts']))
clear('src/business/lib/data.ts')

// 4. RED — core reach is ABSOLUTE: banned even in a lock file.
write(
  'src/business/lib/grants.ts',
  "import { getSynqedClient } from '@/lib/synqed/client'\nimport { SynqedClient } from '@synqed-kk/client'\nexport const c = getSynqedClient()\nexport const d = new SynqedClient({})\n",
)
const core = scanDataAccess(root)
assert.equal(core.length, 4, `core reach must be flagged in lock files too, got ${JSON.stringify(core)}`)
assert.deepEqual(
  new Set(core.map((f) => f.label)),
  new Set([
    'core client factory import (lib/synqed/client)',
    'core SDK import (@synqed-kk/client)',
    'getSynqedClient(',
    'new SynqedClient(',
  ]),
)

// 5. RED — writes have ZERO exemption, lock files included.
write('src/business/lib/grants.ts', "const db = createServiceClient()\nawait db.from('x').update({ a: 1 })\n")
const writes = scanDataAccess(root)
assert.equal(writes.length, 1, `expected the write flagged, got ${JSON.stringify(writes)}`)
assert.equal(writes[0].label, 'write call .update(')
clear('src/business/lib')

// 6. Prose naming a forbidden symbol is not a call (comment-strip pin).
write('src/business/screens/Notes.tsx', '// use createClient() only in lib/\n/* new SynqedClient( */\nexport const x = 1')
assert.deepEqual(scanDataAccess(root), [])

// 7. ALLOW entry exempts its EXACT pinned occurrence…
write('src/business/screens/Legacy.tsx', 'const c = createClient() // pinned\n')
const allow = [{ path: 'src/business/screens/Legacy.tsx', label: 'createClient(', match: ['const c = createClient()'], count: 1, reason: 'fixture' }]
assert.deepEqual(scanDataAccess(root, allow), [])

// …and fails CLOSED when the pinned string appears on more lines than budgeted.
write('src/business/screens/Legacy.tsx', 'const c = createClient() // pinned\nconst c = createClient() // copied\n')
const overBudget = scanDataAccess(root, allow)
assert.equal(overBudget.length, 2)
assert.ok(overBudget.every((f) => f.label.startsWith('allowlist over budget')))
clear('src/business/screens')

// 8. Territory is the WHOLE fence, not just src/business/ — a route-group
//    screen is scanned too, and a root that does not exist is a no-op.
write('src/app/[locale]/(business)/page.tsx', "import { createServiceClient } from '@/lib/supabase/server'\n")
assert.equal(scanDataAccess(root).length, 1)
clear('src/app')

// 9. Line-split import + `as` rename: the specifier is matched over the whole
//    file, so neither the newline nor the alias evades it. Relative reach into
//    lib/supabase counts the same as the @/ alias.
write(
  'src/business/screens/Split.tsx',
  "import {\n  createServiceClient as csc,\n} from\n  '../../lib/supabase/server'\nexport const s = csc()\n",
)
const split = scanDataAccess(root)
assert.equal(split.length, 1, `expected the split import flagged, got ${JSON.stringify(split)}`)
assert.match(split[0].label, /supabase/)
clear('src/business/screens')

// 10. allowJs is on: a .js/.mjs screen is source, not invisible.
write('src/business/screens/legacy.js', "const { SynqedClient } = require('@synqed-kk/client')\n")
assert.equal(scanDataAccess(root).length, 1)
clear('src/business/screens')

// 11. A stray "/*" inside a // comment must NOT blind the rest of the file
//    (kills a comment-strip reorder that passes every case above).
write('src/business/screens/Blind.tsx', '// see /* for details\nconst b = createServiceClient()\n')
const blind = scanDataAccess(root)
assert.equal(blind.length, 1, 'violation after a // comment containing /* must still flag')
assert.equal(blind[0].line, 2)
clear('src/business/screens')

// 12. Mirror of case 11: a "/*" inside a STRING must not latch block-comment
//    state either — that direction fails OPEN (Greptile P2).
write('src/business/screens/Quoted.tsx', "const label = '/*'\nconst q = createServiceClient()\n")
const quoted = scanDataAccess(root)
assert.equal(quoted.length, 1, 'violation after a string containing /* must still flag')
assert.equal(quoted[0].line, 2)

// 13. Bed-packing undo-log allowance (Greptile P2): the entry combines TWO
//    match strings under a SHARED budget of 2, and nothing above exercises
//    it — every call here uses the DEFAULT ALLOW (no second arg), the real
//    allowlist the guard ships.
clear('src/business/screens') // case 12's fixture (Quoted.tsx) is still on disk
const bedPackingPath = 'src/app/[locale]/(business)/business/today/today-interactions.ts'

// 13a. Both pinned lines, exactly once each — clean.
write(bedPackingPath, 'log.push(() => moves.delete(key))\nlog.push(() => movedSet.delete(id))\n')
assert.deepEqual(scanDataAccess(root), [], 'both pinned undo-log lines must be exempt under the default ALLOW')

// 13b. A third occurrence (repeats one pinned line) pushes the shared budget
//     to 3 > 2 — fails CLOSED, one finding per matched use (same shape as
//     case 7's over-budget assertion).
write(
  bedPackingPath,
  'log.push(() => moves.delete(key))\nlog.push(() => movedSet.delete(id))\nlog.push(() => moves.delete(key))\n',
)
const bedPackingOverBudget = scanDataAccess(root)
assert.equal(bedPackingOverBudget.length, 3, `expected 3 over-budget findings, got ${JSON.stringify(bedPackingOverBudget)}`)
assert.ok(bedPackingOverBudget.every((f) => f.label === 'allowlist over budget (3 > 2 pinned)'))
clear('src/app')

// 13c. The SAME two lines at a DIFFERENT path: the allowance is path-exact,
//     so both are ordinary findings, not exempt.
write('src/business/lib/other-interactions.ts', 'log.push(() => moves.delete(key))\nlog.push(() => movedSet.delete(id))\n')
const bedPackingWrongPath = scanDataAccess(root)
assert.equal(bedPackingWrongPath.length, 2, `expected both lines flagged at the wrong path, got ${JSON.stringify(bedPackingWrongPath)}`)
assert.ok(bedPackingWrongPath.every((f) => f.label === 'write call .delete('))
clear('src/business/lib')

// 15a. The practice-salon door (⚖ Liam 9/19): the ONE factory import line at
//     the ONE exempt path is green under the DEFAULT allow.
const doorPath = 'src/business/lib/practice-door/core-reach.ts'
const doorImport = "import { newSynqedClient } from '@/lib/synqed/client'\n"
write(doorPath, doorImport + 'export const c = (id) => newSynqedClient(id)\n')
assert.deepEqual(scanDataAccess(root), [])

// 15b. The SAME line at a different path (data.ts) is an ordinary finding.
write('src/business/lib/data.ts', doorImport)
const doorWrongPath = scanDataAccess(root)
assert.equal(doorWrongPath.length, 1, `expected 1 finding at the wrong path, got ${JSON.stringify(doorWrongPath)}`)
assert.equal(doorWrongPath[0].label, 'core client factory import (lib/synqed/client)')
assert.equal(doorWrongPath[0].rel, 'src/business/lib/data.ts')
clear('src/business/lib/data.ts')

// 15c. A second import line in the exempt file: 2 > 1 — fails CLOSED.
write(doorPath, doorImport + "import { newSynqedClient as again } from '@/lib/synqed/client'\n")
const doorOverBudget = scanDataAccess(root)
assert.equal(doorOverBudget.length, 2, `expected 2 over-budget findings, got ${JSON.stringify(doorOverBudget)}`)
assert.ok(doorOverBudget.every((f) => f.label === 'allowlist over budget (2 > 1 pinned)'))

// 15d. The SDK ban stays absolute, the door included.
write(doorPath, "import { SynqedClient } from '@synqed-kk/client'\nexport const d = new SynqedClient({})\n")
const doorSdk = scanDataAccess(root)
assert.deepEqual(
  doorSdk.map((f) => f.label).sort(),
  ['core SDK import (@synqed-kk/client)', 'new SynqedClient('],
  `expected the SDK import + constructor flagged in the door, got ${JSON.stringify(doorSdk)}`,
)

// 15e. GREEN — the relative spelling of the same module, alone, is the one
//     pinned occurrence too (the isolation test pins both spellings).
const doorRelImport = "import { newSynqedClient } from '../../../lib/synqed/client'\n"
write(doorPath, doorRelImport)
assert.deepEqual(scanDataAccess(root), [])

// 15f. RED — alias AND relative line: one shared budget, 2 > 1 — fails CLOSED.
write(doorPath, doorImport + doorRelImport)
const doorBothSpellings = scanDataAccess(root)
assert.equal(doorBothSpellings.length, 2, `expected 2 over-budget findings, got ${JSON.stringify(doorBothSpellings)}`)
assert.ok(doorBothSpellings.every((f) => f.label === 'allowlist over budget (2 > 1 pinned)'))
clear('src/business/lib')

// 16a. The ONE Business writer (⚖ Liam 9/24, A2): the exact card-colour line in
//     door.ts is green under the DEFAULT allow.
const writerPath = 'src/business/lib/practice-door/door.ts'
const writerLine = '  const saved = await writer.orgSettings.upsert({ settings: { reserve_card_color: next } })\n'
write(writerPath, writerLine)
assert.deepEqual(scanDataAccess(root), [])

// 16b. A second copy of the line in door.ts: 2 > 1 — fails CLOSED.
write(writerPath, writerLine + writerLine)
const writerOverBudget = scanDataAccess(root)
assert.equal(writerOverBudget.length, 2, `expected 2 over-budget findings, got ${JSON.stringify(writerOverBudget)}`)
assert.ok(writerOverBudget.every((f) => f.label === 'allowlist over budget (2 > 1 pinned)'))

// 16c. Any OTHER .upsert( in door.ts is an ordinary finding (the match is the exact one-key body).
write(writerPath, writerLine + "  await writer.orgSettings.upsert({ settings: { reserve_card_color: next, other: 1 } })\n")
const writerOther = scanDataAccess(root)
assert.equal(writerOther.length, 1, `expected the second upsert flagged, got ${JSON.stringify(writerOther)}`)
assert.equal(writerOther[0].label, 'write call .upsert(')
assert.equal(writerOther[0].line, 2)
clear(writerPath)

// 16d. The SAME line in any other Business file is an ordinary finding.
write('src/business/lib/data.ts', writerLine)
const writerWrongPath = scanDataAccess(root)
assert.equal(writerWrongPath.length, 1, `expected 1 finding at the wrong path, got ${JSON.stringify(writerWrongPath)}`)
assert.equal(writerWrongPath[0].label, 'write call .upsert(')
assert.equal(writerWrongPath[0].rel, 'src/business/lib/data.ts')
clear('src/business/lib')

// 14. The REAL repo is green (and absent territory roots are not an error).
rmSync(root, { recursive: true, force: true })
assert.deepEqual(scanDataAccess(repo), [])

console.log('✓ business data-access guard selftest: 24 cases green')
