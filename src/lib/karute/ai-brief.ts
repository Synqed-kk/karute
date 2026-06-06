import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { KaruteRecord } from '@synqed-kk/client'
import { openai } from '@/lib/openai'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { getOrgSettings } from '@/actions/org-settings'
import {
  getBusinessAiPersona,
  resolvePersonaTokens,
  clinicalGuardrail,
} from '@/lib/karute/business-ai-tokens'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'
import type { PreSessionBrief } from '@/components/karute/redesign/record/PreSessionBriefCard'

// The AI generates these fields; the dates / memo / first-visit flag are computed
// mechanically and merged in. zodResponseFormat enforces the shape on the model.
// IMPORTANT: these .describe() strings ship to the model via zodResponseFormat,
// so they MUST stay aligned with the system-prompt Rules block below — if they
// drift, the schema description silently overrides the rules.
const AiBriefSchema = z.object({
  memoAnalysis: z
    .array(z.string())
    .describe(
      "The AI's READ of the booking memo — NOT a restatement (staff already see the raw memo directly above this). Surface only what a quick skim misses: (a) cautions for today (注意点), ESPECIALLY by cross-referencing a stated symptom against a requested treatment; (b) changes/contradictions — a symptom they stopped or started mentioning, or a want-vs-need mismatch; (c) expectation + communication tone (期待/トーン) ONLY if it changes how staff should act. Each bullet must add insight, never paraphrase. Max 3. Empty array if there is no memo OR the memo is purely operational (e.g. ticket renewal).",
    ),
  hooks: z
    .array(z.object({ title: z.string(), body: z.string().nullable() }))
    .describe(
      'Genuine personal rapport openers ONLY (pets/family/hobbies/travel/life events). Operational/scheduling/payment/booking/package notes and symptoms are NOT hooks — exclude them. A family word alone is not a hook (only when it is about that person’s life/event). Empty if no real small-talk material; never fabricate.',
    ),
  concerns: z
    .array(z.string())
    .describe(
      "Concern TRAJECTORY across ALL provided sessions (labelled 'Session <date>:', ordered OLDEST→NEWEST, last line = most recent), most relevant first, in the business's vocabulary: what persists / is improving / is newly raised. Note a direction (継続/改善/悪化/新規) ONLY when two dated sessions actually show it — never infer direction from a single session or summary. With only one session, just carry unresolved concerns forward. Judge only within the sessions shown. Empty if none.",
    ),
  lastProduct: z
    .object({ name: z.string(), reaction: z.string().nullable() })
    .nullable()
    .describe('The most recent product/service offered + the customer reaction, if any. Null if none.'),
  recommendedFocus: z
    .string()
    .nullable()
    .describe('1-2 sentences: today’s focus, grounded in the concern trajectory + memo, in the business vocabulary. Prioritise newly-raised concerns and any that have stalled or worsened. Null if nothing to suggest.'),
})

type AiBrief = z.infer<typeof AiBriefSchema>

function formatLastVisit(iso: string, locale: string, now: Date): { date: string; ago: string } {
  const dt = new Date(iso)
  const date = dt.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const days = Math.max(0, Math.round((now.getTime() - dt.getTime()) / 86_400_000))
  return { date, ago: locale === 'ja' ? `${days}日前` : `${days}d ago` }
}

// Build the karute context the model reads — most-recent record's entries (the
// only one fetched with include_entries) + summaries of the rest.
function buildContext(records: KaruteRecord[]): string {
  // Oldest → newest so the model reads the timeline chronologically and the
  // "direction" instruction can't invert. Entries attach to whichever record
  // carries them (getCustomerKaruteRecords fetches entries for the most recent).
  return [...records]
    .reverse()
    .map((r) => {
      const when = r.created_at?.slice(0, 10) ?? ''
      const summary = r.ai_summary ?? '(no summary)'
      const entries = r.entries?.length
        ? '\n' + r.entries.map((e) => `  [${String(e.category)}] ${e.content}`).join('\n')
        : ''
      return `Session ${when}: ${summary}${entries}`
    })
    .join('\n\n')
}

export interface PreSessionBriefResult extends PreSessionBrief {
  /** AI analysis of the booking memo (兆候/期待/トーン/注意点). */
  memoAnalysis: string[]
}

/**
 * The AI pre-session brief: reads the QR reservation memo + the customer's past
 * karute + the business-type persona, and synthesises the staff-skimmable brief
 * via one OpenAI call. Business-type-aware (整体 talks 姿勢/骨盤, a gym talks
 * 可動域/体組成). Cached 1 day per (customer, memo, locale). Returns null on any
 * failure so the caller falls back to the mechanical brief — never blocks the page.
 */
export async function getAiPreSessionBrief(params: {
  customerId: string
  customerName: string
  visitCount: number
  records: KaruteRecord[]
  reservationMemo: string | null
  locale: string
  now: Date
}): Promise<PreSessionBriefResult | null> {
  const { customerId, customerName, visitCount, records, reservationMemo, locale, now } = params

  // First visit = no prior karute AND no prior visits anywhere (QR visit_count).
  // A 50回券 holder with 0 synqed karute is NOT 新規.
  const isFirstTimeVisit = records.length === 0 && visitCount <= 0
  const memo = reservationMemo?.trim() ? reservationMemo.trim() : null

  // Nothing to synthesise from → let the caller render the mechanical/first-visit
  // shell. (No memo + no history = the AI has no signal.)
  if (!memo && records.length === 0) return null

  const last = records.length > 0 ? records[0] : null
  const lastVisit = last ? formatLastVisit(last.created_at, locale, now) : { date: '', ago: '' }

  try {
    if (!process.env.OPENAI_API_KEY) return null

    const orgSettings = await getOrgSettings().catch(() => null)
    const persona = getBusinessAiPersona(orgSettings?.business_type)
    const tok = resolvePersonaTokens(persona, locale)

    const cacheInput = {
      // Bump when the brief prompt changes so stale cached briefs (≤24h) are
      // invalidated immediately instead of serving the old wording.
      v: 2,
      c: customerId,
      memo,
      ids: records.map((r) => r.id),
      bt: orgSettings?.business_type ?? null,
      locale,
    }
    const cached = (await getCachedAI('presession_brief', cacheInput).catch(() => null)) as AiBrief | null
    const ai = cached ?? (await generate())

    return {
      isFirstTimeVisit,
      lastVisitDate: lastVisit.date,
      lastVisitAgo: lastVisit.ago,
      reservationMemo: memo,
      memoAnalysis: ai.memoAnalysis ?? [],
      hooks: ai.hooks ?? [],
      concerns: ai.concerns ?? [],
      lastProduct: ai.lastProduct ?? null,
      recommendedFocus: ai.recommendedFocus ?? null,
    }

    async function generate(): Promise<AiBrief> {
      const langInstruction =
        locale === 'ja' ? '日本語で出力してください。' : 'Respond entirely in English.'
      const system = `You are a ${tok.role} at a ${tok.businessNoun}. Your focus: ${tok.primaryFocus}.
Before a session you read the customer's booking memo and their past karute (session records), and produce a brief the ${tok.role} can skim in 30 seconds.

Rules:
- GROUNDING: every item must be backed by the memo or the karute. NEVER invent. An empty array / null is the CORRECT answer when there is nothing real — a fabricated item is harmful.
- NON-REDUNDANCY: the staff already see the full booking memo directly above this brief. Do NOT restate or paraphrase it. For each candidate bullet ask "could the staff know this just by reading the memo above?" — if yes, DROP it. Output only what a quick read misses.
- memoAnalysis: the ${tok.role}'s READ of the memo — include only the applicable of these, never forced to fill all:
    (a) 注意点 — cautions for today, especially BY SYNTHESIS: cross-reference a stated symptom against a requested treatment and flag a risk/adjustment (e.g. memo has 胃の不調 + 内臓調整希望 → "内臓調整は強度を弱めから様子を見る"). This is the highest-value bullet — produce it whenever two memo facts interact.
    (b) change/contradiction — a symptom newly raised, dropped, or resurfacing vs the karute, or a want-vs-chief-complaint mismatch.
    (c) 期待/トーン — ONLY if it changes how staff should act today (不安げ→先に説明, せっかち→要点から). Skip if not actionable.
  Each bullet must reference a SPECIFIC fact and add insight, not paraphrase. Max 3. If nothing survives the test (trivial or purely-operational memo), return []. Empty if no memo.
- concerns: the concern TRAJECTORY across ALL sessions shown (labelled "Session <date>:", ordered OLDEST→NEWEST, last line = most recent). Surface what PERSISTS / is IMPROVING / is NEWLY raised, most relevant first. Note a direction (継続/改善/悪化/新規) ONLY when two dated sessions actually show it — with one session or no clear trend, just list current standing concerns without asserting direction. Judge only within the sessions shown; never extrapolate.
- hooks: genuine personal rapport material ONLY (pets/family/hobbies/travel/life events) — worth asking about even if the booking were cancelled. EXCLUDE operational/logistics notes: order of treatment, who is treated first, companions, scheduling, cancellations, payment, packages/回数券, staff assignment, and symptoms/treatments (those belong in concerns/memoAnalysis). A family word alone is not a hook — only when it is about that person's life/event. Empty if there is no real small-talk material — never force one.
- lastProduct: the most recent product/service offered + the customer's reaction, if present. Null otherwise.
- recommendedFocus: 1-2 sentences on today's focus, grounded in the trajectory + memo, in this ${tok.businessNoun}'s vocabulary. Prioritise newly-raised concerns and any that have stalled or worsened. Null if nothing to suggest.
- VOCABULARY: use only this ${tok.businessNoun}'s vocabulary (e.g. ${tok.primaryFocus}); do not borrow another industry's terms (e.g. do not say 施術/"treatment" for a gym). If no domain term fits, use the customer's own words.
${tok.typicalConcerns ? `Common concerns at this kind of business: ${tok.typicalConcerns}.` : ''}
${clinicalGuardrail(tok.clinicalPosture, locale)}
${langInstruction}

${defensivePreamble(locale)}`

      const userParts = [
        `Customer: ${customerName} (visits so far: ${visitCount})`,
        memo
          ? `Booking memo (the customer's / front-desk's own words):\n${wrapUntrustedContent('reservation_memo', memo)}`
          : 'Booking memo: (none)',
        records.length > 0
          ? `Past karute (most recent first):\n${wrapUntrustedContent('karute_history', buildContext(records))}`
          : 'Past karute: (none recorded in the system yet)',
      ]

      const completion = await openai.chat.completions.parse({
        model: process.env.AI_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userParts.join('\n\n') },
        ],
        response_format: zodResponseFormat(AiBriefSchema, 'presession_brief'),
        temperature: 0.3,
      })
      const parsed = completion.choices[0]?.message?.parsed
      const result: AiBrief = parsed ?? {
        memoAnalysis: [],
        hooks: [],
        concerns: [],
        lastProduct: null,
        recommendedFocus: null,
      }
      await setCachedAI('presession_brief', cacheInput, result, 1).catch(() => {})
      return result
    }
  } catch (err) {
    console.error('[getAiPreSessionBrief] failed:', err)
    return null
  }
}
