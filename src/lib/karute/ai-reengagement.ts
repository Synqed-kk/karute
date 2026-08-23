import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { KaruteRecord, SynqedClient } from '@synqed-kk/client'
import { openai } from '@/lib/openai'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { getOrgSettings, orgSettingsWithClient, type OrgSettings, type AIVoiceStyle } from '@/actions/org-settings'
import {
  getBusinessAiPersona,
  resolvePersonaTokens,
  clinicalGuardrail,
  type ClinicalPosture,
} from '@/lib/karute/business-ai-tokens'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'
import { cleanNameToken } from '@/lib/karute/prompt-fragments'
import { effectiveSummary } from '@/lib/karute/effective-summary'
import { getCustomerKaruteRecords, getCustomerKaruteRecordsWithClient } from '@/actions/karute'
import { getBodyPrediction, getBodyPredictionWithClient } from '@/lib/karute/ai-body-prediction'
import { getCustomerMemory } from '@/lib/karute/customer-memory'
import type { MemoryItem } from '@/lib/karute/memory-types'
import type { CustomerStatusKey } from '@/components/customers/redesign/types'
import { audit } from '@/lib/audit'
import { auditWeb } from '@/lib/audit-web'

// AI再エンゲージメント — the customer-profile win-back draft (AI_PROMPTS.md
// §13). Mirrors ai-outreach.ts structurally: Core/WithClient split, a plan
// gate before any AI call, a content-keyed 1-day cache, and a success-only
// 生成 audit row emitted from a private auditLockout-pattern helper (never a
// cache hit, never a gated null). Own constants — this surface's cache key
// and prompt version are independent of KARUTE_PROMPT_VERSION (that constant
// is shared by the passport/summary/extraction prompts; bumping it blanks
// every customer's これまで box — 2026-07-15 incident. Deliberately NOT
// imported here — prompt-safety pin, see the test suite).
const CACHE_PREFIX = 'reengagement_draft'
const REENGAGEMENT_PROMPT_VERSION = 1

/** ⚖ 8/23: becomes an org setting (follow-up PR); Liam may shorten. Aligned
 *  to status-signals.ts's existing 要フォロー boundary (`daysSince > 60`, i.e.
 *  61+) so this card never runs on a different recency scale than the
 *  status chip the rest of the app already shows for the same customer. */
export const REENGAGE_NUDGE_MIN_DAYS = 61

export type ReengagementTier = 'overdue' | 'dormant'

export interface ReengagementSignal {
  kind: 'memory_item' | 'session' | 'elapsed_time' | 'prediction'
  label: string
}

export interface ReengagementDraft {
  draft: string
  reasoning: string
  signals: ReengagementSignal[]
  tier: ReengagementTier
}

export interface ReengagementParams {
  customerId: string
  customerName: string
  /** customer.status (resolveCustomerStatus) — terminal/booked/new hard
   *  excludes read this, never a re-derived day count. */
  status: CustomerStatusKey
  visitCount: number
  /** CustomerProfileData.visitPace.lastVisitAgoDays. */
  lastVisitAgoDays: number | null
  preferredStaffName: string | null
  hasUpcomingBooking: boolean
  locale: string
}

const OutputSchema = z.object({
  draft: z
    .string()
    .describe(
      'The full message body, copy-paste ready. Grounded ONLY in the memory/session/prediction context provided — never invent facts, prices, or offers. Open with the honorific/name form the system prompt specifies.',
    ),
  reasoning: z
    .string()
    .describe(
      '1-2 sentences for staff: what from the history drove this draft. Shown in a "why this message?" disclosure.',
    ),
  signals: z
    .array(
      z.object({
        kind: z.enum(['memory_item', 'session', 'elapsed_time', 'prediction']),
        label: z.string().describe('Short display text — staff scans this for correctness.'),
      }),
    )
    .describe('Structured list of evidence actually referenced in the draft, in the order used.'),
})

/** Tone-only bucket once the gate has already ruled the customer eligible.
 *  hasHistory is kept for signature parity with the spike's history-based
 *  no_history branch (reengagement-draft.ts:135) — unreachable here because
 *  the status gate excludes new/zero-history customers before this ever
 *  runs, so it drives no branch. */
export function reengagementTier(
  lastVisitAgoDays: number | null,
  hasHistory: boolean,
): ReengagementTier {
  void hasHistory
  return lastVisitAgoDays !== null && lastVisitAgoDays < 90 ? 'overdue' : 'dormant'
}

/** Memory item priority for THIS surface's prompt + cache key: pinned first,
 *  then body/goal (§13's own stated priority — "especially body + goal
 *  categories, pinned items first"), then talking-points, then the rest.
 *  Same STRUCTURE as ai-brief.ts formatMemory's rank() (ai-brief.ts:134-135)
 *  with body/preference swapped for body/goal — that file ranks for the
 *  session-scoped brief, this ranks for the lifecycle-scoped draft. */
function rankMemoryItem(m: MemoryItem): number {
  if (m.pinned) return 0
  if (m.category === 'body' || m.category === 'goal') return 1
  if (m.suggestTalkingPoint) return 2
  return 3
}

function formatMemoryForPrompt(items: MemoryItem[]): string {
  if (items.length === 0) return '(no memory recorded)'
  return items
    .map(
      (m) =>
        `[${m.category}${m.pinned ? '/PINNED' : ''}] ${m.label}${m.detail ? ` — ${m.detail}` : ''}`,
    )
    .join('\n')
}

function formatSessionsForPrompt(dated: KaruteRecord[]): string {
  const top5 = dated.slice(0, 5)
  if (top5.length === 0) return '(no session history)'
  return top5
    .map((r) => `${r.created_at?.slice(0, 10)}: ${effectiveSummary(r) ?? '(no summary)'}`)
    .join('\n')
}

const VOICE_RULE_JA: Record<AIVoiceStyle, string> = {
  formal: '丁寧（敬語を使い、「させていただく」等の謙譲表現を交える）',
  polite: '標準（丁寧語・です／ます。重い敬語は使わない）',
  friendly: '親しみ（カジュアルなです／ます。距離感の近い言い回し）',
}
const VOICE_RULE_EN: Record<AIVoiceStyle, string> = {
  formal: 'formal (respectful, keigo-equivalent register)',
  polite: 'polite (standard desu/masu, no heavy honorifics)',
  friendly: 'friendly (casual desu/masu, a warmer/closer register)',
}

function buildSystemPrompt(opts: {
  locale: string
  tier: ReengagementTier
  voiceStyle: AIVoiceStyle
  customerName: string
  businessNoun: string
  role: string
  typicalConcerns: string
  clinicalPosture: ClinicalPosture
}): string {
  const { locale, tier, voiceStyle, customerName, businessNoun, role, typicalConcerns, clinicalPosture } = opts
  const ja = locale === 'ja'
  if (ja) {
    return `あなたは${businessNoun}のために、お客様への再エンゲージメッセージ（LINE／SMS／メール）を、${role}に代わって下書きするAIです。スタッフが送信前に必ず確認・編集します。

【ルール】
- 特定のスタッフがこのお客様を覚えていて書いているように書く。ブランドが一斉配信するテンプレートのように読ませない。
- 声のトーン＝${VOICE_RULE_JA[voiceStyle]}
- セールスより共感を優先する。押しつけがましくしない。
- お客様メモリーやセッション履歴から具体的な話題を1〜2点、必ず引用する。「お久しぶりです、キャンペーン中です」のような一般的な文面は不可。
- 経過期間と履歴から、お客様が今どう感じていそうか、${businessNoun}の言葉で共感的に推測する。${typicalConcerns ? `よくある関心：${typicalConcerns}。` : ''}
- 診断はしない：${clinicalGuardrail(clinicalPosture, 'ja')}
- 価格・割引・キャンペーンコードは書かない（スタッフが個別に案内する）。
- 実在しないサービス・商品・イベントを作らない。
- 起きていないことについて謝らない。
- 絵文字は基本使わない（声のトーンが「親しみ」の場合のみ最大1つ）。
- 「[UNSURE]」等のマーカーは、本当に確信が持てない場合のみ使う。
- 長さ：2〜4文、80〜200文字程度。
- 書き出しは「${customerName}様」から始める。
- ${
      tier === 'dormant'
        ? '90日以上のご無沙汰向けの文面にする：罪悪感を与えず、温かく再接続する。'
        : '46〜89日のご無沙汰向けの文面にする：季節の変わり目など自然な理由で、気にかけている旨を伝える。'
    }
- このメッセージはスタッフが電話で読み上げる場合がある。声に出して読んだときに自然に聞こえる文章にする。
- 低圧的な一文で締め、次回来店を促す。命令形は使わない。

${defensivePreamble('ja')}`
  }
  return `You draft a personal re-engagement message (LINE / SMS / email) for a ${businessNoun}, written as if from the ${role}. Staff always review and edit before sending.

Rules:
- Sound like a specific staff member who remembers this person — never a brand broadcasting a template.
- Tone = ${VOICE_RULE_EN[voiceStyle]}
- Empathy over sales. Never pushy.
- Reference 1-2 SPECIFIC things from the customer's memory or session history. Generic messages ("It's been a while, we're running a promotion") are rejected.
- Make an empathetic guess at how the customer might be feeling now, grounded in ${businessNoun} vocabulary.${typicalConcerns ? ` Common concerns: ${typicalConcerns}.` : ''}
- Never diagnose: ${clinicalGuardrail(clinicalPosture, locale)}
- No pricing, discounts, or campaign codes — staff adds those.
- No made-up services, products, or events.
- No apologizing for things that didn't happen.
- No emoji unless the tone is "friendly" (then max 1).
- No "[UNSURE]" markers unless genuinely uncertain about a claim.
- Length: 2-4 sentences, 200-500 characters.
- Open with "Hi ${customerName}," style addressing.
- ${
    tier === 'dormant'
      ? "90+ days since their last visit — warm reconnect, no guilt."
      : '46-89 days since their last visit — a caring check-in (a seasonal shift or similar natural reason works well).'
  }
- This message may be read aloud by staff over the phone — write it so it sounds natural spoken aloud, not only when read silently.
- Close with a low-pressure invitation to return. Never imperative.

${defensivePreamble(locale)}`
}

async function computeReengagementDraft(
  params: ReengagementParams,
  resolveOrgSettings: () => Promise<OrgSettings | null>,
  checkReengagementAllowed: () => Promise<boolean>,
  fetchKaruteRecords: () => Promise<KaruteRecord[]>,
  fetchPrediction: (records: KaruteRecord[]) => Promise<{ headline: string; confidence: number; delta: 'improving' | 'worsening' | 'stable' | null; recommended: string } | null>,
  onGenerated: () => Promise<void>,
): Promise<ReengagementDraft | null> {
  const { locale, status, hasUpcomingBooking, visitCount, lastVisitAgoDays } = params
  const customerName = cleanNameToken(params.customerName) || 'お客様'

  if (!process.env.OPENAI_API_KEY) return null

  // 1. Plan gate (F8) — before any AI call.
  if (!(await checkReengagementAllowed())) return null

  // 2. Status gate — ⚖ 8/23 (see REENGAGE_NUDGE_MIN_DAYS). Terminal staff
  //    decisions and a booked customer are ALWAYS excluded regardless of
  //    days; a new/zero-history customer gets no win-back (§13's own
  //    guardrail — first-visit welcome is a different future surface).
  if (status === 'graduated' || status === 'lost') return null
  if (hasUpcomingBooking) return null
  if (status === 'new' || visitCount === 0) return null
  const dayEligible = lastVisitAgoDays !== null && lastVisitAgoDays >= REENGAGE_NUDGE_MIN_DAYS
  if (!dayEligible && status !== 'dormant') return null

  // 3. Tier (tone only) — hasHistory=true: the gate above already proved it.
  const tier = reengagementTier(lastVisitAgoDays, true)

  const orgSettings = await resolveOrgSettings()
  const persona = getBusinessAiPersona(orgSettings?.business_type)
  const tok = resolvePersonaTokens(persona, locale)
  const voiceStyle: AIVoiceStyle = orgSettings?.ai_voice_style ?? 'polite'

  const records = await fetchKaruteRecords()
  const dated = records.filter((r) => r.created_at)
  const memoryRaw = await getCustomerMemory(params.customerId)
  const items = [...memoryRaw].sort((a, b) => rankMemoryItem(a) - rankMemoryItem(b))

  const cacheInput = {
    v: REENGAGEMENT_PROMPT_VERSION,
    customerId: params.customerId,
    tier,
    business_type: orgSettings?.business_type ?? null,
    locale,
    voiceStyle,
    memory: items.map((m) => ({ id: m.id, l: m.label, d: m.detail, p: m.pinned })),
    sessions: dated.slice(0, 5).map((r) => ({ id: r.id, s: effectiveSummary(r) })),
  }
  const cached = (await getCachedAI(CACHE_PREFIX, cacheInput).catch(() => null)) as ReengagementDraft | null
  if (cached?.draft) return cached

  // §1 consumption (F3): the SAME 8-record fetch AIBodyPredictionSlot makes,
  // so the two surfaces share one body_prediction cache entry and can never
  // disagree. Deferred until here (past our own cache check) so a
  // reengagement cache hit never pays for a §1 call. Null prediction →
  // proceed; the prompt notes its absence.
  const prediction = await fetchPrediction(records)
  const predictionBlock = prediction
    ? JSON.stringify({
        headline: prediction.headline,
        confidence: prediction.confidence,
        trend: prediction.delta,
        recommended_visit: prediction.recommended,
      })
    : null

  const system = buildSystemPrompt({
    locale,
    tier,
    voiceStyle,
    customerName,
    businessNoun: tok.businessNoun,
    role: tok.role,
    typicalConcerns: tok.typicalConcerns,
    clinicalPosture: tok.clinicalPosture,
  })
  const userPrompt = `Customer: ${customerName}
Visit count: ${visitCount}
Last visit: ${lastVisitAgoDays !== null ? `${lastVisitAgoDays} days ago` : 'unknown'}
Preferred staff: ${params.preferredStaffName ?? 'none'}
Voice style: ${voiceStyle}
Business type: ${tok.businessNoun}
Recency tier: ${tier}

AI body-condition prediction (§1, primary signal — reference it when relevant):
${predictionBlock ?? '(not available)'}

Customer memory (pinned + body/goal prioritized):
${wrapUntrustedContent('customer_memory', formatMemoryForPrompt(items))}

Recent session summaries (newest first, up to 5):
${wrapUntrustedContent('recent_sessions', formatSessionsForPrompt(dated))}`

  const completion = await openai.chat.completions.parse({
    model: process.env.AI_MODEL || 'gpt-4o',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    response_format: zodResponseFormat(OutputSchema, 'reengagement_draft'),
    temperature: 0.6,
    max_tokens: 700,
  })
  const parsed = completion.choices[0]?.message?.parsed
  if (!parsed?.draft?.trim()) return null

  const result: ReengagementDraft = {
    draft: parsed.draft,
    reasoning: parsed.reasoning,
    signals: parsed.signals,
    tier,
  }
  // The LLM produced a usable draft — the ONE place this feature's 生成 row
  // is earned (success-only audit doctrine ⚖ 8/23 — never a cache hit, never
  // a gated null). Best-effort, same as every other audit emit in this file.
  await onGenerated().catch(() => {})
  await setCachedAI(CACHE_PREFIX, cacheInput, result, 1).catch(() => {})
  return result
}

/** 生成-row emitters (auditLockout pattern, mirrors ai-outreach.ts:84-119):
 *  each body emits UNCONDITIONALLY on its one return path and is
 *  AUDITED_CORES-registered; computeReengagementDraft conditions the CALL
 *  to the generation branch only. */
async function auditReengagementDraftGeneratedWeb(customerId: string): Promise<void> {
  await auditWeb({
    category: 'ai',
    action: 'ai.reengagement_draft',
    targetType: 'customer',
    targetId: customerId,
    detail: { customer_id: customerId },
    requestId: crypto.randomUUID(),
  })
}

function auditReengagementDraftGeneratedFacade(
  businessId: string,
  actorId: string,
  requestId: string,
  customerId: string,
): void {
  audit({
    category: 'ai',
    action: 'ai.reengagement_draft',
    actorId,
    actorType: 'staff',
    businessId,
    targetType: 'customer',
    targetId: customerId,
    detail: { customer_id: customerId },
    requestId,
    source: 'facade',
  })
}

/** Web (cookie) entry — cookie org-settings + cookie feature gate. */
export async function getReengagementDraft(params: ReengagementParams): Promise<ReengagementDraft | null> {
  try {
    return await computeReengagementDraft(
      params,
      () => getOrgSettings().catch(() => null),
      async () => {
        const { featureAllowed } = await import('@/lib/subscription/feature-gate')
        return featureAllowed('aiOutreachDrafts')
      },
      () => getCustomerKaruteRecords(params.customerId, 8),
      (records) => getBodyPrediction({ customerId: params.customerId, records, locale: params.locale }),
      () => auditReengagementDraftGeneratedWeb(params.customerId),
    )
  } catch (err) {
    console.error('[getReengagementDraft] failed:', err)
    return null
  }
}

/** Facade (Bearer) entry — identity-threaded org-settings + business-scoped
 *  feature gate, same generator core as web. */
export async function getReengagementDraftWithClient(
  synqed: Pick<SynqedClient, 'orgSettings' | 'karuteRecords'>,
  businessId: string,
  actorId: string,
  requestId: string,
  params: ReengagementParams,
): Promise<ReengagementDraft | null> {
  try {
    return await computeReengagementDraft(
      params,
      () => orgSettingsWithClient(synqed).catch(() => null),
      async () => {
        const { featureAllowedForBusiness } = await import('@/lib/subscription/feature-gate')
        return featureAllowedForBusiness(businessId, 'aiOutreachDrafts')
      },
      () => getCustomerKaruteRecordsWithClient(synqed, params.customerId, 8),
      (records) => getBodyPredictionWithClient(synqed, { customerId: params.customerId, records, locale: params.locale }),
      () => Promise.resolve(auditReengagementDraftGeneratedFacade(businessId, actorId, requestId, params.customerId)),
    )
  } catch (err) {
    console.error('[getReengagementDraftWithClient] failed:', err)
    return null
  }
}
