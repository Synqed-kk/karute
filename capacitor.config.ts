import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'jp.synqed.karute',
  appName: 'Karute',
  // Tag every WebView request's User-Agent so the SERVER can tell shell from
  // web from the first byte (client-side isNativeShell() only knows after
  // hydration). Inert until a binary built with this ships; then the web app
  // may server-render web-only surfaces (purchase CTAs) for browsers while
  // omitting them for the shell — no hydration pop-in, no shell flash. Applies
  // to iOS and (parked) Android alike. Version suffix = UA-parse stability.
  appendUserAgent: 'KaruteShell/1',
  // SPIKE ONLY (spike/auth-client-session): local bundle, no server.url. The
  // WebView loads spike-auth/index.html from capacitor://localhost so we can
  // test plain supabase-js client auth on-device with NO remote site. Never
  // let this webDir / removed-server change reach any other branch.
  webDir: 'spike-auth',
  plugins: {
    // Hold the native launch screen until the site reports it has painted —
    // the web app's SplashHide component calls SplashScreen.hide() right
    // after hydration (the plugin proxy is bridge-injected into the remote
    // page; the site bundles nothing). Kills the white gap between splash
    // and first paint on cold start. CookieVC's failsafe force-hides at +8s
    // so a failed hide call can never strand the user on the splash.
    SplashScreen: {
      // SPIKE: auto-hide — the spike page does not call SplashScreen.hide(),
      // so let the OS drop the splash itself instead of waiting on the failsafe.
      launchAutoHide: true,
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

export default config;
