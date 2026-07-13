// ─────────────────────────────────────────────────────────────────────────
// Coaching LLM call — one interface, two providers (Anthropic + OpenAI)
// ─────────────────────────────────────────────────────────────────────────
// Every coaching prompt is called through callCoachingModel(). It resolves the
// active provider + the right model id (provider.ts) and dispatches to that
// provider's adapter. Flip providers with KARUTE_COACHING_PROVIDER; nothing in a
// prompt module changes.
//
// ⚠ VERIFICATION STATUS (honest): provider.ts (the flip + model map) is pure and
// unit-tested. These two ADAPTERS are written to each API's documented contract but
// have NOT been run against a live key from here (no keys in this env). Before this
// serves real traffic, Anthony must smoke-test each provider once against a real key
// — treat the adapters as correct-by-construction, not yet validated. Dormant until
// then, like the rest of the coaching system.
//
// Schema note: my prompt output schemas use JSON-schema features (maxItems, nullable
// via anyOf) that OpenAI's STRICT structured-output mode rejects, so the OpenAI
// adapter sends the schema in non-strict mode and relies on the app-side validation
// the prompt headers already require. Anthropic gets the schema described in-prompt
// (every prompt already ends with "Output JSON only matching the schema") and the
// text is parsed. Both paths therefore need the same downstream Zod/JSON-schema
// validation on receipt — never trust the raw parse.

import { openai } from '@/lib/openai'

import {
  resolveCoachingProvider,
  resolveCoachingModelId,
  coachingApiKey,
  type CoachingProvider,
} from './provider'

export interface CoachingModelCall {
  /** The prompt module's canonical model tier (config.model). */
  canonicalModel: string
  system: string
  user: string
  maxTokens: number
  /** JSON schema for the structured output + a short name for it. */
  schema: Record<string, unknown>
  schemaName: string
}

/** Call the active coaching provider and return the parsed JSON object. The caller
 *  MUST still validate the result against `schema` (see the schema note above). */
export async function callCoachingModel(call: CoachingModelCall): Promise<unknown> {
  const provider = resolveCoachingProvider()
  const model = resolveCoachingModelId(call.canonicalModel, provider)
  const raw = provider === 'anthropic' ? await callAnthropic(model, call) : await callOpenAI(model, call)
  return parseJsonLoose(raw)
}

// ── OpenAI adapter (uses the app's existing shared client) ────────────────────
async function callOpenAI(model: string, call: CoachingModelCall): Promise<string> {
  const completion = await openai.chat.completions.create({
    model,
    max_tokens: call.maxTokens,
    messages: [
      { role: 'system', content: call.system },
      { role: 'user', content: call.user },
    ],
    // Non-strict: our schemas carry maxItems etc. that strict mode rejects; the
    // app-side validation on receipt is the real guard.
    response_format: {
      type: 'json_schema',
      json_schema: { name: call.schemaName, schema: call.schema, strict: false },
    },
  })
  return completion.choices[0]?.message?.content ?? ''
}

// ── Anthropic adapter (dependency-free; fetch to the Messages API) ────────────
async function callAnthropic(model: string, call: CoachingModelCall): Promise<string> {
  const apiKey = coachingApiKey('anthropic')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: call.maxTokens,
      system: call.system,
      messages: [{ role: 'user', content: call.user }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  return data.content?.find((b) => b.type === 'text')?.text ?? ''
}

/** Parse a model's JSON output, tolerating ```json fences some models wrap it in. */
function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  return JSON.parse(trimmed)
}

export type { CoachingProvider }
