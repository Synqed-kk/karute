'use client'

/**
 * The ONE logout wipe for the session vault — call from every sign-out
 * surface (sidebar, profile, and any future mobile-auth purge).
 *
 * A salon iPad is a shared device and logout is a SOFT navigation: the
 * module-level recorder/pipeline singletons — which can hold a customer's
 * live audio, transcript, and AI summary — survive it unless killed here,
 * and would render (or re-stamp as a draft) under the NEXT user who signs
 * in. Storage (draft + takes) is wiped alongside.
 *
 * Dynamic imports on purpose: globalRecorder's module graph reaches server
 * actions (next/cache), which must not load just because a component that
 * CAN sign out rendered (plain jsdom tests render the sidebar). The cost is
 * paid only when a logout actually happens.
 *
 * `uid` (F3, packet 12 fix batch): optional EXPLICIT override for
 * clearOwnTakes' owner lookup. Every existing caller stays no-arg and
 * behaves identically (clearOwnTakes falls back to its own currentUserId()
 * read). It exists for thin/auth/session.ts's SIGNED_OUT listener, which
 * calls this AFTER the session store has already been nulled — on the thin
 * path, currentUserId() reads FROM that store, so a SERVER-driven sign-out
 * (failed refresh, revoke, password reset) would otherwise resolve null and
 * clearOwnTakes would silently no-op, leaving the leaving staff member's
 * takes on the shared device.
 */
export async function wipeSessionVault(opts: { uid?: string } = {}): Promise<void> {
  const [{ globalRecorder }, { globalPipeline }, { clearDraft }, { clearOwnTakes }, { clearAiSlotCache }] =
    await Promise.all([
      import('@/lib/global-recorder'),
      import('@/lib/global-pipeline'),
      import('@/lib/karute/draft'),
      import('@/lib/karute/take-store'),
      import('@/lib/karute/ai-slot-cache'),
    ])
  globalRecorder.discard() // stops the mic if live; deletes the live take
  globalPipeline.reset()
  clearDraft()
  // AI-card session memory (drafts/predictions keyed by record path): module
  // scope survives a soft logout, so without this the next signer-in on the
  // same device could render the previous user's cached card.
  clearAiSlotCache()
  // Owner-scoped on purpose: only the signing-out user's takes die here —
  // another staff member's crash-recovery audio must survive their logout
  // (it is already invisible to everyone else via the store's owner gate).
  await clearOwnTakes(opts.uid)
}
