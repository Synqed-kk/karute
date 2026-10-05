import * as Sentry from '@sentry/nextjs'
import { sentryScrubOptions } from './lib/observability/sentry-scrub'

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return

  const common = {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? 'development',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    ...sentryScrubOptions,
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') Sentry.init(common)
  if (process.env.NEXT_RUNTIME === 'edge') Sentry.init(common)
}

export const onRequestError = Sentry.captureRequestError
