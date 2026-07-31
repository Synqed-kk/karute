#!/usr/bin/env node
// Business PR diff gate (phone-safety lock 3, clause 1): a PR that touches
// Business territory may touch NOTHING outside it — deny-by-default, so the
// phone-owned surface never needs enumerating (thin/, facade routes, shared
// screen components at every width, messages/, package.json … are all simply
// "outside"). A legitimate shared-file move ships as its OWN non-Business PR
// with the sim battery + byte-diff proof (savepoint four-locks section);
// this gate exists to make that split mandatory, not optional.
//
// stdin = changed file paths, one per line (CI feeds the PR files API,
// including previous_filename on renames so a file can't be smuggled INTO
// territory). Local run:
//   git diff --name-only origin/main...HEAD | node scripts/business/check-business-isolation.mjs
// No dependencies; territory lives in business-territory.json (one source of
// truth, shared with the jest import-isolation suite).

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

/** Pure core. changed = repo-relative paths. Returns null when the diff
 *  touches no Business path (not a Business PR — gate does not apply). */
export function checkIsolation(changed, territory) {
  const inTerritory = (f) => territory.some((p) => f.startsWith(p))
  if (!changed.some(inTerritory)) return null
  return changed.filter((f) => !inTerritory(f))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
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
  const offenders = checkIsolation(changed, loadTerritory(root))
  if (offenders === null) {
    console.log(`✓ not a Business PR (${changed.length} changed files, none in Business territory)`)
  } else if (offenders.length === 0) {
    console.log('✓ Business PR stays inside Business territory')
  } else {
    console.error('✗ Business PR touches files OUTSIDE Business territory — split them into their own PR:')
    for (const f of offenders) console.error('  ' + f)
    process.exit(1)
  }
}
