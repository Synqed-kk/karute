# Coaching — visibility & sharing model

| | |
|---|---|
| **Status** | Design (enforceable spec). Companion to `COACHING_V2_DESIGN.md §2`. |
| **Audience** | Anthony (RLS + data model) + Liam (product) |
| **Method** | Liam's requirements → 4-lens adversarial design panel → Fable synthesis. Strong cross-lens convergence. |
| **Updated** | 2026-07-08 |

## The one rule

> **Depth = who is looking × what the staff member has granted.**
> Nobody reaches a staff member's private detail without that person's explicit,
> revocable grant — not the manager, not the owner. Enforced in the database, not
> the UI.

## 1. Four layers (not three)

| Layer | Who | Content | Enforcement |
|---|---|---|---|
| **L1 — staff-private** | the staff member only | personal growth detail, personal coaching insights (the honest ranked callouts + fixes), verbatim transcript excerpts, own exact numbers, own grant/consent history | RLS `staff_id = auth.uid()` OR `is_manager_granted(...)`. **Zero role/capability references in these policies** — `staff.manage` has no code path here. (Add a CI check asserting no role literal appears in an L1 policy.) |
| **L2 — banded aggregate** | owner + manager + senior (via existing `analytics.viewAll`) | trajectory **band** (成長中/安定/サポートが必要), one focus-area label, priority chip, module-completion, assignable modules — **server-computed bands, never raw numbers** | projection view; raw `gap%`/`closingRate%` never leave the DB to these roles |
| **L3 — owner config** | owner only | coaching weights, min-session threshold, consent template, attribution-mode ceiling, master enable | `settings.manage`; configures the system, grants visibility into no one |
| **Grant** (new) | a specific manager, only when a staff member authorizes | precision upgrade + scoped L1 read (see §2) | `coaching_manager_grant` row; **INSERT requires `created_by = staff_id = auth.uid()`** — no manager/owner write path |

**Owner is not special for L1.** When the owner acts as a staff member's day-to-day
supervisor, the *same* staff switch gates them. Being owner only grants L3 + always-on
L2-banded — never L1 without the grant.

## 2. The two staff switches + the ask (kept separate on purpose)

1. **Consent to be coached** (existing dialog). Gates whether *any* L1 artifact is
   generated at all. If off, there is nothing to share — and the manager's coaching
   surface simply doesn't render.
2. **Share deeper with my manager** (new). **Default OFF for everyone, always.**
   Staff-authored only. When on, it grants *one named manager* a **scoped, time-boxed
   (default 30-day), revocable** read. Scope is check-constrained to
   `{growth_detail, session_insights, transcript_excerpts}`.
3. **"Ask for help" per-item share** (new). A one-time action to share *one* insight,
   independent of the master switch — this delivers granularity so the master switch
   stays a simple, trustworthy on/off, not a checkbox matrix.

**These three are separate decisions and never merged** — merging #1 and #2 would make
declining coaching cost a staff member their access to manager help.

**Absolute floor: verbatim transcript excerpts never cross to a manager — even under a
grant with `transcript_excerpts` scope must be a *separate, never-pre-checked* opt-in
on every grant** — because the transcript carries the *customer's* side of the
conversation, a consent the customer never gave to a manager. Most staff never grant it.

## 3. Anti-coercion (this is the core — Japan: develop, don't punish)

- **Decline is invisible.** A not-yet-shared switch and a deliberately-declined switch
  render **identically** to the manager ("not shared"). No lock icon, no greyed row, no
  "declined" marker anywhere a manager or owner can see. The manager's staff list looks
  structurally the same whether sharing is on or off.
- **Request ≠ grant, separately permissioned.** A manager can only *ask* (human to
  human — no in-app nag mechanic; if a request button is ever added it is frequency-
  capped ≤1/24h). Only the staff member can authorize (the grant-table INSERT policy).
- **Owner sees adoption only as an aggregate count** ("N of M staff sharing"), never a
  per-staff roster of who has/hasn't — removes the "why won't you share with me" lever.
- **Time-boxed grants** read as "help me through this stretch," re-upped deliberately —
  not a permanent surveillance pipe.
- **Manager turnover pauses grants + re-prompts.** Trust was given to a *person*, not
  the role; reassigning the manager re-confirms with affected staff.
- **The "declining has no effect on your work" guarantee** (already in the consent
  dialog) extends explicitly to the manager-share switch.

## 4. Rankings are bands for everyone (including the owner)

Trajectory buckets computed against **each staff member's own historical baseline**
(`trajectoryL2`, `trendDeltaPct`), never against the top performer — this is what turns
a leaderboard into a **triage board**. Every "needs support" flag ships **paired 1:1,
same screen, with a help action** (assign module / suggest a check-in topic / pair with
a top performer) — the surface has no path to a disciplinary action. A framing banner
sits above it: *this is for deploying support, not evaluation.* A sample-size floor
(the existing min-sessions setting) gates whether a staff member gets a bucket at all
(else "building data"), so a new hire's noisy 30-day signal can't mislabel them —
buckets use the §16 multi-horizon composite, not a single snapshot.

## 5. Peer learning — double-consent, win-only

Promoting a top performer's technique to the team needs **two keys**: the owner's
org-wide attribution mode (ceiling, default **anonymous**) AND that specific
performer's own opt-in (floor, default **off**). The owner can never force a name past
an individual's no. **Attribution is only ever offered for a win (a technique), never
for a gap or low rank** — that asymmetry is what makes opt-in naming safe (nobody is
named for being weak). `learningCount` stays aggregate in both directions — you never
see *who* learned from you; sharing never becomes scorekeeping. The pattern-extraction
batch (§14) needs a diversity/rotation objective, not pure top-N-by-score, so the same
1–2 people aren't credited every week (breeds resentment).

## 6. Enforcement (what Anthony builds)

- `coaching_manager_grant(id, business_id, store_id, staff_id, manager_id, scope text[]
  check ⊂ {growth_detail,session_insights,transcript_excerpts}, status
  {active,revoked,expired}, granted_at, expires_at, revoked_at, created_by)`. INSERT
  policy: `created_by = staff_id = auth.uid()`. `business_id` equal on both ends
  (trigger/CHECK — the `COACHING_MESH` cross-tenant wall).
- **One chokepoint:** `is_manager_granted(staff_id, manager_id, scope)` — called by
  every L1 table's non-self RLS branch. Checks **live, never cached**: grant is
  `active`, not expired, AND the grantee *still holds* `analytics.viewAll` (so a
  demoted/offboarded manager instantly loses access). Capability-based, not role-name —
  automatically covers owner, manager, and senior/SV.
- **Bands are computed in the DB** (projection view); raw numbers never reach an
  owner/manager surface.
- `coaching.exportRankings` capability (default on owner / off manager) gates bulk
  export/print of the rankings view.
- Staff-readable `coaching_manager_access_log` — written server-side when a grant-gated
  read actually returns rows (debounced) — so a staff member sees who accessed what.
- **The nightly L2-aggregation job runs as service-role and bypasses RLS** — that job,
  not the app RBAC, is the real place raw cross-staff data is readable in one process.
  Harden and isolate it.

## 7. Production surfaces that already violate this (fix before coaching ships live)

- **`StaffPerformanceTable.tsx` + `GapAnalysisList.tsx`** render **exact** numbers /
  `トップ層との差 28%` to the owner today — a live breach of "bands for everyone." De-number.
- **`AssignModulesCard.tsx`** filters `!isTopPerformer && consentGiven` — so a staff
  member who declined AI coaching is **excluded from receiving help modules.** Backwards:
  module assignment must be **decoupled** from AI-coaching consent (the most anxious /
  struggling are the ones you most want to be able to help).
- **`showSource = role === 'owner'`** is hardcoded, not gated by the source's consent.
- **Role model is binary `staff | owner`** (`role-context.tsx`) — manager must become a
  real capability tier.

## 8. Honest limits (don't oversell)

- **Small-team de-anonymization.** In a 3–5-person salon the owner knows everyone face
  to face; banding does not hide *identity* from the owner. Banding's job is **reframing
  (support-not-punish), not anonymity from the owner** — say that plainly, don't claim
  otherwise.
- **Social coercion is not fixable by RLS.** A staff member can be technically free to
  decline yet feel pressure to "look cooperative." The audit trail, decline-invisibility,
  rate limits, and aggregate-only adoption reduce it; they don't eliminate it. This is a
  product-culture problem, addressed in copy and defaults, not a database guarantee.
- **`recording.viewAll` is a live bypass.** The owner can already read the raw session
  recording (a pre-existing compliance/dispute boundary). An owner who listens can
  reconstruct what the coaching wall hides. This is the hardest open tension — decide
  deliberately with Anthony whether/how the raw-recording boundary and the coaching wall
  are reconciled; do not let a "simplifying" refactor silently merge their code paths.

## Related
- `COACHING_V2_DESIGN.md` (the engine + measurement), `COACHING_MESH.md` (cross-store),
  `AI_LEARNING_LOOP.md` (§16 multi-horizon, §14 patterns).
- Memory: `coaching-design-principle`, `voice-recognition-isolation`.
- Design mock (3 depths side by side): artifact 1a3e9114-9da6-409d-8323-7518b2674ff6.
