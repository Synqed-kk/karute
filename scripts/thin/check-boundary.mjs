#!/usr/bin/env node
// Shared-UI boundary drift gate (packet-02 build #1/#2). Fails if any shared
// component/lib calls a raw `/api/*` fetch instead of routing through the
// DataPort — the one thing a bundler alias CANNOT redirect (it's a string, not
// an import), so it must be caught at source. The complementary drift check —
// a shared component adopting a Next-only API — is caught by the thin typecheck
// + build step in the workflow (an unaliased Next import fails to resolve).
//
// No deps; run from the repo root: `node scripts/thin/check-boundary.mjs`.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src/components', 'src/lib']
const SKIP = ['src/lib/ports', '__tests__']
// Raw fetch to an app-relative /api path (single, double, or template quote).
const RAW_API = /(?<![\w.])fetch\s*\(\s*[`'"]\/api/

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (SKIP.some((s) => p.includes(s))) continue
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
}

const files = []
for (const r of ROOTS) walk(r, files)

const violations = []
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (RAW_API.test(line)) violations.push(`${f}:${i + 1}: ${line.trim()}`)
  })
}

if (violations.length > 0) {
  console.error('✗ boundary drift: raw /api fetch in the shared subtree — route it through DataPort.apiFetch:')
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log(`✓ boundary clean: 0 raw /api fetches across ${files.length} shared files`)
