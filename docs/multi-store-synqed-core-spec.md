# Multi-store — synqed-core spec (for Anthony)

The karute side of multi-store is being built in small PRs (#163 stores table + CRUD, #164 persisted switch + staff counts, more to follow). The **deep data-scoping — filtering each store's customers / bookings / karute, and per-store customer counts — lives in synqed-core.** This is that spec.

## Model (and the hard boundary)
```
account (auth user)
└── business   = the synqed-core tenant (businessId)  ← subscription = COACHING/TRAINING-DATA scope
    └── store (location)   = karute owns the `stores` table (Supabase); id is a uuid
        └── customers / appointments / karute_records / recordings  ← tag with location_id (uuid)
```
- **`businessId` stays the tenant + the coaching/training-data isolation boundary.** All stores of a business pool; coaching/training **never** aggregates across `businessId`. Different business types (salon vs gym) are different businesses = isolated, even under one owner.
- **`location_id` (the karute store) is only a view/report filter** — not the coaching scope.

## Naming — avoid the QuickReserve collision
synqed-core already has `store_id: number` on `SyncConfig` = the **QuickReserve external store**. The karute multi-store location is a **different thing** (a `uuid` = karute `stores.id`). Please use a **distinct name — `location_id uuid`** — on the data entities, so the two never get conflated.

## What synqed-core needs
1. **`location_id uuid null`** on `customers`, `appointments`, `karute_records`, `recordings`. `null` = unassigned / not pinned to a location.
2. **Optional `location_id` filter** on the list/get/count endpoints. When karute passes a `location_id`, scope to it; when omitted/null, return **business-wide** (all locations — the owner's "all stores" view). It is always *within* `businessId` — `location_id` never widens scope past the tenant.
3. **Writes accept `location_id`** — a new booking/customer/karute records the active location (karute passes it from the active-store cookie).
4. **Per-location counts** — a customer count (and ideally booking count) per `location_id`, so karute's store cards show real numbers (today they read 0).
5. **Backfill** — existing rows → the business's **primary store** `location_id` (karute creates exactly one `is_primary` store per business; expose/agree on how synqed-core learns that id — simplest: karute passes the primary `location_id` during a one-time backfill, or synqed-core leaves them `null` = "all" and karute assigns going forward).

## Coaching boundary — please enforce in the backend
When the coaching/training loop reads recording data, it reads **all of a business's recordings (every location pools — same model)** and **never another business's**. Do **not** key any coaching aggregation on `location_id`, and **never** join/train across `businessId`. `location_id` is for surfacing per-location views/reports only. (A future "portfolio" lets one account hold several businesses; each must stay fully isolated, coaching included.)

## How karute drives it
- karute owns store management: the `stores` table + CRUD (#163) and the active-store **cookie** `karute_active_store` (#164). 
- karute server actions will pass the active `location_id` into the `SynqedClient` calls (per-call param, or a client-level "active location" — your call on the client shape; the karute side adapts).
- Until this lands: karute's switch persists + staff counts work, but customers/bookings/karute stay business-wide and customer counts read 0. No karute regression — it just doesn't filter yet.

## Open questions for you
- `location_id` as a per-call param vs a `SynqedClient({ businessId, locationId })` constructor option? (karute can do either.)
- Counts: a dedicated `counts-by-location` endpoint, or include in the list response meta?
- Backfill ownership: karute passes the primary id, or synqed-core defaults `null`?

## Verification (end-to-end, once both sides land)
Owner with 2 La Estro locations: switch store → customers/bookings/karute lists + counts reflect only that location; "all stores" shows the business-wide set. A second business (e.g. a gym) shares nothing — and its (future) coaching never sees salon data.
