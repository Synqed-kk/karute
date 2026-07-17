#!/bin/sh
# Xcode Cloud post-clone hook (Apple runs this automatically before resolving
# package dependencies — the filename and location are Apple's contract:
# ci_scripts/ next to the .xcodeproj).
#
# Why it exists: CapApp-SPM/Package.swift points at LOCAL packages inside
# node_modules/@capacitor/* — a fresh Xcode Cloud clone has no node_modules,
# so dependency resolution fails ("cannot be accessed / doesn't exist in file
# system", builds ≤178). Node isn't preinstalled on the image; Homebrew is.
#
# Why NOT a plain `npm ci`: prod deps include @synqed-kk/* from GitHub
# Packages (tracked .npmrc), which 401s without a NODE_AUTH_TOKEN the runner
# doesn't have. SPM only needs the two plugin FOLDERS to exist, and both live
# on the public npm registry — so install just those in a scratch dir (away
# from the repo's package.json/.npmrc) and copy them in. Versions are read
# from package.json so this never drifts from the app.
# ponytail: if the iOS build ever needs the FULL node_modules (e.g. bundling
# web assets on CI), switch to `npm ci` + a NODE_AUTH_TOKEN secret env var on
# the Xcode Cloud workflow instead.
set -ex
brew install node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"
node --version

SPLASH=$(node -p "require('$CI_PRIMARY_REPOSITORY_PATH/package.json').dependencies['@capacitor/splash-screen']")
BAR=$(node -p "require('$CI_PRIMARY_REPOSITORY_PATH/package.json').dependencies['@capacitor/status-bar']")

WORK=$(mktemp -d)
cd "$WORK"
npm install --no-audit --no-fund --ignore-scripts \
  "@capacitor/splash-screen@$SPLASH" "@capacitor/status-bar@$BAR"

mkdir -p "$CI_PRIMARY_REPOSITORY_PATH/node_modules"
cp -R "$WORK/node_modules/@capacitor" "$CI_PRIMARY_REPOSITORY_PATH/node_modules/"

# Prove the two paths SPM resolves actually exist, or fail loudly here.
test -f "$CI_PRIMARY_REPOSITORY_PATH/node_modules/@capacitor/splash-screen/Package.swift"
test -f "$CI_PRIMARY_REPOSITORY_PATH/node_modules/@capacitor/status-bar/Package.swift"
