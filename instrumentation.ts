import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return

  const common = {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? 'development',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: scrubPii,
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') Sentry.init(common)
  if (process.env.NEXT_RUNTIME === 'edge') Sentry.init(common)
}

export const onRequestError = Sentry.captureRequestError

const PII_KEYS = new Set([
  'transcript', 'transcription', 'notes', 'note',
  'name', 'full_name', 'furigana', 'phone', 'email',
  'audio', 'audioblob', 'recording',
  'password', 'token', 'apikey', 'authorization',
])

function scrubPii(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.request) {
    delete event.request.cookies
    if (event.request.headers) {
      delete event.request.headers['cookie']
      delete event.request.headers['authorization']
      delete event.request.headers['x-api-key']
    }
    if (event.request.data && typeof event.request.data === 'object') {
      event.request.data = redact(event.request.data) as Record<string, unknown>
    }
  }
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>
  if (event.contexts) event.contexts = redact(event.contexts) as typeof event.contexts
  return event
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v)
    }
    return out
  }
  return value
}
