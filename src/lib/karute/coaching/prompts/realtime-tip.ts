// ─────────────────────────────────────────────────────────────────────────
// Realtime in-session tip — the live coaching nudge (L1, Haiku, ~30s)
// ─────────────────────────────────────────────────────────────────────────
// The one the spike never wrote (it cites "§12", but §12 is actually Speaker
// Diarization — a non-LLM pipeline; this is a NEW surface, not that). Watches the
// live transcript during an active recording and, at most once in a while, surfaces
// ONE timely, specific nudge a good coach standing quietly in the room would lean
// over and give. Its default answer is SILENCE — a competent session should get few
// tips or none, and that's success, not a miss.
//
// L1, staff-private, absolute (RLS staff_id = auth.uid(), no owner exception, not
// even a count). Haiku-class + ~30s cadence: cheap, fast, event-driven.
//
// ── Leak fix the review caught (the important one) ──
// The nudge's own flagship case is "the customer mentioned a coworker's wedding" —
// which carries a THIRD-PARTY name. So the rule is not "no customer name", it's NO
// PERSONAL NAME AT ALL (customer, coworker, family, friend) — refer to everyone
// generically. These rows land in the same table §17 writes to, which a manager can
// reach under a session_insights grant; a stray name would smuggle transcript-level
// exposure past the visibility model's separate transcript_excerpts gate. §17 solves
// this by never letting the model touch a name; this surface holds the same bar.
//
// ── Orchestration preconditions + backstops (NOT the model's job) ──
//   • Only invoke when coaching is enabled for the org AND this staff consented, and
//     only when there's NEW speech since the last cycle (skip silent windows).
//   • A HARD invocation backstop independent of talk density: a per-session ceiling +
//     a floor between calls — a badly-diarized session (all speakers 'unknown') would
//     otherwise burn full call volume at ~100% fire=false. Instrument fire-rate.
//   • Enforce the 2-minute min gap server-side too (don't only trust the model).
//   • Drop a tip silently (no retry — the moment goes stale) if it still contains a
//     name-shaped token; malformed JSON → retry once → skip (a missed live tip is
//     invisible, fail closed).

import { coachingSystemBase, COACHING_MODELS, type CoachingPromptModule } from './config'
import { resolveCoachingCategories } from './categories'

const MAX_PATTERNS = 3
const MAX_RECENT_TIPS = 3

export interface RealtimeTipTurn {
  speaker: 'staff' | 'customer' | 'unknown'
  lowConfidence?: boolean
  text: string
}

export interface RealtimeTipInput {
  locale: string
  elapsedMinutes: number
  transcriptWindow: RealtimeTipTurn[]
  entryCountsByCategory?: Array<{ category: string; count: number }>
  focusAreas?: string[]
  topPerformerPatterns?: Array<{ categoryLabel: string; exampleText: string }>
  /** Tips already surfaced this session — for spacing + no-repeat. */
  recentTips?: Array<{ category: string; minutesAgo: number; suggestion: string }>
  tipsSoFarCount: number
}

function rules(businessType: string | null | undefined, locale: string): string {
  const cats = resolveCoachingCategories(businessType, locale)
  const catList = cats.map((c) => `${c.key} (${c.label})`).join(' / ')
  return `
You are watching ONE live session in progress, for this staff member alone. Layer 1,
staff-private — nobody else ever sees this, not the owner, not a manager, not even a
count. You'll be asked again in ~30 seconds with fresh transcript, so there is ZERO
cost to waiting for a clearer moment.

YOUR DEFAULT ANSWER IS SILENCE. A normal, competent session correctly produces few
tips, or none. Only break silence when something SPECIFIC just happened in the window
below that a good coach in the room would lean over and mention RIGHT NOW — not a
generic reminder, not something true of any session. Reaching for something to say
because you feel you ought to produce output is exactly when to stay silent. If your
sureness that this is worth interrupting for is less than clearly-yes (≈0.7), set
fire=false. When fire=true, confidence MUST be ≥ 0.7 — the two never diverge.

WHAT COUNTS (illustrative — most windows match none):
- The customer just said something specific worth registering NOW (a plan, an event,
  a feeling) that could be woven into the close or the next-visit note.
- A concern was raised and the conversation moved on before it was explored deeper.
- A technique your strongest colleagues use here (see top-performer patterns below,
  if any) fits this exact moment. (This is the TEAM's mined evidence shown to you —
  never phrase it as the reader's own past success.)
- Pacing is off for where the session is heading (e.g. drifting to a proposal before
  the customer has said enough for it to land).
- SAFETY/CARE: the customer said something allergy/medication/injury/contraindication
  -relevant at risk of being missed. This OVERRIDES the frequency rule — never hold a
  safety catch to wait for a better moment.

NOT worth firing: small talk in the first minute or two; restating what a line
already said plainly; generic advice not anchored to this moment; anything close to a
tip already given this session (see "already surfaced") unless something materially
new happened there since.

FREQUENCY — hard rule: never fire two tips less than 2 minutes apart, EXCEPT a safety
catch. Soft rule: the more tips already surfaced, the higher the bar for the next.

SPEAKER LABELS: each line is tagged staff / customer / unknown, some low-confidence.
If a tip depends on who said a line and that line is unknown/low-confidence, don't
build on it — find another moment or stay silent. EXCEPTION: a SAFETY/CARE catch may
fire on the content alone even when attribution is shaky — flag it to confirm
("someone mentioned a medication — worth confirming"), never swallow it.

NAMES — absolute: NEVER write ANY personal name that appears in the transcript — not
the customer's, and not a third party they mention (a coworker, friend, family
member). Refer to the customer as "she"/"he"/"the customer", and to any third party
generically ("a coworker", "a family member"). A short quoted phrase is fine as an
anchor ONLY if it contains no name.

CATEGORY — output the STABLE category KEY (the identifier before the parenthesis),
never the localized label, so a live tip joins the same countable bucket as every
other coaching surface: ${catList}. A safety/care catch is category "cautions"
regardless of business type (the app renders it as 注意).

STYLE: suggestion is either a specific line to say (「〜と伺ってみましょう」) or a short
behavioral nudge (「あと1つ質問を挟んでから提案に入りましょう」) — whichever fits. context is
a short anchor (a few words, "ご提案の直前で"), not a full sentence. Two sentences total
maximum across context + suggestion. Write in ${locale}; 丁寧語 for ja.

Output JSON only: { "fire": boolean, "tip": null | { "category", "context",
"suggestion", "confidence" } }. fire=false ⟺ tip=null. At most ONE tip — if several
moments qualify, pick the single best and let the rest wait.`.trim()
}

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['fire', 'tip'],
  properties: {
    fire: { type: 'boolean' },
    tip: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'context', 'suggestion', 'confidence'],
          properties: {
            category: { type: 'string' },
            context: { type: 'string', description: 'short anchor, a few words, no name' },
            suggestion: { type: 'string', description: 'a line to say or a short nudge; ≤2 sentences with context' },
            confidence: { type: 'number', description: '0-1; MUST be ≥0.7 whenever fire=true' },
          },
        },
        { type: 'null' },
      ],
    },
  },
}

function buildUser(input: RealtimeTipInput): string {
  const b = (label: string, lines: string[] | undefined) => (lines && lines.length ? `\n${label}\n${lines.join('\n')}` : '')
  const window = input.transcriptWindow
    .map((t) => `  [${t.speaker}${t.lowConfidence ? ' · low-confidence' : ''}] ${t.text}`)
    .join('\n')
  return [
    `Session elapsed ${input.elapsedMinutes} min · locale ${input.locale} · tips surfaced so far: ${input.tipsSoFarCount}`,
    b('Entries logged so far (different taxonomy — context only):', input.entryCountsByCategory?.map((e) => `  - ${e.category}: ${e.count}`)),
    b("This staff member's current focus areas:", input.focusAreas?.map((f) => `  - ${f}`)),
    b('Top-performer patterns here (the TEAM\'s mined technique, not the reader\'s own):', input.topPerformerPatterns?.slice(0, MAX_PATTERNS).map((p) => `  - ${p.categoryLabel}: ${p.exampleText}`)),
    b('Tips already surfaced this session (respect the 2-min gap + no-repeat):', input.recentTips?.slice(-MAX_RECENT_TIPS).map((r) => `  - ${r.category}, ${r.minutesAgo} min ago: "${r.suggestion}"`)),
    `\nTranscript — last ~2 minutes, oldest first:\n${window}`,
    `\nDecide: fire, or stay silent.`,
  ].filter(Boolean).join('\n')
}

/** The live in-session coaching tip — Haiku, ~30s cadence, L1, default-silent. */
export const realtimeTipPrompt: CoachingPromptModule<RealtimeTipInput> = {
  id: 'realtime-tip',
  config: {
    model: COACHING_MODELS.realtime,
    layer: 'L1',
    cadence: 'realtime',
    // ~350: JSON scaffold + category + a ≤2-sentence JA 丁寧語 suggestion, with
    // headroom so the closing brace never truncates (truncation reads as malformed).
    maxTokens: 350,
  },
  buildSystem: (businessType, locale) => coachingSystemBase(businessType, locale, rules(businessType, locale)),
  buildUser,
  outputSchema: OUTPUT_SCHEMA,
}
