import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./next-intl.config.ts')

const nextConfig: NextConfig = {}

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
