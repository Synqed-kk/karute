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
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const core = require('./lib/c0-same-answers-core.cjs')

const DEFAULT_BEFORE = 'tmp/c0-same-answers-before.json'
const DEFAULT_AFTER = 'tmp/c0-same-answers-after.json'
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// R3-6: a run file holds the Dev Salon's rows, customers included, and only this
// pattern is gitignored (.gitignore: tmp/c0-same-answers-*.json, root-anchored).
const RUN_FILE = /^tmp\/c0-same-answers-[^/]*\.json$/
const RUN_FILE_REFUSAL = 'run files must stay under tmp/c0-same-answers-*.json — they hold customer rows and only that pattern is gitignored'
// R3-5: the only flags any mode reads.
const FLAGS = new Set(['days-ahead', 'before', 'after', 'out'])
// R3-8: the flags each mode reads; a flag of another mode is refused, not silently ignored.
const MODE_FLAGS = {
  before: new Set(['days-ahead', 'out']),
  after: new Set(['before', 'out']),
  diff: new Set(['before', 'after']),
}

function usage(msg) {
  process.stderr.write(`${msg}\nUsage: node scripts/c0-same-answers.mjs <before|after|diff> [--days-ahead N] [--before <file>] [--after <file>] [--out <file>]\n` +
    `  --days-ahead N (before only): D1 = the JST today + N, default ${core.DEFAULT_DAYS_AHEAD}, from 1 to ${core.MAX_DAYS_AHEAD}; set N to the announced apply → deploy gap + 2.\n` +
    `  ${core.MAX_DAYS_AHEAD} is a conservative ceiling derived from Reserve's default grid (14 days when the store sets no 予約受付期間), measured from the requested day.\n` +
    '  A store\'s own 予約受付期間 (booking_open_days) can make the real limit lower (N <= booking_open_days - 2): the operator checks it.\n' +
    '  The after run reads the dates from the before file.\n' +
    '  --out / --before / --after: a run file path must match tmp/c0-same-answers-*.json under the repo root (the only gitignored run-file pattern) —\n' +
    '  run files hold the Dev Salon\'s rows, customers included; any other path is refused.\n' +
    '  Flags: only --days-ahead, --before, --after, --out; any other --name is refused.\n' +
    '  Per mode: before takes --days-ahead, --out; after takes --before, --out; diff takes --before, --after; a flag of another mode is refused.\n')
  process.exit(core.EXIT.USAGE)
}

function flags(mode, argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) usage(`Unknown argument: ${a}`)
    if (!FLAGS.has(a.slice(2))) usage(`Unknown flag: ${a}`)
    if (!MODE_FLAGS[mode].has(a.slice(2))) usage(`${a} is not a flag of the ${mode} mode`)
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) usage(`Missing value for ${a}`)
    out[a.slice(2)] = v
    i++
  }
  return out
}

/** R3-6: the path (resolved against the working directory) as it sits under the repo root, or usage exit 3. */
function runFile(path) {
  const rel = relative(REPO_ROOT, resolve(path)).split(sep).join('/')
  if (!RUN_FILE.test(rel)) usage(`${RUN_FILE_REFUSAL} (got ${path}).`)
  return path
}

function readRun(path) {
  runFile(path)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    usage(`Cannot read the run file ${path}.`)
  }
}

function writeRun(path, run) {
  runFile(path)
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
if (!Object.hasOwn(MODE_FLAGS, mode ?? '')) usage(mode ? `Unknown mode: ${mode}` : 'No mode given.')
const f = flags(mode, rest) // every flag judged before core, env or any file is read

if (mode === 'before') {
  const daysAhead = f['days-ahead'] === undefined ? core.DEFAULT_DAYS_AHEAD : Number(f['days-ahead'])
  if (!core.daysAheadOk(daysAhead)) usage(`--days-ahead must be a whole number from 1 to ${core.MAX_DAYS_AHEAD}.`)
  runFile(f.out || DEFAULT_BEFORE) // refused before core is read, never after
  const cfg = coreConfig()
  const run = await collectOrUsage({ ...cfg, run: 'before', daysAhead, now: Date.now() })
  const out = f.out || DEFAULT_BEFORE
  writeRun(out, run)
  const code = report(run)
  process.stdout.write(`Wrote ${out}.\n`)
  process.exit(code)
} else if (mode === 'after') {
  const beforePath = f.before || DEFAULT_BEFORE
  runFile(f.out || DEFAULT_AFTER) // refused before core is read, never after
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
  runFile(f.before || DEFAULT_BEFORE) // both paths judged before either file is read
  runFile(f.after || DEFAULT_AFTER)
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
