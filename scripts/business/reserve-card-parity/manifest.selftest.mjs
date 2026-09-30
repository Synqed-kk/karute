#!/usr/bin/env node
// Selftest for the parity harness's manifest loader (run.mjs loadManifest) — fixture red, in seconds.
//   node scripts/business/reserve-card-parity/manifest.selftest.mjs
// Each case writes a throwaway repo holding ONLY src/business/lib/reserve-card/parity.manifest.json, spawns
// `node run.mjs` with PARITY_REPO=<that dir>, and asserts exit 1 AND the named message. The loader throws at
// import time, before anything is exported, installed or emitted, so no case reaches Reserve, git or the network
// (RESERVE_REPO points at a path that does not exist, and PARITY_DIR at the case's own temp dir).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUN = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs')
const REL = 'src/business/lib/reserve-card/parity.manifest.json'

const good = () => ({
  reservePin: 'c2a9f9543187bff689307e22a6fcfa29f02a5215',
  expect: { verbatim: 23, scoped: 2 },
  reserveRanges: { 'satin-material.ts': 'a', 'member-card-vars.ts': 'b', 'ReserveCardPreview.tsx': 'c' },
  leftOut: { excludedFrom: 'index.css 1–2', excluded: [['1', 'why']], notPorted: [['2', 'why']] },
})

const CASES = [
  ['missing expect', (m) => { delete m.expect; return JSON.stringify(m) }, /parity\.manifest\.json: expect must be an object/],
  ['reservePin not 40-hex', (m) => { m.reservePin = 'c2a9f95'; return JSON.stringify(m) }, /parity\.manifest\.json: reservePin must be a full 40-hex sha/],
  ['reserveRanges missing a key', (m) => { delete m.reserveRanges['member-card-vars.ts']; return JSON.stringify(m) }, /parity\.manifest\.json: reserveRanges must have exactly the keys/],
  ['leftOut.excluded entry not a pair', (m) => { m.leftOut.excluded.push(['only one']); return JSON.stringify(m) }, /parity\.manifest\.json: leftOut\.excluded\[1\] must be a \[string, string\] pair/],
  ['non-JSON file', () => '{ not json', /parity\.manifest\.json: cannot be read as JSON \(.*parity\.manifest\.json\)/],
]

let failed = 0
// the control: a well-formed manifest must get PAST the loader (it then fails later, on the missing port module)
const all = [['well-formed manifest passes the loader', (m) => JSON.stringify(m), null], ...CASES]
for (const [name, make, want] of all) {
  const dir = mkdtempSync(join(tmpdir(), 'parity-manifest-selftest-'))
  try {
    mkdirSync(join(dir, dirname(REL)), { recursive: true })
    writeFileSync(join(dir, REL), make(good()))
    const r = spawnSync(process.execPath, [RUN], {
      env: { ...process.env, PARITY_REPO: dir, PARITY_DIR: join(dir, 'work'), RESERVE_REPO: join(dir, 'no-reserve') },
      encoding: 'utf8',
      timeout: 30_000,
    })
    const out = `${r.stdout}\n${r.stderr}`
    const ok = want
      ? r.status === 1 && want.test(out)
      : r.status === 1 && !/parity\.manifest\.json:/.test(out) && /no port module/.test(out)
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — exit ${r.status}; output: ${out.trim().split('\n').slice(0, 3).join(' | ')}`}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
if (failed) {
  console.error(`✗ parity manifest selftest: ${failed} of ${all.length} cases red`)
  process.exit(1)
}
console.log(`✓ parity manifest selftest: ${all.length} cases green`)
