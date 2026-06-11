# Karute 多業種化 — Versatility Master Plan

**Status: PLAN ONLY — do not build until the trigger conditions (bottom) are met.**
Authored 2026-06-11 from a 4-lens council (CEO taxonomy / systems architecture /
product-UX / AI-prompts) + judge, at Liam's direction. Purpose: when we DO build
business-type versatility, nothing gets forgotten. Liam's ground rules baked in:
chunk-by-chunk, each independently testable, small PRs, switches in 設定 set as a
bundle by the signup business-type choice, prompts per type (structured), the
universal core never forks, and **the salon experience may never regress** —
La Estro is the first customer and the standing regression gate.

## 1. The decided architecture

One tenant-level keying point, six orthogonal capability axes, one sanctioned fork. The /welcome wizard's existing business_type (26 values, src/lib/welcome/business-types.ts) maps onto ~9 ARCHETYPES; the archetype defines a PRESET BUNDLE — a vector over 6 axes: (1) monetization engines {packs [shipped] / subscription / perVisit / treatmentPlan}, (2) status-engine variant + thresholds (fixed-gap [shipped, currently hardcoded 60/90] / per-customer-cycle / next-due-date / frequency-decay), (3) alert+outcome policies over FIXED vocabularies ('contact'|'low'; stable outcome enum for coaching), (4) terminology (next-intl message overlays merged in src/i18n/request.ts; category KEYS frozen as storage schema, display labels only), (5) prompt pack (versioned TS registry promoting src/lib/karute/business-ai-tokens.ts — base+overlay composition, per-type extraction examples/brief tokens/intake profiles, L3 domain fields as JSONB sidecar with pack-declared zod, owner knobs limited to clipped extraConcerns/customVocabulary), (6) compliance/consent tier (none → 景表法+薬機法 → 特商法 → 医療広告+あはき柔整 + NOT-カルテ positioning; disclosure mode C forced for clinical). Config lives in the org-settings JSON blob (synqed-core, zero migrations): business_type (already there) + sparse capability_overrides; resolveCapabilities() composes DEFAULTS → archetype preset → overrides at READ time, never materialized — so an empty config resolves bit-for-bit to today's salon behavior (the entire tenant-migration story) and preset improvements reach existing tenants. Within a tenant, a per-CUSTOMER resolveEntitlement() (priority plan > pack > subscription > perVisit) picks which model drives that customer's card token, alerts, and stop-dialog — making 'mixed' monetization free. Subscriptions and treatment plans get their own tables (subscriptions; treatment_plans + plan_stages) — NOT shoehorned into ticket_packs, whose withUsage math can't model monthly resets or stages. Components never branch on business_type (ESLint fence; CapabilitiesProvider/useCapability only); pack surfaces gate at the data-load boundary so empty states render free. The universal core (recording→transcription→extraction, 5-category memory, session history, QuickReserve sync, staff/RBAC, multi-store) never forks — with one architectural decision required before the studio archetype: recording formally becomes optional-per-archetype, decided ahead of time, not during.

> Correction baked in (council's own audit): `PackKind` is `'pack' | 'subscription' | 'single'`
> (src/lib/packs/types.ts:4) — earlier drafts said `'trial'`; any migration built from
> that would violate the existing check constraint.

## 2. The mind map (what supports what, where every switch lives)

```text
KARUTE 多業種化 — MASTER MAP
│
├─ SIGNUP  /welcome wizard → business_type (26 values — SHIPPED)
│   └─ maps to 1 of 9 ARCHETYPES → archetype = preset bundle
│       ├─ A1 整体・リラクゼーション … LIVE (reference implementation; massage/chiro/osteo/relax/aroma/foot_care/PT民間/wellness)
│       ├─ A2 エステ … course contracts + 前受金 + 特商法
│       ├─ A3 美容室・理容室 … per-visit + personal-cycle status (biggest market, NOT first wave)
│       ├─ A4 ネイル・マツエク … per-visit/sub, tight 35/60d cadence
│       ├─ A5 整骨院・鍼灸 … insurance+self-pay split (add wizard value: judo_therapy)
│       ├─ A6 歯科・クリニック … recall next-due-date, 医療広告, mode C FORCED (dental/medical/derm/cosmetic)
│       ├─ A7 パーソナルジム … course→卒業 lifecycle, body-metrics series
│       ├─ A8 ヨガ・ピラティス … subscription + frequency-decay (DO LAST — breaks 1:1 recording)
│       └─ A9 ペット (pet_grooming) … subject≠payer (vet deferred)
│
├─ BUNDLE = resolveCapabilities(business_type, capability_overrides) — read-time, never materialized
│   storage: org-settings JSON blob (synqed-core, no migrations) │ empty config ⇒ today's salon, bit-for-bit
│   │
│   ├─ AXIS 1 — monetization {packs, subscription, perVisit, treatmentPlan}
│   │   ├─ packs [SHIPPED]: src/lib/packs/*, 残N/M pill, 未消化¥, repurchaseCue
│   │   │     gate at DATA-LOAD boundary (alerts.ts loader / listCustomerPacks → safe empty)
│   │   ├─ subscription: NEW subscriptions table → 今月n/m pill, MRR(推定), 幽霊会員 alert
│   │   ├─ perVisit: zero schema → LTV/来店周期 profile card, no list token
│   │   ├─ treatmentPlan: NEW treatment_plans + plan_stages → ステージn/N, 中断 alert
│   │   └─ per-customer resolveEntitlement(): plan > pack > sub > perVisit ⇒ mixed = free
│   │   設定: 「ビジネスモデル」tab (absorbs 回数券 tab) — switches + one panel per enabled model
│   │
│   ├─ AXIS 2 — status engine {newDays 30, followupDays 60, dormantDays 90} + variant
│   │   ├─ fixed-gap [SHIPPED → params extracted from list-enrich.ts:296-316] = Kitano's ask
│   │   ├─ per-customer-cycle: 1.5× personal median (hair/nail/pet; flat fallback <3 visits)
│   │   ├─ next-due-date: recall overdue (dental)
│   │   └─ frequency-decay: paying-but-declining (studio, deferred)
│   │   surfaces: resolveCustomerStatus badges, list pills, chase queue, booking-clears rule
│   │   設定: ビジネスモデル tab footer — threshold inputs ({days}日以上 labels parameterized)
│   │
│   ├─ AXIS 3 — alerts + outcomes (vocabularies FIXED across all models)
│   │   ├─ resolveEngagementAlert: outputs only 'contact' | 'low' (red pill / amber, never forks)
│   │   ├─ OutcomePolicy per model: pack=current 3 modes │ sub=continue-intent │ perVisit=rebook Q │ plan=stage-complete
│   │   └─ outcome ENUM stable — coaching trains on enum, wording varies per pack
│   │   surfaces: stop dialog (RecordPageView), dashboard money pair per model + (推定) on estimates
│   │
│   ├─ AXIS 4 — terminology
│   │   ├─ next-intl overlays messages/terminology/<id>/{ja,en}.json, deep-merged in i18n/request.ts
│   │   ├─ ~52 ja.json keys carry 回数券/施術/お客様 today → phase-2 tokens {packNoun}{sessionNoun}{customerNoun}
│   │   └─ category KEYS = frozen storage schema; relabel display only
│   │   設定: terminology selector + live preview (ビジネスモデル tab)
│   │
│   ├─ AXIS 5 — prompt pack (THE one sanctioned business_type fork)
│   │   ├─ registry src/lib/ai/prompt-packs/<type>.ts — promotes business-ai-tokens.ts (26 personas exist)
│   │   ├─ composition: lang directive → universal base → pack overlay → defensivePreamble
│   │   ├─ pack owns: extraction examples, brief tokens + zod .describe(), intake base fields, outcome wording
│   │   ├─ L3 domain fields: JSONB sidecar + pack zod (NO enum migration — P2003 history)
│   │   └─ owner knobs: extraConcerns / customVocabulary only — clipped, never free prompt text
│   │   設定: AIタブ — read-only active-pack preview + the 2 knobs
│   │
│   └─ AXIS 6 — compliance / consent
│       ├─ guardrail tiers: none → 景表法+薬機法 → 特商法 contract surfaces → 医療広告+あはき柔整 + NOT-カルテ
│       ├─ OUTBOUND drafting block (NEW surface): chat/advice/suggestions/outreach routes
│       └─ disclosure mode: A default / C FORCED for clinical postures (mode C already built)
│       設定: read-only posture display — bundle-set, not owner-editable
│
├─ UNIVERSAL CORE — never forks, no gating
│   recording→transcription→AI extraction │ customer memory (5カテゴリ) │ session history
│   QuickReserve sync │ staff/RBAC │ multi-store + entitlements │ audit/theme/intake ENGINE
│   └─ one pre-decision before A8: recording = optional per archetype (architectural, not in-flight)
│
└─ ENFORCEMENT
    ├─ ESLint: ban business-types imports in src/components/** (allowlist: welcome, settings/organization)
    ├─ CapabilitiesProvider + useCapability (client) / getCapabilities (server, rides org-settings cache)
    └─ STANDING GATE: seeded pack-only tenant — snapshot tests + screenshot-diff e2e, byte-identical per chunk
```

## 3. The chunk sequence (build order — each chunk = small, independently-testable PRs)

### PHASE 1 — Capability foundation (invisible, salon-safe)

PHASE 1 — Capability foundation (invisible, salon-safe): PR1 src/lib/capabilities/ types + resolveCapabilities + archetype presets (ALL presets initially = salon defaults) + unit tests, pure lib with zero consumers; PR2 extract hardcoded 30/60/90 from resolveCustomerStatus (list-enrich.ts:296-316) and 20d/残1 from resolvePackAlert into capability params, with regression tests proving default-config output is bit-identical + parameterize {days}日以上 i18n labels in the SAME PR — this alone ships Kitano's threshold-configurability ask; PR3 CapabilitiesProvider/useCapability + gate all pack surfaces at the data-load boundary (alerts.ts loader, listCustomerPacks return safe-empty when monetization.packs off; default ON) + ESLint fence banning business-types imports from components. GATE: seeded pack-only tenant screenshot-diff e2e (list L3 / profile card / dashboard / stop dialog) byte-identical — this e2e becomes the standing gate for every later phase.

### PHASE 2 — Prompt-pack foundation

PHASE 2 — Prompt-pack foundation: PR4 PromptPack type + registry, refactor personaLine/personaSystemFragment onto it (packs = the 26 existing personas in business-ai-tokens.ts), structural tests per pack (vocabulary present, guardrail line present, no cross-pack leakage, lang directive first, defensivePreamble present); PR5 de-salonize prompts.ts base (move 美容ウェルネス framing + 右肩の張り few-shots into the salon pack) with BYTE-IDENTICAL salon prompt snapshot; PR6 golden-transcript eval harness (scripts/eval/, nightly not per-commit) + salon golden set built from anonymized La Estro transcripts = permanent salon regression gate. GATE: salon snapshot byte-identical; golden run green.

### PHASE 3 — Settings + signup surfaces

PHASE 3 — Settings + signup surfaces: PR7 rename/absorb 設定→回数券 into 「ビジネスモデル」 tab — monetization switches + default, per-enabled-model collapsible panels (回数券 panel = PacksSection content verbatim), threshold footer, terminology selector, preset-default-vs-overridden indicators + per-switch reset; pack-only tenants see one open 回数券 panel ≈ pixel-identical, old route deep-link preserved; PR8 wizard Step 1.5 収益モデル — type maps to preset shown as pre-checked editable switches + live mini-preview of L3 token and money pair, completeOnboarding writes the bundle; PR9 business-type CHANGE semantics: confirm dialog + explicit keep-or-clear capability_overrides + AI cache invalidation. GATE: standing e2e; '' /unknown business_type resolves to salon defaults (legacy-tenant migration is zero data changes).

### PHASE 4 — Terminology overlays

PHASE 4 — Terminology overlays: PR10 deep-merge mechanism in i18n/request.ts (try/catch tenant lookup, base-message fallback for unauthenticated routes, rides org-settings unstable_cache — verify upsertOrgSettings updateTag covers it) + Jest test asserting every overlay key exists in base; PR11 first non-salon terminology pack + per-type category DISPLAY labels (extend src/lib/karute/categories.ts; keys untouched). Phase-2 follow-on (later): parameterize high-traffic strings with {packNoun}/{sessionNoun}/{customerNoun} tokens. GATE: salon loads base messages byte-identical; overlay-subset test green.

### PHASE 5 — Outcome + entitlement spine (the deepest cut, still dark)

PHASE 5 — Outcome + entitlement spine (the deepest cut, still dark): PR12 OutcomePolicy strategy extraction from resolveOutcomeMode/stop dialog — pack policy reproduces today's conversion/auto/repurchase exactly; all future policies serialize to the ONE stable outcome enum (outcome-types.ts) so coaching labels never fragment; PR13 per-customer resolveEntitlement() (returns 'pack' for everyone when nothing else enabled) + MonetizationPosition union introduced with a SINGLE 'pack' variant across the ~7 rendering surfaces (list pill, profile card, dashboard, recording target, alerts) — then each new variant is one PR each, defusing the un-sliceable refactor. GATE: standing e2e + outcome-label snapshot; 'auto' mode ledger write guarded by entitlement type with a test per model.

### PHASE 6 — Subscription engine (first new monetization, prerequisite for gym/studio)

PHASE 6 — Subscription engine (first new monetization, prerequisite for gym/studio): PR14 audit + backfill the barely-used legacy ticket_packs kind='subscription'/'single' rows BEFORE the resolver treats them as live; PR15 new subscriptions table (plan_name, monthly_price, period_visit_allowance, anchor_day, status, cancelled_at) + period math (今月n/m) ; PR16 inverted alerts (幽霊会員 paying-not-visiting, paused>14d, cancel-pending) emitting only 'contact'/'low' + dashboard MRR(推定)+解約リスク segment + サブスクプラン settings panel. Replace NEXT_PUBLIC_FEATURE_SUBSCRIPTION with double gate (env AND capability) until Karute's own billing is real; disambiguate labels: 契約・支払い (Karute's SaaS billing) vs ビジネスモデル (customer plans). GATE: standing e2e — pack-only tenants see zero change; no segmented control renders for them.

### PHASE 7 — Per-visit + personal-cycle status

PHASE 7 — Per-visit + personal-cycle status: PR17 visit-cadence stats (personal median interval; flat 60d fallback when <3 visits or QuickReserve history sparse) + per-customer-cycle status variant (1.5× overshoot); PR18 PerVisitCard (累計LTV, 平均単価, 来店周期, 次回予測 — read-only, no list token, recency rail carries the signal). Unlocks hair/nail/pet archetype presets without new monetization work. GATE: standing e2e; young-tenant fallback test (alerts must not silently cover 0%).

### PHASE 8 — Vertical wave 1, エステ + パーソナルジム (first sold non-salon archetypes)

PHASE 8 — Vertical wave 1, エステ + パーソナルジム (first sold non-salon archetypes): エステ = course-contract mode on treatment-plan machinery + 前受金残高 dashboard number + 特商法 scope decision implemented (render consumed/remaining ONLY, no cancellation-refund figure, unless statutory math is built and counsel-reviewed); ジム = L3 domain-fields pilot end-to-end (numeric-series body metrics: zod sidecar → extraction → generic card render) + graduation/conversion loop on the EXISTING 卒業 lifecycle + subscription continuation. Both ship dark for non-enabled tenants. GATE: standing e2e + archetype golden transcripts green + esthe/gym preset bundles real (not the admitted prototype preview numbers).

### PHASE 9 — Vertical wave 2, 整骨院 + ペット

PHASE 9 — Vertical wave 2, 整骨院 + ペット: 整骨院 = per-visit payer split (保険/自費) + 保険→自費 conversion funnel dashboard + medical-adjacent guardrail prompt layer (あはき・柔整 ad limits, NOT-レセコン/NOT-施術録 in-product language) + new judo_therapy wizard value — this is the de-risked rehearsal for dental; ペット = subject≠payer (pet profiles under owner/household account, breed-cycle thresholds, dignified terminal state reusing graduated/lost semantics with different labels). GATE: standing e2e + counsel review of 整骨院 outbound compliance block BEFORE selling the archetype.

### PHASE 10 — Vertical wave 3, 歯科 (highest prize, heaviest bar — only after Phase 9 hardens positioning)

PHASE 10 — Vertical wave 3, 歯科 (highest prize, heaviest bar — only after Phase 9 hardens positioning): recall next-due-date status variant (リコール率 dashboard) + treatment_plans/plan_stages full surfaces (ステージn/N, 中断患者 alert = dentistry's exhausted-unrenewed analog) + 医療広告ガイドライン outbound block + mode-C consent FORCED by bundle + APPI 要配慮個人情報 data-layer legal review completed. Positioning hard line in product AND marketing: customer-communication/recall layer, never 診療録/電子カルテ/レセコン. GATE: standing e2e + counsel sign-off as a launch gate per clinical type, not a code-review item.

### PHASE 11 — Deferred tail

PHASE 11 — Deferred tail: スタジオ (frequency-decay alerts, membership-tier vs usage, group model — REQUIRES the recording-optional-per-archetype core decision made explicitly first) and スクール (payer=parent subject=child inherits pet machinery; 特商法 inherits esthe machinery; March-cliff seasonality). Each enters only when its prerequisite modules exist and a design partner is signed.

## 4. Forget-me-nots (the details that must not get dropped — Liam's explicit fear)

- FIX THE PLAN DOC NOW: PackKind is 'pack'|'subscription'|'single' (verified src/lib/packs/types.ts:4) — the master plan's 'trial' is wrong; any subscription migration built from the doc would violate the existing check constraint.
- Legacy tenants with business_type='' (org-settings.ts:80) must resolve to SALON defaults, not the neutral 'other' preset — or existing tenants lose pack surfaces on deploy day. Mirror DEFAULT_PERSONA fallback but salon-flavored for capabilities.
- Threshold config and label copy ship in the SAME PR: 休眠（90日以上） badge copy is load-bearing (list-enrich.ts:313-316) — numeric settings without {days} parameterized labels means badges contradict the rule.
- Stop-dialog 'auto' mode currently means 'consume 1 pack session': the redemption-ledger write MUST be guarded by entitlement type (test per model) — a mis-resolved entitlement silently corrupts pack counts, the salon's core trust artifact.
- Outcome enum is the coaching training stream (docs/karute-session-outcome-spec.md): add values, NEVER repurpose; per-type wording lives in the prompt pack, enum stays frozen, or months of labeled data become incomparable at coaching launch.
- The 5 memory categories and karute_entries.category enum are FROZEN storage schema (P2003 production bug documented in src/types/ai.ts) — terminology relabels display strings only; per-type fields go in the L3 JSONB sidecar, never new enum values.
- Estimated money gets (推定) + muted treatment locked in the design spec: pack 未消化¥ is real ledger liability, subscription MRR and per-visit 離反リスク¥ are estimates — identical visual authority = owners deciding on fake precision.
- 特商法 trap (esthe, later schools): either implement statutory mid-term-cancellation refund math correctly (penalty cap = lower of ¥20,000 or 10% remaining) with counsel review, or visibly scope to consumed/remaining sessions and NEVER display a cancellation-refund figure.
- NOT-a-カルテ hard constraint, written into the plan not marketing nuance: if Karute is perceived as 電子カルテ/診療録/施術録/レセコン it triggers 3省2ガイドライン + record-keeping law it cannot meet — explicit in-product language for every clinical-adjacent archetype.
- Outbound AI copy is a per-archetype regulatory surface applied to EVERY drafting channel (chat/advice/suggestions/outreach), not one route: 薬機法+景表法 baseline, 医療広告ガイドライン for clinical, あはき・柔整 ad limits for 整骨院, 獣医療法 for vet — counsel review is a per-type LAUNCH gate.
- Mode C consent FORCED (not recommended) by the bundle for clinical postures; APPI 要配慮個人情報 needs data-layer legal review (retention/deletion), not just prompt guardrails, before the first clinic onboards.
- Audit/backfill legacy ticket_packs kind='subscription'/'single' rows BEFORE resolveEntitlement treats them as live — or salon tenants grow phantom subscription customers overnight.
- i18n/request.ts tenant lookup must be try/catch with base-message fallback (landing/auth pages) and ride the existing org-settings unstable_cache; verify upsertOrgSettings updateTag invalidates terminology in PR, or changes lag ~5 min.
- NEXT_PUBLIC_FEATURE_SUBSCRIPTION is a build-time global: keep the double gate (env AND per-tenant capability) until Karute's own billing is real; name the tabs 契約・支払い vs ビジネスモデル to kill the SubscriptionSection collision.
- Business-type change after signup = re-bundle: confirm dialog + explicit keep-or-clear capability_overrides + AI cache invalidation (pack.version in cache keys, generalizing ai-brief.ts v:4 pattern) — otherwise stale overrides from the old type linger invisibly.
- zod .describe() strings ship to the model and silently override system rules (ai-brief.ts:21-23): the pack registry owns BOTH rule text and describe tokens, enforced by a structural drift test.
- Owner AI overrides stay bounded (extraConcerns/customVocabulary, clipped via ai-safety.ts) — free-form prompt text in org-settings is an owner-level injection channel into staff-facing output.
- Wizard taxonomy reconciliation ships in the SAME chunk as the first bundle switch: all 26 BUSINESS_TYPES (whose preview numbers are admitted prototype fakes) must map to an archetype, plus the new judo_therapy value, or tenants exist with no bundle.
- Coaching sealed-vault rule: business_id + business_type scope cohorts — no pooling 'similar' types (massage+chiro) for training without an explicit reviewed exception, or the legal/quality isolation story collapses.
- Two architectural pre-decisions, made deliberately not in-flight: (a) recording optional per archetype BEFORE studio (group classes have no 1:1 session recording); (b) multi-pet/multi-child subject≠payer data model BEFORE vet (one-customer=one-subject breaks on households).
- Eyelash archetype onboarding copy must not assist unlicensed operation (lash extensions legally require 美容師免許 per MHLW notice).
- Market figures in the plan are directional (衛生行政報告例/Yano-class, from memory) — re-verify every number before board materials, pricing models, or the franchise pitch.
- Mobile mixed-model dashboard: segmented control defaults to revenueModels.default AND persists — a salon owner stranded on the MRR segment after exploring once breaches the 'my salons are the first customer' bar.
- Content scale is the hidden cost: 26 types × bilingual examples/intake/outcome wording/golden transcripts is weeks of content work, not engineering — ship ~9 archetype-level packs with per-type tokens only where they differ; generic fallback covers the long tail.

## 5. Rejected approaches (do not relitigate without new information)

- Reuse ticket_packs.kind='subscription' for monthly plans (UX) — REJECTED: withUsage's pack_size−redeemed math cannot model a monthly-resetting allowance, and the proposal was grounded on a nonexistent 'trial' kind (code says 'single'). New subscriptions table; migrate legacy rows after audit.
- Treatment plans as ticket_packs kind='plan' (UX) — REJECTED: stages, target dates, phases, and per-stage/upfront billing don't reduce to a redemption ledger; dedicated treatment_plans + plan_stages tables (ARCHITECT).
- 26 per-type forked configs — REJECTED for the 2-layer system: ~9 archetype bundles set behavior, the 26 wizard values only tune vocabulary/prompts (CEO). 26 forks = unmaintainable support surface.
- A new capabilities/settings DB table — REJECTED: the org-settings JSON blob is the documented extension path (org-settings.ts:41-42), zero migrations, and billing entitlements already live orthogonally in business_entitlements.
- Materializing the resolved bundle at signup (or storing full prompt text in org-settings) — REJECTED: frozen-at-signup config rots as presets improve, and owner-editable prompt text is an injection channel that bypasses code review and golden tests. Sparse overrides + read-time resolution; prompt packs are versioned code.
- business_type if-branches in components — BANNED via ESLint no-restricted-imports (allowlist: welcome, settings/organization); capabilities hook is the only consumption path. Verified only 2 legitimate readers exist today.
- Per-type Prisma enum values for karute categories — REJECTED: synqed-core migration with cross-tenant blast radius and a documented P2003 production failure (src/types/ai.ts). L2 display labels + L3 JSONB sidecar instead.
- Hair salon in the first expansion wave despite the biggest establishment count (~370k) — REJECTED: lowest ARPU tolerance, entrenched POS/karte competitors (Salon Board), and it forces per-customer-cycle work without willingness-to-pay payoff. Capability-coverage × pain-fit picks esthe → gym → 整骨院.
- Gating every CI run on live-model golden evals — REJECTED: nondeterministic + token cost. Tier 1 structural tests per commit; golden transcripts nightly/on-demand, gating only pack-touching PRs, assertion-scored not judge-scored.
- Keeping a separate 回数券 settings tab alongside a new ビジネスモデル tab — REJECTED (single source of truth, no shims): rename/absorb, packs panel moves verbatim, deep-link preserved.
- Pooling 'similar' business types into shared coaching cohorts — REJECTED: violates the sealed-vault rule (business_id + business_type scoping) that is both the legal isolation story and the quality story.
- Veterinary and schools in the current plan — DEFERRED, not designed around: vet needs the multi-subject household model and 獣医療法 ad work; schools need 特商法 + subject≠payer machinery from esthe + pets first (March-cliff seasonality on top).
- Per-business-type model routing in prompt packs — REJECTED: model selection stays per-surface (AI_MEMORY_MODEL → AI_MODEL env), orthogonal to packs.
- Building the statutory 特商法 refund calculator speculatively in wave 1 — REJECTED until counsel-reviewed: scope esthe money surfaces to consumed/remaining and never render a cancellation-refund figure in the interim.

## 6. When to actually build

Phases 1–2 (capability lib + threshold extraction + prompt-pack registry) need NO external trigger — they are pure salon-safe refactors that ship Kitano's threshold-configurability ask and the regression harness; build them opportunistically in slack time, since they de-risk everything else and change nothing visible. Everything from Phase 3 onward triggers on: (1) FIRST NON-SALON DESIGN PARTNER SIGNED — a paying esthe, personal-gym, or 整骨院 owner committed to weekly feedback (ideally inside the QuickReserve ecosystem); the partner's archetype decides whether Phase 6/7/8 ordering flexes. Per-vertical chunks then trigger one-by-one on a signed partner for that archetype — never build a vertical on spec. Hard gates regardless of demand: clinical archetypes (整骨院 wave 2, dental wave 3) additionally require Japanese-counsel sign-off on the outbound compliance block and the APPI sensitive-data layer BEFORE selling, and dental enters only after 整骨院 has hardened the NOT-a-medical-record positioning in production; studio enters only after the recording-optional core decision is made explicitly. Standing preconditions throughout: La Estro salons stable on current behavior (the standing screenshot-diff gate green), QuickReserve sync healthy, and the salon golden-transcript set in place before any base-prompt edit.
