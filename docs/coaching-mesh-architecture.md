# Coaching Mesh — pointer (canonical design lives in the design spike)

> **This is a pointer, not the design.** The full Coaching Mesh architecture is
> the single source of truth in the design spike:
>
> **`synqed-karute-design-spike/docs/COACHING_MESH.md`**
> (a peer to `AI_LEARNING_LOOP.md` in that repo).
>
> Don't duplicate the design here — update it there. This file only exists so the
> boundary stays visible to anyone working in the production codebase.

## Why this file exists

Anthony builds in this repo. This note connects the multi-store foundation we're
building **now** to the future coaching system, so the isolation boundary isn't
accidentally violated before the mesh is ever built.

## TL;DR for Anthony

- **Future build, not now.** Coaching needs accumulated recording data first
  (`AI_LEARNING_LOOP.md` Rung 1, at scale). Today we only *reserve room* for it.
- **The one invariant to preserve:** coaching/training aggregates over a
  **configurable set of `store_id`s within one `business_id`** — never across
  `business_id` (gym vs salon = sealed vaults, even under one owner's login), and
  **only distilled models/patterns cross store lines, never raw `ai_interactions`
  rows.** ("Data never moves, only learning moves.")
- The multi-store work that establishes this boundary:
  - **karute:** `stores` table + `profiles.store_id` (PRs #163 / #164 / #166) —
    a store is a *location* scoped to `business_id`.
  - **synqed-core:** `docs/multi-store-synqed-core-spec.md` (PR #165) — adds
    `location_id` to customers / appointments / karute. Its "coaching aggregates at
    `business_id`" note is the **floor**; refine to *"a configurable set of
    `location_id`s within one `businessId`"* so cohorts + transfer edges slot in
    later without re-architecting.
- **Future tables** (all scoped to `business_id`): `coaching_cohorts`,
  `cohort_stores`, `coaching_transfer_edges`. Schema sketch, the three-layer design
  (tenant vault → cohorts → transfer mesh), the owner UX, and build sequencing are
  all in the spike doc.

## Read next

1. `synqed-karute-design-spike/docs/COACHING_MESH.md` — the full architecture.
2. `synqed-karute-design-spike/docs/AI_LEARNING_LOOP.md` — the sibling: *what* each
   store learns (the 4 rungs the mesh federates across stores).
