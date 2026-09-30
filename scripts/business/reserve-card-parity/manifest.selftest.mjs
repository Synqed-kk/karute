#!/usr/bin/env node
// Selftest for the parity harness's manifest loader (run.mjs loadManifest) — fixture red, in seconds.
//   node scripts/business/reserve-card-parity/manifest.selftest.mjs
// Each case writes a throwaway repo holding ONLY src/business/lib/reserve-card/parity.manifest.json, spawns
// `node run.mjs` with PARITY_REPO=<that dir>, and asserts exit 1 AND the named message. The loader throws at
// import time, before anything is exported, installed or emitted, so no case reaches Reserve, git or the network
// (RESERVE_REPO points at a path that does not exist, and PARITY_DIR at the case's own temp dir).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
// per-run scratch: a well-formed manifest creates the run's own dir under PARITY_DIR before dying on the missing
// module — with PARITY_KEEP=1 each spawn prints a DIFFERENT path under the parent; without it nothing is left behind
{
  const name = 'per-run scratch dir: unique under PARITY_DIR, kept only with PARITY_KEEP=1'
  const dir = mkdtempSync(join(tmpdir(), 'parity-manifest-selftest-'))
  try {
    mkdirSync(join(dir, dirname(REL)), { recursive: true })
    writeFileSync(join(dir, REL), JSON.stringify(good()))
    const parent = realpathSync(dir), work = join(parent, 'work')
    const spawnRun = (extra) => spawnSync(process.execPath, [RUN], { env: { ...process.env, PARITY_REPO: dir, PARITY_DIR: work, RESERVE_REPO: join(dir, 'no-reserve'), PARITY_KEEP: '', ...extra }, encoding: 'utf8', timeout: 30_000 })
    const kept = [spawnRun({ PARITY_KEEP: '1' }), spawnRun({ PARITY_KEEP: '1' })].map((r) => r.stdout.match(/^scratch kept: (.+)$/m)?.[1] ?? null)
    const keptOk = kept.every((p) => p && p.startsWith(join(work, 'reserve-card-parity-')) && existsSync(p)) && kept[0] !== kept[1]
    for (const p of kept) if (p) rmSync(p, { recursive: true, force: true })
    const r = spawnRun({})
    const ok = keptOk && r.status === 1 && !/scratch kept:/.test(r.stdout) && readdirSync(work).length === 0
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — kept ${JSON.stringify(kept)}; left ${JSON.stringify(readdirSync(work))}`}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  all.push([name])
}
if (failed) {
  console.error(`✗ parity manifest selftest: ${failed} of ${all.length} cases red`)
  process.exit(1)
}
console.log(`✓ parity manifest selftest: ${all.length} cases green`)
