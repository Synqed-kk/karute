import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '@/lib/openai'
import type { MemoryItem, MemoryDeltaOp } from './memory-types'
import type { BusinessAiPersona } from './business-ai-tokens'
import { resolvePersonaTokens, clinicalGuardrail } from './business-ai-tokens'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'

const DeltaSchema = z.object({
  ops: z
    .array(
      z.object({
        action: z.enum(['add', 'update', 'remove']),
        id: z.string().nullable().describe('existing item id — required for update/remove, null for add'),
        category: z
          .enum(['personal', 'body', 'preference', 'goal', 'lifestyle'])
          .nullable(),
        label: z.string().nullable().describe('short durable fact, ≤30 chars (e.g. 愛犬チビ(柴犬))'),
        detail: z.string().nullable().describe('context, ≤120 chars'),
        confidence: z.number().nullable().describe('0.70–1.0; below 0.70 do NOT emit'),
        suggestTalkingPoint: z
          .boolean()
          .nullable()
          .describe('true ONLY for warm next-visit openers (pets/family/trips); never for body/sensitive items'),
      }),
    )
    .describe('Reconciliation ops vs the existing memory. Empty array if nothing durable to add/change.'),
})

/**
 * The spike's §11 Customer Memory Extractor, adapted for OpenAI + a delta schema.
 * Reads one or more session transcripts + the existing memory and emits an
 * add/update/remove delta of DURABLE facts. Grounded — never invents. Used both
 * on save (one new transcript) and to backfill an existing customer (several
 * transcripts at once). Best-effort: [] on any failure.
 */
export async function extractCustomerMemory(params: {
  transcripts: string[]
  existing: MemoryItem[]
  persona: BusinessAiPersona
  locale: string
}): Promise<MemoryDeltaOp[]> {
  const { transcripts, existing, persona, locale } = params
  const joined = transcripts.filter((t) => t && t.trim()).join('\n\n---\n\n').trim()
  if (!joined) return []

  try {
    if (!process.env.OPENAI_API_KEY) return []
    const tok = resolvePersonaTokens(persona, locale)
    const langInstruction =
      locale === 'ja' ? '日本語で出力してください。' : 'Respond entirely in English.'

    const system = `You are a memory curator for a ${tok.businessNoun} (focus: ${tok.primaryFocus}). You read a session transcript and the customer's existing memory, then emit a JSON delta that reconciles them.

A "memory item" is a DURABLE fact worth remembering ACROSS visits — NOT today's treatment notes (those live on the karute). Five categories:
- personal: family / pets / travel / hobbies / life events — anything warm to reference next visit ("愛犬チビ 柴犬", "娘のりなが空手を開始", "先月ハワイ旅行", "来月結婚").
- body: persistent body state / pattern relevant to ${tok.primaryFocus}.
- preference: treatment / product / service preferences.
- goal: what the customer is trying to achieve ("結婚式までに姿勢改善").
- lifestyle: job / stress / routine that shapes treatment.

Rules:
1. GROUNDING: emit ONLY facts explicitly stated in the transcript. NEVER infer or invent. If nothing durable was said, return { "ops": [] }.
2. Per item, action = "add" (new), "update" (an existing item's detail refined / confidence changed), or "remove" (an existing item the transcript contradicts).
3. NEVER emit update/remove for an item whose source is "staff" or "intake_form" — those are human-owned. Only touch source="ai_extraction".
4. Do NOT duplicate an existing item (any source) — if the fact is already there unchanged, emit nothing for it.
5. confidence: 0.95+ said explicitly/repeated; 0.80–0.95 said once clearly; 0.70–0.80 reasonable; BELOW 0.70 do NOT emit.
6. suggestTalkingPoint = true ONLY for warm next-visit openers (pets, family milestones, trips, hobbies). NEVER for body issues, goals, or sensitive topics (illness, caregiving stress).
7. label ≤30 chars; detail ≤120 chars. ${langInstruction}
8. PRIVACY (個人情報保護法): NEVER store phone numbers, emails, full addresses, payment details, or ID numbers.
9. Medical: ${clinicalGuardrail(persona.clinicalPosture, locale)}

${defensivePreamble(locale)}`

    const existingForModel = existing.map((m) => ({
      id: m.id,
      category: m.category,
      label: m.label,
      detail: m.detail,
      source: m.source,
    }))

    const user = `Existing memory (reconcile against this; do not duplicate; only update/remove source="ai_extraction"):
${existing.length ? wrapUntrustedContent('existing_memory', JSON.stringify(existingForModel)) : '(none yet)'}

Session transcript(s):
${wrapUntrustedContent('transcript', joined)}

Emit the delta.`

    const completion = await openai.chat.completions.parse({
      // DEDICATED env so memory extraction (reads FULL transcripts — the most
      // token-heavy AI path) can run on a cheaper model (e.g. gpt-4o-mini) for
      // cost WITHOUT downgrading extract/summary. Falls back to the shared
      // AI_MODEL, then gpt-4o.
      model: process.env.AI_MEMORY_MODEL || process.env.AI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: zodResponseFormat(DeltaSchema, 'memory_delta'),
      temperature: 0.2,
    })

    const parsed = completion.choices[0]?.message?.parsed
    return (parsed?.ops ?? []) as MemoryDeltaOp[]
  } catch (err) {
    console.error('[extractCustomerMemory] failed:', err)
    return []
  }
}
