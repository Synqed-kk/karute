#!/usr/bin/env node
// In-tier regression pins for the Business data-access guard (same pattern as
// check-business-isolation.selftest.mjs). Business territory is EMPTY today,
// so the live guard run proves nothing on its own — these fixtures are the
// red→green proof that the rule catches what it claims. Cases 6–8 pin the
// three bypasses a blind review round found in the first cut.

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

// 1. RED — a screen outside the wrapper opens its own door: every form caught.
write('src/business/screens/Home.tsx', FORBIDDEN)
const red = scanDataAccess(root)
assert.equal(red.length, 5, `expected 5 findings, got ${red.length}`)
assert.deepEqual(new Set(red.map((f) => f.rel)), new Set(['src/business/screens/Home.tsx']))

// 2. GREEN — the identical code inside src/business/lib/ is THE data door.
clear('src/business/screens')
write('src/business/lib/data.ts', FORBIDDEN)
assert.deepEqual(scanDataAccess(root), [])

// 3. Prose naming a forbidden symbol is not a call (comment-strip pin).
write('src/business/screens/Notes.tsx', '// use createClient() only in lib/\n/* new SynqedClient( */\nexport const x = 1')
assert.deepEqual(scanDataAccess(root), [])

// 4. ALLOW entry exempts its EXACT pinned occurrence…
write('src/business/screens/Legacy.tsx', 'const c = createClient() // pinned\n')
const allow = [{ path: 'src/business/screens/Legacy.tsx', label: 'createClient(', match: ['const c = createClient()'], count: 1, reason: 'fixture' }]
assert.deepEqual(scanDataAccess(root, allow), [])

// …and fails CLOSED when the pinned string appears on more lines than budgeted.
write('src/business/screens/Legacy.tsx', 'const c = createClient() // pinned\nconst c = createClient() // copied\n')
const overBudget = scanDataAccess(root, allow)
assert.equal(overBudget.length, 2)
assert.ok(overBudget.every((f) => f.label.startsWith('allowlist over budget')))
clear('src/business/screens')

// 5. Territory is the WHOLE fence, not just src/business/ — a route-group
//    screen is scanned too, and a root that does not exist is a no-op.
write('src/app/[locale]/(business)/page.tsx', "import { createServiceClient } from '@/lib/supabase/server'\n")
assert.equal(scanDataAccess(root).length, 1)
clear('src/app')

// 6. Line-split import + `as` rename: the specifier is matched over the whole
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

// 7. allowJs is on: a .js/.mjs screen is source, not invisible.
write('src/business/screens/legacy.js', "const { SynqedClient } = require('@synqed-kk/client')\n")
assert.equal(scanDataAccess(root).length, 1)
clear('src/business/screens')

// 8. A stray "/*" inside a // comment must NOT blind the rest of the file
//    (kills a comment-strip reorder that passes every case above).
write('src/business/screens/Blind.tsx', '// see /* for details\nconst b = createServiceClient()\n')
const blind = scanDataAccess(root)
assert.equal(blind.length, 1, 'violation after a // comment containing /* must still flag')
assert.equal(blind[0].line, 2)

// 9. The REAL repo is green (and absent territory roots are not an error).
rmSync(root, { recursive: true, force: true })
assert.deepEqual(scanDataAccess(repo), [])

console.log('✓ business data-access guard selftest: 9 cases green')
