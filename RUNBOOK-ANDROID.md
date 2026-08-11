# Android build recipe — session cookie persistence fix

Any-AI rebuild doc for `feat/android-cookie-persist`. Fixes forced re-login on
Android cold launch by porting the iOS `CookieVC` cookie-persistence pattern
(see `ios/App/App/AppDelegate.swift`) to `android/app/src/main/java/jp/synqed/karute/MainActivity.java`.

## 1. Branch

```
git fetch origin
git switch -c feat/android-cookie-persist feat/android-capacitor-shell
```

`android/` on this branch already carries the full native tree (build.gradle,
settings.gradle, gradle wrapper, AndroidManifest.xml, MainActivity.java). The
signing files (`android/keystore.properties`, `android/local.properties`,
`android/karute-upload-key.jks`) are untracked/gitignored on every branch —
they must survive any checkout untouched. Verify with:

```
git status --short --ignored=matching   # expect !! next to all three
```

## 2. Vendor `@capacitor/android` (registry token is dead — no npm install)

`node_modules/@capacitor/android` is missing from the repo's `node_modules`
(never installed). Check `package.json` for the exact `@capacitor/core`
version and pull the MATCHING `@capacitor/android` tarball straight from the
public npm tarball endpoint (no auth needed):

```
curl -fL https://registry.npmjs.org/@capacitor/android/-/android-8.4.1.tgz -o /tmp/cap-android.tgz
mkdir -p node_modules/@capacitor/android
cd node_modules/@capacitor/android && tar -xzf /tmp/cap-android.tgz --strip-components=1
```

The tarball's `package/` dir becomes the package root. Verify
`node_modules/@capacitor/android/capacitor/build.gradle` exists — that's what
`android/capacitor.settings.gradle` points `:capacitor-android` at.

Version must match `@capacitor/core` exactly (both were `8.4.1` at the time
of this fix — check `node_modules/@capacitor/core/package.json` before
assuming this stays current).

## 3. Sync

```
KARUTE_SHELL_MODE=remote ./node_modules/.bin/cap sync android
```

Uses the repo's own vendored CLI (`node_modules/.bin/cap`), never a globally
installed one. Copies `capacitor-shell` web assets + regenerates
`android/app/src/main/assets/capacitor.config.json`.

## 4. Build (signed release APK)

```
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
cd android
set -o pipefail
./gradlew assembleRelease 2>&1 | tail -30
```

JDK 21 is required — `node_modules/@capacitor/android/capacitor/build.gradle`
sets `sourceCompatibility/targetCompatibility JavaVersion.VERSION_21` for the
capacitor-android module itself. Gradle wrapper is 8.14.3, AGP 8.13.0.

Output: `android/app/build/outputs/apk/release/app-release.apk`. Signing
comes from `android/app/build.gradle`'s existing `signingConfigs.release`
block, which reads `android/keystore.properties` (untracked, must already be
in place) — nothing in this fix touches signing config.

Verify the APK is actually signed:

```
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
PATH="$JAVA_HOME/bin:$PATH" \
/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0/apksigner verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

Expect `Signer #1 certificate DN: CN=SYNQED K.K., ...`.

## 5. Verify on device

```
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb logcat -s CookiePersist
```

With logcat running: log in, force-quit the app **by swiping it away from
the recents screen**, relaunch.

Acceptance: relaunch must land on the **dashboard** — not the marketing
landing page, not `/login`.

Repro method matters: swipe-from-recents fires `onPause`/`onStop` (the
capture hooks) before the process dies — that is the flow this fix covers,
and it is also what every normal backgrounding does. Settings → 強制停止
(Force Stop) is an abnormal kill that skips all lifecycle callbacks; in
practice the snapshot still exists because leaving the app to reach
Settings already fired a capture, but don't use Force Stop as the primary
repro — a failure there does not necessarily mean the fix is broken.

## Known tail

Restore covers cold launches within the access-token TTL. A relaunch after
being idle for more than ~1 hour may still show one re-login — this is a
documented tail, same as iOS (see the header comment in
`ios/App/App/AppDelegate.swift`). Testers should not file that as a
regression.

## Known launch behavior

Cold launch now holds the splash screen until the WebView's first real paint
(see the Fix B2 comments in `MainActivity.java`), with a 6s ceiling failsafe
so a launch can never get stranded on the splash.

## Version bump rule — ⚖ UNIFIED VERSION LAW (Liam 2026-08-11, supersedes everything older in this section)

- **ONE shared plain-integer release counter for BOTH platforms:** Android
  `versionCode` == iOS `CFBundleVersion`, always. Counters merged at **15**
  (8/11). Next release = 16 on both. Integers only — never decimals, never
  timestamps, never reuse (codes 7/10/14 and iOS 1.2(4.8) are burned — dead).
- **`versionName` (and iOS marketing version) identical on both platforms**
  — "1.1" until Liam explicitly declares a joint milestone bump. Never bump
  it per release, never on one platform alone.
- **Every release bakes BOTH platforms with the same number** — even
  platform-specific fixes ship both sides (the other side rebakes the same
  bundle). The two stores must never show different latest numbers.
- Canon: memory `project_karute_personal_device.md` §3. One bake packet
  covers both platforms with one number; a packet stamping different
  numbers is malformed — refuse it.

(Historical: the first fix on this branch was `versionCode 1 → 2`,
`versionName "1.0" → "1.1"`.)

## Known note (not a blocker)

`androidx.security:security-crypto:1.1.0` (added for
`EncryptedSharedPreferences`, used to back up the sb-* session cookies)
compiles with a javac deprecation note — Google marked the
`EncryptedSharedPreferences` class itself `@Deprecated` in this version with
no drop-in replacement (they now point at Jetpack DataStore + manual Tink).
It is still fully functional and is the best available "encrypted,
device-only key-value store" match for this ask; build succeeds cleanly, this
is an FYI note only. `MainActivity.java` also has a runtime fallback to plain
`SharedPreferences` if `EncryptedSharedPreferences.create(...)` throws at
runtime (sandboxed/unusual devices).

## Lessons

### 7/31 — code 6 LOCAL wrap (branch `feat/android-local-bundle`)

This runbook's body describes the REMOTE (cookie) build. The 1.1 code 6 build
switched Android to the LOCAL baked thin bundle (localStorage bearer auth,
same as iPhone 1.1(4.x)). Corrections learned, in build order:

- **§1 is stale**: `feat/android-cookie-persist` exists — never re-run its
  `git switch -c`. New work branches off it (worktree with `-b <new-branch>`;
  two worktrees on one branch corrupt each other, never `--force`).
- **§2 vendored tarball = FALLBACK only**: `@capacitor/android` is a plain
  registry dep in package.json since the main merge — `npx npm@10.8.2 ci`
  installs it (npm 11 mangles this lockfile; version must equal
  `@capacitor/core` exactly, lockfile pins it).
- **§3 mode**: local builds sync with `KARUTE_SHELL_MODE=local`; the mode is
  explicit everywhere — unset must throw (main-PR fix), never default. An
  unset var here once produced a remote artifact in a "local" flow with zero
  errors.
- **§4 builds only the APK**: Play needs `./gradlew bundleRelease` (AAB); the
  `assembleRelease` APK is for the emulator only (`adb install` can't take an
  AAB). Build BOTH.
- **Never invoke `scripts/shell/release.mjs` for Android** — its only real
  build path also runs `cap sync ios`, stamps Info.plist, and advances the
  shared ASC build counter. Hand-extract its thin-build steps (vite build +
  manifest + hash); reading `.last-build-number` is fine, writing is not.
- **`cap sync android` dirties tracked wiring files**
  (`android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`)
  when package.json plugins changed — commit them BEFORE the release build so
  the tip SHA covers everything in the binary.
- **Local-mode acceptance replaces §5's cookie test**: login on the AVD
  (test tenant only) → settle ≥5s → HOME → `am force-stop` → PROVE death
  (`pidof` empty + `ps -A` empty) → `am start` → new PID ≠ old → still
  authenticated after a 5s hold. `adb logcat -s CookiePersist` shows exactly
  one line in local mode ("local mode: … cookie machinery inert") — more
  lines means the mode guard failed. `monkey` is unreliable for launching;
  use `am start -n jp.synqed.karute/.MainActivity`.
- **The `karute-test` AVD has Quick Boot ON** — always boot `-no-snapshot`
  for persistence tests and never restart the emulator mid-test, or a VM
  snapshot restore can fake (or break) persistence results.
- **Upgrade data note**: switching origin orphans unsaved local work
  (IndexedDB takes, localStorage drafts) and forces one re-login. Release
  notes must say "save in-progress work before updating"; Liam confirms no
  tester has unsaved work before upload. Local mode also deliberately clears
  the remote-era cookie jar + snapshot on launch (see MainActivity comments).

### 7/31 night — codes 7+8 (mic permissions + lock-screen recording)

- **Mic-liveness proof method**: `adb shell dumpsys audio | grep silenced:` —
  the OS's RecordingActivityMonitor states per-session `silenced:true/false`
  for our own capture. A/B it: build WITHOUT the fix → lock (`keyevent 26`) →
  flips `silenced:true` in ~10s; build WITH the mic FGS → stays `false`. This
  is the red-run artifact; screenshots of the timer alone don't prove audio.
- **FGS liveness**: `dumpsys activity services jp.synqed.karute` →
  `isForeground=true types=0x00000080`. Raise/drop is logged under the
  `CookiePersist` tag ("raising/dropping mic foreground service").
- **Emulator lock/wake**: lock `input keyevent 26`, wake `224`, then swipe up
  to dismiss keyguard. AVD has no PIN.
- **Play Console at upload (code 8+)**: TWO forms — Data safety ("Audio files
  → Voice or sound recordings": Collected, not ephemeral, App functionality,
  encrypted in transit) AND Foreground service permissions declaration
  (type microphone, category "Background Audio Access", feature description +
  demo video link). Missing either is a commonly-reported auto-reject.
- **POST_NOTIFICATIONS is never requested** (deliberate, 7/31): the 録音中
  FGS notification is enqueued but withheld on Android 13+; mic keepalive is
  unaffected (OS green dot shows). If a future build requests notification
  permission, this notification starts appearing — that's expected, not a bug.
- **OEM battery killers**: a mic FGS does not stop Xiaomi/Samsung-style
  app managers from killing the process. Staff-device setup on such phones:
  disable battery optimization for Karute (dontkillmyapp.com per vendor).
- **Consent gate lives in web code**: the 録音同意 flow runs before
  getUserMedia, so the OS mic dialog appears only after consent-taken — this
  ordering is what satisfies Play's prominent-disclosure rule; don't reorder.
