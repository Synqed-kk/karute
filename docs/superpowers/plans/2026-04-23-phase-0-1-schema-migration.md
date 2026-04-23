# Phase 0.1 — synqed-core Schema Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four fields to synqed-core's Prisma schema (`KaruteRecord.transcript`, `KaruteEntry.isManual`, `Staff.pinHash`, `Staff.avatarUrl`), sync to the dev database, and publish the generated client types so Phase 0.2 endpoint work can consume them.

**Architecture:** Pure additive schema change — all new fields are nullable or have defaults, so existing rows and existing tests are unaffected. We use `prisma db push` (matching the team's existing workflow — no `migrations/` directory yet), not `prisma migrate dev`. A follow-up task to introduce proper migration files can be filed separately if needed.

**Tech Stack:** Prisma 6.6, Postgres, TypeScript, Vitest.

**Repo:** `synqed-core` (working directory: `/Users/anthonylee/synqed-core`). This plan does **not** touch karute.

---

## Context the engineer needs

- `prisma/schema.prisma` holds the full data model.
- `src/services/*.service.ts` use `prisma.X.findMany/create/update/delete`. New fields surface in those types automatically after `prisma generate`.
- `src/validations/*.ts` hold zod schemas for request bodies. They don't yet include the new fields — that's OK, Phase 0.2 plans will add them when endpoints consume them.
- Tests live in `synqed-core/tests/`. Current pattern: hit Hono app via `app.request('/v1/...')` with `x-api-key` + `x-tenant-id` headers. `tests/setup.ts` exports `cleanupTestData()`.
- The dev DB connection string is in `.env` (`DATABASE_URL`). Must point at a working Postgres with the pooler URL (see repo memory: `project_synqed_architecture.md` — pooler URL is required).

## File Structure

- Modify: `synqed-core/prisma/schema.prisma` — add 4 fields across 3 models

That's the only human-written file change. Everything else is generated (`node_modules/.prisma/client/`) or database state.

---

## Task 1: Add fields to Prisma schema

**Files:**
- Modify: `synqed-core/prisma/schema.prisma` (3 models: `Staff`, `KaruteRecord`, `KaruteEntry`)

- [ ] **Step 1: Open `synqed-core/prisma/schema.prisma`**

Locate the three models listed below. Current state (for reference) is at lines ~51–68 (`Staff`), ~232–251 (`KaruteRecord`), ~268–284 (`KaruteEntry`).

- [ ] **Step 2: Add `pinHash` and `avatarUrl` to `Staff` model**

In the `Staff` model, after the `isActive` field and before `createdAt`, add:

```prisma
  pinHash   String?   @map("pin_hash")
  avatarUrl String?   @map("avatar_url")
```

The full `Staff` model should now read:

```prisma
model Staff {
  id        String    @id @default(uuid()) @db.Uuid
  tenantId  String    @map("tenant_id") @db.Uuid
  userId    String?   @unique @map("user_id") @db.Uuid
  name      String
  nameKana  String?   @map("name_kana")
  email     String?
  role      StaffRole @default(STYLIST)
  isActive  Boolean   @default(true) @map("is_active")
  pinHash   String?   @map("pin_hash")
  avatarUrl String?   @map("avatar_url")
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  appointments Appointment[]

  @@index([tenantId])
  @@index([tenantId, name])
  @@map("staff")
}
```

- [ ] **Step 3: Add `transcript` to `KaruteRecord` model**

In the `KaruteRecord` model, after `aiSummary` and before `createdAt`, add:

```prisma
  transcript         String?
```

The full model should now read:

```prisma
model KaruteRecord {
  id                 String       @id @default(uuid()) @db.Uuid
  tenantId           String       @map("tenant_id") @db.Uuid
  customerId         String?      @map("customer_id") @db.Uuid
  staffId            String       @map("staff_id") @db.Uuid
  appointmentId      String?      @map("appointment_id") @db.Uuid
  recordingSessionId String?      @unique @map("recording_session_id") @db.Uuid
  status             KaruteStatus @default(DRAFT)
  aiSummary          String?      @map("ai_summary")
  transcript         String?
  createdAt          DateTime     @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt          DateTime     @updatedAt @map("updated_at") @db.Timestamptz()

  entries          KaruteEntry[]
  recordingSession RecordingSession? @relation(fields: [recordingSessionId], references: [id])

  @@index([tenantId, createdAt])
  @@index([customerId])
  @@index([staffId])
  @@map("karute_records")
}
```

- [ ] **Step 4: Add `isManual` to `KaruteEntry` model**

In the `KaruteEntry` model, after `sortOrder` and before `createdAt`, add:

```prisma
  isManual       Boolean       @default(false) @map("is_manual")
```

The full model should now read:

```prisma
model KaruteEntry {
  id             String        @id @default(uuid()) @db.Uuid
  karuteRecordId String        @map("karute_record_id") @db.Uuid
  category       EntryCategory
  content        String
  originalQuote  String?       @map("original_quote")
  confidence     Float         @default(0)
  tags           String[]      @default([])
  sortOrder      Int           @default(0) @map("sort_order")
  isManual       Boolean       @default(false) @map("is_manual")
  createdAt      DateTime      @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt      DateTime      @updatedAt @map("updated_at") @db.Timestamptz()

  karuteRecord KaruteRecord @relation(fields: [karuteRecordId], references: [id], onDelete: Cascade)

  @@index([karuteRecordId, sortOrder])
  @@map("karute_entries")
}
```

- [ ] **Step 5: Verify formatting**

Run:

```bash
cd /Users/anthonylee/synqed-core/.worktrees/phase-0-1 && npx prisma format
```

Expected: no errors, schema is reformatted to canonical style. Re-open the file to confirm the three models still contain the new fields and nothing else drifted.

---

## Task 2: Regenerate Prisma client

**Files:** (generated — not committed by hand)
- `node_modules/.prisma/client/*` — auto-generated

- [ ] **Step 1: Run `prisma generate`**

```bash
cd /Users/anthonylee/synqed-core/.worktrees/phase-0-1 && npx prisma generate
```

Expected output: `Generated Prisma Client (v6.6.0)` (or the version pinned in `package.json`). No errors.

- [ ] **Step 2: Confirm typecheck still passes**

```bash
cd /Users/anthonylee/synqed-core/.worktrees/phase-0-1 && npm run typecheck
```

Expected: exit 0, no TypeScript errors. The added fields are optional/defaulted, so no existing code needs updating.

---

## Task 3: Sync schema to dev database

**Files:** none (DB state only)

- [ ] **Step 1: Confirm `DATABASE_URL` is set and points at the dev DB**

```bash
cd /Users/anthonylee/synqed-core/.worktrees/phase-0-1 && grep -E "^DATABASE_URL=" .env | head -1
```

Expected: a `postgresql://postgres.jdbsqvlfwsmzfmisuwmw:...@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true` URL. The orchestrator has already placed this in `.env`.

If `.env` is missing the var or the URL is the direct port (5432), stop and flag — the transaction pooler URL (6543 + `?pgbouncer=true`) is required.

- [ ] **Step 2: Sync the schema**

```bash
cd /Users/anthonylee/synqed-core/.worktrees/phase-0-1 && export $(grep -v '^#' .env | xargs) && npm run db:push
```

`npm run db:push` runs `prisma db push`; the `export` loads `DATABASE_URL` from `.env` since the script doesn't auto-load it.

This runs `prisma db push`. Expected output includes:

```
🚀  Your database is now in sync with your Prisma schema.
```

and a list showing the three altered tables (`staff`, `karute_records`, `karute_entries`) with the new columns.

If `db push` refuses because of pending destructive changes, stop and flag — we do NOT want unexpected column drops.

- [ ] **Step 3: Verify the new columns landed**

Read the `db push` output from Step 2 — it explicitly lists altered tables and columns. Confirm all four of these appear:

- `staff.pin_hash`
- `staff.avatar_url`
- `karute_records.transcript`
- `karute_entries.is_manual`

If you want a secondary check, open Prisma Studio (`npx prisma studio`) and inspect the three tables' columns. Do NOT shell out to `psql` or `prisma db execute` — they require extra flags and are easy to misinvoke.

---

## Task 4: Run existing test suite against the updated schema

**Files:** none (verification only)

- [ ] **Step 1: Run vitest with env loaded**

`npm test` does NOT auto-load `.env` on this setup — the `test` script is just `vitest run`. Load env vars explicitly:

```bash
cd /Users/anthonylee/synqed-core/.worktrees/phase-0-1 && export $(grep -v '^#' .env | xargs) && npm test
```

Expected: 14/14 tests pass. Takes ~45 seconds (Supabase pooler latency). The existing suite is `tests/customers.test.ts`; it does not touch the new fields, so it should pass unchanged.

If any test fails, stop and investigate. Do not commit a broken build.

---

## Task 5: Commit and open PR

**Files:** the committed change is just `prisma/schema.prisma`.

- [ ] **Step 1: Review the diff**

```bash
cd /Users/anthonylee/synqed-core/.worktrees/phase-0-1 && git status && git diff prisma/schema.prisma
```

Expected: only `prisma/schema.prisma` shows as modified. Diff shows the four new fields across the three models and nothing else.

If `node_modules` or other files appear, they should NOT be staged.

- [ ] **Step 2: Stage and commit**

```bash
cd /Users/anthonylee/synqed-core/.worktrees/phase-0-1 && git add prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(schema): add pin_hash, avatar_url, transcript, is_manual

Additive schema change in support of the karute server-actions
migration to @synqed/client. Adds:
  - Staff.pin_hash, Staff.avatar_url
  - KaruteRecord.transcript
  - KaruteEntry.is_manual (default false)

All fields are nullable or defaulted; no existing rows need
backfill. Applied to dev DB via `prisma db push`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push and open PR against synqed-core's integration branch**

```bash
cd /Users/anthonylee/synqed-core/.worktrees/phase-0-1 && git push -u org HEAD
```

Then:

```bash
cd /Users/anthonylee/synqed-core/.worktrees/phase-0-1 && gh pr create --repo Synqed-kk/synqed-core --base main --head feat/add-migration-fields --title "feat(schema): add pin_hash, avatar_url, transcript, is_manual" --body "$(cat <<'EOF'
## Summary
- Adds four additive fields to unblock Phase 0.2 endpoint work (karute server-actions migration).
- Fields: `Staff.pin_hash`, `Staff.avatar_url`, `KaruteRecord.transcript`, `KaruteEntry.is_manual`.
- All nullable or defaulted — no backfill required.

## Spec
See `docs/superpowers/specs/2026-04-23-karute-synqed-client-migration-design.md` in the karute repo.

## Verification
- `npx prisma format` — clean.
- `npx prisma generate` — succeeded.
- `npm run typecheck` — passes.
- `npm run db:push` — columns confirmed via `information_schema.columns`.
- `npm test` — existing suite passes.

## Test plan
- [ ] Reviewer verifies the three model diffs match the spec.
- [ ] Reviewer confirms we intentionally kept the "db push, no migration files" workflow for this change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Confirm the base branch is synqed-core's integration branch (`main` unless a different integration branch exists — check with `git branch -a` before pushing if uncertain).

- [ ] **Step 4: Return the PR URL to the orchestrator**

The `gh pr create` command prints the URL. Capture and report it.

---

## Done criteria

- `prisma/schema.prisma` contains the four new fields as specified.
- `npx prisma generate` has run and `npm run typecheck` passes.
- Dev DB has the four columns (confirmed via `information_schema.columns` query).
- Existing test suite is green.
- PR opened against synqed-core's integration branch; URL reported.

No production deploy or client-package bump happens in this plan — those belong to Phase 0.3.
