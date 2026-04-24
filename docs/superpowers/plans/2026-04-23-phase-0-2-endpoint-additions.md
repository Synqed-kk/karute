# Phase 0.2 — synqed-core Endpoint Additions Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each Task (0.2.a–0.2.f) is an independent unit of work — one subagent per task, one PR per task. Tasks have NO dependencies on each other; dispatch in parallel.

**Goal:** Add six endpoints (or endpoint extensions) to synqed-core so Phase 1 karute migration can consume them via `@synqed-kk/client`.

**Architecture:** Hono routes with tenant-scoped Prisma queries, zod validation, vitest integration tests. Each task follows the existing customers.ts pattern. After all six PRs merge, Phase 0.3 bumps `@synqed-kk/client` to v0.2.0 and republishes.

**Tech Stack:** Hono 4, Prisma 6, Zod 3, Vitest, TypeScript.

**Repo:** `synqed-core` (working directory: `/Users/anthonylee/synqed-core`). This plan does **not** touch karute.

**Base branch:** `main` (Phase 0.1 merged as commit `2673f80`). Each task creates its own branch off main.

---

## Common conventions (applies to ALL tasks)

### File pattern (per endpoint group)

| Layer | Path | Responsibility |
|---|---|---|
| Route | `src/routes/X.ts` | Hono handler: parse request, validate, call service, format response |
| Service | `src/services/X.service.ts` | Prisma queries + business logic. Returns `*Public` shapes |
| Validation | `src/validations/X.ts` | Zod schemas. One per input type |
| Tests | `tests/X.test.ts` | Vitest integration tests via `app.request('/v1/...')` |
| Client | `packages/client/src/X.ts` | Method(s) on `XClient` class |
| Types | `packages/client/src/types.ts` | Exported request/response types |

See `src/services/customer.service.ts` + `src/routes/customers.ts` + `tests/customers.test.ts` + `packages/client/src/customers.ts` as a reference for the full pattern.

### Test pattern

- All tests go in `synqed-core/tests/`.
- Import from `./setup.js`: `cleanupTestData`, `TEST_TENANT_ID`, `TEST_API_KEY`.
- Use the `req()` helper (see customers.test.ts).
- Before each test: `await cleanupTestData()` in `afterEach`.
- **If your task needs new seed helpers** (e.g., `seedTestStaff`, `seedTestKaruteRecord`): add them to `tests/setup.ts` and update `cleanupTestData()` to clean those tables too.

### Client package

- After editing `packages/client/src/*`, run `npm run build` in `packages/client/` to ensure `dist/` is up to date before a reviewer pulls.
- Do NOT publish during this phase — Phase 0.3 handles the coordinated v0.2.0 publish after all 6 PRs merge.

### Branch + PR workflow

- Each task: branch off `org/main` named `feat/0-2-X-short-description`.
- Worktree location: `.worktrees/0-2-X-short-description/`.
- PR target: `main` on `Synqed-kk/synqed-core`.
- PR title: `feat(api): <one-line description>`.
- Push remote: `org` (not `origin`).

### Environment setup (per worktree)

```bash
cd /Users/anthonylee/synqed-core/.worktrees/0-2-X-short-description
cp ../../.env .env
npm install
npx prisma generate
```

Baseline tests pass on the merged Phase 0.1 main (14/14). Your task adds more tests; the final suite must be green.

### Running tests

`npm test` does not auto-load `.env`. Always prefix commands that need env:

```bash
export $(grep -v '^#' .env | xargs) && npm test
```

---

## Task 0.2.a — Date-range filter on karute list

**Why:** The karute dashboard queries records by date range. The current `GET /karute-records` endpoint only supports `customer_id`, `staff_id`, `recording_session_id`, `status`.

**Branch:** `feat/0-2-a-karute-date-range`

**Files to modify:**
- `src/validations/karute.ts` — add `from` and `to` to `listKaruteRecordsSchema`
- `src/services/karute.service.ts` — accept `from`/`to` in options, add Prisma `createdAt` filter
- `src/routes/karute.ts` — pass `from`/`to` through from query string
- `packages/client/src/karute.ts` — add `from`/`to` to `list()` method's URL params
- `packages/client/src/types.ts` — add `from?: string; to?: string;` to `ListKaruteRecordsOptions`
- `tests/karute.test.ts` — **NEW** — integration tests for date-range filtering

### Steps

- [ ] **Step 1: Extend `listKaruteRecordsSchema`**

Edit `src/validations/karute.ts`. Change `listKaruteRecordsSchema` from:

```typescript
export const listKaruteRecordsSchema = z.object({
  customer_id: z.string().uuid().optional(),
  staff_id: z.string().uuid().optional(),
  recording_session_id: z.string().uuid().optional(),
  status: karuteStatusSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(200).optional(),
})
```

to:

```typescript
export const listKaruteRecordsSchema = z.object({
  customer_id: z.string().uuid().optional(),
  staff_id: z.string().uuid().optional(),
  recording_session_id: z.string().uuid().optional(),
  status: karuteStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(200).optional(),
})
```

- [ ] **Step 2: Extend `listKaruteRecords` service**

Edit `src/services/karute.service.ts`. In the `listKaruteRecords` function, change the options typedef to include `from?: string; to?: string;`, and add date filter construction:

```typescript
// Before the Promise.all:
if (options.from || options.to) {
  const createdAt: Record<string, Date> = {}
  if (options.from) createdAt.gte = new Date(options.from)
  if (options.to) createdAt.lte = new Date(options.to)
  where.createdAt = createdAt
}
```

Place this after the existing `where.status = options.status` line and before the `Promise.all`.

- [ ] **Step 3: Update route handler**

Edit `src/routes/karute.ts`. The existing list handler uses `listKaruteRecordsSchema.parse(c.req.query())`. Since we extended the schema, it automatically picks up `from`/`to`. No handler change required — but confirm by re-reading the file.

- [ ] **Step 4: Update client method**

Edit `packages/client/src/karute.ts`. In `KaruteRecordClient.list()`, add the new params:

```typescript
if (options?.from) params.set('from', options.from)
if (options?.to) params.set('to', options.to)
```

Place after the `status` line, before `page`.

- [ ] **Step 5: Update client types**

Edit `packages/client/src/types.ts`. Find the `ListKaruteRecordsOptions` interface and add:

```typescript
from?: string
to?: string
```

(ISO 8601 strings. Typing mirrors `ListAppointmentsOptions`.)

- [ ] **Step 6: Rebuild client**

```bash
cd packages/client && npm run build
```

Expected: `tsc` succeeds, no errors. Then `cd ../..` back to repo root.

- [ ] **Step 7: Write integration tests**

Create `tests/karute.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  seedTestKaruteRecord,
  TEST_TENANT_ID,
  TEST_API_KEY,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY

const headers = {
  'x-api-key': TEST_API_KEY,
  'x-tenant-id': TEST_TENANT_ID,
  'Content-Type': 'application/json',
}

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers }
  if (body) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}

describe('Karute Records — date range filter', () => {
  afterEach(async () => {
    await cleanupTestData()
  })

  it('returns records within from/to window', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()

    const inWindow = await seedTestKaruteRecord({
      customerId: customer.id,
      staffId: staff.id,
      createdAt: new Date('2026-04-15T12:00:00Z'),
    })
    await seedTestKaruteRecord({
      customerId: customer.id,
      staffId: staff.id,
      createdAt: new Date('2026-04-01T12:00:00Z'),
    })

    const res = await req(
      'GET',
      '/karute-records?from=2026-04-10T00:00:00Z&to=2026-04-20T00:00:00Z',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.karute_records).toHaveLength(1)
    expect(body.karute_records[0].id).toBe(inWindow.id)
  })

  it('from only (no to)', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    await seedTestKaruteRecord({
      customerId: customer.id,
      staffId: staff.id,
      createdAt: new Date('2026-04-15T12:00:00Z'),
    })
    await seedTestKaruteRecord({
      customerId: customer.id,
      staffId: staff.id,
      createdAt: new Date('2026-04-01T12:00:00Z'),
    })

    const res = await req('GET', '/karute-records?from=2026-04-10T00:00:00Z')
    const body = await res.json()
    expect(body.karute_records).toHaveLength(1)
  })
})
```

- [ ] **Step 8: Add `seedTestStaff` and `seedTestKaruteRecord` to setup.ts**

Edit `tests/setup.ts`. Add:

```typescript
export async function seedTestStaff(overrides?: Record<string, any>) {
  return testPrisma.staff.create({
    data: {
      tenantId: TEST_TENANT_ID,
      name: 'テストスタッフ',
      role: 'STYLIST',
      isActive: true,
      ...overrides,
    },
  })
}

export async function seedTestKaruteRecord(overrides: { customerId?: string; staffId: string; createdAt?: Date }) {
  return testPrisma.karuteRecord.create({
    data: {
      tenantId: TEST_TENANT_ID,
      customerId: overrides.customerId ?? null,
      staffId: overrides.staffId,
      status: 'DRAFT',
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  })
}
```

And extend `cleanupTestData` to include staff and karuteRecord cleanup **at the top**:

```typescript
export async function cleanupTestData() {
  await testPrisma.karuteRecord.deleteMany({ where: { tenantId: TEST_TENANT_ID } })
  await testPrisma.staff.deleteMany({ where: { tenantId: TEST_TENANT_ID } })
  await testPrisma.customer.deleteMany({ where: { tenantId: TEST_TENANT_ID } })
}
```

(Order matters: delete karute_records before staff (FK), before customers.)

- [ ] **Step 9: Run tests**

```bash
export $(grep -v '^#' .env | xargs) && npm test
```

Expected: all tests pass. New tests in karute.test.ts + existing customers.test.ts = 16+ passing.

- [ ] **Step 10: Commit and open PR** (follow the Common conventions push/PR workflow at the top of this plan)

Commit message:
```
feat(api): add from/to date filter to /karute-records

Adds from and to query params to the karute records list endpoint
so karute's dashboard can query by date window. Params are ISO 8601
datetime strings; both are optional.

Also exposes from/to on KaruteRecordClient.list() in the client
package and adds integration tests.
```

PR title: `feat(api): add from/to date filter to /karute-records`

---

## Task 0.2.b — Appointment overlap check

**Why:** karute's `createAppointment` currently does a client-side overlap check. Moving it server-side returns HTTP 409 so the client can display the error uniformly.

**Branch:** `feat/0-2-b-appointment-overlap`

**Files:**
- `src/services/appointment.service.ts` — add overlap check in `createAppointment`; export an `AppointmentOverlapError`
- `src/routes/appointments.ts` — map `AppointmentOverlapError` → HTTP 409
- `packages/client/src/client.ts` — no change (existing `SynqedError` carries status)
- `tests/appointments.test.ts` — **NEW** — overlap test cases

### Steps

- [ ] **Step 1: Add overlap check to service**

Edit `src/services/appointment.service.ts`. Near the top, export a new error class:

```typescript
export class AppointmentOverlapError extends Error {
  constructor(message = 'This time slot overlaps with an existing booking.') {
    super(message)
    this.name = 'AppointmentOverlapError'
  }
}
```

In `createAppointment(tenantId, input)`, before the `prisma.appointment.create(...)` call, add overlap check:

```typescript
const startsAt = new Date(input.starts_at)
const endsAt = new Date(input.ends_at)

const overlapping = await prisma.appointment.findFirst({
  where: {
    tenantId,
    staffId: input.staff_id,
    status: { not: 'CANCELLED' },
    startsAt: { lt: endsAt },
    endsAt: { gt: startsAt },
  },
  select: { id: true },
})

if (overlapping) throw new AppointmentOverlapError()
```

- [ ] **Step 2: Map the error in the route**

Edit `src/routes/appointments.ts`. In the POST handler, catch the new error:

```typescript
import { AppointmentOverlapError } from '../services/appointment.service.js'

// inside the POST / handler's try/catch:
try {
  const appt = await createAppointment(tenantId, body)
  return c.json(appt, 201)
} catch (err) {
  if (err instanceof AppointmentOverlapError) {
    return c.json({ error: err.message }, 409)
  }
  throw err
}
```

If the existing handler doesn't already have a try/catch wrapper, add one.

- [ ] **Step 3: Write tests**

Create `tests/appointments.test.ts`. Use `seedTestStaff`, `seedTestCustomer` from setup.ts (add them if Task 0.2.a hasn't — see its Step 8).

Tests to cover:
1. Creates appointment when no overlap.
2. Returns 409 when a SCHEDULED appointment overlaps.
3. Does NOT return 409 for a CANCELLED appointment (check `status: { not: 'CANCELLED' }`).
4. Does NOT return 409 for same staff but non-overlapping time.
5. Does NOT return 409 for overlapping time but different staff.

Example happy-path:

```typescript
it('creates an appointment when no overlap', async () => {
  const customer = await seedTestCustomer()
  const staff = await seedTestStaff()

  const res = await req('POST', '/appointments', {
    customer_id: customer.id,
    staff_id: staff.id,
    starts_at: '2026-05-10T10:00:00Z',
    ends_at: '2026-05-10T11:00:00Z',
  })

  expect(res.status).toBe(201)
})

it('returns 409 when overlapping', async () => {
  const customer = await seedTestCustomer()
  const staff = await seedTestStaff()

  await req('POST', '/appointments', {
    customer_id: customer.id,
    staff_id: staff.id,
    starts_at: '2026-05-10T10:00:00Z',
    ends_at: '2026-05-10T11:00:00Z',
  })

  const res = await req('POST', '/appointments', {
    customer_id: customer.id,
    staff_id: staff.id,
    starts_at: '2026-05-10T10:30:00Z',
    ends_at: '2026-05-10T11:30:00Z',
  })

  expect(res.status).toBe(409)
  const body = await res.json()
  expect(body.error).toMatch(/overlap/i)
})
```

Fill in the remaining cases following the same pattern.

- [ ] **Step 4: Verify + commit + PR**

```bash
export $(grep -v '^#' .env | xargs) && npm test
```

All tests pass. Commit + push + PR per Common conventions.

Commit title: `feat(api): 409 on overlapping appointments`

---

## Task 0.2.c — Manual entry add/delete endpoints

**Why:** karute's `addManualEntry` and `deleteEntry` server actions need endpoints. Entries today can only be created via karute-record create/update.

**Branch:** `feat/0-2-c-manual-entries`

**Files:**
- `src/validations/karute.ts` — add `createEntrySchema` for a single entry
- `src/services/karute.service.ts` — add `addEntry(tenantId, karuteRecordId, input)` and `deleteEntry(tenantId, karuteRecordId, entryId)`
- `src/routes/karute.ts` — add `POST /karute-records/:id/entries` and `DELETE /karute-records/:id/entries/:entryId`
- `packages/client/src/karute.ts` — add `addEntry()` and `deleteEntry()` methods
- `packages/client/src/types.ts` — add `CreateEntryInput` type if different from existing `EntryInput`
- `tests/karute-entries.test.ts` — **NEW**

### Steps

- [ ] **Step 1: Add validation schema**

Edit `src/validations/karute.ts`. Reuse the existing `entryInputSchema` (it already supports `is_manual` now that Phase 0.1 merged — but check: if `is_manual` isn't in it, add it as `z.boolean().optional()`).

Open the file, confirm `entryInputSchema` has:

```typescript
export const entryInputSchema = z.object({
  category: entryCategorySchema,
  content: z.string(),
  original_quote: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),  // allow null for manual
  tags: z.array(z.string()).optional(),
  sort_order: z.number().int().optional(),
  is_manual: z.boolean().optional(),
})
```

If `confidence` isn't nullable, change it to nullable (manual entries have no confidence). If `is_manual` isn't there, add it.

- [ ] **Step 2: Add service methods**

Edit `src/services/karute.service.ts`. Add at the bottom:

```typescript
export async function addEntry(
  tenantId: string,
  karuteRecordId: string,
  input: EntryInput,
): Promise<EntryPublic> {
  // Verify karute record belongs to tenant
  const record = await prisma.karuteRecord.findFirst({
    where: { id: karuteRecordId, tenantId },
    select: { id: true },
  })
  if (!record) throw new Error('Karute record not found')

  // Determine next sort order
  const lastEntry = await prisma.karuteEntry.findFirst({
    where: { karuteRecordId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  const nextSortOrder = (lastEntry?.sortOrder ?? -1) + 1

  const row = await prisma.karuteEntry.create({
    data: {
      karuteRecordId,
      category: input.category,
      content: input.content,
      originalQuote: input.original_quote ?? null,
      confidence: input.confidence ?? 0,
      tags: input.tags ?? [],
      sortOrder: input.sort_order ?? nextSortOrder,
      isManual: input.is_manual ?? false,
    },
  })
  return entryToPublic(row)
}

export async function deleteEntry(
  tenantId: string,
  karuteRecordId: string,
  entryId: string,
): Promise<void> {
  // Verify karute record belongs to tenant (enforces tenant isolation for entry)
  const record = await prisma.karuteRecord.findFirst({
    where: { id: karuteRecordId, tenantId },
    select: { id: true },
  })
  if (!record) throw new Error('Karute record not found')

  const entry = await prisma.karuteEntry.findFirst({
    where: { id: entryId, karuteRecordId },
    select: { id: true },
  })
  if (!entry) throw new Error('Entry not found')

  await prisma.karuteEntry.delete({ where: { id: entryId } })
}
```

Note: you may need to tweak `entryToPublic` to include `is_manual` — update it:

```typescript
function entryToPublic(row: {
  // existing fields ...
  isManual: boolean  // add
}): EntryPublic {
  return {
    // existing fields ...
    is_manual: row.isManual,  // add
  }
}
```

And `EntryPublic` interface at the top of the file — add `is_manual: boolean`.

- [ ] **Step 3: Add routes**

Edit `src/routes/karute.ts`. After the existing `DELETE /:id` handler, add:

```typescript
karuteRoutes.post('/:id/entries', async (c) => {
  const tenantId = c.get('tenantId')
  const karuteRecordId = c.req.param('id')
  const body = entryInputSchema.parse(await c.req.json())
  try {
    const entry = await addEntry(tenantId, karuteRecordId, body)
    return c.json(entry, 201)
  } catch (err) {
    if (err instanceof Error && err.message === 'Karute record not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})

karuteRoutes.delete('/:id/entries/:entryId', async (c) => {
  const tenantId = c.get('tenantId')
  const karuteRecordId = c.req.param('id')
  const entryId = c.req.param('entryId')
  try {
    await deleteEntry(tenantId, karuteRecordId, entryId)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && (err.message === 'Karute record not found' || err.message === 'Entry not found')) {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})
```

Make sure `entryInputSchema`, `addEntry`, `deleteEntry` are imported at the top of the file.

- [ ] **Step 4: Add client methods**

Edit `packages/client/src/karute.ts`. Inside `KaruteRecordClient`, after `delete()`:

```typescript
async addEntry(
  karuteRecordId: string,
  input: EntryInput,
): Promise<Entry> {
  return this.client.fetch<Entry>(`/karute-records/${karuteRecordId}/entries`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

async deleteEntry(karuteRecordId: string, entryId: string): Promise<void> {
  await this.client.fetch(
    `/karute-records/${karuteRecordId}/entries/${entryId}`,
    { method: 'DELETE' },
  )
}
```

Import `EntryInput` and `Entry` from `./types.js` at the top if not present.

- [ ] **Step 5: Update client types**

Edit `packages/client/src/types.ts`. Check if `EntryInput` and `Entry` types exist — if not, add:

```typescript
export interface Entry {
  id: string
  karute_record_id: string
  category: EntryCategory
  content: string
  original_quote: string | null
  confidence: number
  tags: string[]
  sort_order: number
  is_manual: boolean
  created_at: string
  updated_at: string
}

export interface EntryInput {
  category: EntryCategory
  content: string
  original_quote?: string | null
  confidence?: number | null
  tags?: string[]
  sort_order?: number
  is_manual?: boolean
}
```

Also add `is_manual: boolean` to the `KaruteEntry` type (if it exists separately).

- [ ] **Step 6: Rebuild client**

```bash
cd packages/client && npm run build && cd ../..
```

- [ ] **Step 7: Write tests**

Create `tests/karute-entries.test.ts` with:
1. Add entry to existing record (happy path), verifies response has `is_manual`.
2. Add entry to non-existent record → 404.
3. Delete entry successfully.
4. Delete entry from different tenant's record → 404.
5. Delete non-existent entry → 404.

- [ ] **Step 8: Verify + commit + PR**

```bash
export $(grep -v '^#' .env | xargs) && npm test
```

Commit title: `feat(api): entry add/delete endpoints`

---

## Task 0.2.d — Staff delete guards

**Why:** karute's `deleteStaff` action guards against deleting the last staff or a staff who has karute records attributed. Move these guards server-side.

**Branch:** `feat/0-2-d-staff-delete-guards`

**Files:**
- `src/services/staff.service.ts` — extend `deleteStaff` with guard checks; throw typed errors
- `src/routes/staff.ts` — map new errors to HTTP 400
- `tests/staff.test.ts` — **NEW** — cover guard cases

### Steps

- [ ] **Step 1: Add typed errors + guards to service**

Edit `src/services/staff.service.ts`. At the top, export:

```typescript
export class StaffLastMemberError extends Error {
  constructor() {
    super('Cannot delete the last staff member.')
    this.name = 'StaffLastMemberError'
  }
}

export class StaffAttributedRecordsError extends Error {
  constructor(public count: number) {
    super(`This staff member has ${count} karute record${count === 1 ? '' : 's'} and cannot be deleted.`)
    this.name = 'StaffAttributedRecordsError'
  }
}
```

In `deleteStaff(tenantId, id)`, add guards before the delete:

```typescript
const [totalCount, recordCount] = await Promise.all([
  prisma.staff.count({ where: { tenantId } }),
  prisma.karuteRecord.count({ where: { tenantId, staffId: id } }),
])

if (totalCount <= 1) throw new StaffLastMemberError()
if (recordCount > 0) throw new StaffAttributedRecordsError(recordCount)
```

Then the existing `prisma.staff.delete(...)` runs.

- [ ] **Step 2: Map errors in route**

Edit `src/routes/staff.ts`. In the DELETE handler:

```typescript
import { deleteStaff, StaffLastMemberError, StaffAttributedRecordsError } from '../services/staff.service.js'

staffRoutes.delete('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  try {
    await deleteStaff(tenantId, id)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof StaffLastMemberError || err instanceof StaffAttributedRecordsError) {
      return c.json({ error: err.message }, 400)
    }
    throw err
  }
})
```

- [ ] **Step 3: Tests**

Create `tests/staff.test.ts`. Test cases:
1. Happy path: create 2 staff, delete one → 200, second remains.
2. Guard: only 1 staff exists → 400 with "last staff member" message.
3. Guard: staff has karute records → 400 with "N karute record(s)".
4. Idempotent 404: delete non-existent staff ID → 404 (verify existing behavior).

Use `seedTestStaff` and `seedTestKaruteRecord` helpers (add to setup.ts per Task 0.2.a Step 8 if not present).

- [ ] **Step 4: Verify + commit + PR**

Commit title: `feat(api): server-side staff delete guards`

---

## Task 0.2.e — Staff PIN endpoints

**Why:** karute's `staff-pin.ts` hashes PINs client-side. Move PIN storage + verification server-side so the plaintext PIN never leaves the server action.

**Branch:** `feat/0-2-e-staff-pin`

**Files:**
- `src/validations/staff.ts` — add `pinSchema` (4-digit)
- `src/services/crypto.ts` — already exists; add (if not present) `hashPin(pin)` using SHA-256
- `src/services/staff.service.ts` — add `setPin`, `removePin`, `verifyPin`, `hasPin`
- `src/routes/staff.ts` — PUT `/:id/pin`, DELETE `/:id/pin`, POST `/:id/pin/verify`, GET `/:id/pin`
- `packages/client/src/staff.ts` — add corresponding methods
- `tests/staff-pin.test.ts` — **NEW**

### Steps

- [ ] **Step 1: Validation schema**

Edit `src/validations/staff.ts`. Add:

```typescript
export const setPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
})

export const verifyPinSchema = z.object({
  pin: z.string(),
})

export type SetPinInput = z.infer<typeof setPinSchema>
```

- [ ] **Step 2: Hash helper**

Check `src/services/crypto.ts`. If it doesn't have `hashPin`, add:

```typescript
import { createHash } from 'node:crypto'

export function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex')
}
```

Else extend the existing file. Do NOT duplicate if it exists.

- [ ] **Step 3: Service methods**

Edit `src/services/staff.service.ts`. Add:

```typescript
import { hashPin } from './crypto.js'

export async function setPin(tenantId: string, staffId: string, pin: string): Promise<void> {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, tenantId }, select: { id: true } })
  if (!staff) throw new Error('Staff not found')
  await prisma.staff.update({
    where: { id: staffId },
    data: { pinHash: hashPin(pin) },
  })
}

export async function removePin(tenantId: string, staffId: string): Promise<void> {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, tenantId }, select: { id: true } })
  if (!staff) throw new Error('Staff not found')
  await prisma.staff.update({
    where: { id: staffId },
    data: { pinHash: null },
  })
}

export async function verifyPin(
  tenantId: string,
  staffId: string,
  pin: string,
): Promise<{ valid: boolean; no_pin?: boolean }> {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, tenantId },
    select: { pinHash: true },
  })
  if (!staff) throw new Error('Staff not found')
  if (!staff.pinHash) return { valid: true, no_pin: true }
  return { valid: hashPin(pin) === staff.pinHash }
}

export async function hasPin(tenantId: string, staffId: string): Promise<{ has_pin: boolean }> {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, tenantId },
    select: { pinHash: true },
  })
  if (!staff) throw new Error('Staff not found')
  return { has_pin: !!staff.pinHash }
}
```

- [ ] **Step 4: Routes**

Edit `src/routes/staff.ts`. Add:

```typescript
import {
  setPinSchema,
  verifyPinSchema,
} from '../validations/staff.js'
import {
  setPin,
  removePin,
  verifyPin,
  hasPin,
} from '../services/staff.service.js'

staffRoutes.put('/:id/pin', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const body = setPinSchema.parse(await c.req.json())
  await setPin(tenantId, id, body.pin)
  return c.json({ success: true })
})

staffRoutes.delete('/:id/pin', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  await removePin(tenantId, id)
  return c.json({ success: true })
})

staffRoutes.post('/:id/pin/verify', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const body = verifyPinSchema.parse(await c.req.json())
  const result = await verifyPin(tenantId, id, body.pin)
  return c.json(result)
})

staffRoutes.get('/:id/pin', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const result = await hasPin(tenantId, id)
  return c.json(result)
})
```

Each handler should 404 on "Staff not found" via a try/catch (same pattern as staff delete).

- [ ] **Step 5: Client methods**

Edit `packages/client/src/staff.ts`. Inside `StaffClient`, add:

```typescript
async setPin(id: string, pin: string): Promise<void> {
  await this.client.fetch(`/staff/${id}/pin`, {
    method: 'PUT',
    body: JSON.stringify({ pin }),
  })
}

async removePin(id: string): Promise<void> {
  await this.client.fetch(`/staff/${id}/pin`, { method: 'DELETE' })
}

async verifyPin(id: string, pin: string): Promise<{ valid: boolean; no_pin?: boolean }> {
  return this.client.fetch<{ valid: boolean; no_pin?: boolean }>(
    `/staff/${id}/pin/verify`,
    { method: 'POST', body: JSON.stringify({ pin }) },
  )
}

async hasPin(id: string): Promise<{ has_pin: boolean }> {
  return this.client.fetch<{ has_pin: boolean }>(`/staff/${id}/pin`)
}
```

- [ ] **Step 6: Rebuild client**

```bash
cd packages/client && npm run build && cd ../..
```

- [ ] **Step 7: Tests**

Create `tests/staff-pin.test.ts`. Test cases:
1. `PUT /:id/pin` with 4-digit PIN → 200, GET `/:id/pin` returns `has_pin: true`.
2. `PUT /:id/pin` with non-4-digit → 400 (validation).
3. `DELETE /:id/pin` → 200, GET → `has_pin: false`.
4. `POST /:id/pin/verify` with correct PIN → `{ valid: true }`.
5. `POST /:id/pin/verify` with wrong PIN → `{ valid: false }`.
6. `POST /:id/pin/verify` when no PIN set → `{ valid: true, no_pin: true }`.
7. PIN stored as hash (peek `pinHash` in DB after set; it should be 64-char hex, not the raw PIN).
8. Cross-tenant: a different tenant's set/verify → 404 (staff not found).

- [ ] **Step 8: Verify + commit + PR**

Commit title: `feat(api): server-side staff PIN endpoints`

Note: karute's existing `staff-pin.ts` does the same hashing client-side; after this PR the hash function + secret stays server-side only.

---

## Task 0.2.f — Staff avatar upload

**Why:** karute uploads staff avatars to supabase storage directly. Move that to a server-side endpoint so karute doesn't depend on supabase storage anymore.

**Branch:** `feat/0-2-f-staff-avatar`

**Files:**
- `src/services/staff.service.ts` — add `uploadAvatar(tenantId, id, file)` that writes to Supabase Storage and persists the resulting URL
- `src/routes/staff.ts` — `POST /:id/avatar` (multipart)
- `packages/client/src/staff.ts` — `uploadAvatar(id, file)`
- `tests/staff-avatar.test.ts` — **NEW**

### Prereqs

Check synqed-core's env/deps for Supabase SDK. If it's not there:
- Add `@supabase/supabase-js` to `package.json` (synqed-core root)
- Add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to `.env.example` (and ask orchestrator to put real values in `.env`)

**Before starting implementation, confirm with the orchestrator** whether synqed-core should own Supabase storage or if we should use a different object storage (S3, Vercel Blob, etc.). The spec assumed Supabase. If uncertain, STOP and ask rather than guessing.

### Steps

- [ ] **Step 1: Add Supabase client**

Create `src/services/storage.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
}

export const storage = createClient(url, key).storage
```

- [ ] **Step 2: Service method**

Edit `src/services/staff.service.ts`:

```typescript
import { storage } from './storage.js'

export async function uploadAvatar(
  tenantId: string,
  staffId: string,
  file: File,
): Promise<{ avatar_url: string }> {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, tenantId },
    select: { id: true },
  })
  if (!staff) throw new Error('Staff not found')

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${tenantId}/${staffId}.${ext}`

  const { error: uploadError } = await storage
    .from('avatars')
    .upload(path, file, { upsert: true })
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = storage.from('avatars').getPublicUrl(path)

  await prisma.staff.update({
    where: { id: staffId },
    data: { avatarUrl: publicUrl },
  })

  return { avatar_url: publicUrl }
}
```

- [ ] **Step 3: Route (multipart)**

Edit `src/routes/staff.ts`:

```typescript
staffRoutes.post('/:id/avatar', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const formData = await c.req.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)

  try {
    const result = await uploadAvatar(tenantId, id, file)
    return c.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Staff not found') {
      return c.json({ error: err.message }, 404)
    }
    throw err
  }
})
```

- [ ] **Step 4: Client method**

Edit `packages/client/src/staff.ts`:

```typescript
async uploadAvatar(id: string, file: File): Promise<{ avatar_url: string }> {
  const formData = new FormData()
  formData.append('file', file)
  // Bypass the JSON Content-Type header on this.client.fetch — let fetch set multipart boundary
  return this.client.fetchMultipart<{ avatar_url: string }>(
    `/staff/${id}/avatar`,
    formData,
  )
}
```

This needs a new helper `fetchMultipart` on `SynqedClient`. Edit `packages/client/src/client.ts`:

```typescript
async fetchMultipart<T>(path: string, formData: FormData): Promise<T> {
  const url = `${this.baseUrl}/v1${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': this.apiKey,
      'x-tenant-id': this.tenantId,
      // NO Content-Type — fetch sets multipart boundary
    },
    body: formData,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new SynqedError(res.status, body.error ?? 'Request failed')
  }
  return res.json() as Promise<T>
}
```

- [ ] **Step 5: Rebuild client**

```bash
cd packages/client && npm run build && cd ../..
```

- [ ] **Step 6: Tests**

Create `tests/staff-avatar.test.ts`. Test cases:
1. Upload returns `avatar_url` + staff record has `avatar_url` set.
2. Missing file → 400.
3. Cross-tenant → 404.

For the upload test, create a small test file in memory:

```typescript
const file = new File([new Uint8Array([137, 80, 78, 71])], 'test.png', { type: 'image/png' })
const formData = new FormData()
formData.append('file', file)
const res = await app.request('/v1/staff/' + staff.id + '/avatar', {
  method: 'POST',
  headers: { 'x-api-key': TEST_API_KEY, 'x-tenant-id': TEST_TENANT_ID },
  body: formData,
})
```

Clean up uploaded test files in `cleanupTestData` (or write a targeted cleanup in the test itself).

- [ ] **Step 7: Verify + commit + PR**

Commit title: `feat(api): staff avatar upload endpoint`

---

## After all six PRs merge

Bump `packages/client/package.json` to `0.2.0` and republish (that's Phase 0.3 — a separate plan).

---

## Common failure modes

- **Seed helpers collide with concurrent test files** — tests share a tenant ID. `afterEach(cleanupTestData)` handles this, but ordering in cleanup matters (karute_records before staff before customers). If you get FK errors, fix the cleanup order.
- **Prisma client out of sync** — if you edit schema during your task (you shouldn't for Phase 0.2), re-run `npx prisma generate`. If someone else's merge changed schema while you were working, pull main and regenerate.
- **Worktree .env missing** — always `cp ../../.env .env` after creating a worktree.
- **pgbouncer prepared statement errors** — the pooler URL has `?pgbouncer=true` which is correct for runtime but breaks `prisma db push`. Phase 0.2 doesn't touch schema, so this shouldn't come up. If it does, use the direct URL (port 5432) just for that command.

## Done criteria

Each task ends when:
- All existing tests pass.
- New tests cover happy + error paths.
- Client package rebuilt.
- PR opened against `Synqed-kk/synqed-core:main` from the task's feature branch.
- PR URL reported back to the orchestrator.
