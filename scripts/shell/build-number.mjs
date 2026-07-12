#!/usr/bin/env node
// Monotonic, unique native build number for CFBundleVersion (R3 #18). Today the
// value is hard-coded `2` — the App Store REJECTS a build whose CFBundleVersion
// isn't strictly greater than the last uploaded one, so a fixed number can ship
// at most once. This derives a value that is BOTH monotonic and unique.
//
// Strategy: max(last + 1, unix-seconds-now). Seconds-since-epoch is naturally
// increasing and unique across normal build cadence; the `last + 1` floor
// guarantees strict monotonicity even for two builds in the same second (CI
// bursts, retries). Pure fn is unit-tested; the CLI persists the last value.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const STATE = join(dirname(fileURLToPath(import.meta.url)), '.last-build-number')

/** Pure: strictly greater than `last`, and ≥ the current unix second. */
export function nextBuildNumber(last, now = Date.now()) {
  const seconds = Math.floor(now / 1000)
  return Math.max((Number(last) || 0) + 1, seconds)
}

function readLast() {
  try {
    return Number(readFileSync(STATE, 'utf8').trim()) || 0
  } catch {
    return 0
  }
}

// CLI: `node build-number.mjs` prints + persists the next number.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = nextBuildNumber(readLast())
  writeFileSync(STATE, String(next))
  process.stdout.write(String(next))
}
