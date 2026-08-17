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

// ─────────────────────────────────────────────────────────────
// The one public web origin — for links that LEAVE this device
// ─────────────────────────────────────────────────────────────
// Inside the native shell `window.location.origin` is the shell's INTERNAL
// origin (`capacitor://localhost` on an iOS local bundle; `https://localhost`
// on Android — the same two in SHELL_ORIGINS in src/lib/app-api/cors.ts), so a
// URL composed from it is dead on every other device. Every share/redirect URL
// must go through publicSiteOrigin(), never window.location.origin directly.
// (8/17 staff-lockout: invite links generated on a phone were inert.)
//
// Hardcoded, not env-read, because the shell bundle compiles `process.env` away
// to `{}` (thin/vite.config.ts) — an env-driven origin would resolve undefined
// in the exact place this fix exists for.
//
// Web and dev are unchanged: there is no Capacitor runtime on localhost, so dev
// links keep the localhost origin and stay clickable.
export const PUBLIC_SITE_ORIGIN = 'https://karute.synqed.jp'

export function publicSiteOrigin(): string {
  if (typeof window === 'undefined' || isNativeShell()) return PUBLIC_SITE_ORIGIN
  return window.location.origin
}
