# Karute Server Actions → `@synqed-kk/client` Migration

**Date:** 2026-04-23
**Branch:** `feat/synqed-core-migration` (integration branch)
**Scope:** Migrate all karute server actions from direct Supabase calls to `@synqed-kk/client`, adding missing synqed-core endpoints and schema fields as needed.

## Goal

Complete the migration started in commit `4cd2b5a` (`feat: migrate customer data layer from direct Supabase to synqed-core API`). After this work, karute's `src/actions/*.ts` no longer read or write application data via `supabase.from(...)`. Supabase remains only for:

- User authentication (`supabase.auth.getUser()`)
- Reading the current user's tenant from `profiles` (via `/lib/staff.ts`)

All other data access flows through `@synqed-kk/client` against synqed-core.

## Non-goals

- Refactoring feature behavior beyond what migration requires
- Replacing Supabase Auth
- Migrating `src/app/api/*` routes (out of scope for this round)

## Current state

Server action files in `src/actions/`:

| File | Status |
|---|---|
| `customers.ts` | Partially migrated. `createCustomer`, `createQuickCustomer`, `updateCustomer` use `getSynqedClient()`. `deleteCustomer` still hits supabase for linked-karute pre-check and appointment delete. |
| `appointments.ts` | Not migrated. |
| `karute.ts` | Not migrated. |
| `entries.ts` | Not migrated. |
| `staff.ts` | Not migrated. |
| `staff-pin.ts` | Not migrated. |
| `org-settings.ts` | Not migrated. |
| `dashboard.ts` | Not migrated. |

Bridge: `src/lib/synqed/client.ts` — `getSynqedClient()` constructs a tenant-scoped `SynqedClient` using `getTenantId()`.

## Schema reconciliation

The karute app schema and synqed-core's Prisma schema have diverged. We adopt synqed-core's naming as canonical and add the missing fields there.

### Field renames (karute → synqed-core)

| Karute (old) | synqed-core (new) | Scope |
|---|---|---|
| `summary` | `ai_summary` | karute_records |
| `staff_profile_id` | `staff_id` | karute_records, entries, appointments |
| `client_id` | `customer_id` | karute_records, appointments |
| `source_quote` | `original_quote` | entries |
| `confidence_score` | `confidence` | entries |

`src/types/karute.ts` and all callers (PRs 2 and 5) update to the new names.

### Additions to synqed-core Prisma schema

```prisma
model KaruteRecord {
  // ...
  transcript String?  // full transcript text when no recording_session is present
}

model KaruteEntry {
  // ...
  isManual Boolean @default(false)  // true for manually-added entries
}

model Staff {
  // ...
  pinHash   String?  // sha256 of 4-digit PIN; null = no PIN
  avatarUrl String?
}
```

## Architecture

Two phases:

1. **Phase 0 — synqed-core**: Prisma migration + endpoint additions + client package version bump.
2. **Phase 1 — karute**: Five domain-grouped PRs migrating `src/actions/*.ts`, each consuming the updated `@synqed-kk/client`.

Phase 1 cannot start until Phase 0 is merged and `@synqed-kk/client` is published/linked.

## Phase 0 — synqed-core work

One serial schema migration, then six parallel endpoint subagents.

### Step 0.1 (serial) — Prisma migration

Single PR adding the fields listed above. Generates a migration file under `synqed-core/prisma/migrations/`. No route changes yet.

### Step 0.2 (parallel, six subagents)

Each opens its own PR against synqed-core's integration branch.

| # | Work | Route(s) | Client method(s) |
|---|---|---|---|
| 0.2.a | Date-range filter on karute list | `GET /karute-records?from&to` | `KaruteRecordClient.list({ from, to })` |
| 0.2.b | Appointment overlap check | `POST /appointments` returns 409 on overlap | unchanged surface; adds typed `SynqedError` with status 409 |
| 0.2.c | Manual entry add/delete | `POST /karute-records/:id/entries`, `DELETE /karute-records/:id/entries/:entryId` | `KaruteRecordClient.addEntry(id, input)`, `KaruteRecordClient.deleteEntry(id, entryId)` |
| 0.2.d | Staff delete guards | `DELETE /staff/:id` returns 400 if last-staff or has attributed records | unchanged surface; guards enforced server-side |
| 0.2.e | Staff PIN | `PUT /staff/:id/pin`, `DELETE /staff/:id/pin`, `POST /staff/:id/pin/verify`, `GET /staff/:id/pin` | `StaffClient.setPin`, `removePin`, `verifyPin`, `hasPin` |
| 0.2.f | Staff avatar upload | `POST /staff/:id/avatar` (multipart) | `StaffClient.uploadAvatar(id, file)` — persists `avatar_url` and returns it |

### Step 0.3 (serial) — publish `@synqed-kk/client`

Bump version, publish (or rely on workspace link), update karute's `package.json` + lockfile in its own small PR against karute's integration branch.

## Phase 1 — karute migration (five PR groups)

All five can run in parallel, each in a separate worktree off the karute integration branch.

### PR 1 — Customers cleanup + Appointments

**Files:** `src/actions/customers.ts`, `src/actions/appointments.ts`

- `deleteCustomer`: drop supabase pre-check and appointment delete. Use `synqed.karuteRecords.list({ customer_id, page_size: 1 })` to check for linked records; block delete if `total > 0`. Delete customer via `synqed.customers.delete(id)`. (Appointment cascade handled server-side on customer delete — verify in Phase 0.)
- `createAppointment`: `synqed.appointments.create({ staff_id, customer_id, start_time, duration_minutes, title, notes })`. Remove client-side overlap check; catch `SynqedError` with status 409 and return `{ error: 'This time slot overlaps with an existing booking.' }`.
- `getAppointmentsByDate(dateStr, tz)`: compute `from`/`to` ISO boundaries; `synqed.appointments.list({ from, to })`.
- `linkKaruteToAppointment`: `synqed.appointments.update(id, { karute_record_id })`.
- `deleteAppointment`, `updateAppointment`: thin wrappers over client.

### PR 2 — Karute + Entries

**Files:** `src/actions/karute.ts`, `src/actions/entries.ts`, `src/types/karute.ts`

- Rename fields in `src/types/karute.ts` per the table above.
- `saveKaruteRecord` / `saveKaruteRecordInline`: single atomic call to `synqed.karuteRecords.create({ customer_id, staff_id, appointment_id, transcript, ai_summary, entries: [...] })`. Server handles both inserts; no manual cleanup needed. Preserve the `redirect()` outside try/catch pattern in `saveKaruteRecord`.
- `deleteKaruteRecord`: `synqed.karuteRecords.delete(id)`. Server cascades entries + unlinks appointments.
- `addManualEntry`: `synqed.karuteRecords.addEntry(karuteRecordId, { category, content, is_manual: true, confidence: null })`.
- `deleteEntry`: `synqed.karuteRecords.deleteEntry(karuteRecordId, entryId)`.

### PR 3 — Staff + staff-pin

**Files:** `src/actions/staff.ts`, `src/actions/staff-pin.ts`

- `createStaff`: `synqed.staff.create({ name, email, ... })`. Tenant is implicit; drop the `profiles.customer_id` lookup.
- `updateStaff`: `synqed.staff.update(id, input)`.
- `deleteStaff`: `synqed.staff.delete(id)`. Catch 400 and surface guard messages. Keep the active-staff auto-switch logic client-side (needs `list()` to find the next staff member).
- `uploadStaffAvatar`: `synqed.staff.uploadAvatar(id, file)`. Drop direct supabase storage usage.
- `setActiveStaff`: unchanged (cookie-only).
- `setStaffPin`, `removeStaffPin`, `verifyStaffPin`, `hasStaffPin`: delegate to new `StaffClient` PIN methods. Drop local hashing — server owns the hash.

### PR 4 — Org-settings

**File:** `src/actions/org-settings.ts`

- `getOrgSettings`: `synqed.orgSettings.get()`. Keep operating-hours and theme normalization wrappers.
- `upsertOrgSettings`: validate operating hours, then `synqed.orgSettings.upsert(input)`. Drop `supabase.auth.getUser()` — tenant scoping is server-side.

### PR 5 — Dashboard + supabase client cleanup

**Files:** `src/actions/dashboard.ts`, `src/lib/supabase/server.ts` (possibly)

- `getBarsByDate(dateStr, tz)`: compute `from`/`to`; `synqed.karuteRecords.list({ from, to })`; map to `DashboardBar[]`. Customer name comes from an `include` on the server response; if not, fall back to a single `synqed.customers.get()` batch.
- After this PR, `src/lib/supabase/server.ts` is only used for `supabase.auth`. Audit callers and, if feasible, retire `createClient()` in favor of a narrower `getSupabaseAuth()` helper. Otherwise leave as-is.

## Ordering & dependencies

```
Phase 0 (synqed-core)
  0.1 schema migration (serial)
    ↓
  0.2.a..f (six parallel PRs)
    ↓
  0.3 bump @synqed-kk/client, update karute package (serial)
    ↓
Phase 1 (karute, five parallel PRs)
  PR 1, 2, 3, 4, 5 — independent; each own worktree
    ↓
Each PR reviewed via /ultrareview before merge to integration branch
```

Intra-phase ordering within Phase 1:
- PR 2 lands the field renames in `src/types/karute.ts`. PR 5 uses the renamed fields too — the second to merge rebases.
- `src/lib/supabase/server.ts` deletion (if done) lives in PR 5, the last merge.

## Execution strategy

Parallel subagents, each in an isolated git worktree (`superpowers:using-git-worktrees`). Orchestrator dispatches, collects PRs, runs `/ultrareview` per PR, then merges to integration branch.

Skill stack per agent:
- `superpowers:executing-plans` (or `subagent-driven-development` from the orchestrator)
- `superpowers:test-driven-development` for new synqed-core endpoints
- `superpowers:verification-before-completion` + `simplify` before opening PR

## Error handling

- `SynqedError` (from `@synqed-kk/client`) carries HTTP status. Actions translate:
  - 400 → surface the server `message` as `{ error }`
  - 404 → `{ error: 'Not found' }`
  - 409 (appointment overlap, duplicate customer) → domain-specific friendly message
  - Any other → the server message, or `'Unknown error'`
- Preserve the existing `{ success, error }` / `{ error }` / `throw Error` return shapes per file (they're consumed by UI components — no need to refactor).

## Testing

Per existing convention (integration tests must have teardown to clean test data):

- **synqed-core (Phase 0)**: every new/extended endpoint gets an integration test hitting a real test database. Teardown cleans inserted rows. Test covers happy path + guard/overlap/error paths.
- **karute (Phase 1)**: smoke tests for each migrated action confirming it calls the client with the right shape. Full integration tests for actions that had non-trivial logic (`saveKaruteRecord` flow, `deleteCustomer` pre-check, `deleteStaff` guards, `createAppointment` overlap).
- Before each PR is submitted: run typecheck + existing test suite; paste output under the "Verification" section of the PR description.

## Review loop

Per PR:
1. Agent completes work, runs `verification-before-completion` (typecheck + tests) and `simplify` inline.
2. Agent opens PR against integration branch with a summary of changes and test output.
3. User runs `/ultrareview` on the PR.
4. Agent addresses feedback (via `superpowers:receiving-code-review`), re-verifies.
5. User merges.

After all 5 karute PRs land: manual smoke test of dashboard, recording flow, settings, customer CRUD (per `feedback_dashboard_ux.md`), then merge integration branch to `main` via its own PR.

## Open items

- Verify whether `DELETE /customers/:id` in synqed-core cascades `appointments`. If not, karute's `deleteCustomer` must iterate and delete appointments explicitly — either client-side (bad: N+1) or by adding server-side cascade (preferred). Resolve in Phase 0.
- Verify whether `karute-records.list()` response includes customer name. If not, add an `include=customer` query param in 0.2.a.
- Confirm `@synqed-kk/client` publish mechanism (npm vs workspace link) with Anthony before Phase 0.3.
