import * as Sentry from '@sentry/nextjs'
import { wrapTransport } from './lib/observability/sentry-exit'
import { sentryScrubOptions } from './lib/observability/sentry-scrub'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    integrations: [],
    ...sentryScrubOptions,
    transport: wrapTransport(Sentry.makeFetchTransport),
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
