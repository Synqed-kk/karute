import * as Sentry from '@sentry/nextjs'

export const runtime = 'nodejs'

export async function GET() {
  const client = Sentry.getClient()
  const dsn = client?.getDsn()
  const initialized = !!client

  Sentry.captureException(new Error('Sentry smoke test — explicit capture'))
  await Sentry.flush(2000)

  return Response.json({
    initialized,
    dsn: dsn ? { host: dsn.host, projectId: dsn.projectId } : null,
    runtime: process.env.NEXT_RUNTIME,
    hasEnvDsn: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  })
}
