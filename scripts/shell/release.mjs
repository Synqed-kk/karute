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
// carries exactly this web output. Skipped on BOTH sides of the pre/post-sync
// comparison: build-manifest.json embeds this very hash (circular), and the
// cordova shims are injected by `cap sync` into the synced copy only — their
// emptiness is asserted separately at verify time, never silently ignored.
const HASH_SKIP = new Set(['build-manifest.json', 'cordova.js', 'cordova_plugins.js'])
function assetHash(dir) {
  const h = createHash('sha256')
  const walk = (d) =>
    readdirSync(d)
      .sort()
      .forEach((n) => {
        // Root level only: cap sync injects the shims (and the manifest is
        // written) at the TOP of the web dir — a same-named file deeper in the
        // tree is real content and must stay under the hash (Greptile P2).
        if (d === dir && HASH_SKIP.has(n)) return
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

// Required Vite env for a NON-white-screen bundle. thin/.env is gitignored and
// machine-local — a fresh CI runner has neither it nor the vars, and without
// this preflight it would archive a guaranteed white-screen binary while
// printing "✓ verified" (Fable review round 1, critical 3a).
const REQUIRED_VITE = ['VITE_FACADE_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
function preflightViteEnv() {
  const dotenv = {}
  if (existsSync('thin/.env')) {
    for (const line of readFileSync('thin/.env', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.+)$/)
      if (m) dotenv[m[1]] = m[2]
    }
  }
  const missing = REQUIRED_VITE.filter((k) => !process.env[k] && !dotenv[k])
  if (missing.length > 0) {
    throw new Error(
      `✗ preflight: missing required Vite env (no fallback default): ${missing.join(', ')}. ` +
        'Set them in the environment or thin/.env — refusing to build a white-screen bundle.',
    )
  }
}

function main() {
  // Mode is EXPLICIT here — no default at all. A mislabeled probe binary
  // corrupts the A/B numbers that decide CONTINUE/ABORT (Fable review round 1).
  const mode = process.env.KARUTE_SHELL_MODE
  if (mode !== 'local' && mode !== 'remote') {
    throw new Error(
      `✗ KARUTE_SHELL_MODE must be explicitly 'local' or 'remote' (got ${JSON.stringify(mode)}). ` +
        'No default: the release pipeline must never guess which shell it is building.',
    )
  }
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA || cap('git rev-parse --short HEAD')
  const last = existsSync(STATE) ? Number(readFileSync(STATE, 'utf8').trim()) || 0 : 0
  const buildNumber = nextBuildNumber(last)

  // 1. Build the thin target (web-lane config). Injects commit + build number so
  //    the manifest emitted INTO the bundle matches the native embed. Env is
  //    preflighted FIRST — vite build must never start with missing config.
  if (RUN) {
    preflightViteEnv()
    sh(
      `VITE_SHELL_MODE=${mode} VITE_BUILD_COMMIT=${commit} VITE_BUILD_NUMBER=${buildNumber} ` +
        `npx vite build --config thin/vite.config.ts`,
    )
  }

  // 2. Asset hash of the built bundle. remote ships no bundle; 'none' = local
  //    mode with no dist yet (dry-run) — never the 'remote' sentinel in a
  //    local-mode manifest.
  const hash =
    mode === 'local' ? (existsSync(DIST) ? assetHash(DIST) : 'none') : 'remote'

  // 3. Non-secret env manifest, written beside the bundle AND printed for CI.
  const manifest = { mode, commit, buildNumber, assetHash: hash, builtAt: new Date().toISOString() }
  if (existsSync(DIST)) writeFileSync(join(DIST, 'build-manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('build manifest:', JSON.stringify(manifest))

  // 4. cap sync — copies webDir + plugins into the native project. Then VERIFY
  //    the synced copy: re-hash what actually landed in the native web dir and
  //    compare to the pre-sync bundle hash (same readback pattern as the
  //    CFBundleVersion check below) — the manifest must prove what is IN the
  //    archive, not what we intended to put there.
  if (RUN) {
    sh(`KARUTE_SHELL_MODE=${mode} npx cap sync ios`)
    if (mode === 'local') {
      // The shims are excluded from the hash, so pin them to the known empty
      // stubs (this project has zero cordova plugins) — a shim with content
      // would ship unverified code into the WebView.
      for (const shim of ['cordova.js', 'cordova_plugins.js']) {
        const p = join('ios/App/App/public', shim)
        if (existsSync(p) && statSync(p).size > 0) {
          throw new Error(
            `✗ verify failed: ${p} is non-empty — expected Capacitor's empty stub ` +
              '(no cordova plugins in this project); a non-empty shim is unverified code.',
          )
        }
      }
      const synced = assetHash('ios/App/App/public')
      if (synced !== hash) {
        throw new Error(
          `✗ verify failed: synced ios/App/App/public hash=${synced} != thin/dist hash=${hash} — ` +
            'cap sync did not faithfully copy the bundle (stale webDir? partial copy?).',
        )
      }
      console.log(`✓ verified synced assets match bundle (hash=${hash})`)
    }
  }

  // 5. Embed CFBundleVersion (monotonic build number) + VERIFY the readback.
  if (RUN) {
    sh(`/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${buildNumber}" ${PLIST}`)
    const readback = cap(`/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" ${PLIST}`)
    if (readback !== String(buildNumber)) {
      throw new Error(`✗ verify failed: CFBundleVersion=${readback} != ${buildNumber}`)
    }
    writeFileSync(STATE, String(buildNumber))
    console.log(`✓ verified CFBundleVersion=${buildNumber}, commit=${commit}, hash=${hash}`)
    console.log(
      `[reminder] ${PLIST} was modified (CFBundleVersion=${buildNumber}) — commit or discard it after this run.`,
    )
  } else {
    console.log(`[dry-run] would embed CFBundleVersion=${buildNumber} into ${PLIST} and verify`)
  }

  // 6. Archive — needs Xcode + signing; Liam/CI runs this on a Mac with the
  //    project resolved (SPM). Documented, gated behind --archive.
  if (RUN && ARCHIVE) {
    // SPM layout: there is no .xcworkspace (packet-04 §Builder environment) —
    // the -workspace invocation this replaces had never actually run.
    sh(
      'xcodebuild -project ios/App/App.xcodeproj -scheme App ' +
        '-configuration Release -archivePath build/Karute.xcarchive archive',
    )
  } else {
    console.log('[archive] run with --run --archive on a Mac with Xcode + signing configured')
  }
}

main()
