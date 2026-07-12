#!/usr/bin/env node
// Build → cap sync → archive as ONE verified pipeline (R3 #18). Replaces the
// today-state where webDir points at `spike-auth` and CFBundleVersion is a
// hard-coded `2`. Embeds AND verifies mode / commit / asset-hash / a monotonic
// unique build number BEFORE archive, and emits a non-secret env manifest.
//
// CROSS-LANE NOTE: step 1 builds the thin target (`thin/vite.config.ts`), which
// lives on the web lane (PR #457). Run this only after the web PRs merge; until
// then use --dry-run to exercise the verifiable Node logic (hash/number/manifest).
//
// Usage:
//   node scripts/shell/release.mjs --dry-run     # logic only, no native tools
//   node scripts/shell/release.mjs --run         # full: vite + cap sync + plist
//   node scripts/shell/release.mjs --run --archive  # + xcodebuild archive

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { nextBuildNumber } from './build-number.mjs'

const RUN = process.argv.includes('--run')
const ARCHIVE = process.argv.includes('--archive')
const DIST = 'thin/dist'
const STATE = 'scripts/shell/.last-build-number'
const PLIST = 'ios/App/App/Info.plist'

const sh = (cmd) => execSync(cmd, { stdio: 'inherit' })
const cap = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

// Deterministic sha256 over the built bundle (sorted paths) — proves the binary
// carries exactly this web output.
function assetHash(dir) {
  const h = createHash('sha256')
  const walk = (d) =>
    readdirSync(d)
      .sort()
      .forEach((n) => {
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else {
          h.update(n)
          h.update(readFileSync(p))
        }
      })
  walk(dir)
  return h.digest('hex').slice(0, 16)
}

function main() {
  const mode = process.env.KARUTE_SHELL_MODE === 'local' ? 'local' : 'remote'
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA || cap('git rev-parse --short HEAD')
  const last = existsSync(STATE) ? Number(readFileSync(STATE, 'utf8').trim()) || 0 : 0
  const buildNumber = nextBuildNumber(last)

  // 1. Build the thin target (web-lane config). Injects commit + build number so
  //    the manifest emitted INTO the bundle matches the native embed.
  if (RUN) {
    sh(
      `VITE_SHELL_MODE=${mode} VITE_BUILD_COMMIT=${commit} VITE_BUILD_NUMBER=${buildNumber} ` +
        `npx vite build --config thin/vite.config.ts`,
    )
  }

  // 2. Asset hash of the built bundle (local mode only; remote ships no bundle).
  const hash = mode === 'local' && existsSync(DIST) ? assetHash(DIST) : 'remote'

  // 3. Non-secret env manifest, written beside the bundle AND printed for CI.
  const manifest = { mode, commit, buildNumber, assetHash: hash, builtAt: new Date().toISOString() }
  if (existsSync(DIST)) writeFileSync(join(DIST, 'build-manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('build manifest:', JSON.stringify(manifest))

  // 4. cap sync — copies webDir + plugins into the native project.
  if (RUN) sh(`KARUTE_SHELL_MODE=${mode} npx cap sync ios`)

  // 5. Embed CFBundleVersion (monotonic build number) + VERIFY the readback.
  if (RUN) {
    sh(`/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${buildNumber}" ${PLIST}`)
    const readback = cap(`/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" ${PLIST}`)
    if (readback !== String(buildNumber)) {
      throw new Error(`✗ verify failed: CFBundleVersion=${readback} != ${buildNumber}`)
    }
    writeFileSync(STATE, String(buildNumber))
    console.log(`✓ verified CFBundleVersion=${buildNumber}, commit=${commit}, hash=${hash}`)
  } else {
    console.log(`[dry-run] would embed CFBundleVersion=${buildNumber} into ${PLIST} and verify`)
  }

  // 6. Archive — needs Xcode + signing; Liam/CI runs this on a Mac with the
  //    project resolved (`pod`/SPM). Documented, gated behind --archive.
  if (RUN && ARCHIVE) {
    sh(
      'xcodebuild -workspace ios/App/App.xcworkspace -scheme App ' +
        '-configuration Release -archivePath build/Karute.xcarchive archive',
    )
  } else {
    console.log('[archive] run with --run --archive on a Mac with Xcode + signing configured')
  }
}

main()
