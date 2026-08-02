#!/usr/bin/env node
// In-tier regression pins for the Business diff gate (same pattern as
// scripts/audit/parse-audit-source.selftest.mjs): runs in CI before the real
// check, no dependencies. Each case is a boundary a mutant actually crossed
// during the red-run proofs (prefix-vs-substring, trailing-slash config,
// rename smuggling) — not decoration.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkIsolation, loadTerritory } from './check-business-isolation.mjs'

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

console.log('✓ business isolation gate selftest: 7 cases green')
