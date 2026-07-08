// ─────────────────────────────────────────────────────────────────────────
// Top-performer patterns — the team-learning amplification engine (§14)
// ─────────────────────────────────────────────────────────────────────────
// Mines the BEST staff's sessions into SPECIFIC, transferable behaviors, then
// hands them (anonymized) to the learning-module generator and to personal-findings
// as "here's what your strongest colleagues do." This is the one prompt that takes
// one person's conversation and teaches it to everyone — the most consequential
// surface in the set. Two rules the whole design turns on, and (after adversarial
// review) the corroboration gate is enforced in CODE here (a real filter, below).
// Anonymization + single-performer suppression are backed by computed HARD FACTS fed
// to the model, but the drop itself + the JA name-scrub are still prompt-instructed +
// documented for Anthony's app layer — NOT code here yet. Don't over-read "enforced":
//
//   1. THE CORROBORATION GATE (coaching-design-principle, the one surgical rule).
//      A staff member's own 成約 label is trusted for THEIR OWN coaching but NOT
//      here. Before one person's conversation becomes everyone's lesson, the win
//      must be corroborated by the HARD purchase/booking signal, not self-report.
//      buildUser() FILTERS to corroboratedWin sessions — so even if the upstream
//      gate regresses, an uncorroborated win physically cannot be mined.
//
//   2. ANONYMIZATION IS ABSOLUTE (COACHING_VISIBILITY_MODEL). Shared output. NEVER a
//      customer name, a staff name, >~15 chars verbatim, or an identifying
//      circumstance (a datable life event, a named place). Attribution to a named
//      performer is a separate app-layer double-consent decision, never here.
//
// ── Code-computed inputs that make the rules checkable (per the review) ──
//   • corroboratedWin filter (the gate) — a real filter. NOTE: no assert/throw; an
//     empty corroborated set just yields an empty prompt, so the app should treat
//     "0 corroborated wins" as skip-the-run.
//   • single-performer suppression keys off the ACTUAL distinct top-performer count
//     (a 20-person shop with one star still outs the star) — not just cohortSize.
//   • contrast DENOMINATORS (# distinct performers per group) are computed here and
//     passed as facts; the model fills only the numerators, so it can't invent a gap.
//   • input is capped + each sourceQuote is truncated before the model sees it (so a
//     long identifying utterance never enters context) and only STAFF-spoken quotes
//     are rendered (customer/bystander speech is dropped at input — the diarization
//     misattribution fix, since sourceQuote alone carries no speaker).
//
// ── App-layer backstops still required ──
//   JA-aware NER + verbatim sweep over title/description/anonymizedExample AND note
//   (regenerate-on-hit then discard); strip performerRef/sourceStaffId for non-owner
//   viewers. SMALL-TEAM honest limit: in a tiny shop an owner knows who the star is,
//   so even a nameless pattern reframes rather than fully hides — surfaced via the
//   double-consent gate, not solved here.

import { coachingSystemBase, COACHING_MODELS, type CoachingPromptModule } from './config'
import { resolveCoachingCategories } from './categories'

/** Input caps — bound context/cost and cap raw verbatim exposure. */
const MAX_SESSIONS_PER_GROUP = 40
const MAX_ENTRIES_PER_SESSION = 12
const QUOTE_INPUT_MAX = 40 // chars the model may see per quote; output verbatim is tighter still

export interface PatternSessionEntry {
  category: string
  title: string
  /** Verbatim, untranslated. Truncated before the model sees it; only rendered when
   *  speaker === 'staff'. */
  sourceQuote: string
  /** Diarized speaker — customer/unknown quotes are dropped at input so a
   *  misattributed customer/bystander line can't become "the technique". */
  speaker: 'staff' | 'customer' | 'unknown'
  confidence: number
}

export interface PatternSession {
  /** Opaque performer ref — used ONLY to count distinct performers, NEVER emitted. */
  performerRef: string
  sessionId: string
  /** True only for hard-corroborated wins (pack redemption / registration), never
   *  self-reported 成約. Filtered on in buildUser as defense-in-depth. */
  corroboratedWin: boolean
  entries: PatternSessionEntry[]
}

export interface TopPerformerPatternsInput {
  locale: string
  businessType: string
  category: string
  topSessions: PatternSession[]
  medianSessions: PatternSession[]
  /** Comparable-staff count — one input to the small-team caveat. */
  cohortSize: number
  existingPatterns?: Array<{ id: string; title: string }>
}

function rules(businessType: string | null | undefined, locale: string): string {
  const cats = resolveCoachingCategories(businessType, locale)
  const catList = cats.map((c) => `  - "${c.key}": ${c.label} — ${c.def}`).join('\n')
  return `
You extract transferable TECHNIQUE patterns from the sessions of this business's
strongest staff, so they can be taught to everyone. The sessions you're given are
CORROBORATED wins (confirmed by the actual purchase/booking) — trust that.

A pattern is a SPECIFIC, repeatable thing a staff member DID or SAID that plausibly
caused a better outcome — not a personality trait, not a vibe. "Warm and friendly"
is not a pattern. "Names the customer's stated goal back to them when proposing the
next visit" is.

── METHOD ──
1. Find a specific behavior recurring ACROSS the top-performer sessions.
2. CONTRAST against the median sessions: a pattern earns its place only if it's
   noticeably MORE present in the top group than the median. The performer
   DENOMINATORS are given to you as facts — fill only how many performers in each
   group show the behavior; never invent a denominator. If the median baseline is
   empty (0 performers), you CANNOT establish contrast — cap such a pattern at
   confidence "low" and say so, never treat "absent from an empty baseline" as a gap.
3. DIVERSITY: prefer a behavior seen across SEVERAL top performers. Don't re-extract
   a catalog pattern (listed below).
4. Rank by transferability × contrast. Emit 0–5 patterns. If nothing clears the bar,
   return an empty list — never manufacture a pattern to look productive.

── ANONYMIZATION (absolute — becomes shared, teachable content) ──
- NEVER a customer name or identifying detail. Crucially, the PARAPHRASE channel
  leaks too: strip datable life events, specific circumstances, places, and any
  detail that would single out one customer or one staff member — GENERALIZE to the
  category ("a customer preparing for a big event", never "her wedding next month").
  In a small shop one specific circumstance de-anonymizes instantly.
- NEVER a staff name, and never phrase a pattern so it points at one identifiable
  person.
- anonymizedExample is a PARAPHRASE; any verbatim span must be ≤15 characters, from
  a staff sourceQuote (never invented), with no name or datable detail in it.
- The "note" field is shared output too — same rules; never write "this comes mostly
  from your top stylist" or anything that points at a person.

── SINGLE-PERFORMER SUPPRESSION ──
You are told the number of DISTINCT top performers. If it is fewer than 2, do not
emit any pattern (a pattern from a lone star broadcasts and identifies them) — return
an empty list with a note. When it is ≥2, only emit a pattern seen across ≥2
performers unless the cohort is large.

Categories (tag each; null if none fits):
${catList}

Write all output text in ${locale}; 丁寧語 for ja; business-native vocabulary only.
Output JSON matching the schema exactly. No prose outside it.`.trim()
}

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['patterns', 'note'],
  properties: {
    patterns: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'title', 'behaviorDescription', 'anonymizedExample', 'evidence', 'transferability', 'confidence'],
        properties: {
          category: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          title: { type: 'string' },
          behaviorDescription: { type: 'string' },
          anonymizedExample: { type: 'string', description: 'paraphrase; any verbatim ≤15 chars, no names/dates/circumstances' },
          evidence: {
            type: 'object',
            additionalProperties: false,
            required: ['presentInTopPerformers', 'ofTopPerformers', 'presentInMedianPerformers', 'ofMedianPerformers', 'sessionCount'],
            properties: {
              presentInTopPerformers: { type: 'integer', description: 'numerator you fill' },
              ofTopPerformers: { type: 'integer', description: 'GIVEN fact — echo exactly' },
              presentInMedianPerformers: { type: 'integer', description: 'numerator you fill' },
              ofMedianPerformers: { type: 'integer', description: 'GIVEN fact — echo exactly' },
              sessionCount: { type: 'integer' },
            },
          },
          transferability: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    note: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'e.g. small-team / empty-baseline caveat; anonymized like everything else' },
  },
}

/** Render a group: corroboration already filtered upstream in buildUser. Only
 *  staff-spoken, truncated quotes reach the model. Returns distinct performer count. */
function sessionsBlock(label: string, sessions: PatternSession[]): { text: string; distinct: number } {
  const distinct = new Set(sessions.map((s) => s.performerRef)).size
  const body = sessions
    .map((s) => {
      const usable = s.entries.filter((e) => e.speaker === 'staff').slice(0, MAX_ENTRIES_PER_SESSION)
      const entries = usable.length
        ? usable.map((e) => `    [${e.category}] (conf ${e.confidence}) ${e.title} — "${e.sourceQuote.slice(0, QUOTE_INPUT_MAX)}"`).join('\n')
        : '    (no staff-spoken entries)'
      return `  · performer ${s.performerRef} / session ${s.sessionId}\n${entries}`
    })
    .join('\n')
  return { text: `${label} — ${sessions.length} sessions across ${distinct} performers:\n${body}`, distinct }
}

function buildUser(input: TopPerformerPatternsInput): string {
  // THE GATE, in code: only corroborated wins can be mined, even if upstream breaks.
  const top = input.topSessions.filter((s) => s.corroboratedWin).slice(0, MAX_SESSIONS_PER_GROUP)
  const median = input.medianSessions.slice(0, MAX_SESSIONS_PER_GROUP)
  const topBlock = sessionsBlock('TOP-PERFORMER corroborated wins', top)
  const medianBlock = sessionsBlock('MEDIAN-performer sessions (contrast baseline)', median)
  const existing = input.existingPatterns?.length
    ? `\nAlready in the catalog (don't re-extract):\n${input.existingPatterns.map((p) => `  - ${p.title}`).join('\n')}`
    : ''
  const smallTeam = input.cohortSize <= 4 || topBlock.distinct < 2
  return [
    `Business type: ${input.businessType}. Category: ${input.category}. Locale: ${input.locale}.`,
    `Comparable cohort size: ${input.cohortSize}. Distinct top performers: ${topBlock.distinct}. Distinct median performers: ${medianBlock.distinct}.`,
    `FACTS to echo as denominators: ofTopPerformers=${topBlock.distinct}, ofMedianPerformers=${medianBlock.distinct}.`,
    topBlock.distinct < 2
      ? `\nDISTINCT TOP PERFORMERS < 2 — return an empty patterns list with a note (a lone star's pattern would identify them).`
      : smallTeam
        ? `\nSMALL cohort — only emit patterns seen across ≥2 distinct top performers.`
        : '',
    medianBlock.distinct === 0 ? `MEDIAN BASELINE EMPTY — no contrast is possible; cap any pattern at confidence "low".` : '',
    `\n${topBlock.text}`,
    `\n${medianBlock.text}`,
    existing,
    `\nExtract transferable technique patterns per the rules — contrast against the median, prefer multi-performer, fully anonymized. 0-5. Output the JSON schema exactly.`,
  ].filter(Boolean).join('\n')
}

/** §14 top-performer pattern extraction — the team-learning amplification engine.
 *  L2 anonymized, weekly batch, Sonnet 5. Consumes ONLY corroborated wins. */
export const topPerformerPatternsPrompt: CoachingPromptModule<TopPerformerPatternsInput> = {
  id: 'top-performer-patterns',
  config: {
    model: COACHING_MODELS.reason,
    layer: 'L2',
    cadence: 'weekly-batch',
    maxTokens: 4000,
  },
  buildSystem: (businessType, locale) => coachingSystemBase(businessType, locale, rules(businessType, locale)),
  buildUser,
  outputSchema: OUTPUT_SCHEMA,
}
