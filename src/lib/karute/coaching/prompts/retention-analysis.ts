// ─────────────────────────────────────────────────────────────────────────
// Retention analysis — why THIS staff member's customers do / don't come back (L1)
// ─────────────────────────────────────────────────────────────────────────
// The section Liam asked for by name: "you rebooked 71%; the 29% who didn't share
// this pattern…". Distinct from personal-findings — its whole method is CONTRAST:
// find what's systematically different between the customers who came back and the
// ones who didn't, for this one staff member, ranked by how many it explains. And
// when they're winning, name the specific thing that's causing it so they can
// repeat it deliberately.
//
// L1, staff-private, absolute. No L2 half at all — this never gets aggregated,
// anonymized, or promoted to the mesh. The simplest privacy surface in the system:
// the staff member's own mirror, full stop. Writes to
// personal_growth_profile.rebooking_pattern_analysis (jsonb), RLS staff_id =
// auth.uid(), no owner exception — with a cross-read test that must fail.
//
// ── Ground truth is handed in, never computed by the model ──
// rebookingRate / counts / window / trend are precomputed server-side from real
// visit history (same deterministic rule family as the rest of the app). The model
// echoes them and explains them; it never recomputes or judges the trend. Rebooking
// is a data question with a clean answer; the causal WHY is the only LLM job here.
//
// ── Integration hand-offs the review surfaced (do NOT skip) ──
//   • Rung-1 LOGGING CARVE-OUT (real leak): the default ai_interactions.output
//     jsonb column logs the full parsed body — including verbatim momentQuote —
//     into a cross-surface table NOT scoped by staff_id. For this surface (and
//     personal-findings, same exposure) log metadata only (surface/model/tokens/
//     cost/latency/outcome), NEVER the parsed body with quotes.
//   • Grant scope at the OBJECT level: the whole evidence[] array (customerRef +
//     sessionDate + quote + paraphrase) sits behind the strict, never-pre-checked
//     transcript_excerpts scope; only pattern-level title/category/explanation/
//     counts fall under session_insights. customerRef resolves to a real name, so
//     it must not leak under the lenient scope.
//   • evidence[] cap ≤3 app-side; drop-count is reported in additionalPatternsFound.
//   • JA name-scrub over momentQuote as a backstop (the model trims names too).
//   • The design docs the draft cited (COACHING_VISIBILITY_MODEL, COACHING_V2_DESIGN)
//     DO exist — PRs #402/#403, currently unmerged branches; a reviewer checking
//     main won't find them. Not a gap.

import { coachingSystemBase, COACHING_MODELS, type CoachingPromptModule } from './config'
import { resolveCoachingCategories } from './categories'

export interface RetentionCustomer {
  /** Opaque ref; the app resolves the real name at render. The model NEVER sees
   *  or emits a real name. */
  customerRef: string
  rebooked: boolean
  isFirstVisit: boolean
  sessionDate: string
  daysAgo: number
  sessionOutcome: 'success' | 'no_deal' | 'pending'
  declineReason?: string | null
  /** Verbatim excerpt when available — the ONLY source for a momentQuote. */
  transcriptExcerpt?: string | null
  /** Fallback when no transcript — structured entries; momentQuote stays null. */
  sessionEntries?: Array<{ category: string; content: string }>
}

export interface RetentionAnalysisInput {
  locale: string
  windowDays: number
  windowStart: string
  windowEnd: string
  /** Ground truth — echo, never recompute. */
  rebookingRate: number
  rebookedCount: number
  totalConsidered: number
  /** Precomputed server-side with an explicit band (e.g. ±5pp = steady) — NOT the
   *  model's judgment. */
  trend: 'improving' | 'steady' | 'declining' | 'insufficient_prior_data'
  /** The decided customers (still-pending ones are excluded upstream). Capped +
   *  recency-weighted upstream for high-volume staff before this prompt runs. */
  customers: RetentionCustomer[]
}

function rules(businessType: string | null | undefined, locale: string): string {
  const cats = resolveCoachingCategories(businessType, locale)
  const catList = cats.map((c) => `  - "${c.key}": ${c.label}`).join('\n')
  return `
You are this staff member's OWN private retention coach — Layer 1, strictly
private, nobody else ever reads it. Their customers' actual rebooked / not-rebooked
outcomes and their own session history are in front of you. Your job: a causal,
EVIDENCED read on why their customers do or don't come back. Never invent a story
the sessions don't support.

GROUND TRUTH (handed in — echo exactly, never recompute or contradict):
rebookingRate, rebookedCount, totalConsidered, windowDays, trend, and each
customer's rebooked boolean + sessionOutcome. Trust the outcome label completely —
this never leaves this staff member's own view, so nobody gamed it.

── METHOD: CONTRAST, don't just describe ──
1. Read each customer's evidence (a transcript excerpt where one exists, else the
   structured entries).
2. Find what is systematically DIFFERENT between the rebooked group and the
   not-rebooked group — a specific moment, phrase, sequencing choice, or omission
   that shows up disproportionately on one side. A both-sides contrast ("in 26 of
   32 rebooked, only 5 of 13 not-rebooked") is far stronger than describing one
   group alone — always look for it, report both counts (contrastSessionsAffected).
   If there's no genuine contrast, leave those fields null; don't force one.
3. Only surface dimensions the data actually shows: first-visit concentration,
   decline-reason clustering (declineReason), timing/sequencing. Never force one.
4. Rank patterns by how many customers they explain, most first. Cite the real
   count every time — never "often"/"usually", say the number.

── HONESTY OVER COMPLETENESS ──
- If the non-rebooked customers share no specific pattern beyond their stated
  decline reasons, say exactly that — don't manufacture one.
- 0–3 noRebookPatterns and 0–2 whatsWorking are normal, expected outcomes, not
  failures. Never pad to a target. A quiet quarter with no shared thread → a short
  honest output. If MORE than 3 real patterns clear the bar, keep the 3 most
  explanatory and set additionalPatternsFound to how many you dropped.
- whatsWorking is held to the IDENTICAL evidence bar as a churn pattern — a real,
  counted difference (a single-sided count with null contrast is allowed, same as
  a churn pattern). Never praise-by-fallback filler.

── COUNTS ──
sessionsAffected counts UNIQUE CUSTOMERS, not visits. If a small number of repeat
non-rebookers inflate a pattern's apparent breadth, say so in the explanation.

── EVIDENCE ──
- Cite AT MOST 3 customers per pattern — the clearest, not an exhaustive list.
- NEVER emit a customer's real name or any identifying detail beyond customerRef —
  not in evidence, and not in title or explanation either.
- momentQuote MUST be an actual substring of that session's supplied transcript. If
  the span you'd quote contains the customer's spoken name (e.g. 「田中様、…」), trim
  the boundary to exclude it or pick another moment — never widen a quote to include
  a name. If no transcript exists for the session, set momentQuote null and use
  momentParaphrase. Never invent a quote.
- Diarization is imperfect and has, in production, mixed a bystander's side
  conversation into a session. Before citing a span as this customer's evidence,
  sanity-check it's actually the staff↔customer exchange — if it looks like a
  third party or ambient chatter, don't use it. speaker is staff|customer|unknown;
  use unknown rather than guessing.
- Describe the STAFF's communication/process choices as the cause — never the
  customer's condition or character. This is a mirror on the staff member's own
  behavior, not a judgment of the customer, and not a diagnosis.

Category set (tag a pattern when it clearly matches; null rather than forcing):
${catList}

── TONE ──
Growth-oriented, never shaming, never surveillance-flavored. "You tend to X", not
"you failed to X" — a coach on their side. Write all output text in ${locale}; 丁寧語 for ja.

Output JSON matching the schema exactly. No prose outside it.`.trim()
}

const PATTERN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'category', 'explanation', 'sessionsAffected', 'sessionsAffectedOf', 'contrastSessionsAffected', 'contrastSessionsAffectedOf', 'evidence'],
  properties: {
    title: { type: 'string' },
    category: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'a coaching category key or null' },
    explanation: { type: 'string' },
    sessionsAffected: { type: 'integer', description: 'unique customers showing the pattern' },
    sessionsAffectedOf: { type: 'integer' },
    contrastSessionsAffected: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    contrastSessionsAffectedOf: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    evidence: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['customerRef', 'sessionDate', 'momentQuote', 'momentParaphrase', 'speaker'],
        properties: {
          customerRef: { type: 'string' },
          sessionDate: { type: 'string' },
          momentQuote: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          momentParaphrase: { type: 'string' },
          speaker: { type: 'string', enum: ['staff', 'customer', 'unknown'] },
        },
      },
    },
  },
}

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['rebookingRate', 'rebookedCount', 'totalConsidered', 'windowDays', 'trend', 'lowConfidence', 'noRebookPatterns', 'whatsWorking', 'additionalPatternsFound'],
  properties: {
    rebookingRate: { type: 'number' },
    rebookedCount: { type: 'integer' },
    totalConsidered: { type: 'integer' },
    windowDays: { type: 'integer' },
    trend: { type: 'string', enum: ['improving', 'steady', 'declining', 'insufficient_prior_data'] },
    lowConfidence: { type: 'boolean', description: 'true when totalConsidered < 15 — surfaced as an early-signal caveat' },
    noRebookPatterns: { type: 'array', maxItems: 3, items: PATTERN_SCHEMA },
    whatsWorking: { type: 'array', maxItems: 2, items: PATTERN_SCHEMA },
    additionalPatternsFound: { type: 'integer', description: 'real patterns that cleared the bar but were dropped to keep the top set' },
  },
}

function buildUser(input: RetentionAnalysisInput): string {
  const customers = input.customers
    .map((c) => {
      const head = `--- ${c.customerRef} — rebooked: ${c.rebooked} — first visit: ${c.isFirstVisit} — ${c.sessionDate} (${c.daysAgo}d ago) ---`
      const outcome = `outcome: ${c.sessionOutcome}${c.declineReason ? ` — reason: ${c.declineReason}` : ''}`
      const body = c.transcriptExcerpt
        ? `transcript:\n${c.transcriptExcerpt}`
        : c.sessionEntries?.length
          ? `entries:\n${c.sessionEntries.map((e) => `  - [${e.category}] ${e.content}`).join('\n')}`
          : '(no transcript or entries — usable for rate math only)'
      return `${head}\n${outcome}\n${body}`
    })
    .join('\n\n')
  return [
    `Window: last ${input.windowDays} days (${input.windowStart} – ${input.windowEnd})`,
    `Locale: ${input.locale}`,
    `\nGround truth (echo, do not recompute):`,
    `  rebookingRate: ${input.rebookingRate} (${input.rebookedCount} of ${input.totalConsidered})`,
    `  trend: ${input.trend}`,
    `  lowConfidence: ${input.totalConsidered < 15} (set this in output)`,
    `\nCustomers considered (decided only):\n${customers}`,
    `\nAnalyze why this staff member's customers do or don't come back. Use the contrast method. Rank by customers explained. Output the JSON schema exactly.`,
  ].join('\n')
}

/** Retention / rebooking causal analysis — the staff member's private mirror on
 *  why customers return. L1, monthly batch (+ on-demand), Sonnet 5. */
export const retentionAnalysisPrompt: CoachingPromptModule<RetentionAnalysisInput> = {
  id: 'retention-analysis',
  config: {
    model: COACHING_MODELS.reason,
    layer: 'L1',
    cadence: 'monthly-batch',
    // Generous so a busy month with several evidenced patterns (≤3 evidence each)
    // never truncates; boundedness comes from the 0-3/0-2 caps, not the ceiling.
    maxTokens: 4000,
  },
  buildSystem: (businessType, locale) => coachingSystemBase(businessType, locale, rules(businessType, locale)),
  buildUser,
  outputSchema: OUTPUT_SCHEMA,
}
