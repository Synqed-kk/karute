import type { CapacitorConfig } from '@capacitor/cli';

// §7 mechanism 1 — build-time env-switched config = the ROLLBACK story.
//   KARUTE_SHELL_MODE=local  → offline: WebView loads the thin target bundle
//                              (webDir=thin/dist), zero network for first paint.
//   KARUTE_SHELL_MODE=remote → WebView loads the LIVE site. Flip back here to
//                              instantly revert a bundled binary to the remote
//                              shell — no code change.
// The choice is a single env var read at `cap sync`/build time; nothing about the
// app code differs between modes.
//
// The mode is EXPLICIT — unset throws, same bar as release.mjs. The old
// unset→remote dev default was how a "local" Android build could silently come
// out remote: `cap sync` accepts whatever this file resolves and no later step
// checks it (Android has no release.mjs equivalent; found 7/31 during the
// Android code-6 local wrap).
const rawMode = process.env.KARUTE_SHELL_MODE;
if (rawMode !== 'local' && rawMode !== 'remote') {
  throw new Error(
    `[capacitor] KARUTE_SHELL_MODE must be explicitly 'local' or 'remote', got: ${JSON.stringify(rawMode)}. ` +
      'No default — an unset mode silently builds the wrong shell. ' +
      'Run e.g. KARUTE_SHELL_MODE=remote npx cap sync <platform>.',
  );
}
const SHELL_MODE = rawMode;

const base: CapacitorConfig = {
  appId: 'jp.synqed.karute',
  appName: 'Karute',
  // Tag every WebView request's User-Agent so the SERVER can tell shell from
  // web from the first byte (client-side isNativeShell() only knows after
  // hydration). Inert until a binary built with this ships; then the web app
  // may server-render web-only surfaces (purchase CTAs) for browsers while
  // omitting them for the shell — no hydration pop-in, no shell flash. Applies
  // to iOS and (parked) Android alike. Version suffix = UA-parse stability.
  appendUserAgent: 'KaruteShell/1',
  plugins: {
    // Hold the native launch screen until the site reports it has painted —
    // the web app's SplashHide component calls SplashScreen.hide() right
    // after hydration (the plugin proxy is bridge-injected into the remote
    // page; the site bundles nothing). Kills the white gap between splash
    // and first paint on cold start. CookieVC's failsafe force-hides at +8s
    // so a failed hide call can never strand the user on the splash.
    SplashScreen: {
      launchAutoHide: false,
    },
  },
  ios: {
    // Default WKWebView scheme; leave as-is. Do NOT set to http/https.
    scheme: 'capacitor',
    // Matches the app's light theme so the launch/status-bar area looks native.
    backgroundColor: '#ffffff',
    // Force the WKWebView to commit to MOBILE content mode up front. The default
    // ('recommended') lets WKWebView pick a desktop-ish layout width on a
    // remote-URL shell and latch an initial scale before the live site's
    // width=device-width / initial-scale=1 applies — so the app loads zoomed-in
    // until you pinch. 'mobile' resolves the correct device-width fit on first
    // paint. Native-only: does NOT touch the served viewport meta, so browser
    // pinch-zoom / WCAG is unaffected (zoomEnabled, a separate knob, stays default).
    preferredContentMode: 'mobile',
  },
};

// LOCAL: point webDir at the thin target's build output (produced by
// `vite build --config thin/vite.config.ts`, which lives on the web lane — see
// scripts/shell/release.mjs for the ordering). No server.url → offline first paint.
const local: CapacitorConfig = {
  ...base,
  webDir: 'thin/dist',
};

// REMOTE (default): the minimal offline-fallback folder + the live-site server
// URL. Identical to today's shipped behavior — this is the rollback target.
const remote: CapacitorConfig = {
  ...base,
  // NEW minimal folder — NOT public/. Holds only the offline fallback page so
  // zero Next.js assets are bundled into the native binary.
  webDir: 'capacitor-shell',
  server: {
    // Remote-URL shell: the iOS WebView loads the LIVE production site, so the
    // app is visually identical to the website because it IS the website.
    // karute-omega.vercel.app is the PUBLIC production alias (verified HTTP 200);
    // the karute-synqed-kk / git-main aliases are behind Vercel SSO (HTTP 401).
    // Swap to a custom domain (e.g. https://karute.synqed.jp) before public launch.
    url: 'https://karute-omega.vercel.app',
    // Prod is HTTPS end-to-end — no cleartext HTTP. Keep false for App Store ATS.
    cleartext: false,
    // Keep in-app navigation (booking, sync, all internal routing) INSIDE the
    // WebView instead of bouncing to mobile Safari. Single prod host only.
    allowNavigation: ['karute-omega.vercel.app'],
  },
};

const config: CapacitorConfig = SHELL_MODE === 'local' ? local : remote;

export default config;
