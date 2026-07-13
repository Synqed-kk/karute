// ─────────────────────────────────────────────────────────────
// Platform — are we inside the native app shell?
// ─────────────────────────────────────────────────────────────
// The phone apps are the SAME web app wrapped in Capacitor. Subscription
// purchase/upgrade surfaces must exist ONLY on the open web: app-store rules
// (Apple guideline 3.1.1/3.1.3; Google Play billing policy) put in-app
// digital-subscription checkout — and even steering links toward external
// checkout — under store commissions (Japan: 21% under the MSCA regime) and
// review risk. A binary with zero purchase surface sits entirely outside
// those rules. So: purchase CTAs render on web, never in the shell.
//
// This is the allowed multiplatform pattern (identical behavior for every
// shell user, reviewer or not) — NOT review-detection, which is banned.
//
// Detection is feature-based (the Capacitor runtime injects window.Capacitor)
// so this needs no dependency on @capacitor/core and is a no-op false on the
// web and in SSR. Client components only.

export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as {
    Capacitor?: { isNativePlatform?: () => boolean }
  }).Capacitor
  return Boolean(cap?.isNativePlatform?.())
}
