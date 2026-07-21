// Sign-out lifecycle (PLAN §4 Codex R2 #16, packet-01 point 6; reordered
// fail-closed-first, packet 13; wipe/purge order + guard, packet 14).
//
// ⚠ SAFEGUARD (classifier-sensitive auth seam — see the karute phase-2
// Fable→Opus flag incident): the captured `accessToken` flows ONLY to
// `revokeRemote`. NEVER read, decode, print, or log a token VALUE here or in
// the tests for this file — assert on your own fixture strings via mock
// capture, never on a decoded/real token.
//
// The remote-first order used to leave the token trio sitting in storage for
// as long as the network revocation took (~1.2s, longer on flaky wifi) —
// kill the app in that window and relaunch boots fully signed in (REV 81).
// GoTrue itself re-reads the access token FROM THE SAME STORAGE on every
// call (client-session.ts's revoke cites the exact read), so purging first
// and revoking after would make the revoke silently find no token to send.
// The order below is now the ONLY path: capture the outgoing identity while
// the session is still intact, purge local state UNCONDITIONALLY, and only
// then attempt the remote revoke — riding the token captured before
// anything was purged. Local state is fully torn down before the revoke
// even starts, so killing the app at any point after that leaves at worst
// local-wiped-but-unrevoked (today's offline end state), never a token
// stranded in storage.

export interface SignOutResult {
  /** Did the remote GoTrue revocation succeed? Informational only (logging) —
   *  local state is already fully torn down by the time this resolves, win
   *  or lose. */
  remoteOk: boolean
}

/**
 * Sign out: capture the outgoing token + uid, purge local state
 * UNCONDITIONALLY, then best-effort revoke the CAPTURED token remotely.
 *
 * `captureSession` reads the outgoing session ONCE, before anything below
 * purges it — `revokeRemote` rides this captured token, never a fresh read
 * (which would find the storage this function just emptied). `purgeStorage`
 * removes the GoTrue storage trio and `flip` demotes the store to signed-out;
 * both run FIRST — the fail-closed core — because purgeStorage depends on none
 * of the per-user teardown, so getting the token off disk and the UI demoted
 * must not wait behind (nor be skippable by a throw in) the heavier `wipeLocal`
 * (packet 14 P2). `wipeLocal` is the caller's per-user teardown
 * (recorder/pipeline/draft/takes), uid threaded explicitly rather than read
 * back off session state; it runs AFTER purge/flip and is GUARDED — its failure
 * is best-effort and can never block the purge/flip (already done) or the
 * revoke. `revokeRemote` is best-effort and LAST: a failure, offline, or a hang
 * must never delay or block the local purge above — it has already happened by
 * the time this runs. No retry queue (YAGNI — the server token expires on its
 * own schedule; revocation is defense-in-depth).
 */
export async function signOutAndPurge(args: {
  captureSession: () => Promise<{ accessToken: string | null; uid: string | undefined }>
  wipeLocal: (uid: string | undefined) => Promise<void>
  purgeStorage: () => Promise<void>
  flip: () => void
  revokeRemote: (accessToken: string | null) => Promise<void>
}): Promise<SignOutResult> {
  // INVARIANT: a capture failure must NEVER block the purge/flip — the whole
  // reason this module exists. A rejecting read (e.g. a broken storage adapter)
  // degrades to no token so the fail-closed sequence below still runs: purge/
  // flip land, wipe(undefined) is best-effort, revoke is skipped for the null
  // token. The token trio never survives a capture throw.
  let captured: { accessToken: string | null; uid: string | undefined }
  try {
    captured = await args.captureSession()
  } catch {
    captured = { accessToken: null, uid: undefined }
  }
  const { accessToken, uid } = captured
  // Fail-closed core FIRST: token trio off disk, then demote the store.
  await args.purgeStorage()
  args.flip()
  // Per-user teardown AFTER the token is gone and the UI demoted. Guarded so a
  // throw here cannot skip the revoke or reject the whole sign-out — the purge
  // this function exists for has already landed.
  try {
    await args.wipeLocal(uid)
  } catch {
    // best-effort; the token is already purged and the store flipped
  }
  let remoteOk = true
  try {
    await args.revokeRemote(accessToken)
  } catch {
    remoteOk = false
  }
  return { remoteOk }
}
