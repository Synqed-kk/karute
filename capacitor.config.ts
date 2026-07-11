import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'jp.synqed.karute',
  appName: 'Karute',
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

export default config;
