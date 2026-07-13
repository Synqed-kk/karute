// ─────────────────────────────────────────────────────────────────────────
// Staff focus — the dual-layer write (L1 staff-specific + L2 owner-banded)
// ─────────────────────────────────────────────────────────────────────────
// §16. One generation pass, TWO guarded outputs for two audiences with very
// different trust levels:
//   layer1_specifics → the staff member's own view — full detail, exact angles,
//     direct language (StaffCoachingView.focus + strengths in contract.ts).
//   layer2_summary  → the owner/manager dashboard — BANDED, categorical, zero
//     numbers, zero names (feeds the ManagerCoachingView / OwnerTriageView bands).
// The redaction is asymmetric by design: L1 keeps full latitude, L2 is scrubbed.
//
// ── The L2 leak guard must diff against GROUND TRUTH, not shape-match (critical) ──
// The obvious guard — "reject any digit / Title-Case name / long quote" — is an
// ASCII heuristic and is USELESS here: this is a Japanese product. "三割" / "半分" /
// "二回" are numbers with zero ASCII digits; a real customer/staff name is an
// unspaced 2–4 char kanji/kana string with no capitalization signal; a verbatim
// phrase folded into flowing prose has no quote marks to catch. So the app-side
// guard MUST substring/fuzzy-diff summary_text against the real strings it already
// has — this staff's actual customer names for the window, the FULL staff roster
// (including THIS staff member's own name), and the literal note/outcome_note
// strings fed into this call — and reject on a hit. The prompt below is hardened to
// forbid kanji-numeral quantities and all names in the first place, but that's the
// model doing its part, not the backstop. Also: overwrite the echoed bands with the
// source-of-truth value before persisting (the model only ever echoes a band).
//
// ── Other hand-offs the review surfaced ──
//   • strengths capped 1–3 (an all-green month must not blow the budget via strengths).
//   • confidence/maturity is surfaced INTO L2 too (categorical, safe) so an owner
//     never over-reacts to an unearned needs-support on a 2-week hire.
//   • headcount-aware: when the comparable cohort is small (≤4), suppress ALL
//     comparative language in L2 — "your senior stylist" identifies by elimination.
//   • an acute 30d crash surfaces (as early_signal / lower priority, "worth checking
//     in") even without 180d confirmation — never silently dropped.
//   • insufficient data returns {status:'skipped'}, NOT an "error" key (ops noise).
//   • bands map to contract.ts PerformanceBand exactly ('growing'|'steady'|'needs-support').
//   • FRONTEND HAND-OFF: GapAnalysisList.tsx still renders the old numeric
//     gapFromTopPerformerPct pill — swap it for these band/priority badges, or it
//     renders nothing. Same de-numbering the visibility model requires.
//   • prompt_version = sha256 of the PRE-interpolation template (not the rendered
//     per-tenant text, which would fragment the A/B key per business/locale).
//   • The design docs cited by the workflow (V2_DESIGN / VISIBILITY_MODEL) DO exist
//     — PRs #402/#403, unmerged. Not a gap.

import { coachingSystemBase, COACHING_MODELS, type CoachingPromptModule } from './config'
import { resolveCoachingCategories } from './categories'

/** contract.ts PerformanceBand. JA display: 成長中 / 安定 / サポートが必要. */
type Band = 'growing' | 'steady' | 'needs-support'

export interface StaffFocusHorizonMetric {
  closingRate: number
  benchmarkClosing: number
  rebookingRate: number
  benchmarkRebooking: number
  satisfaction?: number | null
  benchmarkSatisfaction?: number | null
  sessions: number
}

export interface StaffFocusInput {
  locale: string
  role: string
  tenureMonths: number
  /** Precomputed upstream — the model echoes it, never recomputes. When the staff
   *  is too new to trust a band, pass 'early' in overallMaturity. */
  overallBand: Band
  overallMaturity: 'established' | 'early'
  /** How many comparable staff share this category/cohort — drives headcount-aware
   *  comparison suppression. */
  cohortSize: number
  horizons: { d30: StaffFocusHorizonMetric; d90?: StaffFocusHorizonMetric; d180?: StaffFocusHorizonMetric; d365?: StaffFocusHorizonMetric }
  /** Per-category band (precomputed) + internal gap context (L1-only). */
  categoryGaps: Array<{ category: string; band: Band; maturity: 'established' | 'early'; acute30dDrop?: boolean; note?: string }>
  previousFocusAreas?: Array<{ label: string; category: string; assignmentStatus: 'assigned' | 'started' | 'completed' | 'ignored' | 'declined'; assignedMonthsAgo: number; outcomeNote?: string }>
  availableModules?: Array<{ id: string; title: string; category: string; durationMin: number; effectivenessComposite: number | null; ci90Low?: number; ci90High?: number; n?: number }>
}

function rules(businessType: string | null | undefined, locale: string): string {
  const cats = resolveCoachingCategories(businessType, locale)
  const catList = cats.map((c) => `  - "${c.key}": ${c.label} — ${c.def}`).join('\n')
  return `
You are this staff member's career coach. From their performance vs the business
benchmark, identify 1–3 specific focus areas for next month — then produce TWO
guarded views of your findings for two audiences with very different trust levels.
Do NOT conflate them.

THE TWO AUDIENCES:
- layer1_specifics — the staff member, only them. Full detail: exact angles, direct
  language. (Numbers are fine here.)
- layer2_summary — the owner/manager dashboard. Write every sentence as if a
  stranger could read it aloud in the break room and this staff member would still
  feel fairly treated: zero embarrassment, zero number, zero name.

RULES FOR BOTH:
- Specific enough to be useful. Not "improve service" — "ask one more follow-up
  after the customer names a concern". Vague praise is equally useless — name the
  metric a strength is evidenced by.
- Rank by expected revenue impact: a sustained gap (weight the 180d window as
  primary) outranks a noisy 30d swing. Between metrics, a closing/rebooking gap
  (direct revenue) outranks a satisfaction gap of similar size. On a near-tie across
  >3 categories, order by category key so a re-run doesn't reshuffle.
- ESCAPE VALVE: a severe ACUTE 30d drop (categoryGaps[].acute30dDrop) still surfaces
  even without 180d confirmation — as confidence 'early_signal', priority ≤ medium,
  framed "worth checking in on", never as a settled verdict.
- Each focus area maps to ONE category:
${catList}
- Surface ONE learning module per focus area (prefer strong sustained 180d
  effectiveness with a tight interval over a wide uncertain one). None fits →
  module_id null + suggested_new_module_title.
- Respect prior decisions: don't re-assign a module the staff 'ignored'/'declined'
  (drop it or come at the gap from a different angle); if one is 'started', reinforce
  it rather than competing with a new focus area in the same category.
- Confidence: if a category's evidence is only 30d/90d (maturity 'early' / <12
  sessions at 180d+), mark confidence 'early_signal' and cap priority at 'medium'.
  A thin sample doesn't earn 'high'.
- Dignity first: frame growth, never failure ("could grow further by…", never "you
  are weak at…"). A genuine evidenced strength gets the same specificity as a gap.
- Write all output text in ${locale}; 丁寧語 for ja.

DO NOT PAD. If the staff is at/above benchmark everywhere with no sustained gap,
say so plainly — return 0–1 focus areas (a growth-edge, "building on a strength",
never a manufactured deficit). Cap strengths at 1–3, most-evidenced first — an
all-green month is a SHORT clean output, not an enumeration of every category.

━━ HARD RULES FOR layer2_summary ONLY (a violation is a trust-destroying leak) ━━
- NEVER a number, in ANY form. Not arabic digits (10%, 3), not kanji numerals or
  quantity words (三割, 半分, 二回, 数ポイント), not "about a tenth". Trend language
  with NO quantity is fine ("今期はベンチマークに近づいている" ✓). Use ONLY the band
  words: growing / steady / needs-support (成長中 / 安定 / サポートが必要).
- NEVER a customer name or identifier (no partial names, no dates, no #-number).
- NEVER another staff member's name OR an identifying description of one. In a SMALL
  team (cohortSize ≤ 4) suppress ALL comparative language entirely — "your senior
  stylist" / "the other therapist" identifies one person by elimination even with no
  name. With a small cohort, describe only THIS staff member's own trajectory, never
  relative to colleagues.
- NEVER quote >20 characters of anyone's speech.
- NEVER re-introduce this staff member's own name/identity — the UI already shows
  whose row it is.
- Echo trajectory_band / overall_trajectory_band exactly as given; never invent or
  contradict; never translate a band back into a number. Carry the maturity flag
  through so the owner sees an 'early' read as early, not a settled verdict.
- summary_text is categorical only: what KIND of thing to work on and why it matters,
  never the session/customer/moment that revealed it. Specifics live in L1 only.
If you can't write an L2 entry that passes every rule, OMIT it. A missing row is
safe; a leaking row is not.

Output JSON matching the schema exactly. No prose outside it.`.trim()
}

const FOCUS_L2 = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'trajectory_band', 'priority', 'maturity', 'summary_text'],
  properties: {
    category: { type: 'string' },
    trajectory_band: { type: 'string', enum: ['growing', 'steady', 'needs-support'] },
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    maturity: { type: 'string', enum: ['established', 'early'] },
    summary_text: { type: 'string', description: 'categorical only, no number, no name' },
  },
}

const FOCUS_L1 = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'label', 'description', 'confidence', 'priority', 'module_id', 'suggested_new_module_title'],
  properties: {
    category: { type: 'string' },
    label: { type: 'string' },
    description: { type: 'string' },
    confidence: { type: 'string', enum: ['established', 'early_signal'] },
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    module_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    suggested_new_module_title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
}

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'layer2_summary', 'layer1_specifics'],
  properties: {
    status: { type: 'string', enum: ['generated', 'skipped'], description: 'skipped = insufficient data; NOT an error' },
    layer2_summary: {
      type: 'object',
      additionalProperties: false,
      required: ['overall_trajectory_band', 'overall_maturity', 'focus_areas'],
      properties: {
        overall_trajectory_band: { type: 'string', enum: ['growing', 'steady', 'needs-support'] },
        overall_maturity: { type: 'string', enum: ['established', 'early'] },
        focus_areas: { type: 'array', maxItems: 3, items: FOCUS_L2 },
      },
    },
    layer1_specifics: {
      type: 'object',
      additionalProperties: false,
      required: ['focus_recommendations', 'strengths'],
      properties: {
        focus_recommendations: { type: 'array', maxItems: 3, items: FOCUS_L1 },
        strengths: {
          type: 'array',
          maxItems: 3,
          items: { type: 'object', additionalProperties: false, required: ['label', 'detail'], properties: { label: { type: 'string' }, detail: { type: 'string', description: 'MUST cite the evidencing metric/pattern' } } },
        },
      },
    },
  },
}

function horizonLine(name: string, m?: StaffFocusHorizonMetric): string {
  if (!m) return `- ${name}: (no data)`
  const sat = m.satisfaction != null ? `, satisfaction ${m.satisfaction}/5 (bm ${m.benchmarkSatisfaction})` : ''
  return `- ${name} (${m.sessions} sessions): closing ${m.closingRate} (bm ${m.benchmarkClosing}), rebooking ${m.rebookingRate} (bm ${m.benchmarkRebooking})${sat}`
}

function buildUser(input: StaffFocusInput): string {
  const gaps = input.categoryGaps
    .map((g) => `  - ${g.category}: band=${g.band}, maturity=${g.maturity}${g.acute30dDrop ? ', ACUTE 30d drop' : ''}${g.note ? ` — ${g.note}` : ''}`)
    .join('\n')
  const prev = input.previousFocusAreas?.length
    ? input.previousFocusAreas.map((p) => `  - ${p.label} (${p.category}): ${p.assignmentStatus}, ${p.assignedMonthsAgo}mo ago${p.outcomeNote ? ` — ${p.outcomeNote}` : ''}`).join('\n')
    : '  (none)'
  const mods = input.availableModules?.length
    ? input.availableModules.map((m) => `  - ${m.id} — ${m.title} (${m.category}, ${m.durationMin}min) effectiveness=${m.effectivenessComposite ?? 'n/a'}${m.ci90Low != null ? ` (90% CI ${m.ci90Low}–${m.ci90High}, n=${m.n})` : ''}`).join('\n')
    : '  (none)'
  return [
    `Staff: ${input.role}, tenure ${input.tenureMonths} months. Locale: ${input.locale}.`,
    `Comparable cohort size: ${input.cohortSize}${input.cohortSize <= 4 ? ' — SMALL: suppress ALL comparative language in layer2_summary' : ''}`,
    `\nOverall trajectory (echo exactly): band=${input.overallBand}, maturity=${input.overallMaturity}`,
    `\nPerformance by horizon (180d is the primary signal; numbers are L1/reasoning only — NEVER copy one into layer2_summary):`,
    horizonLine('30d', input.horizons.d30),
    horizonLine('90d', input.horizons.d90),
    horizonLine('180d (PRIMARY)', input.horizons.d180),
    horizonLine('365d', input.horizons.d365),
    `\nCategory bands (precomputed — echo; gap context is L1-only):\n${gaps}`,
    `\nPrevious focus areas (respect prior decisions):\n${prev}`,
    `\nAvailable learning modules:\n${mods}`,
    `\nGenerate this month's dual-layer output. If <4 sessions this month, return status 'skipped'. Output the JSON schema exactly.`,
  ].join('\n')
}

/** Per-staff focus — the dual L1/L2 write. Monthly batch, Sonnet 5. */
export const staffFocusPrompt: CoachingPromptModule<StaffFocusInput> = {
  id: 'staff-focus',
  config: {
    model: COACHING_MODELS.reason,
    layer: 'L1+L2',
    cadence: 'monthly-batch',
    maxTokens: 2400,
  },
  buildSystem: (businessType, locale) => coachingSystemBase(businessType, locale, rules(businessType, locale)),
  buildUser,
  outputSchema: OUTPUT_SCHEMA,
}
