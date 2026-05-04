import { NextResponse } from 'next/server'
import { getSynqedClient } from '@/lib/synqed/client'

export async function enforceAiRateLimit(route: string): Promise<NextResponse | null> {
  const synqed = await getSynqedClient()
  const result = await synqed.aiRateLimit.consume(route)
  if (result.allowed) return null
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      cap: result.cap,
      remaining: 0,
      retry_at: result.resetAt,
    },
    { status: 429, headers: { 'Retry-After': String(60 * 60) } },
  )
}
