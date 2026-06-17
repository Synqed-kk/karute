# Multi-store (store_id) — full synqed-core spec for Anthony

> **Status:** ready to send. Every file/line below was verified against current `main` on both repos (synqed-core + karute) on 2026-06-17.
> **Line numbers are approximate anchors** — grep by symbol name to be safe; a couple may have drifted a line or two.
> Built to be done in ONE pass so we don't re-ask. The ordering at the bottom is load-bearing — a wrong sequence mass-cancels live bookings.
> Supersedes the earlier short `location_id` draft (see §2 for the naming reconciliation).

---

Anthony — full spec to make synqed-core multi-store **isolated AND future-proof** in one pass. Build it all together; the ordering at the bottom is load-bearing.

## THE ONE DECISION THAT GATES EVERYTHING (confirm before any column lands)

Customer identity stays **BUSINESS-WIDE**; `store_id` lives only on **EVENT** tables (appointment / visit / karute), never as a customer scope. Reasons, all verified:

- `karuteNumber` is `_max+1` over the whole `businessId` with `@@unique([businessId, karuteNumber])`.
- the QR identity ladder (`sync.service.ts:537-645`) is `businessId`-only at every step.
- a store-scoped customer column would re-mint the same person once per store — **amplifying the existing 654-dup bug.**

So: **`business_id` = tenant + coaching/training pool** (all stores pool, never cross-business). **`store_id` = a location/view/report filter only, NEVER a coaching boundary.**

---

## 1) PRISMA SCHEMA (`prisma/schema.prisma`)

All new `store_id` columns are bare `@db.Uuid`, **NO Prisma relation/FK** (the stores table lives in karute's Supabase — same opaque-uuid pattern as `Customer.assignedStaffId`). All nullable on add; tighten per note.

**EVENT TABLES (real store_id = where the event happened):**

- **Appointment** (`:195`): add `storeId String? @map("store_id") @db.Uuid`; add `@@index([businessId, storeId, startsAt])`. → NOT NULL after backfill.
- **CustomerVisit** (`:74`): add `storeId String? @map("store_id") @db.Uuid`; add `@@index([businessId, storeId, usedAt])`. → NOT NULL after backfill (table empty today).
  - ⚠️ **CHANGE THE UNIQUE KEY — latent data-loss bug, not optional:** `@@unique([businessId, qrReservationId])` (`:90`) → `@@unique([businessId, storeId, qrReservationId])`. Each store is a SEPARATE QuickReserve store with its OWN reservation-id sequence; QR ids are unique within a QR store, NOT across a business's stores. Leave the key as-is and the moment a 2nd store goes live, two stores' visits with the same int id silently upsert-overwrite each other.
- **KaruteRecord** (`:337`): add `storeId String? @map("store_id") @db.Uuid` (PERMANENTLY nullable — a karute can be manual/pre-store); add `@@index([businessId, storeId, createdAt])`. Stamp from the appointment's store_id when created in a recording flow.
- **RecordingSession** (`:285`): add `storeId String? @map("store_id") @db.Uuid` (permanently nullable); add `@@index([businessId, storeId])`.

**CUSTOMER (`:15`) — NO scope column:**

- add `homeStoreId String? @map("home_store_id") @db.Uuid` ONLY (display/default hint, never a scope, never in a unique key); add `@@index([businessId, homeStoreId])`.
- **DO NOT touch** `@@unique([businessId, email])` / `@@unique([businessId, karuteNumber])`.

**DO-NOT-TOUCH** (inherit scope via parent / business-wide by design): KaruteEntry (via karuteRecordId), TranscriptionSegment (via recordingSessionId), CustomerPhoto + RecordingConsent (per-person, business-wide — one consent valid at every location), Staff, OrgSettings, AiRequestLog.

**SyncConfig (`:241`) — only if you promote the dormant path (recommended, see §3):**

- add `karuteStoreId String? @map("karute_store_id") @db.Uuid` (links a QR config row to a karute `stores.id` so the run knows which store_id to stamp).
- **RENAME** the existing `store_id Int?` → `qrStoreId @map("qr_store_id")` to kill the name clash with the new uuid (this Int is QuickReserve's EXTERNAL numeric id). This rename also hits the published SDK — see §2.
- **REPLACE** `@@unique([businessId, provider])` (`:268`) → `@@unique([businessId, provider, karuteStoreId])` so a business holds N QR configs (one per store). Migration MUST stamp `karuteStoreId = primary store` on the existing row BEFORE swapping the index or it null-collides.

**INTEGRITY CONTRACT (put in a schema comment):** store_id is an opaque tenant-supplied uuid; core does NOT FK or validate it (can't — cross-DB). `business_id` is the ONLY enforced isolation boundary. No query may EVER filter by store_id alone — always `{ businessId, storeId }`.

---

## 2) SDK `@synqed-kk/client` (`packages/client/src/`) — coordinated MAJOR bump

Store scope is a **per-CALL dimension, NOT a client-constructor field.** SynqedClient is a business-singleton built ~10× across karute; one session views MULTIPLE stores (owner switches active store), so store must never pin on the client. Keep `SynqedClientConfig` unchanged; put store_id on method options + create inputs. Skip the `x-store-id` header for v1 (explicit params only — no hidden scope; admin/all-stores reads pass none).

**types.ts:**

- Customer output: add `home_store_id: string | null`. AND fix the `toCustomer` mapper (`customer.service.ts:16-50`) — it currently **DROPS** `external_refs` even though the type declares it. Same trap will silently swallow home_store_id. Fix external_refs in the same pass to prove the mapper/type/route serializer all move together.
- CreateCustomerInput: add `home_store_id?: string | null`.
- Appointment output: add `store_id: string | null`. CreateAppointmentInput + UpdateAppointmentInput: add `store_id?: string | null` (update = re-tag a moved booking).
- CustomerVisit / UpsertVisitInput, KaruteRecord / CreateKaruteRecordInput, RecordingSession / CreateRecordingInput: add `store_id`.
- LIST OPTIONS: add `store_id?: string` to ListCustomersOptions, ListAppointmentsOptions, ListKaruteRecordsOptions, ListRecordingsOptions.
- ⚠️ **NAME COLLISION (resolve one of two ways — your call):** SyncConfig output already ships `store_id: number|null` (`types.ts:314`) and UpsertSyncConfigInput `store_id?: number` (`:334`) = the QR external numeric id. The new store_id is a uuid.
  - **(A, recommended)** rename the existing numeric one to `qr_store_id` across schema AND the published SDK in the same major bump, and move every karute reader of `config.store_id` (the QR fetch arg) in lockstep. More invasive now, but consistent with karute's existing `profiles.store_id:uuid` and clearer long-term (`qr_store_id` is the honest name for the QR id).
  - **(B, lower-risk)** leave `SyncConfig.store_id:number` untouched and name the NEW uuid column/field `location_id` everywhere instead. No SDK breaking change, but karute's vocabulary is otherwise all `store_*`, so the data tag would be the odd one out.
  - Either works — pick one and use it consistently. The rest of this spec is written with **(A) `store_id`**.

**Client builders** (customers/appointments/karute/recordings `.ts`): thread store_id into the URLSearchParams on every list; pass store_id through create/update bodies.
**Validations** (`src/validations/*.ts`): add optional store_id (uuid) to list + create/update + upsertVisit schemas; home_store_id to createCustomerSchema.
**Routes** (`src/routes/*.ts`): querystring parsers read store_id and pass to service list calls; create routes pass store_id from body.

**NEW endpoint + SDK method** (unstubs StoresSection's `customerCount:0`): `GET /v1/stores/counts` (business-scoped via x-business-id) → `[{ store_id, customer_count, appointment_count }]` in ONE call (no N+1). appointment_count = group-by store_id; customer_count = DISTINCT customerId with ≥1 appointment/visit at that store_id. SDK: `client.stores.counts()`. ⚠️ Every subquery/join here must filter `businessId=caller` at EVERY level (outer AND the appointment/visit subquery), never just `storeId=X`. Unknown/foreign store_id → zero rows, never an error, never a cross-business match.

`CreateAppointmentInput.store_id`: ship **OPTIONAL-with-server-default-to-primary** for the transition release (no lockstep, safe rollout), then tighten to required.

---

## 3) QR SYNC — the biggest piece; it has a structural blocker

**Ground truth (verified): TWO sync implementations, and the LIVE one is NOT core's.**

- **LIVE (prod):** karute `/src/app/api/sync/quickreserve/route.ts`, Vercel cron `'0 8 * * *'`. Reads sync_config from KARUTE's own Supabase. find-or-creates customers by **NAME ONLY** (`customerByName`, `:136`) — THIS is the 654-dup root cause. Dedups appointments by `apptKey=(staff_id, starts_at)` (`:141`) over a **store-BLIND** appointments.list (`:135/:178`). Hardcodes `config.store_id||222` (`:101`). Config read is `.single()` (`:53`).
- **DORMANT (never runs — core has ZERO crons in vercel.json):** core's `runQuickReserveSync` (`sync.service.ts:331`) has the robust ladder (QRid→phone→email→name, all businessId-scoped) + externalRefs dedup + guarded orphan-cancellation.

**FORK B (decide first — Liam's call, rec below):** **PROMOTE** core's robust `runQuickReserveSync` to be the LIVE path (wire core's cron) and **RETIRE** the karute name-only route. This kills two birds at once — the dup-mint root cause dies AND store-tagging lands once on the robust ladder. The karute name-only route is a **RECURRING re-mint engine**, not a static 654: it loads existing customers via `customers.list({page_size:200})` and matches by name against only that 200-name window, so every customer past row 200 gets a fresh dup on EVERY daily run. Retiring it is a PREREQUISITE of the dup cleanup, not a parallel task.

⚠️ **ORPHAN-CANCELLATION IS A NEW CAPABILITY (highest-severity, verified):** the live route has NO cancellation logic at all. Promoting core switches on `markOrphanedCancelled` (`sync.service.ts:707-728`), whose WHERE is `{businessId, source:QUICKRESERVE, startsAt window, notIn(seenIds)}` — **NO store scope.** With two stores' feeds, store A's run builds seenIds from ONLY store A's reservations, then cancels every QUICKRESERVE appointment in the window not in that set = ALL of store B's live bookings. **Store-scoping it to `(businessId, storeId)` AND making seenAppointmentIds per-store MUST land in the EXACT SAME PR that wires the core cron / adds the 2nd SyncConfig row.** No deploy may have the cron live and this un-scoped.

**Store-tagging points once per-store config exists:**

- `runQuickReserveSync` receives `config.karuteStoreId` and STAMPS it on: appointment create + update, the visit upsert, and karute/recording rows created in-flow.
- `findOrCreateCustomer` (`:537`) STAYS business-wide — store_id must NEVER enter its WHERE clauses (verified businessId-only at every ladder step) or it mints a dup per store. On CREATE only, set `homeStoreId = this run's store`.
- **APPOINTMENT IDEMPOTENCY:** key on the QR reservation id (externalRefs), NOT the `(staff_id, starts_at)` tuple, and store-scope the day appointments.list lookup. Then a reservation MOVED between QR stores updates the SAME row with a new store_id instead of racing create-vs-orphan-cancel across two per-store configs.

**OVERLAP / FORK D (resolve, don't leave open):** store-scope the createAppointment overlap guard (`appointment.service.ts:130-141`, currently businessId+staffId+time, throws AppointmentOverlapError 409) to `{businessId, storeId, staffId, time}`; AND make per-store sync match staff against THIS store's pinned `profiles.store_id` first. Otherwise the fuzzy `staffByName` matcher collapses two stores' distinct therapists onto one synqed `staff.id` and drops their bookings as false 409s.

**STRUCTURAL BLOCKER (worse than it looks):** the live karute `sync_config` table is a GLOBAL SINGLETON — `provider text NOT NULL UNIQUE` (one QR config for the ENTIRE Supabase project). The captured migration (karute `20260607010000`) is DRIFTED on TWO columns: it's missing BOTH `business_id` AND `store_id`, yet the live route reads both (`:68`, `:101`). **Before any re-key, reconcile live `\d public.sync_config` against the file.** Recommended move: relocate config into core's per-store SyncConfig rows rather than re-key the drifted karute singleton in place.

`dispatchCron` already iterates `findMany({enabled:true})` so per-store config rows fan out naturally. ⚠️ N stores = N credential sets + N crawls per tick against QuickReserve; `dispatchCron` has no per-tenant backoff (there's a TODO). Add stagger/backoff before going wide or you amplify any QR rate-limit.

---

## 4) SECURITY — service-layer parity, NO RLS

**Put this at the TOP as a contract, so it's never mistaken for DB-level isolation:** "store_id is a VIEW/REPORT filter, NOT a security boundary. `business_id` is the ONLY enforced isolation. Core CANNOT validate store∈business (no stores table, no FK). Per-staff store isolation is enforced SOLELY in karute, resolved server-side from `profiles.store_id` — never client-supplied. Karute must NEVER relax that gating just because core now accepts a store param." (Core already blindly trusts `x-business-id` at `auth.ts:31` — no entitlement check — so a store param is only as strong as karute's gating.)

Enforce store_id at the SAME layer as businessId (the Prisma where-clause). Absent/null store_id on a request = NO store filter (business-wide; owner path). Present = AND it into the where.

- **READS:** listCustomers, getCustomer (**404 not 403** if the row's store_id != a present caller storeId — avoid existence-leak), listAppointments, getAppointment, karute list/get, visits, photos, recordings.
- **WRITES (stamp):** createCustomer (homeStoreId), createAppointment, karute create, upsertVisits.
- ⚠️ **VERIFY-THEN-ACT GUARDS (silent-leak trap, all 4 verified):** `customer.service.ts:268` (update) + `:287` (delete) and `appointment.service.ts:186` (update) + `:193` (delete) do `findFirst({id,businessId})` then mutate `where:{id}` ALONE. Add storeId to BOTH the findFirst AND the mutate where when a caller store is present, or a store-limited staffer mutates another store's row.

**NULL-STORE VISIBILITY (per table — get this exactly right):** for staff-restricted reads, NULL store_id means "business-wide / visible to all", so the predicate is `{ businessId, OR:[{storeId: caller},{storeId: null}] }` — **NOT "NULL hidden".** "NULL hidden" applies ONLY to the fully-backfilled NOT-NULL columns (Appointment, CustomerVisit). For the permanently-nullable tables (KaruteRecord, RecordingSession) and un-stamped manual creates, "NULL hidden" would vanish a row from its own author's view.

**COACHING BOUNDARY (hard intent — verified leak vector):** store_id must NEVER enter any coaching/training-data/aggregation query. ALL coaching pools at `business_id` across stores. Write this invariant in verbatim: "store_id is never a default; it is passed explicitly per call. The coaching/AI read paths — api/ai/chat, api/ai/insights, all of coaching/*, global-pipeline, list-enrich consumers — MUST pass NO store_id and MUST NOT import getActiveStoreId()."

- There are ~10 `new SynqedClient(...)` sites in karute, each rebuilding businessId by hand. **I'll own consolidating those to ONE businessId-only builder** + a CI grep guard (getActiveStoreId() must never appear under `api/ai/` or `coaching/*`). Flagged so you know the coaching reads must pass NO store param when you wire the SDK.

---

## 5) STORE LIFECYCLE — the spec's biggest blind spot

(karute has NO delete/deactivate path today; the `active` column is dead — updateStore never sets it, there's no deleteStore. Most of this is karute-side, but core's behavior depends on it, so here's the contract core must honor:)

- Stores are **SOFT-deleted only** (set active=false), NEVER hard-deleted, so core's tags never dangle. Core treats an unknown/inactive store_id as opaque/"unassigned" — never errors, never drops its counts.
- On deactivate: event rows **KEEP** their original store_id (history is immutable, owner-visible, staff-restricted views exclude inactive); the store's QR SyncConfig row → `enabled=false`; `profiles.store_id` unpinned/reassigned.
- **PRIMARY store (本店) can NEVER be deactivated/deleted;** moving primary = atomically promote another store. The partial unique index only blocks a SECOND primary — it does NOT stop removing the only one. The backfill migration must **FAIL LOUDLY** for any business with zero primary, never null-backfill.
- `/v1/stores/counts` may return a store_id with no matching live karute store (closed/deleted) — karute will label it "不明な店舗 / unassigned" and still show the count, never drop it.

(Items I own on karute: `setStoreActive(false)` action, `setPrimaryStore` atomic flip, plan-downgrade-below-cap handling.)

---

## 6) BACKFILL (same coordinated migration as the column adds, BEFORE any per-store sync runs)

Every existing row predates store_id (654 customers + their appointments/visits/karute all NULL). **TARGET = each business's PRIMARY store** (`stores.is_primary`, exactly one per business). For today's single-store La Estro this is unambiguous.

- **CROSS-DB CATCH:** the primary-store uuid lives in karute's Supabase; core's migration can't read it. Hand core a `businessId→primaryStoreId` map (a one-off karute query `select business_id, id from stores where is_primary`) at migration time, OR run the backfill as a karute-side script writing core via the admin path. Do NOT blanket-assign one hardcoded uuid.
- Appointment: backfill ALL to primary → tighten storeId NOT NULL.
- CustomerVisit: empty today → tighten NOT NULL.
- KaruteRecord / RecordingSession: backfill to primary where derivable from the linked appointment, else leave NULL (stay nullable).
- Customer: set homeStoreId=primary (hint only).

---

## ORDERING (single coordinated migration, then flag flip — a wrong order mass-cancels bookings)

1. Add all nullable columns + indexes + the **CustomerVisit unique-key swap** (core) + the SDK major bump (uuid store_id added; numeric SyncConfig store_id renamed to `qr_store_id`; `external_refs`+`home_store_id` mapper fix).
2. **FREEZE/disable the karute name-only cron route** — it's a recurring re-mint engine (200-row name window, daily), so it must stop BEFORE the dup cleanup, not alongside.
3. **Dedup/merge existing customers QR-id-first** (the dup fix), THEN backfill store_id + homeStoreId to each business's primary store from the karute primary-store map.
4. Tighten `Appointment.storeId` + `CustomerVisit.storeId` → NOT NULL.
5. In ONE PR: promote core's `runQuickReserveSync` to live (move QR config into per-store core SyncConfig rows, wire core's cron, **store-scope `markOrphanedCancelled` + seenAppointmentIds**, store-scope the appointment idempotency key to externalRefs, store-scope the overlap guard) — orphan-cancellation goes from non-existent to business-wide the instant this lands, so its store-scoping cannot lag by even one deploy.
6. Ship all of the above **DARK** (NEXT_PUBLIC_FEATURE_MULTI_STORE still off in karute), then flip the karute flag.

**Per-store sync (the 2nd SyncConfig row) must NOT be enabled until steps 4 + 5 are both complete.** Single-store businesses see zero behavior change through the window (additive nullable column + optional filters + NULL-treated-as-business-wide).

**The dup-customer fix is NOT a separate later task — it's step 3 and a prerequisite of the backfill (you can't tag dups you haven't merged).**

That's the whole thing — schema, SDK, sync, security, lifecycle, backfill, ordering. Ping me on FORK B and FORK D if you'd pick differently from my recs.
