// ─────────────────────────────────────────────────────────────────────────
// Learning module generation — turn proven patterns into a teachable module (§15)
// ─────────────────────────────────────────────────────────────────────────
// Takes this business type's anonymized top-performer patterns + its prior
// modules' effectiveness history, and designs ONE 10-20 min module for a single
// teachable skill — structurally RESEMBLING what durably worked and AVOIDING what
// faded. All four horizons (30/90/180/365) are shown WITH confidence intervals so
// the model can tell a durable skill gain from a novelty spike.
//
// Derived / shared-catalog output (source='ai'): owner-visible, assignable to ANY
// staff member. So the anonymization is non-negotiable, and the one L1 input
// (targetStaffFocus — a staff member's own focus area) is FIREWALLED: it may only
// steer which skill to build, never appear in the module's visible text — a module
// visibly built around one person's weak spot outs them the moment it's assigned to
// their teammates.
//
// ── Deterministic backstops the app MUST run (per the review) ──
//   • Anonymization sweep over title/description/designRationale/outline[].detail:
//     regex for phone/email + a ≤20-char verbatim check against each source
//     pattern's exampleText + (per V2 design C7) a JA-aware NER pass — reject +
//     regenerate once, then discard. The targetStaffFocus firewall has NO automated
//     check otherwise; this is it.
//   • outline.length ∈ [2,5] and durationMin ∈ [10,20] are NOT schema-enforceable
//     (structured outputs has no min/max/array-length) — check at runtime,
//     regenerate once, then discard. Floor is 2, not 3, so the check stops
//     contradicting the prompt's own "don't pad to 5 steps" rule.
//   • designRationale must contain a number/CI token OR an explicit "no prior
//     evidence" phrase — cheap content check on the same retry path, so a generic
//     unfalsifiable sentence doesn't pass Zod's shape-only validation.
//   • Strip generatedFromPatternIds / resembledExemplarIds for non-owner viewers —
//     an assigned staffer must not be able to resolve a pattern id back to the
//     source colleague (metadata leak the text-level anonymization doesn't cover).
//   • id / source / businessType / category are set SERVER-SIDE, not by the model
//     (all known before the call) — the model emits only judgment content.
//   • Orchestration: skip the call entirely if zero patterns (log pattern_batch_empty);
//     depend on §14's job-COMPLETION signal, not a fixed clock offset; add a cooldown
//     so a repeat patterns_too_generic category isn't re-billed weekly; on-demand
//     failure returns a distinct generation_failed status to the owner's click.

import { coachingSystemBase, COACHING_MODELS, type CoachingPromptModule } from './config'
import { resolveCoachingCategories } from './categories'

export interface ModuleHorizon {
  scoreShrunk: number
  ciLow: number
  ciHigh: number
  n: number
}

export interface ModuleExemplar {
  id: string
  title: string
  durationMin: number
  stepCount: number
  effectivenessComposite: number
  structureSummary: string
  horizons: { d30?: ModuleHorizon; d90?: ModuleHorizon; d180?: ModuleHorizon; d365?: ModuleHorizon }
}

export interface LearningModuleInput {
  locale: string
  businessType: string
  category: string
  /** §14 anonymized top-performer patterns to ground the module in. */
  patterns: Array<{ id: string; title: string; description: string; exampleText: string }>
  effectiveExemplars: ModuleExemplar[]
  ineffectiveExemplars: ModuleExemplar[]
  /** Real org age (months) — code-computed, NOT guessed by the model. Drives the
   *  early-signal evidence basis honestly. */
  tenantAgeMonths: number
  /** Optional L1 steering input — choose the skill only; NEVER restated (firewalled). */
  targetStaffFocus?: string | null
}

function rules(businessType: string | null | undefined, locale: string): string {
  const cats = resolveCoachingCategories(businessType, locale)
  const catList = cats.map((c) => `  - ${c.label} — ${c.def}`).join('\n')
  return `
Design a 10–20-minute LEARNING MODULE for this business's staff — ONE specific skill
they could practice and visibly improve on within a week, grounded in the
top-performer patterns provided. Never invent a skill the patterns don't support.

── STRUCTURE ──
- ONE skill per module — the single most teachable, transferable theme in the input.
  Don't cover everything you were given.
- 10–20 minutes of hands-on practice. 2–5 steps (intro → demo → practice →
  reflection → apply) — include exactly what THIS skill needs, no more. A tight
  2–3 step module beats a padded 5-step one. Never add a step to hit a count.
- Prefer the theme that lines up with an active focus area when there's a fair fit:
${catList}
- Write all output text in ${locale}; 丁寧語 for ja. Business-native vocabulary only.

── RESEMBLE WHAT DURABLY WORKED, NOT WHAT LOOKS GOOD ──
You're given prior modules' effectiveness. Every score is a difference-in-differences
vs a same-store/category control who were assigned a similar module but didn't
complete it — so positive means it beat the natural trend, not that time passed.
Scores are shrunk toward the category average for small samples and shown with a 90%
CI: treat a WIDE interval as a weak signal even if the point looks good, a NARROW one
as worth taking seriously. 180d is the primary signal.
- HIGH-effectiveness priors: resemble their STRUCTURE (duration, steps, framing). The
  ARC tells you why — "strong at 30d, still strong at 180d" is a durable gain worth
  echoing; "strong at 30d, faded by 180d" is a novelty effect — do NOT resemble that.
- LOW-effectiveness priors: avoid that structure.
- Resemble the PRINCIPLE that made a module stick, not its wording. Modules across
  categories must not read like one template with the nouns swapped.
- Missing exemplars is NORMAL (new category / young tenant). Don't force a
  resemblance that isn't there — design from the patterns + first principles, and set
  evidenceBasis honestly using the tenant age you're given (an org under 6 months old
  → include "early_signal_org_under_6_months").

── WHEN NOT TO GENERATE ──
Generating something TRUE is the goal, not generating something. Return status
"no_module_needed" (module null) with reason when:
- the patterns are all generic platitudes with no concrete practiceable behavior →
  "patterns_too_generic";
- they describe 3+ unrelated skills with no coherent single theme →
  "no_transferable_skill_identified".
A correct no_module_needed beats a padded module built to look productive.

── ANONYMIZATION (non-negotiable — this is shared, owner-visible, assignable content) ──
Never carry: a real customer name or identifying detail (even paraphrased from a
pattern — use "a customer who…"); a real staff name (including whoever this was
generated for); more than ~20 characters verbatim of any example. If a target-staff
focus area is given, use it ONLY to choose the skill — never restate/quote it or let
the module read as personally targeted. It must stand alone as generally useful.

── designRationale ──
1–3 sentences citing the ACTUAL horizon evidence you used (a score / CI / horizon),
or explicitly saying there was no prior precedent. No generic "this will help the
team grow" filler.

Output JSON matching the schema exactly. No prose outside it.`.trim()
}

const HORIZON_SCHEMA = {
  anyOf: [
    { type: 'object', additionalProperties: false, required: ['scoreShrunk', 'ciLow', 'ciHigh', 'n'], properties: { scoreShrunk: { type: 'number' }, ciLow: { type: 'number' }, ciHigh: { type: 'number' }, n: { type: 'integer' } } },
    { type: 'null' },
  ],
}

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reason', 'module'],
  properties: {
    status: { type: 'string', enum: ['generated', 'no_module_needed'] },
    reason: { anyOf: [{ type: 'string', enum: ['patterns_too_generic', 'no_transferable_skill_identified'] }, { type: 'null' }] },
    module: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'description', 'durationMin', 'generatedFromPatternIds', 'resembledExemplarIds', 'evidenceBasis', 'designRationale', 'outline'],
          properties: {
            title: { type: 'string', description: 'action-oriented, e.g. "Name the life event when rebooking"' },
            description: { type: 'string', description: '2 sentences: what staff learn + why it matters' },
            durationMin: { type: 'integer', description: 'intended 10-20 (runtime-checked)' },
            generatedFromPatternIds: { type: 'array', items: { type: 'string' } },
            resembledExemplarIds: { type: 'array', maxItems: 2, items: { type: 'string' } },
            evidenceBasis: {
              type: 'array',
              description: 'one or more — a module can both resemble a precedent AND avoid a bad one',
              items: { type: 'string', enum: ['resembles_high_effectiveness_precedent', 'avoids_known_ineffective_pattern', 'no_prior_precedent_first_principles', 'early_signal_org_under_6_months'] },
            },
            designRationale: { type: 'string' },
            outline: {
              type: 'array',
              maxItems: 5,
              items: { type: 'object', additionalProperties: false, required: ['step', 'title', 'detail'], properties: { step: { type: 'integer' }, title: { type: 'string' }, detail: { type: 'string' } } },
            },
          },
        },
        { type: 'null' },
      ],
    },
  },
}

function exemplarLines(exs: ModuleExemplar[]): string {
  if (!exs.length) return '  (none yet — design from the patterns + first principles)'
  const h = (name: string, x?: ModuleHorizon) => (x ? `${name}=${x.scoreShrunk} (CI ${x.ciLow}–${x.ciHigh}, n=${x.n})` : `${name}=—`)
  return exs
    .map((e) => `  - ${e.id} "${e.title}" (${e.durationMin}min, ${e.stepCount} steps) composite=${e.effectivenessComposite}/100\n      ${h('30d', e.horizons.d30)}, ${h('90d', e.horizons.d90)}, ${h('180d', e.horizons.d180)}, ${h('365d', e.horizons.d365)}\n      structure: ${e.structureSummary}`)
    .join('\n')
}

function buildUser(input: LearningModuleInput): string {
  const patterns = input.patterns.map((p) => `  - ${p.id} — ${p.title}: ${p.description}\n      example: ${p.exampleText}`).join('\n')
  return [
    `Business type: ${input.businessType}. Category: ${input.category}. Locale: ${input.locale}.`,
    `Org age: ${input.tenantAgeMonths} months${input.tenantAgeMonths < 6 ? ' — under 6 months (use early_signal_org_under_6_months in evidenceBasis)' : ''}`,
    `\nTop-performer patterns to ground the module in:\n${patterns}`,
    `\nEffective prior modules (resemble their STRUCTURE), composite ≥ 70:\n${exemplarLines(input.effectiveExemplars)}`,
    `\nIneffective prior modules (AVOID their structure), composite ≤ 30:\n${exemplarLines(input.ineffectiveExemplars)}`,
    input.targetStaffFocus ? `\nSteering only (choose the skill; NEVER restate — firewalled): ${input.targetStaffFocus}` : '',
    `\nGenerate ONE module per the rules, or return no_module_needed with a reason. Output the JSON schema exactly.`,
  ].filter(Boolean).join('\n')
}

/** Learning-module generation — patterns → a teachable module, imitating durable
 *  winners. Derived/shared catalog, weekly batch + on-demand, Sonnet 5. */
export const learningModulePrompt: CoachingPromptModule<LearningModuleInput> = {
  id: 'learning-module',
  config: {
    model: COACHING_MODELS.reason,
    layer: 'L2',
    cadence: 'weekly-batch',
    maxTokens: 6000,
  },
  buildSystem: (businessType, locale) => coachingSystemBase(businessType, locale, rules(businessType, locale)),
  buildUser,
  outputSchema: OUTPUT_SCHEMA,
}
