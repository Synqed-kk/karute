// Keychain-backed session storage adapter for supabase-js (packet-01 point 1 + 6).
//
// AT-REST PROTECTION ONLY (Codex R3 #5, PLAN §4): supabase-js hands the
// serialized session — refresh material included — back to JavaScript, so any
// code already inside the bundle can reach it regardless of where it is stored.
// The Keychain buys encryption-at-rest against a lost/compromised device, NOT
// isolation from bundle code. // ponytail: at-rest only; the named upgrade is a
// native token broker that never returns refresh material to the WebView — build
// it only if the threat model demands it.
//
// IMPORTANT — @capacitor/preferences is NOT Keychain-backed (it is iOS
// UserDefaults / a plist, unencrypted at rest). Genuine at-rest protection needs
// a Keychain-backed SecureStorage plugin. This adapter targets the small
// `SecureStore` port below; the scaffold packet (02) — which owns the native
// plugin install + the binary — provides the concrete Keychain implementation.

/** Minimal secure key/value store, satisfied by a Keychain-backed plugin. */
export interface SecureStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** The async subset of supabase-js's storage contract we implement. */
export interface SupportsStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

/** Wrap a SecureStore as a supabase-js storage adapter. */
export function createKeychainSessionStorage(store: SecureStore): SupportsStorage {
  return {
    getItem: (key) => store.get(key),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.remove(key),
  }
}

/**
 * Fresh-install Keychain reset (packet-01 point 6). iOS Keychain SURVIVES app
 * deletion, so a reinstall can inherit a previous install's residual session.
 * We gate on a NON-Keychain marker (Preferences / localStorage — cleared by app
 * deletion): if the marker is absent, this is a first run on this install, so we
 * purge any residual Keychain state BEFORE it can be trusted, then set the
 * marker.
 *
 * Injected markers/purge keep this pure and testable; the scaffold binds them to
 * the real Preferences + SecureStore plugins.
 */
export async function purgeResidualKeychainOnFreshInstall(args: {
  hasInstallMarker: () => Promise<boolean>
  setInstallMarker: () => Promise<void>
  purgeSecureStore: () => Promise<void>
}): Promise<{ purged: boolean }> {
  if (await args.hasInstallMarker()) {
    return { purged: false }
  }
  await args.purgeSecureStore()
  await args.setInstallMarker()
  return { purged: true }
}
