#!/usr/bin/env node
// Runnable check (no framework): build-number increments. `node build-number.test.mjs`.
import assert from 'node:assert/strict'
import { nextBuildNumber, parseLastBuildNumber } from './build-number.mjs'

// 1. Fresh 1.1 train starts at 1 (Liam ruling 7/25: 1.1 (1), clear numbers).
assert.equal(nextBuildNumber(0), 1, 'fresh train starts at 1')

// 2. Plain increment — the whole contract.
assert.equal(nextBuildNumber(1), 2, 'next after 1 is 2')

// 3. Strictly monotonic across a burst of sequential builds.
let last = 1
for (let i = 0; i < 5; i++) {
  const next = nextBuildNumber(last)
  assert.ok(next > last, `burst build ${i} must strictly increase (${next} > ${last})`)
  last = next
}
assert.equal(last, 6, 'five builds after 1 land on 6')

// 4. Missing state file fails LOUDLY (Greptile #610 P1) — never mint blind.
assert.throws(() => parseLastBuildNumber(null), /missing/, 'absent state must throw')

// 5. Garbage state fails loudly too — no silent coercion to a wrong number.
assert.throws(() => parseLastBuildNumber('garbage'), /unreadable/, 'garbage must throw')
assert.throws(() => parseLastBuildNumber('-3'), /unreadable/, 'negative must throw')

// 6. Valid state parses.
assert.equal(parseLastBuildNumber('12\n'), 12, 'trims and parses')
assert.equal(parseLastBuildNumber('0'), 0, 'zero seed is valid (fresh 1.1 train)')

console.log('✓ build-number increments: all assertions passed')
