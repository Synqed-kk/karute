import { NextResponse } from 'next/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { AppApiError } from '@/lib/app-api/errors'

type RateLimitClient = Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'aiRateLimit'>

function limitMessage(reason: string, costCap: number): string {
  return reason === 'daily_cost'
    ? `Daily AI spend cap of ${(costCap / 100).toFixed(2)} USD reached`
    : 'Hourly AI request cap reached'
}

/** Consume one AI request against the daily/hourly cap on an EXPLICIT
 *  business-scoped client — the accounting seam shared by the cookie routes and
 *  the facade Bearer path (packet 07 §Build 3). Throws a classified `rate_limited`
 *  (→ 429) so the facade error mapper handles it; the legacy NextResponse variant
 *  below wraps the SAME consume so extract/summarize never bill via two paths. */
export async function enforceAiRateLimitWithClient(
  synqed: RateLimitClient,
  route: string,
): Promise<void> {
  const result = await synqed.aiRateLimit.consume(route)
  if (result.allowed) return
  throw new AppApiError('rate_limited', limitMessage(result.reason, result.costCap), {
    reason: result.reason,
    cap: result.cap,
    cost_cap_cents: result.costCap,
    cost_used_cents: result.costUsed,
    retry_at: result.resetAt,
  })
}

export async function enforceAiRateLimit(route: string): Promise<NextResponse | null> {
  const synqed = await getSynqedClient()
  const result = await synqed.aiRateLimit.consume(route)
  if (result.allowed) return null
  return NextResponse.json(
    {
      error: limitMessage(result.reason, result.costCap),
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

// ── Transcription (per-MINUTE) cost ─────────────────────────────────────────
// Deepgram nova-3 ja is $0.0043/min pay-as-you-go with diarization included
// (pricing page, read 2026-09-08) = 0.43 ¢/min. Rounded UP to 0.5, for the same
// reason the token estimator falls back to gpt-4o pricing above: the cap must
// err toward stopping early rather than overspending.
export const DEEPGRAM_CENTS_PER_MINUTE = 0.5

/** Cents for one transcription, from the audio's own length. Rounded up, and
 *  never below 1 ¢ — the same "tiny calls still register" rule
 *  estimateCostCents applies to tokens. */
export function estimateTranscriptionCostCents(durationSec: number): number {
  return Math.max(1, Math.ceil((durationSec / 60) * DEEPGRAM_CENTS_PER_MINUTE))
}

/** The waits BETWEEN the three attempts below. Short on purpose: the caller is
 *  a request or a job holding a claim, and core answering slowly is the common
 *  case this is here for — not an outage, which the third failure records. */
const DEBIT_RETRY_WAITS_MS = [250, 750]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Report ONE transcription's minutes to synqed-core, as cents, against the same
 * rolling daily $-cap consume() enforces (core's ai_request_log — a
 * `transcribe:usage` row, no tokens). Returns whether the debit LANDED.
 *
 * THREE ATTEMPTS (fix round 2, Greptile P1). A single failed call used to lose
 * the money silently: the cap under-counts by that recording for a rolling 24 h,
 * and a run of them is exactly the outage during which the wall stops holding.
 * A blip now costs 250 ms and then 750 ms instead of a spend nobody counted.
 *
 * NEVER THROWS, deliberately, even after the third failure — and since fix
 * round 4 the CALLER decides what a `false` means, because it is called twice
 * now and the two moments are not the same:
 *
 *   BEFORE the provider (the reserve) — nothing has been spent yet, so a
 *   `false` REFUSES: runMeteredTranscription throws `upstream_unavailable` and
 *   the provider is never reached.
 *
 *   AFTER the provider (the true-up) — the money is already spent, so a
 *   `false` is FLAGGED, never re-thrown: failing the caller here would send the
 *   whole recording back through Deepgram on the next retry, paying twice to
 *   report once. ⚖ That is the ruling: a lost debit is written down (the
 *   console line below, and `debit_recorded: false` on the caller's audit row).
 */
export async function reportTranscriptionUsageWithClient(
  synqed: RateLimitClient,
  costCents: number,
): Promise<boolean> {
  let err: unknown
  for (let attempt = 0; attempt < 1 + DEBIT_RETRY_WAITS_MS.length; attempt++) {
    if (attempt > 0) await sleep(DEBIT_RETRY_WAITS_MS[attempt - 1])
    try {
      await synqed.aiRateLimit.recordUsage('transcribe', null, null, costCents)
      return true
    } catch (e) {
      err = e
    }
  }
  console.error('[ai-usage] transcription debit LOST after 3 attempts:', { costCents, err })
  return false
}

/**
 * Give a transcription's RESERVE back to the ledger, as a NEGATIVE row on the
 * same route: core's `recordAiUsage` stores the integer exactly as it is given
 * and `consume` SUMs that column over the rolling 24 h
 * (synqed-core `src/services/ai-rate-limit.service.ts` — the `_sum: { costCents }`
 * aggregate and the `create` beneath it), so `-reserveCents` subtracts the
 * reserve back out of the very number the cap is computed from. No refund call
 * was invented and no core change was needed; the hourly count is untouched,
 * because it only counts rows whose cents are null.
 *
 * ⚖ RELEASE, NOT REFUND: this runs only when the provider call itself threw —
 * the money was not spent (a failed request is not billed; a client-side
 * timeout after the server finished is the accepted residual: one estimate,
 * once). A SUCCESSFUL call is never refunded, whatever the estimate was (the
 * no-refund ruling).
 *
 * The three attempts and the never-throws rule are the reporter's above, and
 * for the same reason — but a `false` here is the SAFE direction: the reserve
 * simply stays, and an over-count errs toward stopping early, which is the
 * ruling the unknown-duration floor and the gpt-4o price fallback already
 * follow. So it is written down and nothing else happens.
 */
export async function releaseTranscriptionReserveWithClient(
  synqed: RateLimitClient,
  reserveCents: number,
): Promise<boolean> {
  // Never a POSITIVE "release". A reserve that is not a whole positive number
  // of cents is nothing to give back, and writing one anyway would ADD to the
  // very cap this call claims to relieve.
  if (!Number.isInteger(reserveCents) || reserveCents <= 0) return true
  let err: unknown
  for (let attempt = 0; attempt < 1 + DEBIT_RETRY_WAITS_MS.length; attempt++) {
    if (attempt > 0) await sleep(DEBIT_RETRY_WAITS_MS[attempt - 1])
    try {
      await synqed.aiRateLimit.recordUsage('transcribe', null, null, -reserveCents)
      return true
    } catch (e) {
      err = e
    }
  }
  console.error('[ai-usage] reserve RELEASE lost after 3 attempts:', { reserveCents, err })
  return false
}

/**
 * Fire-and-forget: report token usage to synqed-core for the daily $-cap.
 *
 * Transcription (Deepgram) is billed per-MINUTE, not per-token, so it does not
 * come through here — it reports through reportTranscriptionUsageWithClient
 * above, into the SAME ledger, so the cap now DOES include Deepgram cost (the
 * dominant cost at 60–90 min sessions). No core change was needed:
 * recordUsage's tokens are nullable and its cents are the caller's own.
 */
export async function reportAiUsageWithClient(
  synqed: RateLimitClient,
  route: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  try {
    const cost = estimateCostCents(tokensIn, tokensOut, modelForRoute(route))
    await synqed.aiRateLimit.recordUsage(route, tokensIn, tokensOut, cost)
  } catch (err) {
    console.warn('[ai-usage] failed to report usage:', err)
  }
}

export async function reportAiUsage(
  route: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  await reportAiUsageWithClient(await getSynqedClient(), route, tokensIn, tokensOut)
}
