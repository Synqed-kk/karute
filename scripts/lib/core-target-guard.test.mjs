#!/usr/bin/env node
// Runnable check (no framework): the seeder refuses any non-local core BEFORE
// any network call. `node scripts/lib/core-target-guard.test.mjs` — CI runs it
// on Node 20, which cannot load .ts itself, so TypeScript goes through the
// repo's own pinned ts-node (devDependency; tsx is not in the lockfile).
// Never touches a real core: every URL below is .invalid (RFC 2606, cannot
// resolve) and the child env is built from scratch — no inherited keys.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const TS = { transpileOnly: true, skipProject: true, compilerOptions: { module: 'commonjs', esModuleInterop: true, target: 'es2020' } }
const require = createRequire(import.meta.url)
require('ts-node').register(TS)
const { LOCAL_CORE_HOSTS, assertLocalCoreTarget } = require('./core-target-guard.ts')

const REFUSED = { message: /^SEEDER REFUSED:/ }

// (a) unit — allowlisted hosts pass, everything else throws. Exact match only:
// the last four go green under an endsWith/startsWith loosening.
for (const host of LOCAL_CORE_HOSTS) assertLocalCoreTarget(`http://${host}:3100`)
for (const url of [
  'https://abc.supabase.co',
  'https://shared-example.invalid',
  '',
  undefined,
  'garbage',
  'http://localhost.evil.com',
  'http://localhost@evil.com',
  'https://evil-localhost',
  'https://notlocalhost',
  'https://127.0.0.1.attacker.example',
  'https://xlocalhost:3100',
]) {
  assert.throws(() => assertLocalCoreTarget(url), REFUSED, `must refuse ${url}`)
}

// (b)+(c) integration — run the real entry points against a fake shared core.
const repo = fileURLToPath(new URL('../..', import.meta.url))
const core = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  SYNQED_CORE_URL: 'https://shared-example.invalid',
  SYNQED_CORE_API_KEY: 'test-key',
}
// Fake Supabase too, so a MISSING guard reaches the network (fetch failed)
// instead of stopping at the env check — that is what turns a mutant red.
const env = { ...core, NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key' }
const run = (code, childEnv) =>
  spawnSync(process.execPath, ['-e', `require('ts-node').register(${JSON.stringify(TS)}); ${code}`], {
    cwd: repo,
    env: childEnv,
    encoding: 'utf8',
    timeout: 120_000,
  })
const NO_NETWORK = /ENOTFOUND|fetch failed/
const SEEDER = "require('./scripts/seed-booking-data.ts')"

const seeder = run(SEEDER, env)
assert.equal(seeder.status, 2, `seeder exit code\n${seeder.stdout}\n${seeder.stderr}`)
assert.match(seeder.stderr, /SEEDER REFUSED:/)
assert.doesNotMatch(seeder.stderr, NO_NETWORK, 'seeder reached the network before refusing')

// Ordering: Supabase vars unset. The guard must fire before the env check.
const bare = run(SEEDER, core)
assert.equal(bare.status, 2, `guard must run before the env check\n${bare.stdout}\n${bare.stderr}`)
assert.match(bare.stderr, /SEEDER REFUSED:/)
assert.doesNotMatch(bare.stderr, /Missing env vars/)

const setup = run("require('./e2e/global-setup.ts').default({})", env)
const setupOut = setup.stdout + setup.stderr
assert.notEqual(setup.status, 0, `global-setup must fail\n${setupOut}`)
assert.match(setup.stderr, /SEEDER REFUSED:/)
assert.doesNotMatch(setupOut, /\[global-setup\] running/, 'global-setup started a seed script before refusing')
assert.doesNotMatch(setupOut, NO_NETWORK, 'global-setup reached the network before refusing')

console.log('core-target-guard: all checks passed')
