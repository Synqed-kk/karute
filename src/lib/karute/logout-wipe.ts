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
 */
export async function wipeSessionVault(): Promise<void> {
  const [{ globalRecorder }, { globalPipeline }, { clearDraft }, { clearAllTakes }] =
    await Promise.all([
      import('@/lib/global-recorder'),
      import('@/lib/global-pipeline'),
      import('@/lib/karute/draft'),
      import('@/lib/karute/take-store'),
    ])
  globalRecorder.discard() // stops the mic if live; deletes the live take
  globalPipeline.reset()
  clearDraft()
  await clearAllTakes()
}
