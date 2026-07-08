// ─────────────────────────────────────────────────────────────────────────
// Coaching LLM provider — the flip between Anthropic and OpenAI
// ─────────────────────────────────────────────────────────────────────────
// The coaching prompts can run on EITHER Anthropic (Claude) or OpenAI (ChatGPT).
// Liam's call: support both, flip via config, and keep the two API keys clearly
// LABELLED and separate so they never get mixed up. This file is the pure seam —
// the provider decision + the model-tier mapping. The actual API calls are in
// call.ts, dispatched off resolveCoachingProvider().
//
// ── The two keys, labelled (env) ──
//   OPENAI_API_KEY       — the ChatGPT / OpenAI key (the app already uses this).
//   ANTHROPIC_API_KEY    — the Claude / Anthropic key (add when using Anthropic).
//   KARUTE_COACHING_PROVIDER = 'openai' | 'anthropic'  — the flip. Omit to
//     auto-pick: whichever key is present, defaulting to openai (the app's default).
//
// ── Why a map, not a hardcoded model id ──
// The prompt modules tag a config.model with a CANONICAL tier value (the two in
// COACHING_MODELS: 'claude-sonnet-5' = the heavier judgment tier, the haiku id =
// the fast realtime tier). resolveCoachingModelId translates that canonical tier
// into the right model id for the ACTIVE provider — so flipping providers never
// touches a prompt module. Every id is env-overridable so ops can tune a tier
// without a code change.

export type CoachingProvider = 'openai' | 'anthropic'

const REASON_CANONICAL = 'claude-sonnet-5'
const REALTIME_CANONICAL = 'claude-haiku-4-5-20251001'

/** Which provider serves coaching LLM calls right now. Explicit flag wins; else
 *  prefer whichever key is present; default openai (the app's existing provider). */
export function resolveCoachingProvider(): CoachingProvider {
  const flag = (process.env.KARUTE_COACHING_PROVIDER ?? '').trim().toLowerCase()
  if (flag === 'anthropic') return 'anthropic'
  if (flag === 'openai') return 'openai'
  if (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) return 'anthropic'
  return 'openai'
}

/** The API key for a provider — labelled, never crossed. Undefined ⇒ not configured. */
export function coachingApiKey(provider: CoachingProvider): string | undefined {
  return provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
}

// canonical tier → per-provider model id. Env-overridable per (tier, provider).
const MODEL_MAP: Record<string, Record<CoachingProvider, string>> = {
  [REASON_CANONICAL]: {
    anthropic: process.env.KARUTE_COACHING_MODEL_REASON_ANTHROPIC || 'claude-sonnet-5',
    openai: process.env.KARUTE_COACHING_MODEL_REASON_OPENAI || 'gpt-4o',
  },
  [REALTIME_CANONICAL]: {
    anthropic: process.env.KARUTE_COACHING_MODEL_REALTIME_ANTHROPIC || 'claude-haiku-4-5-20251001',
    openai: process.env.KARUTE_COACHING_MODEL_REALTIME_OPENAI || 'gpt-4o-mini',
  },
}

/** Translate a prompt module's canonical model tier into the id for `provider`.
 *  An unknown value passes through unchanged (so a bespoke id still works). */
export function resolveCoachingModelId(canonicalModel: string, provider: CoachingProvider): string {
  return MODEL_MAP[canonicalModel]?.[provider] ?? canonicalModel
}
