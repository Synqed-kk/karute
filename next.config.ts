import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./next-intl.config.ts')

const nextConfig: NextConfig = {
  experimental: {
    // Router-cache reuse for dynamic screens. Next's default is 0s: every
    // sidebar hop and 予約 date-arrow press re-runs the full server render
    // (measured 1.0–2.6s per click on prod, 2026-07-30 speed pass).
    //
    // 5 minutes, not 30s: at 30s the screens were still "forgotten" between
    // normal sidebar loops and every revisit re-paid the full price. The long
    // window is only honest because <QuietRefresh> ships with it — past 25s a
    // served copy repaints instantly AND fires one background router.refresh()
    // that corrects it in place. So the UNCORRECTED staleness ceiling is 25s
    // (tighter than round 1's 30s), while the INSTANT-paint window is 5min.
    // In-app writes are exact regardless: a Server Action invalidates the
    // router cache, so the next read is live.
    //
    // Web-only: the native shell renders the Vite thin bundle, which this file
    // never touches.
    staleTimes: { dynamic: 300 },
  },
}

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // `disableLogger: true` was deprecated by @sentry/nextjs and prints
  // a DEPRECATION WARNING on every Turbopack startup (the new API
  // — webpack.treeshake.removeDebugLogging — only works under webpack,
  // not Turbopack, so it'd be a no-op in dev anyway). Dropping the
  // flag entirely: Sentry's debug-log treeshaking is a build-time
  // perf optimization, not a runtime requirement — production
  // builds still work + log output is tolerable.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})
