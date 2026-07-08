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
import { getCustomerMemory } from '@/lib/karute/customer-memory'
import { backfillMemoryFromTranscripts } from '@/lib/karute/memory-ingest'
import type { MemoryItem } from '@/lib/karute/memory-types'
import { defensivePreamble, wrapUntrustedContent, MAX_HISTORY_CHARS } from '@/lib/ai-safety'
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
      "The AI's READ of the booking memo — NOT a restatement (staff already see the raw memo directly above this). Surface only what a quick skim misses: (a) cautions for today (注意点), ESPECIALLY by cross-referencing a stated symptom against a requested treatment; (b) changes/contradictions — a symptom they stopped or started mentioning, or a want-vs-need mismatch; (c) expectation + communication tone (期待/トーン) ONLY if it changes how staff should act. A plain SAFETY fact (surgery, metal, meds, allergy, pressure) belongs in cautions even when the memo states it — here carry only the synthesis on top, never the fact restated. Each bullet must add insight, never paraphrase. Max 3. Empty array if there is no memo OR the memo is purely operational (e.g. ticket renewal).",
    ),
  hooks: z
    .array(z.object({ title: z.string(), body: z.string().nullable() }))
    .describe(
      'ADDITIONAL personal rapport topics beyond the one the opener already uses — the opener’s topic must NOT reappear here (if the opener consumed the only topic, return []). Genuine personal material ONLY (pets/family/hobbies/travel/life events); each body is a compact FACT, never a spoken line. Operational/scheduling/payment/booking/package notes and symptoms are NOT hooks. A family word alone is not a hook (only when it is about that person’s life/event). Empty if no real small-talk material; never fabricate.',
    ),
  concerns: z
    .array(z.string())
    .describe(
      "The customer's KEY carried-over concerns + trajectory across the sessions shown (oldest→newest) — HISTORY, never actions: no imperative phrasing, and never restate a todayActions item (the homework/promise re-check lives in todayActions ONLY; here describe the underlying concern's state instead). Keep it USEFUL, not exhaustive: MAX 4 items, most relevant + most recent first, in the business's vocabulary. CONSOLIDATE related concerns into ONE row; DROP vague catch-alls. LEAD with what CHANGED — 改善/悪化/新規 — and tag a direction ONLY when two dated sessions clearly show it. Do NOT put (継続) on every item: an all-継続 list is noise; list a simply-ongoing concern plainly, no tag. Empty if none.",
    ),
  lastProduct: z
    .object({ name: z.string(), reaction: z.string().nullable() })
    .nullable()
    .describe('The most recent product/service offered + the customer reaction, if any. The reaction must not repeat the lastWords quote — if the reaction IS that quote, set reaction null. Null if none.'),
  recommendedFocus: z
    .string()
    .nullable()
    .describe('The WHY behind todayActions: 1-2 sentences of rationale/approach (which finding links the actions, what to prioritise and why), in the business vocabulary. Must ADD reasoning the action list cannot carry — NEVER restate, list, or paraphrase todayActions items. It may NAME a concern as an anchor, but must not restate the state/trajectory concerns already carries — bring only the link and the approach. Null when there is nothing beyond the actions.'),
  opener: z
    .string()
    .nullable()
    .describe(
      "ONE natural spoken first line for the staff to open with — built from the durable-memory personal/talking-point items or the newest personal event in the records (e.g. 「パグちゃん、その後どうですか？」). Warm, short, a question. The topic this line uses is CONSUMED — it must not reappear in hooks. Null when there is no real personal material — NEVER invent or force one.",
    ),
  lastWords: z
    .string()
    .nullable()
    .describe(
      "The customer's OWN memorable words from the LATEST session, ONLY if the latest summary/entries carry a verbatim quote in 『』 or 「」 (e.g. 『人生で一番効いてる』). Copy it exactly, brackets included. Null otherwise — never paraphrase into a fake quote. Null also when the quote is about the opener's topic — the opener owns that moment.",
    ),
  cautions: z
    .array(z.string())
    .describe(
      'Safety/service cautions the staff must know before the session begins, stated ANYWHERE in the memo or the karute: safety-relevant history (allergies, medication, past reactions or trouble; clinical items like surgery/metal where applicable), intensity cautions, service anxiety. This field OWNS safety facts — memoAnalysis/concerns must not restate them. Max 3, most critical first, compact (≤40 chars each). Empty when nothing is stated — never infer.',
    ),
  todayActions: z
    .array(z.string())
    .describe(
      "Up to 3 imperative actions for TODAY, each ≤30 chars — one grounded action is a complete answer; NEVER pad to fill slots. FIRST action = the re-entry item when the latest 次回 line carries homework/a promise (e.g. 「宿題の実施状況を確認」) — todayActions is the ONLY field that carries the re-entry action; concerns and recommendedFocus must not repeat it. Then today's focus. An intensity/pace adjustment ONLY when it changes today's plan beyond what cautions already states — an adjustment that merely rephrases a cautions item is a duplicate, drop it. Grounded only; empty if the records give nothing actionable.",
    ),
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

// The customer's durable memory, grouped for the prompt — personal items (with a
// talking-point flag) feed hooks; body/preference/goal/lifestyle inform concerns.
function formatMemory(items: MemoryItem[]): string {
  return items
    .map(
      (m) =>
        `[${m.category}${m.suggestTalkingPoint ? '/talking-point' : ''}] ${m.label}${m.detail ? ` — ${m.detail}` : ''}`,
    )
    .join('\n')
}

/** Visit rhythm — pure date math (no AI): days since the last session and the
 *  customer's usual gap (median of consecutive-session gaps; needs ≥3 dated
 *  sessions for a meaningful median, else null). Lets the card show
 *  「3日ぶり・通常週1より早め」 so staff sense an unusual visit before a word
 *  is spoken. */
function computeRhythm(
  records: KaruteRecord[],
  now: Date,
): { daysSince: number; usualGapDays: number | null } | null {
  const dates = records
    // Guard falsy created_at BEFORE Date(): new Date(null) is the 1970 epoch,
    // which passes isFinite and would blow up daysSince / the gap median.
    .filter((r) => !!r.created_at)
    .map((r) => new Date(r.created_at).getTime())
    .filter((t) => Number.isFinite(t) && t > 0)
    .sort((a, b) => b - a)
  if (dates.length === 0) return null
  const daysSince = Math.max(0, Math.round((now.getTime() - dates[0]) / 86_400_000))
  let usualGapDays: number | null = null
  if (dates.length >= 3) {
    const gaps = dates
      .slice(0, -1)
      .map((t, i) => Math.round((t - dates[i + 1]) / 86_400_000))
      .filter((g) => g >= 0)
      .sort((a, b) => a - b)
    if (gaps.length > 0) usualGapDays = gaps[Math.floor(gaps.length / 2)]
  }
  return { daysSince, usualGapDays }
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

    // The customer's persistent memory (personal bits + body patterns that
    // accumulate across visits). If empty but the customer has transcripts,
    // bootstrap it once so an existing customer's brief is personal immediately;
    // thereafter the on-save loop keeps it fresh.
    let memory = await getCustomerMemory(customerId)
    if (memory.length === 0 && records.some((r) => r.transcript)) {
      memory = await backfillMemoryFromTranscripts({
        customerId,
        transcripts: records.map((r) => r.transcript ?? '').filter(Boolean),
        locale,
      })
    }

    const cacheInput = {
      // Bump when the brief prompt changes so stale cached briefs (≤24h) are
      // invalidated immediately instead of serving the old wording. v8: layer
      // contract — skim (opener/cautions/todayActions) owns today, detail
      // (hooks/concerns/lastProduct/recommendedFocus) owns history; no fact
      // appears in two fields. v7: 30-second brief fields. v6: re-entry
      // ledger (surface last session's promises/homework first). v5: purge
      // briefs poisoned by the QR-sync customer mis-link (a corrected
      // appointment.customer_id must not keep serving a fused brief built from
      // another customer's reservation memo).
      // v9: de-bodywork — per-type caution taxonomy + neutral examples.
      v: 9,
      c: customerId,
      memo,
      ids: records.map((r) => r.id),
      mem: memory.map((m) => m.id),
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
      memoAnalysis: (ai.memoAnalysis ?? []).slice(0, 3),
      hooks: ai.hooks ?? [],
      concerns: (ai.concerns ?? []).slice(0, 4),
      lastProduct: ai.lastProduct ?? null,
      recommendedFocus: ai.recommendedFocus ?? null,
      opener: ai.opener ?? null,
      lastWords: ai.lastWords ?? null,
      // Bounds live in the .describe() strings the model reads — enforce them
      // here too so an over-eager generation can't flood the card (clamp, not
      // zod .max: a hard schema max would reject the whole parse).
      cautions: (ai.cautions ?? []).slice(0, 3),
      todayActions: (ai.todayActions ?? []).slice(0, 3),
      rhythm: computeRhythm(records, now),
    }

    async function generate(): Promise<AiBrief> {
      // De-bodywork (v9): the caution taxonomy and teaching examples follow
      // the business's clinical posture — a nail salon never reads 体内金属.
      const clinical = tok.clinicalPosture !== 'service'
      const cautionTaxonomy = clinical
        ? '既往歴・手術歴・体内金属・服用中の薬・アレルギー・痛がった箇所や強さの注意・サービスへの不安'
        : 'アレルギー・体質・過去のトラブルや悪い反応・嫌がったこと・サービスへの不安'
      const synthesisExample = clinical
        ? 'e.g. memo has 胃の不調 + 内臓調整希望 → 「内臓調整は強度を弱めにして様子を見る」'
        : 'e.g. the memo pairs a stated sensitivity with a requested service → flag the gentler approach'
      const clusterExample = clinical
        ? 'e.g. 腰痛・肩甲骨・頸椎・ストレートネック are one posture/spine cluster — say 「姿勢由来の首・肩・腰の張り」 not four rows'
        : 'related concerns that share one cause belong on one row'
      const langInstruction =
        locale === 'ja' ? '日本語で出力してください。' : 'Respond entirely in English.'
      const system = `You are a ${tok.role} at a ${tok.businessNoun}. Your focus: ${tok.primaryFocus}.
Before a session you read the customer's booking memo and their past karute (session records), and produce a brief the ${tok.role} can skim in 30 seconds.

Rules:
- GROUNDING: every item must be backed by the memo or the karute. NEVER invent. An empty array / null is the CORRECT answer when there is nothing real — a fabricated item is harmful.
- NON-REDUNDANCY: the staff already see the full booking memo directly above this brief. Do NOT restate or paraphrase it. For each candidate bullet ask "could the staff know this just by reading the memo above?" — if yes, DROP it. Output only what a quick read misses. EXCEPTION: a safety fact stated in the memo still goes to cautions — safety is the one thing worth restating.
- LAYER CONTRACT (no fact appears twice): the card renders two layers. SKIM layer (always visible) = opener + lastWords + cautions + todayActions + memoAnalysis — owns TODAY. DETAIL layer (folded behind a 経過 toggle) = hooks + concerns + lastProduct + recommendedFocus — owns HISTORY & CONTEXT. Ownership when two fields could claim the same fact: a SAFETY fact belongs to cautions ONLY (wherever it was stated); ACTIONS belong to todayActions ONLY; the opener's personal topic may not reappear in hooks or lastWords. TOPIC overlap is NOT duplication — concerns may describe the state of a concern that todayActions checks today, and recommendedFocus may use the opener's topic as clinical rationale; only the same claim in the same framing is a repeat. Before returning, re-read your own output and delete any item in ANY field that restates another field's item.
- memoAnalysis: the ${tok.role}'s READ of the memo — include only the applicable of these, never forced to fill all:
    (a) 注意点 — cautions for today, especially BY SYNTHESIS: cross-reference a stated concern against a requested service and flag a risk/adjustment (${synthesisExample}). This is the highest-value bullet — produce it whenever two memo facts interact. A plain safety fact goes to cautions, not here — here only the synthesis on top.
    (b) change/contradiction — a symptom newly raised, dropped, or resurfacing vs the karute, or a want-vs-chief-complaint mismatch.
    (c) 期待/トーン — ONLY if it changes how staff should act today (不安げ→先に説明, せっかち→要点から). Skip if not actionable.
  Each bullet must reference a SPECIFIC fact and add insight, not paraphrase. Max 3. If nothing survives the test (trivial or purely-operational memo), return []. Empty if no memo.
- RE-ENTRY (highest value): the most recent session's summary may carry a 次回 line — homework assigned (セルフケア), promises the staff made (「次回は腰を重点的に」「期限を延長します」), deferred proposals, or symptoms to re-check. When present, the single most important one MUST surface as the FIRST todayActions item, phrased as an action (${clinical ? 'e.g. 「宿題のハムストレッチの実施状況を確認」「約束どおり腰を重点的に」' : 'e.g. 「宿題の実施状況を確認」「約束どおり◯◯を重点的に」'}) — and ONLY there: concerns and recommendedFocus must not repeat it. A promise the staff forgets is trust lost; one they keep is the "this place remembers me" moment. Only what the records actually say — never invent.
- opener: ONE natural first line to open the conversation, from the durable memory's personal/talking-point items (pets, family news, trips) or the newest personal event in the records. A short warm question in the customer's context. The topic it uses is CONSUMED as rapport material — it must not reappear in hooks or lastWords (it MAY still inform recommendedFocus as clinical rationale). Null when no genuine material exists — a forced opener is worse than none.
- lastWords: ONLY a verbatim customer line already quoted in 『』 or 「」 in the latest session's summary/entries, copied exactly, brackets included. Never manufacture a quote. Null when the quote is about the opener's topic — the opener owns that moment.
- cautions: what staff must know before the session begins, stated ANYWHERE in the memo or the karute: ${cautionTaxonomy}. This field OWNS safety facts — no other field may restate one. Max 3, most critical first, ≤40 chars each. Empty when none are stated.
- todayActions: up to 3 imperative actions (≤30 chars each) the staff executes today — ONE grounded action is a complete answer; never pad to fill slots. FIRST = the re-entry item (homework/promise from the latest 次回 line) when present; then today's focus; then an intensity/pace adjustment ONLY if it changes today's plan beyond what cautions already states (an adjustment that merely rephrases a caution is a duplicate — drop it). This is the ONLY field that carries actions — no other field may restate them.
- concerns: HISTORY, never actions — the customer's KEY carried-over concerns + their trajectory across the sessions shown (labelled "Session <date>:", oldest→newest). No imperative phrasing; never restate a todayActions item (when homework/a promise re-checks a concern, describe the concern's STATE here — ${clinical ? 'e.g. 「ハムストリングスの張り：前回セルフケア指導」' : 'e.g. 「継続中の悩み：前回アドバイス済み」'} — while the check itself stays in todayActions). Keep it USEFUL, not exhaustive:
    • MAX 4 items. Pick the most clinically relevant + most recent — NOT every complaint ever logged.
    • CONSOLIDATE related concerns into ONE (${clusterExample}). DROP vague catch-alls (「全体的な不調」).
    • LEAD with what CHANGED — 改善 / 悪化 / 新規 are the actionable signal. Tag a direction ONLY when two dated sessions clearly show it.
    • Do NOT put (継続) on every item. A simply-ongoing concern is listed plainly (no tag) — the (継続) tag is only worth showing to contrast with something that changed; an all-(継続) list is noise.
  Most relevant first. Judge only within the sessions shown; never extrapolate. Empty if none.
- hooks: ADDITIONAL personal rapport topics BEYOND the opener — the opener's topic must not reappear here; if the opener consumed the only personal topic, return []. Each body is a compact FACT (「数ヶ月ぶりに再開」), never a spoken line — the opener is the spoken line. Genuine personal material ONLY (pets/family/hobbies/travel/life events) — worth asking about even if the booking were cancelled. PRIMARY SOURCE = the customer's DURABLE MEMORY 'personal' items below (facts that persist across visits — a pet's name, a child's milestone, a trip from an earlier session), preferring items flagged talking-point, plus any new personal detail in the latest session. EXCLUDE operational/logistics notes: order of treatment, who is treated first, companions, scheduling, cancellations, payment, packages/回数券, staff assignment, and symptoms/treatments (those belong in concerns/memoAnalysis). A family word alone is not a hook — only when it is about that person's life/event. Empty if there is no real small-talk material — never force one.
- lastProduct: the most recent product/service offered + the customer's reaction, if present. Null otherwise.
- recommendedFocus: the WHY behind todayActions — 1-2 sentences of rationale/approach (which finding links today's actions, what to prioritise and why), grounded in the trajectory + memo, in this ${tok.businessNoun}'s vocabulary. It must ADD reasoning the action list cannot carry; NEVER restate, list, or paraphrase todayActions items. It may NAME a concern as an anchor, but the state/trajectory stays in concerns — bring only the link and the approach. Null when there is nothing beyond the actions.
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
        memory.length > 0
          ? `Durable memory about this customer (accumulated across visits — 'personal' items feed the opener/hooks; 'body' items inform concerns AND cautions, but a safety-relevant body item (metal, surgery, allergy) belongs in cautions only; weave naturally, do NOT just relist):\n${wrapUntrustedContent('customer_memory', formatMemory(memory))}`
          : 'Durable memory: (none yet)',
        records.length > 0
          ? `Past karute (oldest → newest, last = most recent):\n${wrapUntrustedContent('karute_history', buildContext(records), MAX_HISTORY_CHARS)}`
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
        opener: null,
        lastWords: null,
        cautions: [],
        todayActions: [],
      }
      await setCachedAI('presession_brief', cacheInput, result, 1).catch(() => {})
      return result
    }
  } catch (err) {
    console.error('[getAiPreSessionBrief] failed:', err)
    return null
  }
}
