# Coaching v2 — corrected design for the self-improving coaching engine

| | |
|---|---|
| **Status** | Design. Structure built dormant; activates on data. NOT live. |
| **Audience** | Anthony (engineering) + Liam (product) |
| **Supersedes-by-refinement** | `synqed-karute-design-spike/docs/AI_LEARNING_LOOP.md`, `COACHING_MESH.md`, `AI_PROMPTS.md §14–17` (all credited; this hardens them, doesn't replace them) |
| **Updated** | 2026-07-08 |

## 0. Why a v2

The original coaching design (authored on an earlier model generation) is
structurally strong and its IP is real — keep its bones. But a six-lens
adversarial review found the **measurement layer can be fooled three ways**, and
if it is, the system "learns" noise and teaches it to every store forever. This
doc folds in those fixes plus Liam's governing product principles. Everything
here is data-gated: build the structure now, switch it on when real outcome data
exists (per the spike's own roadmap).

**What changed from the spike (the delta):**

| # | Change | Prevents |
|---|---|---|
| C1 | Effectiveness = **difference-in-differences** vs a same-store/category control, not raw pre/post | Regression-to-the-mean scored as pedagogy |
| C2 | New `module_assignments` table logs assigned-but-not-completed | Completer self-selection bias |
| C3 | **Empirical-Bayes shrinkage** toward a category prior; rank by shrunk score | Tiny-sample luck topping the "best module" list |
| C4 | Top-performer mining cross-checks the label against the **hard purchase signal** already captured | One staffer's generous label becoming everyone's lesson |
| C5 | Owner sees **banded tiers**, never the raw `gap_from_top_performer_pct` | The gap number used as a punishment stick |
| C6 | Rung-4 fine-tuning re-scoped to 2026 reality; weight shifts to Rung 2/3 + prompt caching | Budgeting for a fine-tune path that barely exists |
| C7 | Anonymization = a **JA-aware NER pass**, not a phone/name regex | A customer name surviving into a durable Layer-2 pattern |
| C8 | A `crossStoreLearningConfirmed` consent gate before any transfer edge | Contradicting the "only our staff can access recordings" policy |
| C9 | Rung-3 artifacts **re-derived on a cadence** so revoked data ages out | A 30-day-delete promise the system can't keep |
| C10 | Nightly measurement window is **`<= now()-H`, not a 1-day slice** | A missed night = a permanent hole in a horizon score |
| C11 | `prompt_version = sha256(template)`, derived automatically | A/B + rollback silently corrupted by an un-bumped edit |
| C12 | Explicit **staff-initiated** Layer-1 deletion/revocation path | JP labour-law exposure; only customers were covered |
| C13 | §17 gets a mandatory **`affirmations`** field, not praise-by-fallback | Coaching that feels like surveillance, so staff opt out |

## 1. Governing principles (product — these outrank any mechanism below)

1. **Staff-private data is self-policing (Liam, 2026-07-08).** The detailed
   coaching a staff member sees is *theirs alone* — the owner never reads it.
   Because it's private, there is no incentive to game one's own labels; a liar
   only blinds their own coach. **Do not build the system to distrust staff.**
   That trust is what makes coaching feel 私のため (for me), not 監視
   (surveillance). Full statement: `project_coaching_design_principle` (memory).
2. **The one surgical exception.** The 成約 (bought / rebooked) label has two
   jobs: (a) drives the staffer's *own* coaching — trust completely; (b) feeds
   the **top-performer miner** that teaches the best conversations to everyone.
   Job (b) is the amplification path, so *there only* the label is confirmed
   against the hard purchase record the app already captures. Not "we don't
   trust you" — "before we broadcast your close as the house example, we confirm
   it closed." (= C4.)
3. **Data never moves, only learning moves** (spike, kept verbatim). Raw
   recordings/customers/records never cross a store line; only distilled patterns
   do. `business_id` is an absolute wall — a gym and a salon under one owner
   never mix. (spike `COACHING_MESH.md`.)
4. **Voice recognition is account-scoped.** During staff A's recording, the
   speaker engine recognises **only A's own** enrolled voice as staff, never the
   roster. (`project_voice_recognition_isolation` memory; enrollment authz shipped
   in karute #401.)
5. **The AI never edits its own production prompts** (spike, kept). It *proposes*
   candidates; a human approves; an A/B gate decides. No exceptions.

## 2. Access model — the owner view vs the staff view (three layers)

This is the spec behind the two dashboards the UI already scaffolds. **RLS
enforced server-side, not just hidden in the client** (today it's client-only —
the #1 thing to fix before real data lands).

| Layer | Who reads | Contents | Rule |
|---|---|---|---|
| **L1 — staff-private** | the staff member **only** | personal coaching insights (§17), personal growth profile (§16 specifics), transcript excerpts, consent withdrawal reason, `affirmations` | RLS `staff_id = auth.uid()`. **No owner exception, ever.** One escaped L1 leak permanently destroys coaching trust. |
| **L2 — owner aggregates** | owner/manager of the staff's store **+** the staff member for their own row | categorical growth summaries (§16), monthly `staff_performance` rollups (never per-session), top-performer patterns (source staff name stripped for non-owner), **banded** gap tiers | Store-scoped. Raw `gap_pct` never exposed to the owner (C5). |
| **L3 — owner config** | owner **only** | coaching settings (weights, thresholds, consent template, cohort/edge topology) | `settings.manage` / `coaching.manage`. |

**Owner view** = L2 + L3: the whole store's health, per-staff *categorical* growth,
who's trending, module effectiveness — enough to run the store, never the raw
private detail. **Staff view** = L1 + own L2 row: their own conversations, what
worked, what to grow, affirmations, assigned modules — the mirror only they hold.

## 3. The measurement — the hard part, corrected

The engine's whole value is: *can it tell a real coaching win from noise?* The
spike's multi-horizon framing (30/90/180/365-day, weights 10/25/45/20, n≥3 gate)
is kept — it correctly rejects novelty spikes and rewards slow-burn wins. The
three corrections make the underlying number trustworthy:

**C1 — control group (regression-to-the-mean).** A module is assigned *because*
§16 flagged a staffer below benchmark — i.e. at their own trough. They rebound
regardless. Fix: score each horizon as a **difference-in-differences**:
`score_H = individual_delta_H − control_delta_H`, where the control is the same
metric over the same calendar window for same-store/same-category staff who did
*not* take the module. This cancels regression-to-mean *and* store-wide/seasonal
shocks (both move the control too). Pure aggregation over `staff_performance` —
no new capture.

**C2 — the denominator (completer bias).** Log assignments, not just completions:
`module_assignments(id, module_id, staff_id, assigned_at, assigned_by, status:
assigned|started|completed|ignored|declined)`. Compute the same horizon delta for
`ignored`/`declined`, anchored on `assigned_at`. They *are* the C1 control arm —
selected by the same below-benchmark trigger, so a near-perfect natural comparison.

**C3 — small samples (shrinkage).** Replace the binary n≥3 gate with shrinkage
toward the category mean: `score_shrunk = (n·score + k·prior) / (n + k)`, k≈10–15.
Rank exemplars by the shrunk score so a 3-sample fluke can't outrank a 40-sample
real win. Owner UI shows an interval ("composite 72, 90% CI 51–88, n=5"), never a
bare point.

**C4 — trustworthy labels for amplification (per principle 2).** The staffer's
own coaching uses their labels as-is. The top-performer miner (§14) admits a
session as an exemplar only when the label is corroborated by the hard signal
the stop-dialog already records (pack purchase / new booking). `is_top_performer`
requires the corroborated signal, not self-report.

## 4. The learning ladder (4 rungs — kept, 2026-updated)

Spike ladder retained: **Rung 1** outcome logging (`ai_interactions`, the
foundation) → **Rung 2** per-org exemplar bank (pgvector few-shot) → **Rung 3**
per-org prompt tuning (tone/vocab) → **Rung 4** per-org fine-tune. Updates:

- **Rung 4 re-scope (C6).** As of 2026 the only Claude fine-tune path is an older
  Haiku-class model via Bedrock — materially weaker than prompt-side gains. Treat
  Rung 4 as optional/last; put the weight on Rungs 2–3. Modern prompt caching
  makes a large stable system prompt cheap, so exemplars ride *after* the cached
  prefix; batch API halves the weekly/monthly job cost.
- **Provider adapter.** Prod runs OpenAI today; the spike assumes Anthropic. Build
  one `callLLM` adapter (provider-agnostic) with `ai_interactions` logging and the
  hashed `prompt_version` (C11) built in, so §14–17 can switch providers without a
  rewrite. This also resolves the standing provider blocker structurally.
- **Rung 1 economics (single-tenant reality).** La Estro alone won't hit the
  100-exemplar gate for months. Encode activation **as code** —
  `canRunSurface(orgStats) → {ok, reason}` — so surfaces light up when the data
  exists, not on a deploy. Log Rung 1 from day one (cheap; write the partition DDL
  for Anthony but a single tenant needs no partitioning yet).

## 5. Cross-store mesh (kept; two gates added)

Vault (`business_id`) → cohorts (which stores pool) → directed teacher→student
transfer edges, carrying only Rung-3/4 distilled artifacts, never raw rows. All
kept from the spike. Added: **C8** a `crossStoreLearningConfirmed` consent gate
before an edge can be created (the Mode-A privacy boilerplate promises recordings
stay with *our* store's staff — an edge moving even distilled patterns needs its
own disclosure); **C9** revoked-consent handling by re-deriving Rung-3 artifacts on
a cadence so revoked data ages out.

## 6. Anonymization, consent, correctness

- **C7 — anonymization.** §14 patterns are durable Layer-2 artifacts; a regex is
  not enough to guarantee "never a customer name." Add a JA-aware NER pass
  (GiNZA/spaCy-ja or a cheap dedicated small-model check) + regenerate-on-hit.
- **C12 — staff deletion.** Explicit staff-initiated Layer-1 deletion/revocation,
  silent (no owner signal), parallel to the customer rule. Labour-law grade.
- **C10 — self-healing job.** Measurement window `completed_at <= now()-H days AND
  not-yet-contributed` (idempotent *and* complete); a missed night self-heals.
- **C11 — prompt version.** `sha256(system+user template)` auto-derived; A/B and
  rollback key on it, so an un-bumped edit can't silently corrupt the experiment.

## 7. Staff experience (C13 — the feature's own retention loop)

A coach that only criticises gets abandoned. §17's schema gains a mandatory
`affirmations: [{category, context, detail}]` populated whenever a session has
any good moment — not the current praise-only-by-fallback. Framing stays growth,
not deficit ("could grow further by…", never "you are weak at…"). This is what
makes staff *open the app*.

## 8. Phasing (build order — each worthless without the prior)

1. **Now:** multi-store `store_id`+`business_id` on every row (done); session
   outcome label capture (done, live); **fix the auto-decide cron** so `pending`
   labels don't rot (G1); Rung-1 `ai_interactions` logging via the adapter (dormant
   sink until core table exists).
2. **Structure (this build, dormant):** the engine lib (types, activation gates,
   effectiveness math with the C1/C2/C3 fixes as pure + unit-tested code,
   attribution cross-check, ported §14–17 + the new realtime §12 prompt, the LLM
   adapter). Behind flag + tier + consent. No live AI calls.
3. **Activate per surface** as `canRunSurface` gates open on real data: §14
   patterns first (needs sessions, not exemplars), then §16/§17, then Rung 2.
4. **Later:** Rung 3 tuning, the mesh UI, then (maybe) Rung 4.

## 9. What Anthony owns (the core contract — detail in `CORE_CONTRACT.md`)

Tables: `ai_interactions` (partitioned from creation), `ai_exemplars` (pgvector),
`coaching_consent` (one reconciled schema — append-only status rows + an owner
rollup view that hides raw decline history), `module_assignments` (C2),
`module_completions` + `learning_modules.effectiveness_by_horizon`,
`staff_performance_monthly`, the L1 personal tables, `coaching_cohorts` /
`cohort_stores` / `coaching_transfer_edges` (mesh, later). RLS: L1
`staff_id = auth.uid()` no-owner-exception (tested — a cross-read test that must
fail), L2 store-scoped, cross-`business_id` edge made impossible by CHECK/trigger.
Launch gate (spike, kept): consent log wired + L1 RLS **tested** + business_type
scoping + `ai_interactions` capturing outcomes — all before §14–17 ship live.

## 10. Production gaps to close first (each its own small PR)

G1 auto-decide cron (`pending` labels rot today — active data-quality bug) ·
G2 tier gate on `/coaching/*` + Settings tab (`TIER_FEATURES.coachingInsights`
today inert) · G3 server-enforce the owner/staff split (today client-only) ·
G4 reconcile the two `coaching_consent` schema sketches → one · G5 delete the
stale `/karute/customer/[customerId]` route · G6 fix the outcome-spec doc
(Phase-2 shipped as an SDK resource, not columns) · G7 the InsightOutcome
(unread→tried/worked/skipped) write path.

## Related
- Spike: `AI_LEARNING_LOOP.md`, `COACHING_MESH.md`, `AI_PROMPTS.md §14–17`.
- Memory: `project_coaching_design_principle`, `project_voice_recognition_isolation`.
- Shipped: karute #398/#399/#400/#401 (security + per-type AI data foundations).
