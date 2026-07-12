#!/usr/bin/env node
// Bundle budget gate (packet-02, first-paint proof). The parse/compile cost is
// the risk the probe A/B exists to test; this stops the JS payload from silently
// regressing between builds. Run AFTER `vite build`:
//   node scripts/thin/check-bundle-budget.mjs
//
// Budget is on RAW JS bytes (parse cost tracks uncompressed size). Current build
// ≈ 901 KB (vendor 688 + app 213); ceiling leaves ~20% headroom. Tighten as
// per-route lazy chunks land during screen conversion.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const DIST = 'thin/dist/assets'
const BUDGET_BYTES = 1_100_000

let dir
try {
  dir = readdirSync(DIST)
} catch {
  console.error(`✗ no build output at ${DIST} — run \`vite build --config thin/vite.config.ts\` first`)
  process.exit(1)
}

const jsFiles = dir.filter((f) => f.endsWith('.js'))
let raw = 0
let gz = 0
for (const f of jsFiles) {
  const buf = readFileSync(join(DIST, f))
  raw += statSync(join(DIST, f)).size
  gz += gzipSync(buf).length
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
console.log(`thin JS: ${kb(raw)} raw / ${kb(gz)} gzip across ${jsFiles.length} chunk(s)`)
if (raw > BUDGET_BYTES) {
  console.error(`✗ over budget: ${kb(raw)} > ${kb(BUDGET_BYTES)} — code-split or trim before merge`)
  process.exit(1)
}
console.log(`✓ within budget (${kb(BUDGET_BYTES)})`)
