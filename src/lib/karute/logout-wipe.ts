'use client'

import { clearAiSlotCache } from '@/lib/karute/ai-slot-cache'

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
  // AI-card session memory: cleared FIRST and SYNCHRONOUSLY (static import —
  // the module is tiny and dependency-free, unlike the recorder chains
  // below). The clear also bumps the epoch fence, so every in-flight AI
  // response is invalidated before this function's first await; bumping
  // after the dynamic-import await left a window where a settling response
  // still counted as fresh (Greptile #649 r3).
  clearAiSlotCache()
  const [
    { globalRecorder },
    { globalPipeline },
    { clearDraft },
    { clearOwnTakes },
    { resetInbox },
  ] = await Promise.all([
    import('@/lib/global-recorder'),
    import('@/lib/global-pipeline'),
    import('@/lib/karute/draft'),
    import('@/lib/karute/take-store'),
    // Build F1: the 録音履歴 rows name the leaving staffer's own customers.
    // Same shared-device hygiene as the rest of this wipe.
    import('@/lib/recordings/inbox-store'),
  ])
  resetInbox()
  // ⚖ Slice five (D4): stops the mic if live and KEEPS the take on the device —
  // the next sign-in's drain secures it; only the identity is dropped.
  globalRecorder.abandon()
  globalPipeline.reset()
  clearDraft()
  // Owner-scoped on purpose: only the signing-out user's takes die here —
  // another staff member's crash-recovery audio must survive their logout
  // (it is already invisible to everyone else via the store's owner gate).
  await clearOwnTakes(opts.uid)
}
