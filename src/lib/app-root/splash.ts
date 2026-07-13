// Native-shell splash handshake — platform-neutral. Both the web app (layout.tsx
// end-of-body script) and this thin target must drop the shell's launch screen on
// the FIRST PAINTED FRAME, not after hydration/interactivity (#444: pixels beat
// interactive by up to ~1s on slow devices). Porting it into the Vite entry is
// NEW code, not a timing tweak — the bundle has no Next layout to carry the script.
//
// The SplashScreen plugin proxy is injected into the page by the native shell;
// normal browsers have no window.Capacitor and every call below no-ops.

type SplashPlugin = { hide?: () => Promise<void> }
type CapWindow = {
  Capacitor?: { Plugins?: { SplashScreen?: SplashPlugin } }
}

/** Hide the native launch screen now. No-op outside the shell. */
export function hideNativeSplash(): void {
  if (typeof window === 'undefined') return
  const p = (window as CapWindow).Capacitor?.Plugins?.SplashScreen
  void p?.hide?.()
}

/**
 * Release the splash on the first painted frame: two rAFs after this runs, which
 * lands right after the browser commits the first paint. Call once from the entry
 * AFTER the synchronous mount. CookieVC's +8s failsafe covers a missed call.
 */
export function releaseSplashOnFirstPaint(): void {
  if (typeof window === 'undefined') return
  if (!(window as CapWindow).Capacitor) return
  requestAnimationFrame(() => requestAnimationFrame(hideNativeSplash))
}
