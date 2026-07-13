// ─────────────────────────────────────────────────────────────────────────
// Category scoring — the measurement rubric (the raw signal everything is built on)
// ─────────────────────────────────────────────────────────────────────────
// Nothing else in the coaching system specifies how a transcript becomes a
// number. Top-performer mining, per-staff focus, the "58 / top 86" comparison,
// every trend arrow, the effectiveness engine's C1/C3 — all consume per-session
// category scores as if they already exist. This is that missing rung. Get it
// wrong and every number on the page is decorated noise.
//
// WHAT IT DOES: scores ONE session transcript on the business's conversation-skill
// categories (categories.ts), each 0–100, evidenced, with honest confidence.
// Runs on every completed, consent-granted session (on-session, background).
//
// WHY BLIND: the model is given ONLY the transcript — no identity, no history, no
// prior scores. If it knew "this staffer usually scores low on closing," it would
// anchor toward confirming it. Scoring blind is what makes a cross-staff,
// cross-time comparison mean something instead of reflecting expectations back.
// (This is the opposite choice from findings/focus, which lean on history — right,
// because those coach a known person; this one produces a comparable measurement.)
//
// ── The downstream contract (deterministic, NOT this prompt's job, no LLM) ──
//   • session_composite = mean(score where applicable) for the session — one line
//     of arithmetic, fully auditable. `confidence` is deliberately NOT weighted
//     into the composite; it travels alongside as the honesty caveat the staff
//     view shows, and feeds the aggregation layer's sample-size logic (a wall of
//     low-confidence scores should widen the shown uncertainty, not silently
//     move the mean).
//   • aggregation over the staff's own window → contract.ts CategoryScore.score
//     (their own exact number, L1, never banded) + .confidence.
//   • the same aggregation over corroborated top-performer sessions (same window,
//     same rubric) → CategoryScore.topBenchmark. Both numbers are pure aggregates
//     of THIS prompt's output, scored by the identical yardstick — which is what
//     makes "58 vs 86" a real comparison, not noise.
//
// ── Prerequisites / hand-offs the review surfaced (do NOT skip) ──
//   • BLOCKING before this feeds any owner/manager (L2) surface: GapAnalysisList
//     + owner-types.ts CategoricalInsight.gapFromTopPerformerPct still render a
//     raw % — a live unbanded leak flagged in COACHING_VISIBILITY_MODEL §7. Band
//     it (成長中/安定/サポートが必要) before real numbers flow in. This prompt is L1;
//     the leak is one aggregation step downstream, but it's real and it's next.
//   • PII backstop: a deterministic name-scrub (regex + JA-aware NER, per V2
//     design C7) MUST run over every evidence quote downstream — this prompt's
//     evidence excerpts are what §14 pattern-mining will later consume, so this
//     is the anonymization choke point, not just an L1 nicety. The soft
//     redaction instruction below is the model's part, not the whole guard.
//   • prompt_version = sha256(buildSystem + buildUser), backend-stamped, so an
//     edit to either template makes historical scores non-comparable on purpose
//     (never blend two rubric eras into one trend line).
//   • on a schema/validation failure for one category: re-ask THAT category only
//     (same transcript, that category's rubric) — not a full re-run. One bad
//     category must not blank a whole session's signal, and a full re-run
//     re-rolls the categories that were already fine.
//   • calibration gate before go-live and on every rubric edit: score 20–30
//     hand-labeled transcripts (quiet / strong / weak); require ≥90% of
//     category-session pairs within ±10 of the human label first.
//   • NOT a per-org personalized surface (no Rung-2 exemplar bank): per-org
//     "how we score here" examples would let the yardstick drift per org and
//     defeat the whole point. Anchors evolve once, globally, human-edited.

import { coachingSystemBase, COACHING_MODELS, type CoachingPromptModule } from './config'
import { resolveCoachingCategories } from './categories'

export interface CategoryScoringTurn {
  /** Diarized speaker. MAY be 'unknown' — diarization is imperfect and has, in
   *  production, mis-attributed a bystander to the customer. */
  speaker: 'staff' | 'customer' | 'unknown'
  text: string
  /** Optional per-segment diarization confidence (0–1). When low, the model is
   *  told to prefer treating the turn as 'unknown' over guessing. */
  confidence?: number
}

export interface CategoryScoringInput {
  locale: string
  transcript: CategoryScoringTurn[]
  /** Logged entries — auxiliary sanity-check context only; the transcript is
   *  ground truth and always wins. */
  sessionEntries?: Array<{ category: string; time: string; content: string }>
}

// The anchor bands, keyed by the stable category keys (categories.ts). Universal
// on purpose — the labels change per business, the yardstick does not. Phrased to
// fit retail (price/close), clinical (consent/plan), and instruction (rationale/
// practice plan) alike.
const ANCHORS = `
questioning_depth (質問の深さ / assessment / listening depth):
  0-20   took the first statement at face value; no follow-up
  21-40  a logistical follow-up only (when / how long) — not cause or severity
  41-60  at least one question probing WHY, or HOW SERIOUS the main concern is
  61-80  a follow-up actually changed what was recommended or said next
  81-100 proactively surfaced a concern the customer hadn't raised, and probed it as deeply

acknowledgment (受けとめ):
  0-20   a customer statement (concern / hesitation / preference) met with silence or an immediate topic change
  21-40  a generic token only ("そうですね") with no reflection of the specific content
  41-60  paraphrased the specific content back before continuing
  61-80  paraphrased AND named the underlying feeling/concern, not just the fact
  81-100 the acknowledgment was carried forward later and visibly shaped a later action

value_presentation (価格提示 / 説明と同意 / plan rationale):
  0-20   stated as a bare number/plan with no framing, or dodged when asked
  21-40  stated with a generic value line not tied to this person's stated need
  41-60  explicitly connected to the benefit/need THIS person named
  61-80  presented with a comparison anchor (single vs course; cost of the problem persisting) that aids a real decision
  81-100 a full breakdown (what's included, why, expected timeline) offered proactively, before being asked
         — for a clinical business, enough for genuine informed consent

next_step (クロージング / 治療計画の合意 / next practice plan):
  0-20   ended with no next step named at all
  21-40  a vague future reference only ("また来てくださいね") — no date or action
  41-60  a specific next step proposed but left open, response not obtained
  61-80  a specific next step proposed AND the person's response actually obtained (yes / no / maybe-with-reason)
  81-100 hesitation or an objection was addressed on its stated substance before re-asking or gracefully deferring
`.trim()

function rules(businessType: string | null | undefined, locale: string): string {
  const cats = resolveCoachingCategories(businessType, locale)
  const catList = cats.map((c) => `  - ${c.key} ("${c.label}"): ${c.def}`).join('\n')
  return `
You are a calibrated conversation-coaching scorer. Given ONE staff member's
session transcript, score EACH category below on a 0-100 scale using ONLY
evidence from this transcript. This number feeds every coaching surface in the
product — trend lines, top-performer comparisons, what the AI teaches the whole
team next. A generous or inconsistent score here corrupts all of it. Be exact,
not encouraging. Kindness lives in HOW a rationale is worded — never in the
number.

These are CONVERSATION-SKILL categories (how the session was run), unrelated to
the entry-content categories used elsewhere in the app (施術/相談/体調/商品提案/次回).

Score exactly these categories, in this order — no additions, no omissions:
${catList}

── HOW TO SCORE EACH CATEGORY ──
1. Find every transcript moment relevant to the category. If there are NONE,
   stop: applicable=false, score=null, evidence=[], confidence=null, and give a
   one-line notApplicableReason ("no price or product came up — a mid-course
   maintenance visit"). This is a correct, GOOD output. A quiet routine session
   should show mostly applicable=false — never manufacture evidence to fill a slot.
2. Place the SPECIFIC observed behavior against the anchor bands below. Use the
   full 0-100 range; don't default to 50/75/100 out of convenience.
3. MULTIPLE qualifying moments at DIFFERENT bands: score the PREPONDERANT band —
   the one most qualifying moments fall in. On a tie, take the LOWER band. Always
   carry the split in the rationale + evidenceCount ("1 of 2 concerns got the
   deeper follow-up") — never bury it in a single averaged number.
4. Score each category INDEPENDENTLY. A weak questioning moment does not lower
   the next_step score. Don't let an overall impression bleed across categories.

── CONFIDENCE (a separate, honest signal — never smoothed into a safe middle score) ──
  high   = 3+ clear, consistent moments
  medium = exactly one CLEAR moment, OR two moments of any clarity
  low    = exactly one moment AND it is borderline / ambiguous
Landing on low for a real-but-marginal moment is just as correct as marking a
category not-applicable. They mean different things: not-applicable = the MOMENT
for this category never arose; low = it arose but the evidence is thin. Do NOT
retreat to not-applicable whenever you're unsure — use each for what it means.

── SPEAKER ATTRIBUTION (diarization is imperfect) ──
Each turn carries a speaker label that may be 'unknown' or low-confidence. In
production a bystander's words were once mis-attributed to the customer. Every
band is keyed to WHO acted ("staff asked", "staff acknowledged"). If a turn's
attribution looks implausible for what's said, treat it as 'unknown' and do NOT
let it drive a score — never credit or penalize the staff for a turn you're not
confident they own. Mark such evidence speaker='unknown'.

── ANCHOR BANDS (keyed to the category keys above; labels differ by business, the yardstick does not) ──
${ANCHORS}

── RULES ──
- Score BLIND. You are given nothing about this staff member's identity, history,
  or prior scores — only this transcript. The same session must score the same
  regardless of whose it is.
- evidence: at most 3 items per category, the clearest ones. Quotes are verbatim
  but short (≤25 JA characters / ≤20 EN words). If a real name appears, replace it
  with お客様 / Xさん — never echo a real name (a deterministic scrub also runs
  downstream, but do your part).
- rationale: plain and factual — what happened, not a verdict on the person.
- evidenceCount MUST equal evidence.length.
- Anything notable that no category covers (good or concerning) →
  sessionNotes.notableMomentsOutsideRubric (0-2 short items). Never stretch a
  category's definition to cover it.
- Write all output text (labels, rationale, evidence, reasons, notes) in ${locale}.
  For ja use 丁寧語.

Output the JSON schema exactly: one categoryScores entry per category above, same
order, nothing added or dropped.`.trim()
}

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['categoryScores', 'sessionNotes'],
  properties: {
    categoryScores: {
      type: 'array',
      description: 'exactly one entry per resolved category, same order',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'key',
          'label',
          'applicable',
          'notApplicableReason',
          'score',
          'confidence',
          'evidenceCount',
          'evidence',
          'rationale',
        ],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          applicable: { type: 'boolean' },
          notApplicableReason: {
            type: ['string', 'null'],
            description: 'required (non-null) iff applicable === false',
          },
          score: {
            type: ['integer', 'null'],
            minimum: 0,
            maximum: 100,
            description: 'null iff applicable === false',
          },
          confidence: {
            type: ['string', 'null'],
            enum: ['high', 'medium', 'low', null],
            description: 'null iff applicable === false',
          },
          evidenceCount: { type: 'integer', description: 'must equal evidence.length' },
          evidence: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['quote', 'speaker', 'momentDescription'],
              properties: {
                quote: { type: 'string' },
                speaker: { type: 'string', enum: ['staff', 'customer', 'unknown'] },
                momentDescription: { type: 'string' },
              },
            },
          },
          rationale: { type: 'string' },
        },
      },
    },
    sessionNotes: {
      type: 'object',
      additionalProperties: false,
      required: ['overallQuietSession', 'notableMomentsOutsideRubric'],
      properties: {
        overallQuietSession: { type: 'boolean' },
        notableMomentsOutsideRubric: {
          type: 'array',
          maxItems: 2,
          items: { type: 'string' },
        },
      },
    },
  },
}

function buildUser(input: CategoryScoringInput): string {
  const turns = input.transcript
    .map((t) => {
      const conf =
        t.confidence !== undefined && t.confidence < 0.45 ? ` (speaker uncertain)` : ''
      return `${t.speaker}${conf}: ${t.text}`
    })
    .join('\n')
  const entries = input.sessionEntries?.length
    ? `\n\nLogged entries (auxiliary sanity-check only — the transcript is ground truth):\n` +
      input.sessionEntries.map((e) => `  - [${e.category}] ${e.time} — ${e.content}`).join('\n')
    : ''
  return `Session transcript (diarized):\n${turns}${entries}\n\nScore every category per your instructions. Output the JSON schema exactly.`
}

/** The category-scoring rubric — the raw per-session measurement everything else
 *  is built on. On-session, L1, Sonnet 5. */
export const categoryScoringPrompt: CoachingPromptModule<CategoryScoringInput> = {
  id: 'category-scoring',
  config: {
    model: COACHING_MODELS.reason,
    layer: 'L1',
    cadence: 'on-session',
    // Sized for the richest sessions: ~6 categories × (≤3 short quotes + rationale
    // + fields) + notes, with headroom so JSON never truncates mid-array.
    maxTokens: 2400,
  },
  buildSystem: (businessType, locale) => coachingSystemBase(businessType, locale, rules(businessType, locale)),
  buildUser,
  outputSchema: OUTPUT_SCHEMA,
}
