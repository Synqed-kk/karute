# QuickReserve Deep Customer Crawl — Implementation Plan (Part 2, Phase 2a+2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crawl QuickReserve's per-customer deep data (full profile + visit/treatment history + payments) into synqed-core so Karute can show a complete customer record instead of placeholders.

**Architecture:** Enumerate customers via QR `get-customers-server-side`; for each, fetch `get-customer-reservations-by-customer-id` (returns nested `Customer`, `Bill`+`BillItems`, `Staff`, `TreatmentCourse` per visit). Upsert (a) extended profile/summary fields onto synqed-core `customers`, (b) one `customer_visits` row per reservation. Reuse the existing `sync_config` creds + `qrLogin`. Read-only against QR.

**Tech Stack:** synqed-core (Hono + Prisma + Postgres), `@synqed-kk/client` SDK, karute (Next.js route handler). Mirrors the Part-1 DOB/gender change and the existing reservation sync.

**Verified QR field map** (from live `get-customer-reservations-by-customer-id`, store 222):
- `Customer.gender`: int — `0`=unset→null, `1`→`male`, `2`→`female`
- `Customer.born_at`: unix ms | null → `date_of_birth`
- `Customer.profession`→occupation, `post_code`/`prefecture`/`address1`, `phone2`, `membership_id`→member#, `direct_mail`→dm_opt_in, `comment`, `remarks2`
- `Customer.postpaid_remaining_cache`→installment outstanding, `has_ticket_pack`:bool, `last_visit_at_cache`, `visits_number_cache`, `is_existing_customer`, `staff_id`→assigned QR staff
- Per visit: `id` (QR reservation id), `start_at`/`end_at` (unix ms), `deleted`:bool, `nominated_staff_id`, `TreatmentCourse.name` (e.g. `6回券`,`¥13200`), `Bill` (`cash`/`credit`/`emoney`/`discount`), `Bill.BillItems[]` (`item_name`,`price`,`price_consumed`,`category`). Visit sales = sum of `BillItems[].price_consumed`; settled = `Bill != null`.

> **PROD GATES (Anthony, same flow as Part 1):** the Prisma migration (apply via a `$executeRawUnsafe` script run by Anthony), the SDK publish, and the synqed-core deploy are all gated. Tasks below produce the code + verify locally; the gated commands are called out where they occur.

---

## File Structure

**synqed-core**
- `prisma/schema.prisma` — extend `Customer`, add `CustomerVisit` model
- `prisma/migrations/manual/2026-06-01-customer-deep.sql` — additive SQL
- `src/validations/customer.ts` — extend create/update schema; add visit-upsert schema
- `src/services/customer.service.ts` — map new fields; add `upsertVisits`
- `src/routes/customers.ts` — add `PUT /v1/customers/:id/visits` (bulk upsert)
- `src/types/api.ts` — extend `Customer`/inputs; add `CustomerVisit`
- `tests/customers.test.ts` — new-field + visit-upsert tests
- `packages/client/src/types.ts`, `packages/client/src/customers.ts`, `packages/client/package.json` — SDK

**karute**
- `src/lib/quickreserve.ts` — add `qrGetCustomersServerSide`, `qrGetCustomerReservationsByCustomerId`, mappers
- `src/app/api/sync/quickreserve-deep/route.ts` — the deep-crawl job
- `src/lib/__tests__` / `src/__tests__/integration/qr-deep-map.test.ts` — mapper unit tests

---

### Task 1: synqed-core — extend `Customer` + add `CustomerVisit` model

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/manual/2026-06-01-customer-deep.sql`

- [ ] **Step 1: Add columns + model to `prisma/schema.prisma`**

In `model Customer` (after the Part-1 `gender` line) add:
```prisma
  occupation            String?  @map("occupation")
  memberNumber          String?  @map("member_number")
  postalCode            String?  @map("postal_code")
  prefecture            String?
  address               String?
  phone2                String?
  dmOptIn               Boolean  @default(false) @map("dm_opt_in")
  comment               String?
  remarks2              String?
  totalSales            Int      @default(0) @map("total_sales")
  installmentOutstanding Int     @default(0) @map("installment_outstanding")
  hasTicketPack         Boolean  @default(false) @map("has_ticket_pack")
  firstVisitAt          DateTime? @map("first_visit_at") @db.Timestamptz()
  lastVisitAt           DateTime? @map("last_visit_at") @db.Timestamptz()
  visits                CustomerVisit[]
```
Add a new model:
```prisma
model CustomerVisit {
  id               String   @id @default(uuid()) @db.Uuid
  businessId       String   @map("business_id") @db.Uuid
  customerId       String   @map("customer_id") @db.Uuid
  qrReservationId  Int      @map("qr_reservation_id")
  usedAt           DateTime @map("used_at") @db.Timestamptz()
  status           String   // 'settled' | 'booked' | 'cancelled'
  courseName       String?  @map("course_name")
  salesAmount      Int      @default(0) @map("sales_amount")
  staffName        String?  @map("staff_name")
  treatmentComment String?  @map("treatment_comment")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([businessId, qrReservationId])
  @@index([customerId, usedAt])
  @@map("customer_visits")
}
```

- [ ] **Step 2: Write the additive migration SQL** — `prisma/migrations/manual/2026-06-01-customer-deep.sql`
```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS occupation text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS member_number text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS prefecture text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone2 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dm_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS comment text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS remarks2 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_sales integer NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS installment_outstanding integer NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS has_ticket_pack boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_visit_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_visit_at timestamptz;

CREATE TABLE IF NOT EXISTS customer_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  qr_reservation_id integer NOT NULL,
  used_at timestamptz NOT NULL,
  status text NOT NULL,
  course_name text,
  sales_amount integer NOT NULL DEFAULT 0,
  staff_name text,
  treatment_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, qr_reservation_id)
);
CREATE INDEX IF NOT EXISTS customer_visits_customer_used_idx ON customer_visits (customer_id, used_at);
```

- [ ] **Step 3: Validate schema** — Run: `cd ~/synqed-core && npx prisma generate`. Expected: generates with no schema error.

- [ ] **Step 4: Commit**
```bash
cd ~/synqed-core && git checkout -b feat/customer-deep-crawl
git add prisma/schema.prisma prisma/migrations/manual/2026-06-01-customer-deep.sql
git commit -m "feat(customer): deep-data schema (profile/summary fields + customer_visits)"
```

- [ ] **Step 5 (PROD GATE — Anthony):** apply the migration with a `$executeRawUnsafe` script (the pattern from `scripts/apply-dob-gender.ts`) run via `npx tsx --env-file=.env scripts/apply-customer-deep.ts`. `prisma db push`/`db execute` HANG on the pooler — use the raw script.

---

### Task 2: synqed-core — validation, service mapping, visit upsert, API types

**Files:** Modify `src/types/api.ts`, `src/validations/customer.ts`, `src/services/customer.service.ts`, `src/routes/customers.ts`

- [ ] **Step 1: Add types in `src/types/api.ts`** — extend `Customer` and `CreateCustomerInput`/`UpdateCustomerInput` with the snake_case fields (`occupation`, `member_number`, `postal_code`, `prefecture`, `address`, `phone2`, `dm_opt_in`, `comment`, `remarks2`, `total_sales`, `installment_outstanding`, `has_ticket_pack`, `first_visit_at`, `last_visit_at`). Add:
```ts
export interface CustomerVisit {
  id: string
  customer_id: string
  qr_reservation_id: number
  used_at: string
  status: string
  course_name: string | null
  sales_amount: number
  staff_name: string | null
  treatment_comment: string | null
}
export interface UpsertVisitInput {
  qr_reservation_id: number
  used_at: string
  status: string
  course_name?: string | null
  sales_amount?: number
  staff_name?: string | null
  treatment_comment?: string | null
}
```

- [ ] **Step 2: Add zod in `src/validations/customer.ts`** — add the new optional fields to create/update (e.g. `occupation: z.string().max(255).nullish()`, `total_sales: z.number().int().min(0).optional()`, `first_visit_at: z.string().datetime().nullish()`, etc.), plus:
```ts
export const upsertVisitsSchema = z.object({
  visits: z.array(z.object({
    qr_reservation_id: z.number().int(),
    used_at: z.string().datetime(),
    status: z.string().max(20),
    course_name: z.string().max(255).nullish(),
    sales_amount: z.number().int().default(0),
    staff_name: z.string().max(100).nullish(),
    treatment_comment: z.string().max(5000).nullish(),
  })).max(500),
})
```

- [ ] **Step 3: Map new fields in `customer.service.ts`** — extend `toCustomer` (e.g. `occupation: row.occupation`, `total_sales: row.totalSales`, `first_visit_at: row.firstVisitAt?.toISOString() ?? null`), and the create/update field maps (mirror the existing `is_existing_customer` pattern). Add `upsertVisits`:
```ts
export async function upsertVisits(businessId: string, customerId: string, visits: UpsertVisitInput[]) {
  await Promise.all(visits.map((v) =>
    prisma.customerVisit.upsert({
      where: { businessId_qrReservationId: { businessId, qrReservationId: v.qr_reservation_id } },
      create: { businessId, customerId, qrReservationId: v.qr_reservation_id, usedAt: new Date(v.used_at),
        status: v.status, courseName: v.course_name ?? null, salesAmount: v.sales_amount ?? 0,
        staffName: v.staff_name ?? null, treatmentComment: v.treatment_comment ?? null },
      update: { usedAt: new Date(v.used_at), status: v.status, courseName: v.course_name ?? null,
        salesAmount: v.sales_amount ?? 0, staffName: v.staff_name ?? null, treatmentComment: v.treatment_comment ?? null },
    })))
  return { upserted: visits.length }
}
```

- [ ] **Step 4: Add route in `src/routes/customers.ts`** (place before `/:id/photos`):
```ts
customerRoutes.put('/:id/visits', async (c) => {
  const businessId = c.get('businessId')
  const id = c.req.param('id')
  const parsed = upsertVisitsSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
  const result = await customerService.upsertVisits(businessId, id, parsed.data.visits)
  return c.json(result)
})
```

- [ ] **Step 5: Test** — add to `tests/customers.test.ts` a case that PUTs `/customers/:id/visits` with two visits and asserts idempotency (re-PUT same `qr_reservation_id` → still one row). Run: `cd ~/synqed-core && npx vitest run customers`. Expected: PASS (requires the migration from Task 1 Step 5 applied; re-run if pooler-flaky).

- [ ] **Step 6: Commit**
```bash
git add src/types/api.ts src/validations/customer.ts src/services/customer.service.ts src/routes/customers.ts tests/customers.test.ts
git commit -m "feat(customer): deep-data field mapping + visits upsert endpoint"
```

---

### Task 3: synqed-core — SDK (`@synqed-kk/client`)

**Files:** Modify `packages/client/src/types.ts`, `packages/client/src/customers.ts`, `packages/client/package.json`

- [ ] **Step 1: Mirror types** in `packages/client/src/types.ts` — same `Customer`/input extensions + `CustomerVisit`/`UpsertVisitInput` as Task 2 Step 1.

- [ ] **Step 2: Add SDK method** in `packages/client/src/customers.ts`:
```ts
async upsertVisits(id: string, visits: UpsertVisitInput[]): Promise<{ upserted: number }> {
  return this.request(`/v1/customers/${id}/visits`, { method: 'PUT', body: JSON.stringify({ visits }) })
}
```
(match the existing `request`/method style in that file)

- [ ] **Step 3: Bump version** `packages/client/package.json` `0.11.0` → `0.12.0`.

- [ ] **Step 4: Build** — Run: `cd ~/synqed-core/packages/client && npm run build`. Expected: tsc succeeds, `dist/` updated.

- [ ] **Step 5: Commit**
```bash
git add packages/client/src/types.ts packages/client/src/customers.ts packages/client/package.json
git commit -m "feat(client): customer deep-data fields + upsertVisits (0.12.0)"
```

- [ ] **Step 6 (PROD GATES — Anthony):** merge `feat/customer-deep-crawl` → main (Vercel deploy) and `cd packages/client && npm publish`.

---

### Task 4: karute — QR client fetchers + mappers

**Files:** Modify `src/lib/quickreserve.ts`; Create `src/__tests__/integration/qr-deep-map.test.ts`

- [ ] **Step 1: Write the failing mapper test** — `qr-deep-map.test.ts`. Feed one reservation object (shape from this plan's field map) into `mapVisit` + `mapDeepCustomer` and assert:
```ts
import { mapVisit, mapDeepCustomer } from '@/lib/quickreserve'
const r = { id: 137402, start_at: 1752390000000, deleted: false, nominated_staff_id: 667,
  Bill: { BillItems: [{ item_name: '6回券', price_consumed: 10450 }] },
  Customer: { gender: 2, born_at: null, profession: '', postpaid_remaining_cache: 0, has_ticket_pack: false },
  Staff: { name: '篠原 夢果' }, TreatmentCourse: { name: '6回券' } } as any
test('mapVisit sums BillItems and marks settled', () => {
  const v = mapVisit(r)
  expect(v.qr_reservation_id).toBe(137402)
  expect(v.sales_amount).toBe(10450)
  expect(v.status).toBe('settled')
  expect(v.course_name).toBe('6回券')
})
test('mapDeepCustomer maps gender int + nulls', () => {
  const d = mapDeepCustomer(r.Customer)
  expect(d.gender).toBe('female')        // 2 → female
  expect(d.date_of_birth).toBeNull()      // born_at null
  expect(d.has_ticket_pack).toBe(false)
})
```
Run: `cd ~/karute && npx jest qr-deep-map`. Expected: FAIL (mappers undefined).

- [ ] **Step 2: Implement mappers + fetchers** in `src/lib/quickreserve.ts`:
```ts
const GENDER: Record<number, 'male' | 'female' | null> = { 0: null, 1: 'male', 2: 'female' }

export function mapVisit(r: any) {
  const items = r.Bill?.BillItems ?? []
  return {
    qr_reservation_id: r.id,
    used_at: new Date(r.start_at).toISOString(),
    status: r.deleted ? 'cancelled' : r.Bill ? 'settled' : 'booked',
    course_name: r.TreatmentCourse?.name ?? null,
    sales_amount: items.reduce((s: number, i: any) => s + (i.price_consumed ?? 0), 0),
    staff_name: r.Staff?.name ?? null,
    treatment_comment: r.request || null,
  }
}
export function mapDeepCustomer(c: any) {
  return {
    gender: GENDER[c.gender] ?? null,
    date_of_birth: c.born_at ? new Date(c.born_at).toISOString().slice(0, 10) : null,
    occupation: c.profession || null,
    member_number: c.membership_id || null,
    postal_code: c.post_code || null,
    prefecture: c.prefecture || null,
    address: c.address1 || null,
    phone2: c.phone2 || null,
    dm_opt_in: !!c.direct_mail,
    comment: c.comment || null,
    remarks2: c.remarks2 || null,
    installment_outstanding: c.postpaid_remaining_cache ?? 0,
    has_ticket_pack: !!c.has_ticket_pack,
    last_visit_at: c.last_visit_at_cache ? new Date(c.last_visit_at_cache).toISOString() : null,
    visit_count: c.visits_number_cache ?? 0,
    is_existing_customer: !!c.is_existing_customer,
  }
}
export async function qrGetCustomerReservationsByCustomerId(session: QRSession, storeSlug: string, storeId: number, customerId: number) {
  const res = await fetch(`${QR_API_BASE}/${storeSlug}/${storeId}/get-customer-reservations-by-customer-id`,
    { method: 'POST', headers: qrHeaders(session), body: JSON.stringify({ customer_id: customerId }) })
  if (!res.ok) throw new Error(`QR reservations-by-customer ${customerId}: ${res.status}`)
  return (await res.json()) as any[]
}
export async function qrGetCustomersServerSide(session: QRSession, storeSlug: string, storeId: number, page: number, pageSize = 100) {
  const res = await fetch(`${QR_API_BASE}/${storeSlug}/${storeId}/get-customers-server-side`,
    { method: 'POST', headers: qrHeaders(session), body: JSON.stringify({ page, page_size: pageSize }) })
  if (!res.ok) throw new Error(`QR customers-server-side p${page}: ${res.status}`)
  return await res.json()
}
```
> NOTE: confirm `get-customers-server-side` request params + total-count field on first run (Task 5) — capture once and pin the pagination shape. `total_sales` is the sum of settled-visit `sales_amount`; compute it during the crawl.

- [ ] **Step 3: Run test** — `cd ~/karute && npx jest qr-deep-map`. Expected: PASS.

- [ ] **Step 4: Verify** — `npm run type-check && npx eslint src/lib/quickreserve.ts`. Expected: clean.

- [ ] **Step 5: Commit**
```bash
git add src/lib/quickreserve.ts src/__tests__/integration/qr-deep-map.test.ts
git commit -m "feat(qr): deep-customer fetchers + visit/profile mappers"
```

---

### Task 5: karute — deep-crawl job

**Files:** Create `src/app/api/sync/quickreserve-deep/route.ts`

- [ ] **Step 1: Implement the crawl** (mirror `src/app/api/sync/quickreserve/route.ts` for creds/SynqedClient setup). For each customer page from `qrGetCustomersServerSide`, resolve/create the synqed customer (match on `external_refs.quickreserve.customerId`), fetch `qrGetCustomerReservationsByCustomerId`, then:
  - `const visits = reservations.map(mapVisit)`
  - `const totalSales = visits.filter(v => v.status==='settled').reduce((s,v)=>s+v.sales_amount,0)`
  - `await synqed.customers.update(id, { ...mapDeepCustomer(reservations[0].Customer), total_sales: totalSales, first_visit_at: <min used_at> })`
  - `await synqed.customers.upsertVisits(id, visits)`
  - Guard `CRON_SECRET` like the existing route; cap concurrency; `console.log` page progress + any skipped customers.
- [ ] **Step 2: Resumability + caps** — paginate until a short page; log `{page, customers, visits}` per page; on a per-customer error, log + continue (don't abort the run).
- [ ] **Step 3: Verify build** — `cd ~/karute && npm run type-check && npm run build`. Expected: clean. (Requires SDK `0.12.0` installed — see Task 6.)
- [ ] **Step 4: Commit**
```bash
git add src/app/api/sync/quickreserve-deep/route.ts
git commit -m "feat(qr): deep customer crawl job (profile + visits → synqed-core)"
```

---

### Task 6: karute — consume SDK 0.12.0 + PR

- [ ] **Step 1 (after Task 3 Step 6 publish):** bump `@synqed-kk/client` to `^0.12.0` in `package.json`; `npm install`.
- [ ] **Step 2:** `npm run type-check && npm run lint && npx jest qr-deep-map`. Expected: clean/PASS.
- [ ] **Step 3:** branch off `incremental-merge`, commit, push, open PR into `incremental-merge`.
- [ ] **Step 4 (manual, read-only):** trigger the deep-crawl once against a small page; confirm a Karute customer shows visit history + totals. Then schedule as a cron separate from the daily reservation sync.

---

## Open questions (resolve before/early in execution)
1. **Ticket/course balances (回数券残):** `has_ticket_pack` is a bool only; actual remaining counts aren't in this endpoint — find the dedicated endpoint (likely `get-treatment-courses` or a tickets endpoint) before promising balance display. Phase 2c.
2. **`get-customers-server-side` exact request/response shape** (page param name, total count) — pin on first run (Task 5 Step 1).
3. **Crawl volume/cadence** — La Estro's list is large; decide full vs incremental (changed-since) and cron frequency.
4. **PII/retention (APPI):** sales history + addresses are sensitive — confirm storage/retention is acceptable; audio is already never stored.
5. **`treatment_comment` source:** used `reservation.request`; confirm whether施術コメント lives there or in `get-medical-records-by-customer-id` (the カルテ endpoint) — if the latter, fold it into Phase 2c.

## Coverage vs spec
Profile fields ✅ (Task 1-4), summary/financials ✅ (total_sales/outstanding/visits/first+last visit), visit+treatment history ✅ (`customer_visits`), payments ✅ (folded into visit sales; standalone installment history = 2c), tickets ⚠️ (open Q1), medical records / mail / LINE / UTM = Phase 2c (not in this plan).
