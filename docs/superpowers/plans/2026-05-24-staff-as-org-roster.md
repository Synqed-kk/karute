# Staff as Org Roster + Booking-Time Attribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the synqed-core staff roster the single source of truth for staff (so staff added in Settings appear everywhere), and attribute recorded karute to the staff of the booking happening at record time.

**Architecture:** `profiles` (Supabase auth) = the org login only. synqed-core `staff` = the roster (no auth). The app keys staff off `synqed staff.id`, removing the old profile↔synqed id translation. Karute attribution comes from the live booking (or a picker), validated server-side against the org roster.

**Tech Stack:** Next.js 16 (App Router, server actions), TypeScript, `@synqed-kk/client`, Supabase (auth only), Jest (integration tests, node env, `npm test`).

**Spec:** `docs/superpowers/specs/2026-05-24-staff-as-org-roster-design.md`

**Phasing:**
- **Phase 1** — Roster is the source of truth. *Fixes the reported "added staff invisible" bug on its own.*
- **Phase 2** — Save contract: attribution by explicit `staffId`, validated against the roster.
- **Phase 3** — Record page reads synqed-core + booking-time attribution UI.
- **Phase 4** — Clean up `getCurrentUserStaffId` consumers (sidebar/session, settings, calendar default).

**Key types (from `@synqed-kk/client`):**
```typescript
// Staff
interface Staff { id: string; business_id: string; user_id: string | null; name: string;
  name_kana: string | null; email: string | null; role: 'OWNER'|'ADMIN'|'STYLIST'|'ASSISTANT';
  is_active: boolean; avatar_url: string | null; created_at: string; updated_at: string }
// staff.list(opts?) => { staff: Staff[]; total; page; page_size }
// Appointment
interface Appointment { id; business_id; customer_id; staff_id; starts_at; ends_at;
  duration_minutes: number | null; title: string | null; notes: string | null;
  status: 'SCHEDULED'|'IN_PROGRESS'|'COMPLETED'|'CANCELLED'; source; created_at; updated_at }
```

**Pre-flight (do once before Phase 1):**
- [ ] Create a branch: `git checkout -b staff-org-roster`
- [ ] Confirm baseline is green: `npm test` → note current pass count (was "13 suites / 77 tests").
- [ ] Confirm synqed-core is running on `:3100` (`curl -s -o /dev/null -w "%{http_code}" localhost:3100/` → non-000) for manual verification later.

---

## Phase 1 — Roster is the source of truth

### Task 1.1: `getStaffList()` reads the synqed-core roster

**Files:**
- Modify: `src/lib/staff.ts` (replace the `staffListByBusiness` body + `getStaffById`; remove `getCurrentUserStaffId`)
- Test: `src/__tests__/integration/current-user-staff.test.ts` (replaced — see Task 1.2)

The roster now comes from synqed-core, scoped to the org's `businessId`. `StaffMember.id` becomes the **synqed staff id**. `has_pin` is dropped to `false` (PINs lived on `profiles`; the PIN UI was already removed).

- [ ] **Step 1: Rewrite the staff-list source in `src/lib/staff.ts`**

Replace the `staffListByBusiness` `unstable_cache` block (currently lines ~27-64, the Supabase `profiles` query) with a synqed-core read:

```typescript
import { SynqedClient } from '@synqed-kk/client'

// Roster lives in synqed-core (children of the business). Cached per business,
// invalidated by the 'staff-list' tag that staff mutations already bump.
const staffListByBusiness = unstable_cache(
  async (businessId: string): Promise<StaffMember[]> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) {
      console.error('[getStaffList] Missing SYNQED_CORE_URL/API_KEY')
      return []
    }
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    const { staff } = await client.staff.list({ page_size: 200 })
    return staff
      .filter((s) => s.is_active)
      .map((s) => ({
        id: s.id,
        full_name: s.name,
        display_role: s.role ? s.role.toLowerCase() : null,
        position: null,
        email: s.email,
        phone: null,
        avatar_url: s.avatar_url,
        has_pin: false,
        created_at: s.created_at,
      }))
  },
  ['staff-list-v2'],
  { revalidate: 86400, tags: ['staff-list'] },
)
```

- [ ] **Step 2: Repoint `getStaffById` to synqed-core**

Replace `getStaffById` (currently the Supabase `profiles` lookup, ~lines 93-103) with:

```typescript
export async function getStaffById(id: string): Promise<StaffMemberBasic | null> {
  const list = await getStaffList()
  const found = list.find((s) => s.id === id)
  return found ? { id: found.id, full_name: found.full_name } : null
}
```

- [ ] **Step 3: Remove `getCurrentUserStaffId`**

Delete the `getCurrentUserStaffId` export (currently lines ~117-122). Consumers are migrated in Phase 4; to keep the tree compiling until then, leave a temporary shim that returns the first roster member or null:

```typescript
// TEMPORARY (removed in Phase 4): there is no per-user "active staff" once
// staff are decoupled from auth. Consumers default to the first roster member.
export const getCurrentUserStaffId = cache(async (): Promise<string | null> => {
  const list = await getStaffList()
  return list[0]?.id ?? null
})
```

Keep `resolveUserId` and `getBusinessId` unchanged — they resolve the **org** identity and are still needed (the SynqedClient is scoped by `businessId`). Remove the now-unused imports (`createClient` if no longer referenced, `verifySupabaseJwt`/`LocalJwtError` stay — used by `resolveUserId`).

- [ ] **Step 4: Run type-check**

Run: `npm run type-check`
Expected: PASS (no references to removed symbols). If `createClient` import is now unused, remove it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/staff.ts
git commit -m "feat(staff): source staff roster from synqed-core, not Supabase profiles"
```

---

### Task 1.2: Rewrite the staff-list integration test

**Files:**
- Replace: `src/__tests__/integration/current-user-staff.test.ts` → rename to `staff-list-source.test.ts`

The old test pinned `getCurrentUserStaffId` against Supabase profiles. The new contract: `getStaffList()` reads the synqed roster, filters inactive, maps `name→full_name` / `role→display_role`.

- [ ] **Step 1: Write the failing test**

```bash
git mv src/__tests__/integration/current-user-staff.test.ts src/__tests__/integration/staff-list-source.test.ts
```

Replace the file contents with:

```typescript
/**
 * getStaffList sources the roster from synqed-core (not Supabase profiles).
 * Verifies the Staff → StaffMember mapping, the is_active filter, and that
 * the synqed client is scoped to the org's businessId.
 */
jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn }
})
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

delete process.env.SUPABASE_JWT_SECRET
process.env.SYNQED_CORE_URL = 'http://test.invalid'
process.env.SYNQED_CORE_API_KEY = 'test-key'

const scenario: { businessId: string; synqedStaff: unknown[] } = {
  businessId: 'biz-1',
  synqedStaff: [],
}

// getBusinessId reads profiles.customer_id via the service client.
const serviceFromMock = jest.fn(() => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: { customer_id: scenario.businessId }, error: null }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({ from: serviceFromMock })),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'org-user' } }, error: null })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
  })),
}))

const staffList = jest.fn()
const SynqedClientMock = jest.fn().mockImplementation(() => ({ staff: { list: staffList } }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: SynqedClientMock }))

import { getStaffList } from '@/lib/staff'

beforeEach(() => {
  jest.clearAllMocks()
  staffList.mockImplementation(async () => ({ staff: scenario.synqedStaff, total: 0, page: 1, page_size: 200 }))
})

describe('getStaffList — synqed-core roster', () => {
  it('maps synqed Staff to StaffMember and scopes the client to businessId', async () => {
    scenario.synqedStaff = [
      { id: 's-1', business_id: 'biz-1', user_id: null, name: '四宮朱美', name_kana: null,
        email: 'a@x.test', role: 'STYLIST', is_active: true, avatar_url: 'http://img/1',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ]
    const list = await getStaffList()
    expect(list).toEqual([
      { id: 's-1', full_name: '四宮朱美', display_role: 'stylist', position: null,
        email: 'a@x.test', phone: null, avatar_url: 'http://img/1', has_pin: false,
        created_at: '2026-01-01T00:00:00Z' },
    ])
    expect(SynqedClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz-1' }),
    )
  })

  it('excludes inactive staff', async () => {
    scenario.synqedStaff = [
      { id: 's-1', business_id: 'biz-1', user_id: null, name: 'Active', name_kana: null,
        email: null, role: 'STYLIST', is_active: true, avatar_url: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      { id: 's-2', business_id: 'biz-1', user_id: null, name: 'Gone', name_kana: null,
        email: null, role: 'STYLIST', is_active: false, avatar_url: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ]
    const list = await getStaffList()
    expect(list.map((s) => s.id)).toEqual(['s-1'])
  })

  it('returns [] when synqed env is missing', async () => {
    const url = process.env.SYNQED_CORE_URL
    delete process.env.SYNQED_CORE_URL
    expect(await getStaffList()).toEqual([])
    process.env.SYNQED_CORE_URL = url
  })
})
```

- [ ] **Step 2: Run it to verify it fails (before Task 1.1 lands) / passes (after)**

Run: `npm test -- staff-list-source`
Expected: PASS once Task 1.1 is implemented (the mapping + filter + scoping match).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/integration/staff-list-source.test.ts
git commit -m "test(staff): pin getStaffList to the synqed-core roster contract"
```

---

### Task 1.3: Remove the profile↔synqed staff-id translation

**Files:**
- Modify: `src/actions/appointments.ts` (drop `resolveSynqedStaffId`, pass staff id through, drop the `profileByStaffId` remap)
- Delete: `src/lib/synqed/staff-map.ts`
- Modify: `src/lib/appointments.ts` (rename `AppointmentInput.staffProfileId` → `staffId` — see note)
- Test: `src/__tests__/integration/booking-auth-flow.test.ts` (replaced — Task 1.4)

Because the app now keys staff off `synqed staff.id` (which is exactly what synqed-core's `appointments.staff_id` stores), no translation is needed.

- [ ] **Step 1: Rename the input field in `src/lib/appointments.ts`**

Change `AppointmentInput.staffProfileId: string` → `staffId: string`. Update `validateAppointmentTime` only if it reads that field (it does not — leave its body).

- [ ] **Step 2: Simplify `createAppointment` in `src/actions/appointments.ts`**

Remove the `import { resolveSynqedStaffId } from '@/lib/synqed/staff-map'` line. Replace the staff resolution in `createAppointment` (lines ~51-54):

```typescript
    const synqed = await getSynqedClient()
    const appt = await synqed.appointments.create({
      customer_id: input.clientId,
      staff_id: input.staffId,
      starts_at: startTime.toISOString(),
      ends_at: endTime.toISOString(),
      duration_minutes: input.durationMinutes,
      title: input.title ?? null,
      notes: input.notes ?? null,
    })
```

- [ ] **Step 3: Simplify `updateAppointment`**

Replace the staff branch (lines ~177-179):

```typescript
    if (updates.staffId) {
      patch.staff_id = updates.staffId
    }
```

And change the `updates` parameter type `staffProfileId?: string` → `staffId?: string` (line ~166).

- [ ] **Step 4: Drop the `profileByStaffId` remap in `getAppointmentsByDate`**

Remove `synqed.staff.list({ page_size: 200 })` from the `Promise.all` (line ~100) and the `profileByStaffId` map (lines ~107-114). In the returned object (line ~118), set staff straight through:

```typescript
      staff_profile_id: a.staff_id,
```

(The `AppointmentRow.staff_profile_id` field name is kept to avoid churn in calendar adapters; it now holds the synqed staff id. Add a one-line comment to that effect above the field in the interface.)

- [ ] **Step 5: Delete the translation module**

```bash
git rm src/lib/synqed/staff-map.ts
```

- [ ] **Step 6: Update callers that pass `staffProfileId`**

Run: `grep -rn "staffProfileId" src --include=*.ts --include=*.tsx | grep -v __tests__`
For each (e.g. the booking dialog/form that calls `createAppointment`/`updateAppointment`), rename the property to `staffId`. The value is already a `staff_profile_id` sourced from `getStaffList()` — which, post-Task-1.1, is the synqed staff id, so values are correct without change.

- [ ] **Step 7: Type-check**

Run: `npm run type-check`
Expected: PASS. Fix any remaining `staffProfileId` references it flags.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(staff): drop profile<->synqed id translation; pass synqed staff id through"
```

---

### Task 1.4: Rewrite the booking attribution test

**Files:**
- Replace: `src/__tests__/integration/booking-auth-flow.test.ts` → `booking-staff-passthrough.test.ts`

New contract: `createAppointment` forwards `input.staffId` straight to `synqed.appointments.create` — no translation, no cookie.

- [ ] **Step 1: Write the test**

```bash
git mv src/__tests__/integration/booking-auth-flow.test.ts src/__tests__/integration/booking-staff-passthrough.test.ts
```

Replace contents with:

```typescript
/**
 * createAppointment forwards the supplied staffId straight to synqed-core.
 * No profile->synqed translation, no cookie reads.
 */
jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn }
})
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
const cookieGetSpy = jest.fn()
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: cookieGetSpy, getAll: jest.fn(() => []), set: jest.fn() })),
}))

delete process.env.SUPABASE_JWT_SECRET
process.env.SYNQED_CORE_URL = 'http://test.invalid'
process.env.SYNQED_CORE_API_KEY = 'test-key'

jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({
    operating_hours: {
      mon: { openMinute: 0, closeMinute: 1440 }, tue: { openMinute: 0, closeMinute: 1440 },
      wed: { openMinute: 0, closeMinute: 1440 }, thu: { openMinute: 0, closeMinute: 1440 },
      fri: { openMinute: 0, closeMinute: 1440 }, sat: { openMinute: 0, closeMinute: 1440 },
      sun: { openMinute: 0, closeMinute: 1440 },
    },
  })),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { customer_id: 'biz-1' }, error: null }),
    })),
  })),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'org-user' } }, error: null })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
  })),
}))

const appointments = { create: jest.fn() }
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({ appointments })),
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) { super(message); this.name = 'SynqedError'; this.status = status }
  },
}))

import { createAppointment } from '@/actions/appointments'

beforeEach(() => { jest.clearAllMocks() })

describe('createAppointment — staff id passthrough', () => {
  it('forwards staffId straight to synqed.appointments.create', async () => {
    appointments.create.mockResolvedValue({ id: 'appt-1' })
    const result = await createAppointment({
      staffId: 'synqed-staff-a',
      clientId: 'cust-1',
      startTime: '2026-06-01T03:00:00.000Z',
      durationMinutes: 60,
      title: 'Cut + color',
    })
    expect(result).toEqual({ id: 'appt-1' })
    expect(appointments.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 'cust-1', staff_id: 'synqed-staff-a', duration_minutes: 60 }),
    )
  })

  it('never reads a cookie during the booking path', async () => {
    appointments.create.mockResolvedValue({ id: 'appt-2' })
    await createAppointment({
      staffId: 'synqed-staff-a', clientId: 'cust-1',
      startTime: '2026-06-01T03:00:00.000Z', durationMinutes: 60,
    })
    expect(cookieGetSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run**

Run: `npm test -- booking-staff-passthrough`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/integration/booking-staff-passthrough.test.ts
git commit -m "test(booking): pin staff-id passthrough contract"
```

**✅ Phase 1 checkpoint:** Run `npm test` (all suites). Then manually: log in as `dev@karute.test`, add a staff member in Settings → it should now appear in the Settings staff list and as a column on the Appointments calendar. *This is the reported bug fixed.*

---

## Phase 2 — Save contract: attribution by explicit staffId

### Task 2.1: Add `staffId` to the save input and validate it against the roster

**Files:**
- Modify: `src/types/karute.ts` (`SaveKaruteInput`)
- Modify: `src/actions/karute.ts` (`saveKaruteRecord`, `saveKaruteRecordInline`)
- Test: `src/__tests__/integration/save-flow-staff-attribution.test.ts` (replaced — Task 2.2)

- [ ] **Step 1: Update `SaveKaruteInput` in `src/types/karute.ts`**

Replace the type (and its stale comment) with:

```typescript
/**
 * Input shape for saveKaruteRecord. staffId is the synqed-core staff id the
 * karute is attributed to (from the live booking or a picker). The server
 * validates it belongs to the signed-in org's roster before saving.
 */
export type SaveKaruteInput = {
  customerId: string
  staffId: string
  transcript: string
  summary: string
  entries: Array<{
    category: EntryCategory
    content: string
    sourceQuote?: string
    confidenceScore: number
  }>
  duration?: number
  appointmentId?: string
}
```

- [ ] **Step 2: Rewrite attribution in `src/actions/karute.ts`**

Replace the `import { getCurrentUserStaffId }` line with `import { getStaffList } from '@/lib/staff'`. Replace the staff-resolution block in `saveKaruteRecord` (lines ~25-34) with roster validation:

```typescript
    // staffId comes from the UI (live booking or picker). Validate it belongs
    // to this org's roster — never trust a raw client id against the FK.
    const roster = await getStaffList()
    if (!roster.some((s) => s.id === input.staffId)) {
      return { error: 'Selected staff is not part of your salon.' }
    }
    const staffId = input.staffId
```

The `synqed.karuteRecords.create({ ... staff_id: staffId ... })` call stays the same. Apply the **same** change to `saveKaruteRecordInline` (replace its `getCurrentUserStaffId` block, lines ~72-75, with the identical roster-validation block).

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS for `karute.ts` itself. `ReviewScreen.tsx` will now error because it doesn't pass `staffId` yet — that's fixed in Task 3.3. To keep the build green between commits, temporarily pass `staffId: ''`? **No** — instead implement Task 3.3 in the same branch before the Phase-2 checkpoint. Proceed; the unit test (Task 2.2) drives this task directly.

- [ ] **Step 4: Commit**

```bash
git add src/types/karute.ts src/actions/karute.ts
git commit -m "feat(karute): attribute save to explicit staffId, validated against org roster"
```

---

### Task 2.2: Rewrite the save-attribution test

**Files:**
- Replace: `src/__tests__/integration/save-flow-staff-attribution.test.ts`

New contract: save forwards `input.staffId` as `staff_id`; rejects a `staffId` not in the roster without calling synqed create.

- [ ] **Step 1: Write the test** (replace file contents)

```typescript
/**
 * saveKaruteRecord attributes to the supplied staffId and validates it against
 * the org roster (getStaffList). A staffId outside the roster is rejected and
 * never reaches synqed-core.
 */
jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn }
})
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))

process.env.SYNQED_CORE_URL = 'http://test.invalid'
process.env.SYNQED_CORE_API_KEY = 'test-key'

const rosterIds: string[] = []
jest.mock('@/lib/staff', () => ({
  getStaffList: jest.fn(async () => rosterIds.map((id) => ({ id, full_name: id, has_pin: false, created_at: '' }))),
  getBusinessId: jest.fn(async () => 'biz-1'),
}))

const karuteRecords = { create: jest.fn() }
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords })),
}))

import { saveKaruteRecord } from '@/actions/karute'

const baseInput = {
  customerId: 'cust-1', transcript: 't', summary: 's', entries: [] as [],
}

beforeEach(() => {
  jest.clearAllMocks()
  rosterIds.length = 0
})

describe('saveKaruteRecord — roster-validated attribution', () => {
  it('forwards a roster staffId as staff_id', async () => {
    rosterIds.push('staff-a')
    karuteRecords.create.mockResolvedValue({ id: 'kr-1' })
    await saveKaruteRecord({ ...baseInput, staffId: 'staff-a' })
    expect(karuteRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 'cust-1', staff_id: 'staff-a' }),
    )
  })

  it('rejects a staffId not in the roster and never calls synqed', async () => {
    rosterIds.push('staff-a')
    const result = await saveKaruteRecord({ ...baseInput, staffId: 'intruder' })
    expect(result).toEqual({ error: expect.stringMatching(/not part of your salon/i) })
    expect(karuteRecords.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run**

Run: `npm test -- save-flow-staff-attribution`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/integration/save-flow-staff-attribution.test.ts
git commit -m "test(karute): pin roster-validated save attribution"
```

---

## Phase 3 — Record page on synqed-core + booking-time attribution

> These tasks change UI/runtime behavior best confirmed in the running app (`npm run dev`, synqed-core up). Each task lists a manual verification.

### Task 3.1: Compute current-booking attribution on the record page

**Files:**
- Modify: `src/app/[locale]/(app)/sessions/page.tsx`

Replace the legacy Supabase `appointments`/`karute_records` reads with synqed-core, and compute the booking(s) active at `now` (JST).

- [ ] **Step 1: Replace the data fetch + attribution logic**

Swap the Supabase appointment query for `getAppointmentsByDate` (synqed) and recents for `synqed.karuteRecords.list`. Build the candidate set of **active** bookings (start ≤ now ≤ start+duration, status ≠ CANCELLED/COMPLETED):

```typescript
import { getStaffList } from '@/lib/staff'
import { getAppointmentsByDate } from '@/actions/appointments'
import { ymdInJst, jstStartOfToday } from '@/lib/date/jst'
// ...
const now = new Date()
const today = ymdInJst(jstStartOfToday())
const [customers, staffList, todays] = await Promise.all([
  getCachedCustomerList(),
  getStaffList(),
  getAppointmentsByDate(today),
])

const nameById = new Map(staffList.map((s) => [s.id, s.full_name ?? '—']))
const active = todays.filter((a) => {
  const start = new Date(a.start_time).getTime()
  const end = start + a.duration_minutes * 60_000
  const t = now.getTime()
  return t >= start && t <= end && a.synqed_status !== 'CANCELLED' && !a.karute_record_id
})
```

Map the **single** active booking → `nextAppointment` (now also carrying `staffId` and `staffName`); map `todays` → `nearbyBookings` with real staff names from `nameById`; pass the full `active` list + `staffList` to the view for the multi-booking picker and the no-booking pickers. (Recents: `synqed.karuteRecords.list({ page_size: 5 })` mapped to `RecentRecording[]` — customer names via `getCachedCustomerList`.)

- [ ] **Step 2: Extend `RecordPageNextAppointment` to carry staff**

In `RecordPageView.tsx`, add to the `RecordPageNextAppointment` interface:

```typescript
  staffId: string
  staffName: string
```

Populate `targetAppointment.staffName` from `nextAppointment.staffName` (replace the hardcoded `staffName: '—'` at line ~223).

- [ ] **Step 3: Manual verification**

Run app + synqed-core. Seed/ensure a booking exists for `dev@karute.test` whose time window includes "now" (or temporarily widen the active filter to the whole day to verify wiring). Load the record page → the target card shows that booking's customer **and** the real staff name.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/\(app\)/sessions/page.tsx src/components/karute/redesign/record/RecordPageView.tsx
git commit -m "feat(record): source bookings/attribution from synqed-core, match live booking"
```

---

### Task 3.2: Multi-booking + no-booking pickers on the record screen

**Files:**
- Modify: `src/components/karute/redesign/record/RecordPageView.tsx`
- New prop inputs: `activeBookings: ActiveBooking[]`, `staffRoster: { id: string; name: string }[]`

- [ ] **Step 1: Define the props + selection state**

Add an `ActiveBooking` type (`{ id; customerId; customerName; staffId; staffName }`), accept `activeBookings` and `staffRoster` props, and hold selection state:

```typescript
const [selectedBookingId, setSelectedBookingId] = useState<string | null>(
  activeBookings.length === 1 ? activeBookings[0].id : null,
)
const [manualCustomerId, setManualCustomerId] = useState<string | null>(null)
const [manualStaffId, setManualStaffId] = useState<string | null>(null)
const selectedBooking = activeBookings.find((b) => b.id === selectedBookingId) ?? null
```

- [ ] **Step 2: Resolve effective customer + staff for the pipeline**

Replace the `effectiveAppointmentId`/`effectiveCustomerId` block (lines ~192-193) so the pipeline receives a resolved `customerId` + `staffId`:

```typescript
const effectiveAppointmentId = selectedBooking?.id
const effectiveCustomerId = selectedBooking?.customerId ?? manualCustomerId ?? undefined
const effectiveStaffId = selectedBooking?.staffId ?? manualStaffId ?? undefined
```

Pass `appointmentCustomerId={effectiveCustomerId}`, `staffId={effectiveStaffId}` (new prop) into `PipelineContainer`.

- [ ] **Step 3: Render the pickers**

- When `activeBookings.length > 1` and none selected: render a simple list (reuse `RecordingTargetCard`'s `nearbyBookings`/`onSwitchBooking` which already exists) to pick the booking → `setSelectedBookingId`.
- When `activeBookings.length === 0`: render a `CustomerCombobox` (already imported elsewhere) bound to `manualCustomerId` and a roster `<select>` bound to `manualStaffId` (options from `staffRoster`).
- Gate the record button: disabled until either a booking is selected or (manualCustomerId && manualStaffId) is set.

- [ ] **Step 4: Manual verification**

- Two overlapping active bookings → picker appears; choosing one carries its customer+staff into review.
- No active booking → customer + staff pickers appear; both required before recording.

- [ ] **Step 5: Commit**

```bash
git add src/components/karute/redesign/record/RecordPageView.tsx src/app/[locale]/\(app\)/sessions/page.tsx
git commit -m "feat(record): booking picker for overlaps, manual customer+staff pickers for walk-ins"
```

---

### Task 3.3: Thread `staffId` through PipelineContainer → ReviewScreen → save

**Files:**
- Modify: `src/components/review/PipelineContainer.tsx`
- Modify: `src/components/review/ReviewScreen.tsx`

- [ ] **Step 1: Add `staffId` to PipelineContainer props and pass it down**

Add `staffId?: string` to `PipelineContainerProps`; forward `staffId={staffId}` to `<ReviewScreen>`.

- [ ] **Step 2: Add `staffId` to ReviewScreen and include it in the save call**

Add `staffId?: string` to `ReviewScreenProps`. In `handleSave`, require it and pass it:

```typescript
if (!appointmentCustomerId && !selectedCustomerId) { toast.error(t('selectCustomer')); return }
if (!staffId) { toast.error(t('selectStaff')); return }
// ...
const result = await saveKaruteRecord({
  customerId,
  staffId,
  transcript,
  summary: data.summary,
  entries: data.entries.map((e) => ({ /* unchanged */ })),
  duration,
  appointmentId,
})
```

Add a `selectStaff` key to `messages/en.json` and `messages/ja.json` under `review` (e.g. `"selectStaff": "Select a staff member"` / `"スタッフを選択してください"`).

- [ ] **Step 3: Type-check + manual save**

Run: `npm run type-check` → PASS (ReviewScreen now satisfies the new `SaveKaruteInput`).
Manual: record against a live booking → review → Save → redirects to the new karute; the saved record's `staff_id` matches the booking's staff (verify in the synqed-core data / karute detail page).

- [ ] **Step 4: Commit**

```bash
git add src/components/review/PipelineContainer.tsx src/components/review/ReviewScreen.tsx messages/en.json messages/ja.json
git commit -m "feat(review): thread staffId through save; require staff before saving"
```

**✅ Phase 3 checkpoint:** `npm test` green; full record→save flow works for live-booking, multi-booking, and walk-in cases.

---

## Phase 4 — Retire `getCurrentUserStaffId` consumers

The temporary shim from Task 1.3 returns the first roster member. Now make consumers org-aware and delete the shim.

### Task 4.1: Audit consumers

- [ ] **Step 1: List them**

Run: `grep -rn "getCurrentUserStaffId" src --include=*.ts --include=*.tsx | grep -v __tests__`
Expected hits: `src/lib/staff.ts` (the shim), `sessions/page.tsx` (already migrated in 3.1 — remove the call), `appointments/page.tsx`, `settings/page.tsx`, `dashboard/page.tsx`, `customers/page.tsx`, `layout.tsx`, and the sidebar session source.

### Task 4.2: Make pages org-aware

**Files:** `src/app/[locale]/(app)/appointments/page.tsx`, `settings/page.tsx`, `layout.tsx`, and any other hit.

- [ ] **Step 1: Appointments calendar default column**

In `appointments/page.tsx`, remove `getCurrentUserStaffId` from the `Promise.all` and replace `activeStaffId` usages with `staff[0]?.id ?? null` (it already falls back this way at line ~174). The `activeStaffId` prop becomes the first roster member.

- [ ] **Step 2: Settings owner highlight**

In `settings/page.tsx`, drop `getCurrentUserStaffId`. The org always manages its own roster, so set `isOwner={true}` and `activeStaffId={null}` (no personal highlight). Verify `SettingsShell`/`StaffList` render fine with `activeStaffId = null` (they already accept `string | null`).

- [ ] **Step 3: Sidebar / session source**

Find the session provider feeding `useSession()` (the `{ activeStaff, orgName }` shape consumed by `sidebar.tsx`). It currently derives `activeStaff` from `getCurrentUserStaffId` + `getStaffById`. Change it to populate `orgName` (from the org profile `full_name`) and set `activeStaff = null` (or the org). Update `SidebarProfileChip` to show `orgName` and drop the per-stylist role line, since the login is the org. (Exact file: trace the `useSession`/session-provider import in `sidebar.tsx`; likely `layout.tsx` passes session data.)

- [ ] **Step 4: Remaining hits**

For `dashboard/page.tsx` / `customers/page.tsx`, if `getCurrentUserStaffId` is only used for a default/highlight, replace with `getStaffList()` `[0]?.id ?? null` or remove if unused.

- [ ] **Step 5: Delete the shim**

Remove the temporary `getCurrentUserStaffId` export from `src/lib/staff.ts`.

- [ ] **Step 6: Type-check + full test**

Run: `npm run type-check && npm test`
Expected: PASS, no references to `getCurrentUserStaffId` remain.

- [ ] **Step 7: Manual smoke**

Load dashboard, customers, appointments, settings, record — none crash; sidebar shows the salon/org name.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(staff): retire getCurrentUserStaffId; pages/sidebar are org-aware"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- "Roster is source of truth" → Tasks 1.1, 1.2. ✓
- "Remove translation layer" → Tasks 1.3, 1.4 (success criterion 6). ✓
- "Booking-time attribution (one/multiple/none)" → Tasks 3.1, 3.2. ✓
- "Save takes explicit staffId, validated against org roster" → Tasks 2.1, 2.2 (success criterion 5). ✓
- "Record page sources from synqed-core (data-source correction)" → Task 3.1. ✓
- "Reverses auth.uid() staff; rewrite 3 suites" → Tasks 1.2, 1.4, 2.2; consumers retired in 4.2. ✓
- "Added staff visible in Settings + booking columns" (criteria 1) → Phase 1 checkpoint. ✓

**Placeholder scan:** One intentional investigation step remains — Task 4.2 Step 3 says "trace the `useSession`/session-provider import." This is a locate-then-edit step, not a code placeholder; the edit (show `orgName`, null `activeStaff`) is specified. Acceptable.

**Type consistency:** `AppointmentInput.staffId` (1.3) matches `createAppointment`/`updateAppointment` usage and the test (1.4). `SaveKaruteInput.staffId` (2.1) matches ReviewScreen (3.3) and the test (2.2). `StaffMember` mapping fields (1.1) match the existing interface in `src/lib/staff.ts`.

**Scope:** Single coherent feature, phased so Phase 1 ships the reported fix independently.
