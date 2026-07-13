#!/usr/bin/env node
// Runnable check (no framework): build-number monotonicity. `node build-number.test.mjs`.
import assert from 'node:assert/strict'
import { nextBuildNumber } from './build-number.mjs'

// 1. Strictly greater than the last value.
assert.ok(nextBuildNumber(100) > 100, 'must exceed last')

// 2. Tracks wall clock when clock is ahead of last.
const now = 1_800_000_000_000 // fixed epoch ms
assert.equal(nextBuildNumber(0, now), Math.floor(now / 1000), 'uses unix seconds')

// 3. Strictly monotonic even for many builds within the SAME second (last+1 floor).
let last = Math.floor(now / 1000)
for (let i = 0; i < 5; i++) {
  const next = nextBuildNumber(last, now) // same `now` → same-second burst
  assert.ok(next > last, `burst build ${i} must strictly increase (${next} > ${last})`)
  last = next
}

// 4. Never goes backwards when last is far in the future (clock skew safety).
const future = Math.floor(now / 1000) + 10_000
assert.ok(nextBuildNumber(future, now) > future, 'monotonic under clock skew')

console.log('✓ build-number monotonicity: all assertions passed')
