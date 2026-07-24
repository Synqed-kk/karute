#!/usr/bin/env node
// Runnable check (no framework): build-number increments. `node build-number.test.mjs`.
import assert from 'node:assert/strict'
import { nextBuildNumber } from './build-number.mjs'

// 1. Plain increment — the whole contract (Liam ruling 7/25: clear numbers).
assert.equal(nextBuildNumber(12), 13, 'next after 12 is 13')

// 2. Strictly monotonic across a burst of sequential builds.
let last = 12
for (let i = 0; i < 5; i++) {
  const next = nextBuildNumber(last)
  assert.ok(next > last, `burst build ${i} must strictly increase (${next} > ${last})`)
  last = next
}
assert.equal(last, 17, 'five builds after 12 land on 17')

// 3. Lost/garbage state restarts at 1 (Apple rejects a regression loudly).
assert.equal(nextBuildNumber(0), 1, 'seedless fallback is 1')
assert.equal(nextBuildNumber('garbage'), 1, 'garbage state falls back to 1')

console.log('✓ build-number increments: all assertions passed')
