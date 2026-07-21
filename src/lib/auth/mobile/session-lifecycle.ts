// Sign-out lifecycle (PLAN §4 Codex R2 #16, packet-01 point 6; reordered
// fail-closed-first, packet 13).
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
 * `captureSession` reads the live session ONCE, before anything below
 * purges it — `revokeRemote` rides this captured token, never a fresh read
 * (which would find the storage this function just emptied). `wipeLocal` is
 * the caller's per-user teardown (recorder/pipeline/draft/takes), uid
 * threaded explicitly rather than read back off session state. `purgeStorage`
 * removes the GoTrue storage trio; `flip` runs only after it resolves, so the
 * visible sign-out never precedes the disk purge landing. `revokeRemote` is
 * best-effort and LAST: a failure, offline, or a hang must never delay or
 * block the local purge above — it has already happened by the time this
 * runs. No retry queue (YAGNI — the server token expires on its own
 * schedule; revocation is defense-in-depth).
 */
export async function signOutAndPurge(args: {
  captureSession: () => Promise<{ accessToken: string | null; uid: string | undefined }>
  wipeLocal: (uid: string | undefined) => Promise<void>
  purgeStorage: () => Promise<void>
  flip: () => void
  revokeRemote: (accessToken: string | null) => Promise<void>
}): Promise<SignOutResult> {
  const { accessToken, uid } = await args.captureSession()
  await args.wipeLocal(uid)
  await args.purgeStorage()
  args.flip()
  let remoteOk = true
  try {
    await args.revokeRemote(accessToken)
  } catch {
    remoteOk = false
  }
  return { remoteOk }
}
