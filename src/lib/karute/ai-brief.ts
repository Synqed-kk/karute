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
const AiBriefSchema = z.object({
  memoAnalysis: z
    .array(z.string())
    .describe(
      'Bullets analysing the booking memo — the signals/concerns (兆候), expectations (期待), tone (トーン), and points to watch before treatment (注意点). Empty array if there is no memo.',
    ),
  hooks: z
    .array(z.object({ title: z.string(), body: z.string().nullable() }))
    .describe('Warm conversation openers from personal details the customer mentioned (pets/family/hobbies/events). Empty if none — never invent.'),
  concerns: z
    .array(z.string())
    .describe("Carried-over concerns from past sessions, most relevant first, in the business's vocabulary. Empty if none."),
  lastProduct: z
    .object({ name: z.string(), reaction: z.string().nullable() })
    .nullable()
    .describe('The last product/service offered + the customer reaction, if any. Null if none.'),
  recommendedFocus: z
    .string()
    .nullable()
    .describe('1-2 sentences: what to focus on today, grounded in the history + memo. Null if nothing to suggest.'),
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
  return records
    .map((r, i) => {
      const when = r.created_at?.slice(0, 10) ?? ''
      const summary = r.ai_summary ?? '(no summary)'
      const entries =
        i === 0 && r.entries?.length
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
- Extract ONLY what is grounded in the provided data. NEVER invent facts.
- memoAnalysis: read the booking memo and surface the customer's signals/concerns (兆候), expectations (期待), tone (トーン), and any points to watch before treatment (注意点). Concise bullets. Empty array if there is no memo.
- concerns: carry-over concerns from past sessions, most relevant first. Use this business's vocabulary.
- hooks: warm openers from personal details (pets/family/hobbies/recent events). Empty if none — do NOT fabricate small talk.
- lastProduct: the last product/service offered + reaction, if present. Null otherwise.
- recommendedFocus: 1-2 sentences on what to focus on today, grounded in the history + memo.
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
