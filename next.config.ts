import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./next-intl.config.ts')

const nextConfig: NextConfig = {
  experimental: {
    // Router-cache reuse for dynamic screens. Next's default is 0s: every
    // sidebar hop and 予約 date-arrow press re-runs the full server render
    // (measured 1.0–2.6s per click on prod, 2026-07-30 speed pass). 30s lets
    // the client reuse a screen it already has for quick revisits. Staleness
    // ceiling: in-app mutations stay fresh (router.refresh() after writes
    // bypasses this); only OTHER-device changes can be up to 30s stale on a
    // revisit — same order as the shell's cached facade packets. Web-only:
    // the native shell renders the Vite thin bundle, which this file never
    // touches.
    staleTimes: { dynamic: 30 },
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
