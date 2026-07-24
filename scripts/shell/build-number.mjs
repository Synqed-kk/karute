#!/usr/bin/env node
// Monotonic, unique native build number for CFBundleVersion — plain increment,
// human-readable (Liam ruling 7/25: App Store Connect showed 9, 10, 11, 12,
// then the old unix-seconds floor jumped it to 1784906700 — gibberish; back to
// clear numbers). Apple only accepts ASCENDING build numbers within one
// marketing version, and 1.0's train already has 1784906700 uploaded — so the
// reset rides a MARKETING_VERSION bump to 1.1, where the counter restarts.
// Liam ruling: the 1.1 train starts over at 1 — uploads read 1.1 (1), (2), …
// State file reset to 0 on the build Mac accordingly.
//
// ponytail: read→compute→write is not atomic — two PARALLEL builds on the same
// machine can mint the same number (duplicate, never backwards; App Store
// upload rejects the duplicate loudly). Ceiling accepted: builds are single-
// machine sequential today. Upgrade path: a lockfile (or CI-provided run
// number) if parallel release builds ever exist.
// ponytail: a lost/absent state file restarts at 1 — Apple rejects the upload
// loudly (not silently) if that regresses the train; re-seed the file from App
// Store Connect's last build number.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const STATE = join(dirname(fileURLToPath(import.meta.url)), '.last-build-number')

/** Pure: strictly greater than `last` — the next plain integer. */
export function nextBuildNumber(last) {
  return (Number(last) || 0) + 1
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
