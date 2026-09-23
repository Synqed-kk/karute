#!/usr/bin/env node
// Runnable check (no framework): the seeder refuses any non-local core BEFORE
// any network call. `node scripts/lib/core-target-guard.test.mjs` (Node >= 22.18
// imports the .ts directly; on older Node run it with `npx tsx` instead).
// Never touches a real core: every URL below is .invalid (RFC 2606, cannot
// resolve) and the child env is built from scratch — no inherited keys.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { LOCAL_CORE_HOSTS, assertLocalCoreTarget } from './core-target-guard.ts'

const REFUSED = { message: /^SEEDER REFUSED:/ }

// (a) unit — allowlisted hosts pass, everything else throws.
for (const host of LOCAL_CORE_HOSTS) assertLocalCoreTarget(`http://${host}:3100`)
for (const url of [
  'https://abc.supabase.co',
  'https://shared-example.invalid',
  '',
  undefined,
  'garbage',
  'http://localhost.evil.com',
  'http://localhost@evil.com',
]) {
  assert.throws(() => assertLocalCoreTarget(url), REFUSED, `must refuse ${url}`)
}

// (b)+(c) integration — run the real entry points against a fake shared core.
const repo = fileURLToPath(new URL('../..', import.meta.url))
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  SYNQED_CORE_URL: 'https://shared-example.invalid',
  SYNQED_CORE_API_KEY: 'test-key',
  // Fake too, so a MISSING guard reaches the network (fetch failed) instead
  // of stopping at the env check — that is what turns a mutant red.
  NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
}
const run = (args) => spawnSync('npx', ['tsx', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 })
const NO_NETWORK = /ENOTFOUND|fetch failed/

const seeder = run(['scripts/seed-booking-data.ts'])
assert.equal(seeder.status, 2, `seeder exit code\n${seeder.stdout}\n${seeder.stderr}`)
assert.match(seeder.stderr, /SEEDER REFUSED:/)
assert.doesNotMatch(seeder.stderr, NO_NETWORK, 'seeder reached the network before refusing')

const setup = run(['--eval', "import('./e2e/global-setup.ts').then((m) => (m.default.default ?? m.default)({}))"])
const setupOut = setup.stdout + setup.stderr
assert.notEqual(setup.status, 0, `global-setup must fail\n${setupOut}`)
assert.match(setup.stderr, /SEEDER REFUSED:/)
assert.doesNotMatch(setupOut, /\[global-setup\] running/, 'global-setup started a seed script before refusing')
assert.doesNotMatch(setupOut, NO_NETWORK, 'global-setup reached the network before refusing')

console.log('core-target-guard: all checks passed')
