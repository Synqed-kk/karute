import { NextResponse } from 'next/server'
import { getSynqedClient } from '@/lib/synqed/client'

export async function enforceAiRateLimit(route: string): Promise<NextResponse | null> {
  const synqed = await getSynqedClient()
  const result = await synqed.aiRateLimit.consume(route)
  if (result.allowed) return null
  const message =
    result.reason === 'daily_cost'
      ? `Daily AI spend cap of ${(result.costCap / 100).toFixed(2)} USD reached`
      : 'Hourly AI request cap reached'
  return NextResponse.json(
    {
      error: message,
      reason: result.reason,
      cap: result.cap,
      cost_cap_cents: result.costCap,
      cost_used_cents: result.costUsed,
      retry_at: result.resetAt,
    },
    { status: 429, headers: { 'Retry-After': String(60 * 60) } },
  )
}

// gpt-4o-mini pricing (cents per 1M tokens). Update if model changes.
// $0.15/1M input + $0.60/1M output → 15 cents and 60 cents per 1M tokens.
const PRICE_IN_CENTS_PER_MTOKEN = 15
const PRICE_OUT_CENTS_PER_MTOKEN = 60

export function estimateCostCents(tokensIn: number, tokensOut: number): number {
  const cents =
    (tokensIn / 1_000_000) * PRICE_IN_CENTS_PER_MTOKEN +
    (tokensOut / 1_000_000) * PRICE_OUT_CENTS_PER_MTOKEN
  return Math.max(1, Math.round(cents)) // round up to at least 1 cent so tiny calls still register
}

/** Fire-and-forget: report token usage to synqed-core for the daily $-cap. */
export async function reportAiUsage(
  route: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  try {
    const synqed = await getSynqedClient()
    const cost = estimateCostCents(tokensIn, tokensOut)
    await synqed.aiRateLimit.recordUsage(route, tokensIn, tokensOut, cost)
  } catch (err) {
    console.warn('[ai-usage] failed to report usage:', err)
  }
}
