import * as Sentry from '@sentry/nextjs'
import { wrapTransport } from './lib/observability/sentry-exit'
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

  // Sentry.makeNodeTransport is referenced ONLY inside the nodejs branch: the
  // edge entry has no such export and TypeScript would not catch it (item 102).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({ ...common, spotlight: false, transport: wrapTransport(Sentry.makeNodeTransport, { log: true }) })
  }
  // Edge: no exit until PR 2 (sentry-exit-edge.ts); today's hooks only.
  if (process.env.NEXT_RUNTIME === 'edge') Sentry.init({ ...common, spotlight: false })
}

export const onRequestError = Sentry.captureRequestError
