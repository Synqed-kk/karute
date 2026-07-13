// Sign-out lifecycle (PLAN §4 Codex R2 #16, packet-01 point 6).
//
// supabase-js returns from signOut() BEFORE clearing the local session on most
// network errors — so if we only cleared local "on success", a sign-out while
// offline would leave the session on the device. Local purge therefore runs
// REGARDLESS of whether remote revocation succeeded.

export interface SignOutResult {
  /** Did the remote GoTrue revocation succeed? Local purge happens either way. */
  remoteOk: boolean
}

/**
 * Sign out: attempt remote revocation, then ALWAYS purge local state (the
 * supabase session key, partitioned caches, and the Keychain-backed secure
 * store). A remote failure/throw does not skip the local purge.
 *
 * `purgeLocal` is the caller's composed teardown — it must clear the supabase
 * storage key, every partitioned per-user/business/store cache (PLAN §4 Codex
 * R2 #17), and the secure store. Injected so this stays testable.
 */
export async function signOutAndPurge(args: {
  signOutRemote: () => Promise<void>
  purgeLocal: () => Promise<void>
}): Promise<SignOutResult> {
  let remoteOk = true
  try {
    await args.signOutRemote()
  } catch {
    remoteOk = false
  }
  // ALWAYS — even if remote revocation failed or threw.
  await args.purgeLocal()
  return { remoteOk }
}
