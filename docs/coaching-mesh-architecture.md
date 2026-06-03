# Karute Coaching Mesh — architecture (forward design)

> Status: **design / vision** for the future coaching system. Not built yet (coaching needs accumulated recording data first). This doc exists so the multi-store **foundation we're building now** (store_id + business_id) leaves exactly the right room — and so the eventual build is a genius, defensible structure, not a bolt-on.

## The problem (Liam's framing)
Different businesses (gym vs chiropractor vs salon) must **never** mix coaching/training data — different models entirely. But even *within* one business, the owner may want flexibility: pool all stores, train each store independently, or take a **top-performing store and use it to lift a struggling one**. The structure must be flexible, privacy-safe, and so well-abstracted nobody can copy it.

## The insight (and it's the cutting edge of multi-tenant AI)
This is exactly **federated learning + model merging + teacher-student distillation**, three techniques the best AI-SaaS uses ([federated learning](https://www.paloaltonetworks.com/cyberpedia/what-is-federated-learning), [SLM weight merging for multi-tenant](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/slm-model-weight-merging-for-federated-multi-tenant-requirements/4407315), [knowledge distillation](https://imentiv.ai/blog/unraveling-the-mystery-of-teacher-student-models-a-deep-dive-into-knowledge-distillation/)). The core principle:

> **Data never moves. Only *learning* moves.** Raw recordings/customers stay in their store + business forever. What flows between stores is the trained *pattern* (a model / distilled insight) — never a customer record.

That single principle is the moat: cross-store learning that is **privacy-preserving by construction** (huge for enterprise/legal), and a topology competitors can't see or replicate.

## The three layers

### 1. Tenant vault — `business_id` (hard, non-negotiable)
The absolute isolation boundary. Raw data never leaves a business; coaching never aggregates across `business_id`. Gym vs salon = different businesses = sealed vaults, even under one owner's login. This is the privacy/safety/legal floor + the gym-vs-salon correctness.

### 2. Coaching cohorts — configurable pooling (within a business)
The owner composes which stores' data **pools** to train a coaching model:
- **Default:** one cohort = all stores (whole-business pool — same model).
- **Independent:** each store is its own cohort (a per-location AI).
- **Custom:** arbitrary groups ("luxury" vs "express"; Tokyo vs Osaka).

A store's coaching trains on its cohort's pooled recordings. (Federated "shared vs tenant-specific model" choice, made per-cohort.)

### 3. Transfer mesh — directional knowledge edges (the magic)
Beyond pooling, the owner draws **directed "learns-from" edges**: a strong store's *model/patterns* inform a weaker store's coaching — teacher → student — **without merging identities or moving raw data** (model merging / distillation). The struggling store gets the winning playbook; each store keeps its own baseline. A store's effective coach = `base model ⊕ its cohort's pooled learning ⊕ incoming transfer edges`, composed at inference.

## The UX that hides all of it
Three toggles in Settings → Coaching, owner-only:
- **"Pool these stores' coaching"** (cohort membership)
- **"Keep this store independent"**
- **"Let store B learn from store A"** (a transfer edge)

Dead simple to the user. Underneath: a configurable, privacy-preserving federated-training topology. **Simplicity hiding the sophistication is the moat.**

## The "incomprehensibly genius" layer (later)
Karute can **suggest and auto-tune the mesh**: it notices "Store B's outcomes would lift if it learned from Store A's intake pattern" and proposes the edge; it A/B-tests cohort compositions and recommends the optimal topology per business. The system optimizes *its own training graph* — a self-improving federated coaching mesh. Nobody reverse-engineers that from the outside; they just see "the coaching keeps getting better."

## What the foundation must guarantee (now → build later)
- ✅ Every recording/karute row carries **`store_id` (location) + `business_id` (tenant)** — P1/P2 + the synqed-core spec (#165) already do this.
- 🔜 Future tables (all scoped to `business_id`): `coaching_cohorts (id, business_id, name)`, `cohort_stores (cohort_id, store_id)`, `coaching_transfer_edges (from_cohort, to_cohort, business_id)`.
- 🔒 The coaching loop reads training data over a **configurable set of store_ids within one `business_id`** — never hardcoded "all", never across businesses. Cross-store sharing is **model/pattern-level only** (federated), never raw data.
- This generalizes cleanly to the future **portfolio** (one owner, many businesses): each business has its *own* mesh; meshes never touch.

## Implication for #165 (synqed-core spec)
The earlier note "coaching aggregates at business_id" is the *floor*, not the unit: refine it to **"coaching aggregates over a configurable set of `location_id`s within one `businessId`"** so cohorts + transfer edges slot in without re-architecting. Still: never across `businessId`, and only models/patterns cross store lines — never raw rows.

## Why this wins
Privacy-preserving by construction (data never moves) → enterprise/legal-safe → unlocks big B2B. Owner-configurable training topology → no competitor offers it granularly. Self-tuning mesh → a moat that compounds. To the user it's three toggles; underneath it's federated learning done right.
