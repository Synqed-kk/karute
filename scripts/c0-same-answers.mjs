#!/usr/bin/env node
/**
 * C0 same-answers CLI — `before` | `after` | `diff` (build order #1 § 3, § 5 SAME).
 *
 *   node scripts/c0-same-answers.mjs before [--days-ahead N] [--out tmp/c0-same-answers-before.json]
 *   node scripts/c0-same-answers.mjs after  [--before tmp/c0-same-answers-before.json] [--out tmp/c0-same-answers-after.json]
 *   node scripts/c0-same-answers.mjs diff   [--before <file>] [--after <file>]
 *
 * READ-ONLY against the Dev Salon. `before` / `after` are run by Liam only (his key).
 * This file does argv, env, file IO and exit codes; all logic is in lib/c0-same-answers-core.cjs.
 * Exit: 0 PASS · 1 FAIL · 2 VOID · 3 usage/config.
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const core = require('./lib/c0-same-answers-core.cjs')

const DEFAULT_BEFORE = 'tmp/c0-same-answers-before.json'
const DEFAULT_AFTER = 'tmp/c0-same-answers-after.json'

function usage(msg) {
  process.stderr.write(`${msg}\nUsage: node scripts/c0-same-answers.mjs <before|after|diff> [--days-ahead N] [--before <file>] [--after <file>] [--out <file>]\n` +
    `  --days-ahead N (before only): D1 = the JST today + N, default ${core.DEFAULT_DAYS_AHEAD}, from 1 to ${core.MAX_DAYS_AHEAD}; set N to the announced apply → deploy gap + 2.\n` +
    `  ${core.MAX_DAYS_AHEAD} is a conservative ceiling derived from Reserve's default grid (14 days when the store sets no 予約受付期間), measured from the requested day.\n` +
    '  A store\'s own 予約受付期間 (booking_open_days) can make the real limit lower (N <= booking_open_days - 2): the operator checks it.\n' +
    '  The after run reads the dates from the before file. --out: keep run files under tmp/ (gitignored) — they hold the Dev Salon\'s rows, customers included.\n')
  process.exit(core.EXIT.USAGE)
}

function flags(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) usage(`Unknown argument: ${a}`)
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) usage(`Missing value for ${a}`)
    out[a.slice(2)] = v
    i++
  }
  return out
}

function readRun(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    usage(`Cannot read the run file ${path}.`)
  }
}

function writeRun(path, run) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`)
}

// The env names src/lib already uses (src/lib/customers/queries.ts:50-51); the auth and
// business headers are the ones @synqed-kk/client sends (dist/client.js:98-101: 'x-api-key', 'x-business-id').
function coreConfig() {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) {
    process.stderr.write('SYNQED_CORE_URL and SYNQED_CORE_API_KEY must both be set to read core.\n')
    process.exit(core.EXIT.USAGE)
  }
  return {
    baseUrl,
    headers: { 'x-api-key': apiKey, 'x-business-id': core.BUSINESS_ID, 'Content-Type': 'application/json' },
  }
}

function report(run) {
  const host = run.core_host || '(unknown host)'
  process.stdout.write(`Read ${host} for the Dev Salon on ${run.dates.join(', ')} (today ${run.today} JST).\n`)
  if (run.thin) process.stdout.write('Thin: the store list (Q1) returned no bookings on D1..D2 — the check still runs, but proves less.\n')
  if (run.pins.unmet.length) process.stdout.write(`Pins could not cover: ${run.pins.unmet.join('; ')}.\n`)
  const voids = core.runVoidReasons(run)
  if (voids.length) {
    process.stdout.write(`VOID (not run): ${voids.join('; ')}.\n`)
    return core.EXIT.VOID
  }
  return core.EXIT.PASS
}

async function collectOrUsage(cfg) {
  try {
    return await core.collect(fetch, cfg)
  } catch (err) {
    if (err && err.code === 'USAGE') usage(err.message)
    throw err
  }
}

const [mode, ...rest] = process.argv.slice(2)
const f = flags(rest)

if (mode === 'before') {
  const daysAhead = f['days-ahead'] === undefined ? core.DEFAULT_DAYS_AHEAD : Number(f['days-ahead'])
  if (!core.daysAheadOk(daysAhead)) usage(`--days-ahead must be a whole number from 1 to ${core.MAX_DAYS_AHEAD}.`)
  const cfg = coreConfig()
  const run = await collectOrUsage({ ...cfg, run: 'before', daysAhead, now: Date.now() })
  const out = f.out || DEFAULT_BEFORE
  writeRun(out, run)
  const code = report(run)
  process.stdout.write(`Wrote ${out}.\n`)
  process.exit(code)
} else if (mode === 'after') {
  const beforePath = f.before || DEFAULT_BEFORE
  const before = readRun(beforePath)
  const today = core.jstToday(Date.now())
  const g = core.guardDates(before, today)
  if (!g.ok) {
    process.stdout.write(`VOID: ${g.reason} — run a new "before" first.\n`)
    process.exit(core.EXIT.VOID)
  }
  const cfg = coreConfig()
  const run = await collectOrUsage({ ...cfg, run: 'after', before, now: Date.now() })
  const out = f.out || DEFAULT_AFTER
  writeRun(out, run)
  const code = report(run)
  process.stdout.write(`Wrote ${out}. Next: node scripts/c0-same-answers.mjs diff\n`)
  process.exit(code)
} else if (mode === 'diff') {
  const before = readRun(f.before || DEFAULT_BEFORE)
  const after = readRun(f.after || DEFAULT_AFTER)
  const bad = core.checkInputs(before, after)
  if (bad) usage(bad)
  // The date guard is judged at the moment the after run read core (after.today), so a
  // diff of two saved files gives the same verdict on any later day.
  const result = core.diff(before, after, { today: after.today })
  process.stdout.write(`${core.summarize(result, before, after)}\n`)
  process.exit(core.EXIT[result.verdict])
} else {
  usage(mode ? `Unknown mode: ${mode}` : 'No mode given.')
}
