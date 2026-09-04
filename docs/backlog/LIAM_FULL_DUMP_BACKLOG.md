# Liam full-dump core backlog

**As of:** 2026-09-01

**Intake owner:** Anthony

**Source of truth:** Liam's latest full dump. Its discard section supersedes the discard section of the earlier 8/16 message.

**Milestone rule:** intake control only. Do not implement additional coaching or Reserve-member work from this document until its decision gates are closed.

## Status vocabulary

Status labels have these meanings:

- `confirmed live` / `confirmed live—do not touch` — verified baseline or explicitly excluded work; protect with regression coverage.
- `implemented` / `implemented uncommitted` — implemented and verified in the local `synqed-core` working tree, but not committed unless stated otherwise.
- `ready` — acceptance criteria and dependencies are sufficiently known for an isolated implementation slice.
- `blocked by decision` / `blocked` — a named decision, missing specification, or prerequisite must close first.

Section A's core-ten release rollup uses only the normalized labels `implemented`, `confirmed live`, and `blocked by decision`. Intake-only sections retain their original labels.

## Evidence policy and catalog

There is **no Linear integration for Synqed**. `L0` is therefore the Linear evidence for every item: **N/A — project has no Linear integration (user-confirmed); tracker absence is not a blocker.**

Repository snapshots used for this intake:

- Karute: `Synqed-kk/karute@f201a9a`
- Core: `Synqed-kk/synqed-core@3daa50a`, plus the explicitly identified uncommitted changes below
- Reserve: `Synqed-kk/reserve@cff817b`

### Code evidence

| ID | Evidence |
|---|---|
| K1 | `karute/src/lib/coaching-consent/hooks.ts` is a localStorage scaffold; its `PROD SWAP (ANTHONY)` requires append-only consent rows, staff self read/write, and an owner rollup rather than raw logs. Liam's latest aggregate-only rule supersedes any scaffold detail that exposes identities. |
| K2 | `karute/src/lib/coaching-dev-preview/types.ts` says role preview is client-only and the production data boundary must remain server/RLS enforced. This is the current replacement for the stale `role-context.tsx` citation. |
| K3 | `karute/src/components/settings/redesign/sections/CoachingSection.tsx:33-41` names the eight proposed coaching settings; the UI is local-state-only. Its non-append-only consent sketch is rejected by the latest dump. |
| K4 | `karute/src/components/coaching/redesign/personal-growth-types.ts` declares `InsightOutcome` (`worked`, `tried`, `skipped`, and unconfirmed state); current screens have no core write path. |
| K5 | `karute/src/actions/karute.ts` writes interactive records using `getCurrentUserStaffId()` or appointment staff. `karute/src/lib/staff.ts` resolves the signed-in profile/auth UUID. `karute/src/lib/karute/synqed-records.ts` and `karute/src/lib/supabase/karute.ts` explicitly document that Synqed staff IDs and profile IDs differ. The cited `karute/src/lib/recordings/inbox-read.ts:16-22` is absent from the current tree and fetched history. |
| C1 | Uncommitted core discard-status slice: `synqed-core/prisma/schema.prisma`, `prisma/migrations/manual/2026-09-01-karute-discarded-status.sql`, `src/{routes,services,validations}/karute*`, SDK types/client, `tests/karute-discarded-status.test.ts`, and SDK serialization tests. Focused 6/6 and broader Karute 33/33 passed; typecheck and SDK build passed. |
| C2 | Uncommitted no-session discard slice: `synqed-core/prisma/migrations/manual/2026-09-02-recording-discard-karute-key.sql`, `src/routes/recording-discards.ts`, `src/services/recording-discard.service.ts`, SDK types, `tests/recording-discards.test.ts`, and `tests/client-recording-discards.test.ts`. Focused 5/5, typecheck, SDK build, and idempotent migration checks passed. |
| C3 | `synqed-core/src/services/recording-discard.service.ts` and `prisma/migrations/manual/2026-08-17-recording-discard-events.sql` implement the session-based written-reason ledger and normalize staff actors to card IDs. The ledger deliberately has no session FK, so session deletion does not erase it. |
| C4 | Uncommitted recordings-ID slice: `synqed-core/src/validations/recording.ts`, `src/services/recording.service.ts`, SDK types/client, `tests/recordings-list-ids.test.ts`, and `tests/client-recordings-list-ids.test.ts` add customer-style batch lookup. Focused 3/3, core typecheck, and SDK build passed. Recording update remains fenced only by business; segment `createMany` still has no segment-index conflict rail, and `prisma/schema.prisma` still has only a non-unique transcription-segment index. |
| C5 | Uncommitted redemption-link read slices: `synqed-core/src/services/packs.service.ts`, `packages/client/src/{packs.ts,types.ts,index.ts}`, `tests/packs-list-redemptions-links.test.ts`, and `tests/packs-recent-redemptions.test.ts` expose stored `appointment_id` and `karute_record_id` on customer and recent redemption reads. Service→API→SDK linked/null regressions, all 5 recent date/price tests, core typecheck, and SDK build passed. |
| C6 | `synqed-core/src/services/staff.service.ts` paginates with `orderBy: { name: 'asc' }` only. |
| C7 | `synqed-core/src/services/karute-outcome.service.ts`, `src/routes/karute-outcomes.ts`, and SDK `ListKaruteOutcomesOptions` lack `staff_id` and `karute_record_id` filters. |
| C8 | `synqed-core/packages/client/src/types.ts` and `src/services/recording-discard.service.ts`: discard list supports one session ID and source only; no date range or session-set filter. |
| C9 | `synqed-core/prisma/schema.prisma`: `Customer.totalSales` is a mutable scalar; `CustomerVisit.salesAmount` stores settled visit value; no customer-account, points-ledger, rank-config, or order model exists. |
| C10 | `synqed-core/prisma/schema.prisma` defines `StatusSource` with `SYSTEM`, `QR`, and `STAFF`; booking consent/UTM fields and `CUSTOMER` are absent. |
| C11 | `synqed-core/src/services/permission-rulebook.ts` makes `recordings.viewAll` owner-only and strips it from non-owners. It has no `coaching.exportRankings`. `prisma/migrations/manual/2026-06-25-auth-profiles.sql` gives `public.profiles` `permission_role` and `permissions jsonb`, but the core API still authenticates business credentials rather than a person. |
| C12 | `synqed-core/tests/coaching-boundary.test.ts` explicitly records that no coaching/aggregation service exists. No requested coaching table/service was found in core. |
| C13 | Confirmed Reserve baseline: menus (`src/services/menu.service.ts`), create/update overlap guards and resource occupancy (`src/services/appointment.service.ts`, `tests/appointments.test.ts`, `tests/bed-plane.test.ts`), appointment idempotency (`src/services/idempotency.service.ts`, `tests/appointment-idempotency.test.ts`), burn uniqueness (`prisma/migrations/manual/2026-07-28-pack-redemptions-appointment-unique.sql`), cancellation taxonomy/history (`prisma/migrations/manual/2026-07-05-appointment-status-audit.sql`, `2026-08-27-booking-status-history.sql`), store policies (`src/services/store-policy.service.ts`), server pricing (`src/services/pricing.service.ts`), hours/closed days/resources (`2026-08-28-bed-plane-phase2a.sql`, `src/services/resource.service.ts`). |

### Documentation evidence

| ID | Evidence |
|---|---|
| D1 | `reserve/docs/P0_ANTHONY_BRIEF.md`: customer-scoped BFF/core routes, one cross-tenant account linked to many business Customer rows, session transport as Anthony's P0 decision, settled-spend/rank requirements, orders/Stripe-to-pack path, and points dependency order. |
| D2 | `reserve/docs/POINTS_ECONOMY.md`: append-only signed ledger, balance by sum, typed entries, ADJUST-only correction, earn-only v1, expiry rows/job, and unresolved per-org versus platform-wide balance scope. |
| D3 | `reserve/src/contracts/customer-api.v0.ts`: auth response/session shape deliberately absent; booking input already specifies marketing opt-in, disclosure acknowledgement, and UTM; pack purchase is webhook-fulfilled and never client-written. `reserve/src/lib/reserve-api/session.ts`, `SignInPage.tsx`, and `WalletPage.tsx` are explicitly mock/theater. |
| D4 | Liam's latest dump is the only available canonical coaching requirement source. The cited `karute/docs/coaching/COACHING_VISIBILITY_MODEL.md`, `COACHING_V2_DESIGN.md`, and referenced `CORE_CONTRACT.md` do not exist in current Karute or fetched history. Exact V2/§6-only details must be restored before code claims compliance. |

## Decision gates

Defaults below are recommendations, not silent approvals. Owners must record a decision in this artifact (or a linked ADR) before the blocked builds start.

| Gate | Unresolved question | Recommended default | Decision owner | Exactly blocked builds |
|---|---|---|---|---|
| G1 — staff actor/data door | How does core authenticate the **person**, not only `x-api-key + x-business-id`, for ownership and private coaching reads: actor-aware API or direct Supabase reads? | **Implemented for the D5/D10 slice.** The Karute BFF forwards a request-scoped Supabase access token; core verifies it with Supabase Auth, resolves its subject to an active in-business staff card, and derives live capabilities. Missing/invalid bearer returns 401; valid nonmember/inactive returns 403; a caller-supplied actor UUID is never trusted. The reusable contract is documented in `synqed-core/docs/actor-auth-contract.md`; future private coaching reads must adopt the same boundary. | Anthony (core/security), Liam consulted on app contract | D5; D10; C1; C2a-C2h; C3b-C3c; C4a-C4h; C5; X1. C3a data normalization may proceed independently. |
| G2 — customer session transport | Supabase session, application cookie, or bearer; who refreshes/revokes it; what can core verify? | Supabase OTP/OIDC with session material held in `HttpOnly`, `Secure`, `SameSite=Lax` Reserve-server cookies. Reserve BFF refreshes; customer-scoped core endpoints verify the short-lived Supabase JWT. The browser never receives a core API key. | Anthony | M0-M5. |
| G3 — cross-tenant account linking | How is one verified account linked to Customer rows across businesses without unsafe guess-merges? | Add explicit `customer_accounts` plus business-scoped link rows. Link only after verified OTP/OIDC and an explicit claim/booking flow; normalized phone is primary, verified email secondary; never auto-merge conflicting identities. | Anthony (data/auth) + Liam (claim UX) | M0; M1 account balance reads; M2 rank/my-page reads; M3 authenticated purchase; M4 customer-authored booking audit. |
| G4 — points balance scope | Is a points balance per business/org or platform-wide? | Per-business for v1, while every ledger row carries `org_id` so a later platform aggregation is additive rather than a migration. | Liam (product/economy), Anthony validates legal/accounting rails | M1 only. |
| G5 — coaching canonical specification | What are the exact L1 table list and exact §6 policy/grant definitions that were said to be in missing docs? | Restore the two named coaching documents (or replace them with a ratified ADR) before schema/RLS work. The latest dump overrides conflicting scaffolds; tests must cite the restored clauses. | Liam supplies/ratifies; Anthony security-reviews | C2b-C2g; C3c; C4a-C4h; C5's policy-literal and cross-read launch checks. |
| G6 — owner audio asymmetry | Should `recordings.viewAll` be reconciled with coaching's wall when raw audio can reconstruct hidden coaching data? | Keep the pre-existing owner-only audio boundary for now, document the asymmetry and purpose limitation, and prohibit coaching-derived indexing/search from bypassing L1 grants. Revisit only with compliance evidence. | Liam (product/privacy) + Anthony (security) | C6 only; it does **not** block C1-C5 implementation after G1/G5 close. |
| G7 — transcript visibility history | Does changing private/manager-viewable transcript mode expose past transcripts? | Apply the setting at read time, including past transcripts, as Liam leans; require an audited manager read and never let it imply coaching transcript-excerpt consent. | Liam approves semantics; Anthony enforces | X1 and the transcript-excerpt portion of C4c/C4d. |
| G8 — computer-created Karute binding | How is a record with no booking attached bound and attributed? | Keep `appointment_id` nullable. Require business, customer (when known), normalized staff owner, provenance (`COMPUTER`), and optional recording/session link; do not synthesize a booking. | Anthony (core shape) + Liam (product attribution) | X2 only. |

## A. Discard and recording core

| ID | Requested item | Status | Priority | Repo | Dependencies | Acceptance criteria | Evidence (code / docs / Linear) |
|---|---|---|---|---|---|---|---|
| D0 | Preserve the shipped session-based written-reason discard row. | `confirmed live` | Protect | synqed-core | — | STAFF discard still requires normalized actor + nonblank trimmed reason; SYSTEM still forbids both; create/list behavior remains compatible. | C3 / latest dump / L0 |
| D1 | Add `DISCARDED` to `KaruteStatus`; accept create-as-discarded and saved→discarded, retaining who/when. | `implemented` | P0 | synqed-core | — | Enum/migration/API/SDK accept the value; create retains `staff_id` + `created_at`; update retains actor in `last_edited_by_staff_id` + `updated_at`; focused create/update tests pass. | C1 / latest dump / L0 |
| D2 | Exclude discarded records from `karuteRecords.list` and `get(id)` by default; add `include_discarded`; `getByRecordingSession` always sees all statuses. | `implemented` | P0 | synqed-core | D1 | Default list omits and default get 404s; opt-in returns discarded; by-recording and idempotent retry return the original discarded record. | C1 / latest dump / L0 |
| D3 | Keep `total` non-discarded even on mixed lists; return discarded count separately. | `implemented` | P0 | synqed-core | D1-D2 | `total` counts matching non-discarded rows, `discarded_count` counts discarded rows, and mixed pagination is documented/tested as `total + discarded_count`. | C1 / latest dump / L0 |
| D4 | Persist late-discard reason without a recording session by accepting `karute_record_id` as an alternative key. | `implemented` | P0 | synqed-core | D0 | At least one of session/karute IDs is required at API, SDK type, service, and DB check; karute-only STAFF row retains trimmed written reason; session behavior unchanged. | C2 / latest dump / L0 |
| D5 | Manager confirmation surface for discard rows (`confirmed_by`, `confirmed_at`) plus update call. | `implemented` | P0 | synqed-core | D0, G1 | Nullable paired audit fields and an idempotent empty-body confirmation update are implemented. Core-derived actor capabilities require both `records.delete` and `stores.viewAll`; the first confirmer/timestamp remain immutable; focused authorization, actor normalization, and retry tests pass. | C3, C11 / latest dump / L0 |
| D6 | `recordings.list` `ids?: string[]` filter like customers. | `implemented` | P1 | synqed-core | — | API/SDK serialize a comma-separated value bounded to 5,000 characters; non-empty IDs return the complete requested in-business set without pagination, matching `customers.list`; empty IDs fall back to the ordinary paginated list; focused API/SDK tests pass. | C4 / latest dump / L0 |
| D7a | `packs.listRedemptions` return `karute_record_id` and `appointment_id`. | `implemented` | P1 | synqed-core | — | Service select, public response, and exported SDK `PackRedemption` return both nullable links already stored by writes; old fields are unchanged; one service→API→SDK regression test covers linked and unlinked rows. | C5 / latest dump / L0 |
| D7b | `listRecentRedemptions` return `karute_record_id` as well as existing `appointment_id`. | `implemented` | P1 | synqed-core | — | Service select, API response, and SDK `RecentRedemption` include the nullable karute link; existing appointment/date/price fields are unchanged; one SDK→API→service regression covers linked and null rows and all existing date/price tests pass. | C5 / latest dump / L0 |
| D8 | Unique `(recording_session_id, segment_index)` for transcription segments. | `implemented` | P0 | synqed-core | — | Prisma and SQL enforce uniqueness. The idempotent migration aborts with duplicate-group/session evidence instead of deleting transcript content; local preflight found 0 duplicate groups. Repeated/concurrent `replace:false` writes produce one success and a stable 409 conflict; focused tests pass. | C4 / latest dump / L0 |
| D9 | Add `id` tiebreak to paginated `staff.list`. | `implemented` | P1 | synqed-core | — | Ordering is `name ASC, id ASC`; the equal-name three-page seam regression traverses every row exactly once. | C6 / latest dump / L0 |
| D10 | Fence `recordings.update` by session ownership, not business only. | `implemented` | P0 | synqed-core + Karute BFF | G1 | Core derives the actor from the verified bearer token. `records.write` permits own-session mutation; cross-owner mutation additionally requires `recordings.viewAll`; missing/invalid/nonmember actors are denied without mutation and the business fence remains. Karute forwards the request-scoped bearer token. | C4, C11 / latest dump / L0 |
| D11 | Keep discard ledger after recording-session deletion; no new FK work. | `confirmed live` | Protect | synqed-core | — | Existing no-session-FK durability regression remains green; no cascade FK is introduced. | C3 / latest dump's verified exclusion / L0 |
| D12 | Keep `discarded_by` normalized to card ID; no ID-space redesign for this field. | `confirmed live` | Protect | synqed-core | — | Login UUID and card UUID inputs resolve to stored staff card ID; SYSTEM actor stays null. | C3 / latest dump's verified exclusion / L0 |

**Core-ten cumulative release gate:** 19 focused/regression files and 74 tests passed together, covering the changed Karute/discard/recording/packs/actor-auth/segment/staff slices plus existing Karute, idempotency, recording-job, recording-discard, permissions, and packs regressions. Both new migrations passed twice against the local test database; the segment preflight found 0 duplicate groups. Core typecheck, SDK build/declaration generation, and `git diff --check` also passed. Karute's bridge passed `git diff --check`; full Karute typecheck is currently blocked by the pre-existing package/lock mismatch (`Missing: @swc/helpers@0.5.23 from lock file`).
| D13 | Consume the visible-discard model in Karute: discarded records remain as grayed rows and the old approval step stays removed. | `ready` | P0 | karute | D1-D4 landed | Karute explicitly requests mixed rows; discarded rows remain visible to ordinary Karute readers with distinct gray/non-actionable styling; non-discarded pills use `total` and discarded UI uses `discarded_count`; no approval gate hides/removes the row; default core exclusion remains unchanged for other consumers. | No current `DISCARDED` consumer exists in Karute / latest dump / L0 |

## B. Reserve member core

These remain intake-only in this milestone. Liam's dependency order is binding: identity first.

| ID | Requested item | Status | Priority | Repo | Dependencies | Acceptance criteria | Evidence (code / docs / Linear) |
|---|---|---|---|---|---|---|---|
| M0 | Cross-tenant customer identity and phone/email OTP sign-in with verifiable sessions. | `blocked` | P0 | synqed-core + reserve | G2, G3 | Ratified auth/session ADR; one auth account links to Customer rows in multiple businesses; OTP start/verify, refresh, revoke, and customer-scoped `/me` work; no browser core key; enumeration-safe errors and cross-tenant isolation tests pass. | C9 / D1, D3 / L0 |
| M1 | Append-only points ledger; earn-only v1. | `blocked` | P1 | synqed-core + reserve | M0, G4 | Signed typed rows implement the D2 taxonomy; balance is `SUM`, never writable scalar; ADJUST-only corrections; v1 exposes earn/read but no purchase/transfer/cash-out; idempotent earn and isolation tests pass. | C9 / D1-D2 / L0 |
| M2 | Real settled lifetime spend and per-business ranks. | `blocked` | P1 | synqed-core + reserve | M0 | Settled-spend definition is encoded from visits plus paid pack orders; unpaid/cancelled money excluded; price snapshots immutable; per-business rank thresholds/config drive server-computed rank; `totalSales` is no longer hand-set authority; backfill/reconciliation tests pass. | C9 / D1, D3 / L0 |
| M3 | Ticket-pack purchase: order + Stripe webhook → pack grant. | `blocked` | P1 | synqed-core + reserve | M0 | Server creates order/checkout; signed idempotent Stripe webhook is the only balance grant; retries do not double-grant; failed/refunded states are modeled; client cannot write pack balance; Connect compatibility is preserved without enabling Connect for pilot. | C5, C9 / D1, D3 / L0 |
| M4 | Booking marketing opt-in, disclosure acknowledgement, UTM audit, and `StatusSource.CUSTOMER`. | `blocked` | P1 | synqed-core + reserve | M0, G2 | Booking schema/API/SDK persist exact consent booleans, disclosure version/mode and server timestamp, bounded UTM fields, and customer actor source; a customer's cancellation records `CUSTOMER`, never impersonates staff; audit and migration tests pass. | C10 / D1, D3 / L0 |
| M5 | Email-first booking confirmations. | `blocked` | P2 | synqed-core + reserve | M0, M4 | Transactional/outbox-style send is triggered only after durable booking; idempotency prevents duplicates; delivery state/failure/retry are observable; done page claims a message only when queued; customer/business/template scoping tests pass. | No outbound booking sender found / D1 / L0 |

## C. Coaching core (priority order 0→5)

### C0 — privacy enforcement door

| ID | Requested item | Status | Priority | Repo | Dependencies | Acceptance criteria | Evidence (code / docs / Linear) |
|---|---|---|---|---|---|---|---|
| C0 | Choose and implement the staff-private data door. | `blocked` | P0 | synqed-core + Karute BFF | G1 | Decision is ratified; verified actor/business/capabilities reach core; negative tests prove another staff member's private rows return none; service-role jobs are isolated; no client preview role affects authorization. | C11, K2 / D4 / L0 |

### C1 — consent

| ID | Requested item | Status | Priority | Repo | Dependencies | Acceptance criteria | Evidence (code / docs / Linear) |
|---|---|---|---|---|---|---|---|
| C1 | Append-only per-staff coaching consent plus aggregate-only owner/manager adoption. | `blocked` | P0 | synqed-core + karute | C0 | Staff can append/read only own history; artifact generation checks latest effective consent; decline generates no personal artifact; owner/manager sees only `N of M`, never identities or raw decline history; revocation and concurrency tests pass. | K1, C12 / D4 / L0 |

### C2 — storage and writes

| ID | Requested item | Status | Priority | Repo | Dependencies | Acceptance criteria | Evidence (code / docs / Linear) |
|---|---|---|---|---|---|---|---|
| C2a | `ai_interactions`, partitioned from creation, capturing every generated coaching artifact. | `blocked` | P0 | synqed-core | C0, C1 | Partition key/retention are explicit; consent is checked before generation; every generated artifact is durably captured with business/staff/provenance; no-consent path writes none; capture integration test passes. | C12 / D4 / L0 |
| C2b | `ai_exemplars` with pgvector for top-performer pattern mining. | `blocked` | P1 | synqed-core | C0, C1, G5 | Restored spec fixes vector model/dimension, source/de-identification, retention, and visibility; consent-gated ingestion and tenant isolation tests pass. | C12 / D4 / L0 |
| C2c | `module_assignments` and `module_completions` as the diff-in-diff control arm. | `blocked` | P1 | synqed-core | C0, C1, G5 | Assignment/completion identities, windows, immutable assignment cohort, self/manager visibility, and effectiveness query are specified and tested. | C12 / D4 / L0 |
| C2d | `staff_performance_monthly` nightly rollup target. | `blocked` | P1 | synqed-core | C0, C1, C3c, G5 | One business/staff/month row; repeat job is idempotent/self-healing; owner reads only permitted bands/aggregates while staff reads own exact metrics. | C12 / D4 / L0 |
| C2e | All V2 L1 personal tables. | `blocked` | P0 | synqed-core | C0, C1, G5 | Canonical spec enumerates every L1 table first; each is consent-gated and partitioned at write; every policy is self-or-grant only with no role literals; deletion coverage includes all L1 tables. | C12 / D4 / L0 |
| C2f | Eight L3 owner-config columns on `org_settings`. | `blocked` | P1 | synqed-core + karute | C0, G5 | Add exactly `coaching_enabled`, `coaching_cross_staff_names_reservation`, `coaching_cross_staff_names_karute`, `coaching_weights`, `coaching_min_sessions`, `coaching_auto_decline_days`, `coaching_policy_template`, `coaching_policy_version`; defaults/migration/partial-update/API/SDK tests pass. | K3, C12 / D4 / L0 |
| C2g | Staff-initiated silent L1 deletion/revocation path. | `blocked` | P0 | synqed-core + karute | C0, C1, C2e, G5 | Self-only request; no manager approval/notification path; revokes future generation immediately; deletion scope and legal audit receipt follow ratified spec without retaining prohibited content; cross-staff request fails. | K1, C12 / D4 / L0 |
| C2h | `InsightOutcome` write (`unread/unconfirmed → tried/worked/skipped`). | `blocked` | P1 | synqed-core + karute | C0, C1, C2e | Staff can update only own insight through allowed transitions; manager cannot write; transition is idempotent/audited without exposing L1 content. | K4, C12 / D4 / L0 |

### C3 — reads, identity, and rollups

| ID | Requested item | Status | Priority | Repo | Dependencies | Acceptance criteria | Evidence (code / docs / Linear) |
|---|---|---|---|---|---|---|---|
| C3a | Normalize `karute_records.staff_id` to the staff card ID on every write and backfill mixed ID space. | `ready` | P0 | synqed-core + karute | — | Inventory every writer first; core resolves accepted auth/profile UUID to the same business's staff card; worker/manual/interactive writes converge; conflict-safe backfill maps only unambiguous rows and reports unresolved rows; both historical ID forms remain discoverable during rollout; tests cover each writer. | K5, C3 / latest dump; cited `inbox-read.ts` unavailable / L0 |
| C3b | Add `staff_id` and `karute_record_id` filters to outcomes list. | `blocked` | P0 | synqed-core + SDK | C0, C3a | API/SDK filters compose, remain business-scoped, and enforce self/grant visibility rather than trusting arbitrary staff filter; pagination/count tests pass. | C7 / D4 / L0 |
| C3c | Compute L2 bands and monthly rollups with the V2 completed≥H self-healing window. | `blocked` | P0 | synqed-core | C0, C1, C2c-C2d, G5 | Service-role job is isolated and non-user-callable; each eligible completion contributes once; late data self-heals; closing/defer/decline mix comes from outcomes, rebooking from appointments, spend from packs/redemptions; owner/manager never receives raw per-staff numbers; staff can derive own exact numbers. | C5, C7, C12 / D4 / L0 |

### C4 — manager grants

| ID | Requested item | Status | Priority | Repo | Dependencies | Acceptance criteria | Evidence (code / docs / Linear) |
|---|---|---|---|---|---|---|---|
| C4a | `coaching_manager_grant` is staff-self-created only. | `blocked` | P0 | synqed-core | C0, C1, G5 | INSERT requires verified `created_by = staff_id = actor`; no owner/manager creation route; revoke/expiry semantics match restored §6; negative tests cover impersonation. | C11-C12 / D4 / L0 |
| C4b | `is_manager_granted()` is the one grant chokepoint with live checks. | `blocked` | P0 | synqed-core | C4a, G5 | Every grant read calls one function that requires active, unexpired grant and current grantee capability; revoked role/capability stops access immediately. | C11-C12 / D4 / L0 |
| C4c | Transcript excerpts are a separate, never-prechecked opt-in on each grant. | `blocked` | P0 | synqed-core + karute | C4a-C4b, G7 | Default false at every grant/re-prompt; no master grant or transcript setting implies consent; policy/read tests cover false/true/revoke. | C12 / D4 / L0 |
| C4d | Staff-only `coaching_manager_access_log`, server-written and debounced when gated reads return rows. | `blocked` | P0 | synqed-core | C4b, G5, G7 | Log writes only after rows are returned; debounce key/window is specified; subject staff can read own log; owner/manager cannot; caller cannot forge entries; zero-row reads do not log. | C12 / D4 / L0 |
| C4e | Add `coaching.exportRankings`: owner on, manager off. | `blocked` | P1 | synqed-core | C0, G5 | Capability is core-owned; effective capability enables owner and strips manager even with override; export route checks it; permission tests prevent smuggling. | C11 / D4 / L0 |
| C4f | Manager turnover pauses grants and re-prompts staff. | `blocked` | P0 | synqed-core + karute | C4a-C4b, G5 | Loss/change of viewing capability makes existing grants ineffective immediately; staff receives a new explicit prompt; transcript checkbox resets false; no automatic transfer. | C11-C12 / D4 / L0 |
| C4g | Per-item “ask for help” share, independent of master grant. | `blocked` | P1 | synqed-core + karute | C0, C1, G5 | One insight can be shared with explicit recipient/scope/expiry; works without master grant; revoke is immediate; no neighboring insight/transcript is exposed; access logged. | C12 / D4 / L0 |
| C4h | L1 policies contain no role/capability literals; `staff.manage` has no L1 path. | `blocked` | P0 | synqed-core | C2e, C4b, G5 | Every L1 SELECT is self OR `is_manager_granted()` only; CI rejects role/capability literals and direct `staff.manage` paths; cross-read tests return zero rows. | C11-C12 / D4 / L0 |

### C5 — launch gate

| ID | Requested item | Status | Priority | Repo | Dependencies | Acceptance criteria | Evidence (code / docs / Linear) |
|---|---|---|---|---|---|---|---|
| C5 | Definition of live: consent log, failing L1 cross-read, no role literals in L1 policy, and actual `ai_interactions` capture. | `blocked` | P0 | synqed-core + karute CI | C1, C2a, C2e, C4h, G5 | All four checks run in CI/integration environment and are green; cross-read test proves another staff member receives no rows; capture test proves a real generated artifact logs; launch remains disabled otherwise. | K1, C12 / D4 / L0 |

### C6 and additional items

| ID | Requested item | Status | Priority | Repo | Dependencies | Acceptance criteria | Evidence (code / docs / Linear) |
|---|---|---|---|---|---|---|---|
| C6 | Decide the `recordings.viewAll` raw-audio/coaching-wall asymmetry; no build yet. | `blocked` | P0 decision | synqed-core + karute docs | G6 | Ratified ADR names the accepted asymmetry, prohibited reconstruction/use, audit/retention expectations, and revisit trigger; no permission change occurs accidentally. | C11 / D4 / L0 |
| C7 | Preserve the already-built dormant Karute coaching prompts, screens, and scoring UI while core contracts are absent. | `confirmed live—do not touch` | Protect | karute | — | Intake/core work does not replace client preview roles with authorization, delete dormant coaching surfaces, or connect them to mock data as if production; existing coaching integration tests remain green. | K1-K4 and `karute/src/components/coaching/redesign/` / latest dump / L0 |
| X1 | Per-business transcript visibility: staff-private vs manager-viewable, enforced at data door. | `blocked` | P0 | synqed-core + karute | G1, G7 | Setting is server-owned; self always reads own transcript; manager reads only when live setting/capability permits; past-row semantics follow G7; business isolation, toggle, historical, and audit tests pass; it does not imply coaching excerpt consent. | C4, C11 / latest dump / L0 |
| X2 | Computer-created Karute records without booking attachment. | `blocked` | P2 | synqed-core + karute | G8 | Binding/provenance decision is ratified; create/get/list work with null appointment without inventing one; attribution and idempotency are explicit; normal booking-linked records unchanged. | `KaruteRecord.appointmentId` already nullable but `staffId` required; K5 / latest dump / L0 |
| X3 | `recordingDiscards.list` date and session-set filters. | `ready` | P2 | synqed-core + SDK | D4 | API/SDK accept bounded session ID set plus ISO date range; compose with source/pagination/business fence; empty set and invalid ranges defined; focused query serialization/API tests pass. | C8 / latest dump / L0 |

## D. Confirmed-live Reserve baseline — protected scope

These are explicitly out of scope. A future slice may add regression coverage, but must not redesign them while delivering this backlog.

| ID | Capability | Status | Priority | Repo | Acceptance criteria | Evidence (code / docs / Linear) |
|---|---|---|---|---|---|---|
| P1 | Menus/catalog | `confirmed live—do not touch` | Protect | synqed-core | Existing menu CRUD/bookability/price-band behavior remains green. | C13 / D1 / L0 |
| P2 | Both appointment overlap guards (create and update/reschedule) | `confirmed live—do not touch` | Protect | synqed-core | Existing staff/customer overlap conflicts and non-overlap cases remain green. | C13 / latest dump / L0 |
| P3 | Resource/bed overlap guard | `confirmed live—do not touch` | Protect | synqed-core | Concurrent resource occupancy and cleanup windows remain enforced. | C13 / D1 / L0 |
| P4 | Appointment idempotency | `confirmed live—do not touch` | Protect | synqed-core | Same key replays once; concurrent and failed claims preserve existing semantics. | C13 / D1 / L0 |
| P5 | Pack burn unique/index rail | `confirmed live—do not touch` | Protect | synqed-core | One active appointment-linked redemption and existing walk-in idempotency remain enforced. | C13 / latest dump / L0 |
| P6 | Cancellation taxonomy and booking status history | `confirmed live—do not touch` | Protect | synqed-core | Existing STAFF/QR/SYSTEM status provenance, reason, history, cancel/no-show behavior remains unchanged until M4 adds CUSTOMER additively. | C10, C13 / D1 / L0 |
| P7 | Per-store booking policies | `confirmed live—do not touch` | Protect | synqed-core | Horizon/cutoff/cancellation policy reads/writes keep existing defaults and business/store fences. | C13 / D1 / L0 |
| P8 | Server-side pricing | `confirmed live—do not touch` | Protect | synqed-core | Booked price remains server-computed and snapshotted; client values cannot override it. | C13 / D1 / L0 |
| P9 | Store hours and closed days | `confirmed live—do not touch` | Protect | synqed-core | Weekly hours, absent-day closure, ad-hoc closed days, and date filters remain green. | C13 / D1 / L0 |
| P10 | Resources/qualifications | `confirmed live—do not touch` | Protect | synqed-core | Resource CRUD/retirement, qualification links, and booking enforcement remain green. | C13 / D1 / L0 |

## Dependency-ready execution order

This is sequencing guidance, not authorization to resume serial implementation.

1. **Land already-verified uncommitted work:** D1-D4 only, after review/commit authorization.
2. **Independent ready core slices:** D8 → D9 → D6 → D7a/D7b → X3; D13 follows D1-D4 landing.
3. **Identity integrity:** C3a can proceed independently after writer inventory; it is prerequisite for coaching-scoped reads.
4. **Close staff actor gate G1:** then D5, D10, and the coaching C0 boundary can start.
5. **Close customer gates G2/G3:** then M0; all other member work remains behind M0.
6. **Close G4:** then M1. M2-M5 follow the member dependency table.
7. **Restore/ratify coaching spec G5:** only then implement C1→C2→C3→C4→C5 in Liam's order.
8. **Record G6/G7/G8 decisions:** unlock C6, X1, and X2 respectively.

## Coverage check against Liam's dump

- Discard/recording ten: D1-D10; shipped reason preservation: D0; explicitly ignored prior-draft concerns: D11-D12; visible gray-row/no-approval consumer: D13.
- Reserve member dependencies: M0-M5; protected booking baseline: P1-P10.
- Coaching priority 0-5: C0, C1, C2a-C2h, C3a-C3c, C4a-C4h, C5; audio decision: C6; dormant app baseline: C7.
- Additional new items: X1-X3.
- Stale/missing-source warnings: K2, K5, D4, G5.
