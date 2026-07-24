#!/usr/bin/env node
// Monotonic, unique native build number for CFBundleVersion — plain increment,
// human-readable (Liam ruling 7/25: App Store Connect showed 9, 10, 11, 12,
// then the old unix-seconds floor jumped it to 1784906700 — gibberish; back to
// clear numbers). Apple only accepts ASCENDING build numbers within one
// marketing version, and 1.0's train already has 1784906700 uploaded — so the
// reset rides a MARKETING_VERSION bump to 1.1, where the counter restarts.
// Liam ruling: the 1.1 train starts over at 1 — uploads read 1.1 (1), (2), …
// State file seeded to 0 on the build Mac accordingly.
//
// A missing or unreadable state file FAILS LOUDLY here (Greptile #610 P1):
// minting blind on a fresh checkout/new machine would stamp a regressed
// number that App Store Connect rejects only AFTER a full archive+upload.
// Seed once per machine from ASC's last uploaded 1.1 build number.
//
// ponytail: read→compute→write is not atomic — two PARALLEL builds on the same
// machine can mint the same number (duplicate, never backwards; App Store
// upload rejects the duplicate loudly). Ceiling accepted: builds are single-
// machine sequential today. Upgrade path: a lockfile (or CI-provided run
// number) if parallel release builds ever exist.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const STATE = join(dirname(fileURLToPath(import.meta.url)), '.last-build-number')

/** Pure: strictly greater than `last` — the next plain integer. */
export function nextBuildNumber(last) {
  return last + 1
}

/** Pure validation: `raw` is the state file's content, or null if absent.
 *  Throws with seed instructions rather than guessing — see header. */
export function parseLastBuildNumber(raw) {
  if (raw === null) {
    throw new Error(
      `✗ ${STATE} missing — refusing to mint a build number blind. ` +
        `Seed it once from App Store Connect's last uploaded 1.1 build: ` +
        `echo -n '<last build number>' > ${STATE}`,
    )
  }
  const n = Number(raw.trim())
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `✗ ${STATE} unreadable (${JSON.stringify(raw.trim())}) — re-seed it ` +
        `from App Store Connect's last uploaded 1.1 build number.`,
    )
  }
  return n
}

/** Strict read of the persisted counter — the ONLY reader of the state file
 *  (release.mjs imports this instead of rolling its own). */
export function readLast() {
  let raw = null
  try {
    raw = readFileSync(STATE, 'utf8')
  } catch {
    // fall through — parseLastBuildNumber(null) throws the seed message
  }
  return parseLastBuildNumber(raw)
}

// CLI: `node build-number.mjs` prints + persists the next number.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = nextBuildNumber(readLast())
  writeFileSync(STATE, String(next))
  process.stdout.write(String(next))
}
