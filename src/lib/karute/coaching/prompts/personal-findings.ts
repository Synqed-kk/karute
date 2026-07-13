// ─────────────────────────────────────────────────────────────────────────
// Personal findings — the heart of the staff page (L1, staff-private)
// ─────────────────────────────────────────────────────────────────────────
// The honest mirror: what in THIS staff member's own recent sessions is actually
// moving their 成約率 / 再来率 / 満足度 / 客単価 — and what isn't — ranked by outcome
// impact, each with a real count, the auditable list of sessions behind it, a
// verbatim moment, and one concrete fix. Strengths live in the SAME ranked array
// (severity 'strength'), held to the identical evidence bar — because "what you're
// good at" and "what's costing you sales" are one honest question, not a criticism
// list with a compliment bolted on. Supersedes the spike's thin §17.
//
// WHY IT CAN BE THIS BLUNT: it's L1, staff-private, forever. Nobody else reads it,
// so there's no reason to soften it and no reason to invent it. That privacy is
// exactly what LETS the coaching be honest without humiliating anyone.
//
// ── L1 IS ABSOLUTE (COACHING_VISIBILITY_MODEL) ──
// RLS staff_id = auth.uid(), no owner exception, ever. This output is NEVER turned
// into a manager/owner view by filtering its fields — the manager-visible view is a
// SEPARATELY generated, banded, source-stripped artifact (the staff-focus prompt's
// L2 half), never this JSON with the quote removed. The verbatim moment is isolated
// in its own nullable object only so the staff UI can render without it and so a
// name-scrub can target it — NOT to enable a field-filtered manager projection.
//
// ── Deterministic checks the app MUST run (this is what makes the count "real",
//    not trusted LLM arithmetic — same discipline as effectiveness.ts) ──
//   • evidence.count_total === len(evidence.session_refs); reject + regenerate on
//     mismatch (bounded: max 2 retries, then drop that one finding, keep the rest).
//   • every session_id in session_refs / verbatim_moment MUST exist in the window's
//     supplied sessions — reject a citation to a session that wasn't in the input.
//   • for a safety finding: evidence.checklist_item_matched MUST appear (verbatim)
//     in the checklist strings passed that turn — reject/regenerate otherwise.
//   • JA-aware NER name-scrub + regenerate-on-hit over verbatim_moment.quote
//     (COACHING_V2_DESIGN C7) — a single prompt instruction is NOT enough for the
//     highest-consequence leak vector; the model does its part, this is the backstop.
//   • cap ≤5 findings + ≤3 strengths app-side — JSON-schema maxItems isn't reliably
//     enforced server-side, so verify after parse.
//   • handle stop_reason === 'max_tokens' (adaptive thinking can eat the budget at
//     high effort) with a regenerate; a hard truncation on strict json output
//     yields nothing parseable, so this needs an explicit path, not a hope.
//
// ── Cost note (honest, not oversold) ──
//   Weekly fan-out across consenting staff. A cache_control breakpoint at the end of
//   the (per-business, week-stable) system prompt helps ONLY if requests aren't all
//   dispatched concurrently — inside the Batches API identical-prefix requests can't
//   read each other's still-writing cache, so the saving is partial at best. Treat
//   it as a maybe, not a load-bearing assumption. Trust the outcome label completely
//   here (it's the staff's OWN coaching); the label-vs-hard-signal cross-check
//   applies only to the §14 cross-staff amplification path, never to this surface.

import { coachingSystemBase, COACHING_MODELS, type CoachingPromptModule } from './config'

export interface FindingSessionEntry {
  category: string
  /** The AI-normalized title (paraphrase). NEVER use this as a verbatim quote. */
  title: string
  /** The verbatim, untranslated excerpt — the ONLY source for verbatim_moment.quote. */
  sourceQuote: string
  /** 0–1 extraction confidence. A low-confidence entry can't be the sole support
   *  for a finding, and can't fire the n=1 safety exception. */
  confidence: number
}

export interface FindingSession {
  sessionId: string
  date: string
  /** success / no_deal / pending — trusted completely (this is the staff's own coaching). */
  outcome: 'success' | 'no_deal' | 'pending'
  declineReason?: string | null
  rebookedWithinWindow?: boolean | null
  satisfaction?: number | null
  ticketAmount?: { amount: number; currency: string } | null
  categoryScoreDeltas?: string | null
  /** Empty when the session recorded an outcome but capture failed (a recorder
   *  miss). Usable for rate math, never for a verbatim moment. */
  entries: FindingSessionEntry[]
}

export interface PersonalFindingsInput {
  locale: string
  windowDescription: string
  dateRange: string
  /** This business's typical concerns — context for what's NORMAL here, so a
   *  routine seasonal conversation isn't mistaken for a staff problem. */
  typicalConcerns: string
  /** resolveCaptureTokens(...).checklist — top-priority items carry their own
   *  「最優先」marker inline; those justify an n=1 safety finding. */
  checklist: string[]
  /** resolveCaptureTokens(...).summaryLabels — grounds category LANGUAGE only. */
  summaryLabels: Array<{ label: string; def: string }>
  sessions: FindingSession[]
  currentFocusAreas?: Array<{ label: string; description: string }>
  /** Last window's findings + what the staff did with each — drives continuity. */
  previousFindings?: Array<{ headline: string; outcome: 'worked' | 'tried' | 'skipped' | 'unconfirmed'; sessionsSince: number }>
  availableModules?: Array<{ id: string; title: string; category: string }>
  relevantPatterns?: Array<{ id: string; title: string; exampleText: string }>
}

const RULES = `
You are this staff member's OWN private coaching analyst — Layer 1, strictly
private to this one person. No manager, owner, or colleague will ever read this.
Because it's private, there is no reason to soften it and no reason to invent it:
tell them, as precisely as the evidence allows, what in their own recent sessions
is actually moving 成約率 / 再来率 / 満足度 / 客単価 — and what isn't. Never
manufacture a problem, and never manufacture a compliment, the sessions don't support.

You receive this staff member's own recent sessions, each with a date, an outcome
label (success / no_deal+reason / pending — trust it completely), whichever of
{rebooking, satisfaction, ticket amount, category scores} the business supplied
(never infer one that's missing), and the category-tagged entries extracted from
that session. Some sessions have an outcome but no entries (a recorder miss) —
usable for rate comparisons, never for a verbatim moment.

── WHAT COUNTS AS A FINDING (all three required) ──
1. RECURS: the same concrete behavior appears in ≥3 sessions in the window. One
   session is an anecdote. EXCEPTION: a single-session SAFETY-CRITICAL miss —
   proceeding despite a checklist item marked top-priority (最優先) — is reportable
   at n=1, ranked first, and MUST cite the matched checklist line verbatim in
   evidence.checklist_item_matched. This exception needs ≥1 HIGH-confidence entry;
   never fire it off a shaky, low-confidence entry.
2. TIES TO A REAL SIGNAL: sessions with the pattern show a measurably different
   supplied metric than sessions without it, OR it's a safety-checklist miss, OR a
   category-score gap is directly present. Only use a metric the input supplied.
3. AUDITABLE: name every session (id + date) behind your count in session_refs.
   count_total MUST equal len(session_refs). Never round up; if you can cite fewer
   sessions than you were about to claim, report the number you can actually cite.
   A finding may NOT rest solely on low-confidence (<0.5) entries.

Name each pattern in THIS business's own language (informed by its concerns +
summary-label vocabulary) — never borrowed industry terms (no "closing" at a yoga
studio, no "cueing" at a dental clinic).

── STRENGTHS — same array, identical bar ──
Genuine strengths go in the SAME findings array with severity 'strength', ranked
by impact alongside the problems (not a separate consolation list). Specific,
recurring, evidenced, auditable: not "great service" but "in 9 of 11 sessions you
named the customer's stated goal back by the end; those rebooked at X vs Y." A
strength with no evidence is flattery — omit it before you'd pad. A strength's
"recommendation" is how to keep/extend it; it needs no fix module.

── RANKING (by real impact, not how the fix sounds) ──
(sessions touched) × (size of the outcome gap), highest first. Any safety finding
outranks everything. Emit ≤5 findings + ≤3 strengths; if more clear the bar, keep
the highest-impact and say so in the headline ("2 more patterns also crossed the
bar"). Never pad to hit the ceiling — a real week with 1 finding ships as 1.

── STATUS (be honest about the window) ──
- 'findings': at least one item cleared the bar.
- 'routine_excellence': plenty of data, nothing recurring crossed the bar — report
  it with the real numbers ("14 sessions, 13 closed; nothing crossed the bar"), a
  valid useful signal, not a consolation prize. Don't stretch a nitpick into a finding.
- 'capture_gap': the window is quiet because most sessions had no entries (a
  recorder problem, not a coaching one) — say so; don't misread it as a good week.
- 'insufficient_data': <6 sessions — set this, leave findings/strengths empty.
For a young 6–9 session window, keep findings but caveat them as early data in
confidenceNote ("6 sessions — a signal, not yet settled").

── VERBATIM MOMENTS ──
For each finding (and a strength when a clean one exists), quote ONE real moment —
taken ONLY from a cited session's sourceQuote (the verbatim field), never from a
title (those are paraphrases; quoting one is fabrication). Brief, exact, ~one
sentence. Replace any real customer name with Xさん / "the customer" even inside
the quote — identity is never the teaching point, the behavior is. speaker is
'staff' | 'customer' | 'unknown'; use 'unknown' when the source doesn't make it
clear rather than guessing. Everything OUTSIDE the quote (headline, impact, fix)
must stand on its own with the quote removed.

── FIXES ──
Every finding gets ONE concrete action — what to actually say or do differently in
the moment the pattern occurs, not "improve X". Reference a learning module or
top-performer pattern only if one genuinely fits (else null). If a pattern has
recurred unresolved for ≥3 windows, do NOT re-top the list with the same fix —
either give a materially different action or de-rank it; coaching, not nagging.

── CONTINUITY ──
Use last window's findings + outcomes. Don't re-report a 'worked' finding as new.
If a 'skipped'/'tried'-but-recurring pattern resurfaces, say so ("third window this
has come up"), don't present it as freshly discovered.

── TONE ──
Direct and plain. State the real problem in one clear sentence — don't bury it in
qualifiers, don't judge the person ("you're not a strong closer"); describe the
behavior and its effect. Growth-oriented, never shaming, never cushioning. Write
all output text in {{locale}} — for ja, 丁寧語 direct address (「あなたは」). The
clinical guardrail in the persona frame governs how clinically you may phrase things.

Output valid JSON matching the schema exactly. No prose outside it.`

const EVIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['count_total', 'count_outcome_aligned', 'outcome_metric', 'comparison', 'session_refs', 'checklist_item_matched', 'verbatim_moment'],
  properties: {
    count_total: { type: 'integer', description: 'sessions showing the pattern; MUST equal len(session_refs)' },
    count_outcome_aligned: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'of those, how many co-occurred with the meaningful outcome; null for safety or no clean comparison' },
    outcome_metric: { type: 'string', enum: ['成約率', '再来率', '満足度', '客単価', 'category_score', 'safety_checklist'] },
    comparison: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'the quantified impact in words ("8 of 12; 5 didn\'t close")' },
    session_refs: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['session_id', 'date'], properties: { session_id: { type: 'string' }, date: { type: 'string' } } },
    },
    checklist_item_matched: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'REQUIRED (verbatim from the supplied checklist) when outcome_metric = safety_checklist; else null' },
    verbatim_moment: {
      anyOf: [
        { type: 'object', additionalProperties: false, required: ['session_id', 'date', 'quote', 'speaker'], properties: { session_id: { type: 'string' }, date: { type: 'string' }, quote: { type: 'string' }, speaker: { type: 'string', enum: ['staff', 'customer', 'unknown'] } } },
        { type: 'null' },
      ],
    },
  },
}

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['window', 'status', 'headline', 'findings'],
  properties: {
    window: {
      type: 'object',
      additionalProperties: false,
      required: ['sessions_reviewed', 'date_range'],
      properties: { sessions_reviewed: { type: 'integer' }, date_range: { type: 'string' } },
    },
    status: { type: 'string', enum: ['findings', 'routine_excellence', 'capture_gap', 'insufficient_data'] },
    headline: { type: 'string' },
    findings: {
      type: 'array',
      maxItems: 8,
      description: 'impact-ranked; severity strength items interleaved. ≤5 non-strength + ≤3 strength (verify app-side).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'severity', 'category', 'rank', 'headline', 'impact', 'recommendation', 'evidence', 'confidenceNote'],
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['priority', 'watch', 'strength'] },
          category: { type: 'string', description: 'business-native pattern name; not a fixed enum' },
          rank: { type: 'integer' },
          headline: { type: 'string' },
          impact: { type: 'string', description: 'the quantified cost/benefit in plain words' },
          recommendation: { type: 'string', description: 'the one concrete fix; for a strength, how to keep/extend it' },
          evidence: EVIDENCE_SCHEMA,
          confidenceNote: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'early-data / thin-sample caveat; null when mature' },
          linked_module_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          pattern_reference: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
  },
}

function buildUser(input: PersonalFindingsInput): string {
  const s = (arr: unknown[] | undefined) => (arr && arr.length ? arr : null)
  const sessions = input.sessions
    .map((sess) => {
      const meta = [
        `outcome: ${sess.outcome}${sess.declineReason ? ` (${sess.declineReason})` : ''}`,
        sess.rebookedWithinWindow != null ? `rebooked: ${sess.rebookedWithinWindow}` : '',
        sess.satisfaction != null ? `satisfaction: ${sess.satisfaction}/5` : '',
        sess.ticketAmount ? `spend: ${sess.ticketAmount.amount} ${sess.ticketAmount.currency}` : '',
        sess.categoryScoreDeltas ? `category scores: ${sess.categoryScoreDeltas}` : '',
      ].filter(Boolean).join('  ')
      const entries = sess.entries.length
        ? sess.entries.map((e) => `    [${e.category}] (conf ${e.confidence}) title="${e.title}" quote="${e.sourceQuote}"`).join('\n')
        : '    (no entries — recorder miss; usable for rate math only)'
      return `--- session ${sess.sessionId} — ${sess.date} — ${meta} ---\n${entries}`
    })
    .join('\n')

  const block = (title: string, arr: string[] | null) => (arr ? `\n${title}\n${arr.join('\n')}` : '')
  return [
    `Window: ${input.windowDescription} — ${input.sessions.length} sessions (${input.dateRange})`,
    `Locale: ${input.locale}`,
    `\nWhat's normal at this business (not automatically a problem): ${input.typicalConcerns}`,
    block("This business's safety/priority checklist (最優先 items justify an n=1 safety finding; cite the matched line verbatim):", input.checklist.map((c) => `  - ${c}`)),
    block("Category-language grounding (inform naming; don't reuse as categories):", input.summaryLabels.map((l) => `  - ${l.label}: ${l.def}`)),
    `\nSessions (oldest → newest). Verbatim quotes come ONLY from quote="...", never title="...":\n${sessions}`,
    block('Current focus areas (continuity):', s(input.currentFocusAreas)?.map((f) => `  - ${(f as { label: string }).label}: ${(f as { description: string }).description}`) ?? null),
    block('Last window (drive continuity; omit resolved, flag recurring):', s(input.previousFindings)?.map((p) => { const f = p as { headline: string; outcome: string; sessionsSince: number }; return `  - ${f.headline} → ${f.outcome} (${f.sessionsSince} sessions since)` }) ?? null),
    block('Available learning modules (for linked_module_id):', s(input.availableModules)?.map((m) => `  - ${(m as { id: string }).id}: ${(m as { title: string }).title} (${(m as { category: string }).category})`) ?? null),
    block('Relevant top-performer patterns (for pattern_reference; use only if on-point):', s(input.relevantPatterns)?.map((p) => `  - ${(p as { id: string }).id}: ${(p as { title: string }).title} — ${(p as { exampleText: string }).exampleText}`) ?? null),
    `\nGenerate this window's findings + strengths (one ranked array). Output the JSON schema exactly.`,
  ].join('\n')
}

/** The honest personal-findings + strengths generator — the heart of the staff
 *  page. L1, weekly batch (+ staff-triggered on-demand), Sonnet 5. */
export const personalFindingsPrompt: CoachingPromptModule<PersonalFindingsInput> = {
  id: 'personal-findings',
  config: {
    model: COACHING_MODELS.reason,
    layer: 'L1',
    cadence: 'weekly-batch',
    // Generous: adaptive thinking + up to 5 findings + 3 strengths with full
    // evidence. Handle stop_reason==='max_tokens' at the call site (see header).
    maxTokens: 12000,
  },
  buildSystem: (businessType, locale) => coachingSystemBase(businessType, locale, RULES.replace(/\{\{locale\}\}/g, locale)),
  buildUser,
  outputSchema: OUTPUT_SCHEMA,
}
