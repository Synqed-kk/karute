#!/usr/bin/env node
// In-tier regression pins for the Business data-access guard (same pattern as
// check-business-isolation.selftest.mjs). Territory holds real files now, but
// they exercise only some of the rules — these fixtures are the red→green
// proof that every rule catches what it claims. Cases 2–5 pin Liam's
// play-phase ruling (core reach and writes banned everywhere, supabase reads
// only in the two lock files); cases 9–12 pin the bypasses the blind review
// round and Greptile found in the first cuts.

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

// The sole reconnect is constrained by exact route, call and occurrence budget.
clear('src/business/screens')
const colorRoute = 'src/app/api/business/reserve-card-color/route.ts'
const authorized = "import { getSynqedClient } from '@/lib/synqed/client'\nconst client = await getSynqedClient()\nawait auth.client.orgSettings.upsert({ settings: { reserve_card_color: color } })"
write(colorRoute, authorized)
assert.deepEqual(scanDataAccess(root), [])
write(colorRoute, authorized + '\nawait auth.client.orgSettings.upsert({ settings: { other: true } })')
assert.ok(scanDataAccess(root).length > 0)
write(colorRoute, authorized + '\nconst client = await getSynqedClient()')
assert.ok(scanDataAccess(root).length > 0)
clear(colorRoute)
write('src/app/api/business/other/route.ts', authorized)
assert.equal(scanDataAccess(root).length, 3)

// 13. The REAL repo is green (and absent territory roots are not an error).
rmSync(root, { recursive: true, force: true })
assert.deepEqual(scanDataAccess(repo), [])

console.log('✓ business data-access guard selftest: 13 cases green')
