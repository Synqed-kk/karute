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

## Version bump rule

Every native-side change (fix, feature, dependency change) bumps
`android/app/build.gradle`:
- `versionCode` +1 (integer, monotonic, gates Play Store upload)
- `versionName` human string, kept in parity with the iOS train
  (`ios/App/App.xcodeproj/project.pbxproj` `CURRENT_PROJECT_VERSION`/marketing
  version — check what iOS is on before picking the next Android versionName).

This fix: `versionCode 1 → 2`, `versionName "1.0" → "1.1"`.

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
