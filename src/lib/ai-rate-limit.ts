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

// ── Cost estimation for the daily $-cap ──────────────────────────────────────
// Cents per 1M tokens, per model. Must track the models the AI routes actually
// use: extract/summarize default to gpt-4o (PR #169), the rest to gpt-4o-mini
// (AI_MODEL). Previously this hardcoded gpt-4o-mini pricing for ALL routes, so
// once extract/summarize moved to gpt-4o the cap under-counted their spend by
// ~16x — it would never trip when it should. An unknown model falls back to
// gpt-4o pricing on purpose (the pricier side), so the cap errs toward stopping
// early rather than overspending.
const MODEL_PRICE_CENTS_PER_MTOKEN: Record<string, { in: number; out: number }> = {
  'gpt-4o': { in: 250, out: 1000 }, // $2.50 in / $10.00 out per 1M tokens
  'gpt-4o-mini': { in: 15, out: 60 }, // $0.15 in / $0.60 out per 1M tokens
}

/** Which model a route bills against — mirrors the routes' own model selection
 *  (extract/summarize → gpt-4o; everything else → AI_MODEL || gpt-4o-mini).
 *  Kept here so cost accounting stays correct without touching each route. */
function modelForRoute(route: string): string {
  if (route === 'extract') return process.env.AI_EXTRACT_MODEL || 'gpt-4o'
  if (route === 'summarize') return process.env.AI_SUMMARIZE_MODEL || 'gpt-4o'
  return process.env.AI_MODEL || 'gpt-4o-mini'
}

export function estimateCostCents(
  tokensIn: number,
  tokensOut: number,
  model = 'gpt-4o',
): number {
  const price =
    MODEL_PRICE_CENTS_PER_MTOKEN[model] ?? MODEL_PRICE_CENTS_PER_MTOKEN['gpt-4o']
  const cents =
    (tokensIn / 1_000_000) * price.in + (tokensOut / 1_000_000) * price.out
  return Math.max(1, Math.round(cents)) // round up to at least 1 cent so tiny calls still register
}

/**
 * Fire-and-forget: report token usage to synqed-core for the daily $-cap.
 *
 * NOTE: transcription (Deepgram) is billed per-MINUTE, not per-token, so it
 * never calls this — the spend cap currently does NOT include Deepgram cost
 * (the dominant cost at 60–90 min sessions). Adding duration-based Deepgram
 * accounting is a synqed-core follow-up so the cap reflects true spend.
 */
export async function reportAiUsage(
  route: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  try {
    const synqed = await getSynqedClient()
    const cost = estimateCostCents(tokensIn, tokensOut, modelForRoute(route))
    await synqed.aiRateLimit.recordUsage(route, tokensIn, tokensOut, cost)
  } catch (err) {
    console.warn('[ai-usage] failed to report usage:', err)
  }
}
