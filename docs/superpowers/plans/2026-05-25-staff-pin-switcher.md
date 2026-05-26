# Staff PIN Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A top-bar, Netflix-style staff switcher that sets a PIN-gated, roster-validated "active staff" cookie, used as the default attribution for walk-ins and the Appointments "Mine" filter — replacing the temporary `getCurrentUserStaffId` shim.

**Architecture:** Active staff = an `active_staff_id` cookie, validated against the synqed-core roster on read and written only after `verifyStaffPin` succeeds. A new top bar renders a switcher chip → overlay grid → PIN pad (reusing the existing `PinPad`/`PinSetup`/`staff-pin.ts`). Lightweight identity only — no access control.

**Tech Stack:** Next.js 16 (App Router, server actions, `next/headers` cookies), TypeScript, next-intl, Jest (integration, node env).

**Spec:** `docs/superpowers/specs/2026-05-25-staff-pin-switcher-design.md`

**Existing building blocks (REUSE, don't recreate):**
- `src/components/staff/PinPad.tsx` — `{ title, onSubmit: (pin: string) => void, onCancel, error, loading }`.
- `src/components/staff/PinSetup.tsx` — set/confirm/remove PIN flow (uses `setStaffPin`/`removeStaffPin`).
- `src/actions/staff-pin.ts` — `setStaffPin`, `verifyStaffPin(staffId,pin) => { valid, noPin?, error? }`, `hasStaffPin(staffId) => boolean`.
- `src/providers/session-provider.tsx` — `useSession()` → `{ userId, staffList: StaffItem[], activeStaff, activeStaffId, locale, orgName }`; `StaffItem = { id, name, displayRole?, avatarUrl?, hasPin? }`.
- `src/lib/staff.ts` — `getStaffList()`, `getBusinessId()`, and the temporary `getCurrentUserStaffId` shim (to be removed in Task 5).
- Cookie pattern: `import { cookies } from 'next/headers'` (see `src/lib/supabase/server.ts`).

**Pre-flight:**
- [ ] Confirm on branch `staff-org-roster` (this rides on it) and `npm test` green.

---

## Task 1: `getActiveStaffId()` — validated active-staff cookie read

**Files:**
- Modify: `src/lib/staff.ts` (add `getActiveStaffId`; keep the shim for now)
- Test: `src/__tests__/integration/active-staff.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/integration/active-staff.test.ts
jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn }
})
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

const cookieStore: Record<string, string | undefined> = {}
const cookieDelete = jest.fn((name: string) => { delete cookieStore[name] })
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    get: (name: string) => (cookieStore[name] ? { name, value: cookieStore[name] } : undefined),
    set: jest.fn(),
    delete: cookieDelete,
  })),
}))

const rosterIds: string[] = []
jest.mock('@/lib/staff', () => {
  const actual = jest.requireActual('@/lib/staff')
  return {
    ...actual,
    getStaffList: jest.fn(async () => rosterIds.map((id) => ({ id, full_name: id, has_pin: false, created_at: '' }))),
  }
})

import { getActiveStaffId } from '@/lib/staff'

beforeEach(() => {
  jest.clearAllMocks()
  rosterIds.length = 0
  for (const k of Object.keys(cookieStore)) delete cookieStore[k]
})

describe('getActiveStaffId', () => {
  it('returns the cookie id when it is a current roster member', async () => {
    rosterIds.push('staff-a')
    cookieStore['active_staff_id'] = 'staff-a'
    expect(await getActiveStaffId()).toBe('staff-a')
  })

  it('returns null when no cookie is set', async () => {
    rosterIds.push('staff-a')
    expect(await getActiveStaffId()).toBeNull()
  })

  it('returns null and clears the cookie when the id is not in the roster (stale/foreign)', async () => {
    rosterIds.push('staff-a')
    cookieStore['active_staff_id'] = 'ghost'
    expect(await getActiveStaffId()).toBeNull()
    expect(cookieDelete).toHaveBeenCalledWith('active_staff_id')
  })

  it('returns null when the roster is empty (synqed-core down)', async () => {
    cookieStore['active_staff_id'] = 'staff-a'
    expect(await getActiveStaffId()).toBeNull()
  })
})
```

Note: the `jest.mock('@/lib/staff', ...)` partial-mock makes `getStaffList` a stub while keeping the REAL `getActiveStaffId` under test. The real `getActiveStaffId` must call the module's own `getStaffList` export in a way the mock intercepts — implement it to call `getStaffList()` (same-module call resolves to the mocked export under this jest pattern). If same-module mocking proves unreliable, split `getActiveStaffId` into its own file `src/lib/active-staff.ts` importing `getStaffList` from `./staff` — adjust the import in this test accordingly and proceed.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- active-staff`
Expected: FAIL (`getActiveStaffId` is not defined / not exported).

- [ ] **Step 3: Implement `getActiveStaffId` in `src/lib/staff.ts`**

Add near the shim (and add `import { cookies } from 'next/headers'` at top):

```typescript
export const ACTIVE_STAFF_COOKIE = 'active_staff_id'

/**
 * The PIN-selected "active staff" for this device, or null. Reads the
 * active_staff_id cookie and validates it against the org roster; a stale or
 * foreign id resolves to null (and the cookie is cleared). Safe because it is
 * roster-validated on read and only ever written after a PIN check — a stale
 * value degrades to "no active staff", never an FK violation.
 */
export const getActiveStaffId = cache(async (): Promise<string | null> => {
  const store = await cookies()
  const id = store.get(ACTIVE_STAFF_COOKIE)?.value
  if (!id) return null
  const roster = await getStaffList()
  if (roster.some((s) => s.id === id)) return id
  store.delete(ACTIVE_STAFF_COOKIE)
  return null
})
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- active-staff`
Expected: PASS (4 tests). Then `npm test` (full) → still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/staff.ts src/__tests__/integration/active-staff.test.ts
git commit -m "feat(staff): add roster-validated getActiveStaffId (active_staff_id cookie)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `setActiveStaff` / `clearActiveStaff` server actions (PIN-gated)

**Files:**
- Create: `src/actions/active-staff.ts`
- Test: `src/__tests__/integration/set-active-staff.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/integration/set-active-staff.test.ts
jest.mock('react', () => {
  const actual = jest.requireActual('react')
  return { ...actual, cache: (fn: (...a: unknown[]) => unknown) => fn }
})

const cookieSet = jest.fn()
const cookieDelete = jest.fn()
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: jest.fn(), set: cookieSet, delete: cookieDelete })),
}))

const verifyStaffPin = jest.fn()
jest.mock('@/actions/staff-pin', () => ({ verifyStaffPin: (...a: unknown[]) => verifyStaffPin(...a) }))

import { setActiveStaff, clearActiveStaff } from '@/actions/active-staff'

beforeEach(() => jest.clearAllMocks())

describe('setActiveStaff', () => {
  it('sets the cookie when the PIN is valid', async () => {
    verifyStaffPin.mockResolvedValue({ valid: true })
    const result = await setActiveStaff('staff-a', '1234')
    expect(result).toEqual({ ok: true })
    expect(cookieSet).toHaveBeenCalledWith(
      'active_staff_id', 'staff-a', expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    )
  })

  it('does NOT set the cookie when the PIN is invalid', async () => {
    verifyStaffPin.mockResolvedValue({ valid: false })
    const result = await setActiveStaff('staff-a', '0000')
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/incorrect pin/i) })
    expect(cookieSet).not.toHaveBeenCalled()
  })
})

describe('clearActiveStaff', () => {
  it('deletes the cookie', async () => {
    await clearActiveStaff()
    expect(cookieDelete).toHaveBeenCalledWith('active_staff_id')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- set-active-staff`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/actions/active-staff.ts`**

```typescript
'use server'

import { cookies } from 'next/headers'
import { verifyStaffPin } from '@/actions/staff-pin'
import { ACTIVE_STAFF_COOKIE } from '@/lib/staff'

const ONE_MONTH = 60 * 60 * 24 * 30

/**
 * Set the active staff for this device after verifying their PIN. The cookie is
 * written ONLY on a valid PIN. Roster membership is re-validated on every read
 * (getActiveStaffId), so this need only gate on the PIN here.
 */
export async function setActiveStaff(
  staffId: string,
  pin: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await verifyStaffPin(staffId, pin)
  if (!result.valid) {
    return { ok: false, error: result.error ?? 'Incorrect PIN' }
  }
  const store = await cookies()
  store.set(ACTIVE_STAFF_COOKIE, staffId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_MONTH,
  })
  return { ok: true }
}

/** Clear the active staff (switch out / logout). */
export async function clearActiveStaff(): Promise<void> {
  const store = await cookies()
  store.delete(ACTIVE_STAFF_COOKIE)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- set-active-staff` → PASS (3 tests). Then `npm test` (full) → green. Then `npm run type-check` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/actions/active-staff.ts src/__tests__/integration/set-active-staff.test.ts
git commit -m "feat(staff): setActiveStaff/clearActiveStaff server actions (PIN-gated cookie)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: StaffSwitcher overlay (grid → PIN verify → switch)

**Files:**
- Create: `src/components/staff/StaffSwitcher.tsx`
- Reuse: `PinPad`, `PinSetup`, `useSession`, `setActiveStaff`/`clearActiveStaff`, `hasStaffPin`

> UI task — verify in the running app. Keep styling consistent with existing overlays (see `PinPad`'s fixed-overlay pattern).

- [ ] **Step 1: Build the component**

A client component `StaffSwitcher({ open, onClose }: { open: boolean; onClose: () => void })`:
- Reads `const { staffList, activeStaffId } = useSession()`.
- Phase state: `'grid' | 'pin' | 'setpin'`, plus `selected: StaffItem | null`, `error`, `loading`.
- **Grid phase:** full-screen overlay (`fixed inset-0 z-[60] bg-black/70 backdrop-blur`) with a centered responsive grid of staff (avatar circle with initials/`avatarUrl` + name), highlighting `activeStaffId`. Each tile `onClick`: set `selected`; if `staff.hasPin` → phase `'pin'`, else phase `'setpin'`. Include a "Switch out" button → `await clearActiveStaff()`, then `onClose()` + `router.refresh()`.
- **PIN phase:** render `<PinPad title={t('enterPinFor', { name: selected.name })} onSubmit={handlePin} onCancel={() => setPhase('grid')} error={error} loading={loading} />`. `handlePin(pin)`: `setLoading(true)`; `const r = await setActiveStaff(selected.id, pin)`; if `r.ok` → `onClose()` + `router.refresh()`; else `setError(t('incorrectPin'))`, `setLoading(false)`.
- **Set-PIN phase (first time):** render `<PinSetup staffId={selected.id} staffName={selected.name} hasPin={false} onClose={async () => { /* after setting a PIN, go to pin phase to actually switch */ setPhase('pin') }} />`. (Setting a PIN does not auto-switch; the user then enters it once to switch — simplest reuse of the existing PinSetup.)
- Use `useRouter` from `next/navigation` for `router.refresh()` so server components re-read the new cookie.
- Add i18n keys under a `switcher` namespace in `messages/en.json` + `messages/ja.json`: `enterPinFor` ("Enter {name}'s PIN" / "{name}のPINを入力"), `incorrectPin` ("Incorrect PIN" / "PINが正しくありません"), `switchStaff` ("Switch staff" / "スタッフを切り替え"), `switchOut` ("Switch out" / "切り替えを解除"), `selectStaff` ("Select staff" / "スタッフを選択").

- [ ] **Step 2: Type-check**

Run: `npm run type-check` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/staff/StaffSwitcher.tsx messages/en.json messages/ja.json
git commit -m "feat(staff): Netflix-style staff switcher overlay (PIN-gated)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Top bar + layout wiring; sidebar chip → org

**Files:**
- Create: `src/components/layout/top-bar.tsx`
- Modify: `src/app/[locale]/(app)/layout.tsx`
- Modify: `src/components/layout/sidebar.tsx` (profile chip → org identity)

> UI task — verify in the running app.

- [ ] **Step 1: Build `top-bar.tsx`**

Client component. Reads `useSession()` for `activeStaff`. Renders a slim bar (`h-14 border-b border-border flex items-center justify-end px-4`) with a right-aligned chip button: avatar + `activeStaff?.name ?? t('switcher.selectStaff')`. Holds `const [open, setOpen] = useState(false)`; renders `<StaffSwitcher open={open} onClose={() => setOpen(false)} />`; chip `onClick={() => setOpen(true)}`. (StaffSwitcher returns null when `!open`.)

- [ ] **Step 2: Wire into the layout**

In `src/app/[locale]/(app)/layout.tsx`:
- Change `getCurrentUserStaffId` import/call to `getActiveStaffId` (from `@/lib/staff`).
- Replace the `activeStaff` fallback block (`if (!activeStaff && staffItems.length > 0) { ... user.id ... staffItems[0] }`) — when there's no active staff, leave `activeStaff = null` (the top bar shows "Select staff"). Keep `sessionData.activeStaff`/`activeStaffId` reflecting the real (possibly null) active staff.
- Render `<TopBar />` as the first child inside the `<main>`'s flex column, ABOVE the scrollable content (so the bar is fixed at top of the content area). Adjust the wrapper so `<TopBar />` sits above `<main>`'s scroll region.

- [ ] **Step 3: Sidebar chip → org**

In `src/components/layout/sidebar.tsx`, the `SidebarProfileChip` currently shows `activeStaff`. Change it to show the **org**: `const { orgName } = useSession()` → display `orgName ?? 'Salon'` with an "Owner"/org sublabel, keeping the logout action. (Active-staff identity now lives in the top bar.) On logout, also call `clearActiveStaff()` before `signOut()`.

- [ ] **Step 4: Verify in app**

Run dev (synqed-core up). Log in → a top bar shows "Select staff". Click → grid of perry/yes/Dev Salon. Pick one with no PIN → set a PIN → enter it → chip shows that staff; refresh persists it. Sidebar shows the org name. "Switch out" returns to "Select staff".

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/top-bar.tsx "src/app/[locale]/(app)/layout.tsx" src/components/layout/sidebar.tsx
git commit -m "feat(layout): top-bar staff switcher; sidebar chip shows org

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Migrate remaining `getCurrentUserStaffId` consumers; remove the shim

**Files:** `src/app/[locale]/(app)/appointments/page.tsx`, `settings/page.tsx`, `dashboard/page.tsx`, `sessions/page.tsx`, and `src/lib/staff.ts`.

- [ ] **Step 1: Find consumers**

Run: `grep -rn "getCurrentUserStaffId" src --include=*.ts --include=*.tsx | grep -v __tests__`

- [ ] **Step 2: Replace each call** with `getActiveStaffId` (import from `@/lib/staff`):
- `appointments/page.tsx`: `activeStaffId` (default column + "Mine" filter) → `await getActiveStaffId()`. Keep the existing `?? staff[0]?.id ?? null` fallback for the default column.
- `settings/page.tsx`: replace `getCurrentUserStaffId` with `getActiveStaffId`; `isOwner` logic unchanged otherwise.
- `dashboard/page.tsx`: the `activeStaffId` passed to `RecordingPanel` → `await getActiveStaffId()`. If null, fall back to `staffList[0]?.id` so the inline save still has a valid attribution (RecordingPanel requires a non-null `activeStaffId: string` — if it can be null, guard the call site or default to the first roster id).
- `sessions/page.tsx`: pass `getActiveStaffId()` as the no-booking default. In the record flow, when there's no active booking, pre-select the active staff: pass an `activeStaffId` prop down so `ReviewScreen`'s `selectedStaffId` initializes to it (extend `RecordPageView`/`PipelineContainer`/`ReviewScreen` to accept an optional `defaultStaffId` used only when no booking staffId is present). Keep booking attribution unchanged.

- [ ] **Step 3: Remove the shim**

Delete the temporary `getCurrentUserStaffId` export from `src/lib/staff.ts`.

- [ ] **Step 4: Verify**

Run: `npm run type-check` (clean — no `getCurrentUserStaffId` references remain) and `npm test` (green). Then in-app: with an active staff set, the no-booking record picker pre-selects them; the Appointments "Mine" filter reflects them.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(staff): consumers use getActiveStaffId; remove getCurrentUserStaffId shim

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (plan author)

**Spec coverage:** active-staff validated cookie → Task 1; PIN-gated set + clear → Task 2; Netflix overlay + first-PIN inline → Task 3; top bar + sidebar→org → Task 4; attribution/“Mine” integration + shim removal (Phase 4 absorption) → Task 5. Edge cases (stale cookie, empty roster, logout) → Tasks 1, 2, 4. Testing → Tasks 1–2 (unit/integration) + in-app checks (Tasks 3–5). All success criteria mapped.

**Placeholder scan:** Task 3/4/5 are UI/integration tasks with concrete component contracts + exact files + in-app verification rather than literal test code — acceptable for UI per the existing plan's pattern. The Task 1 same-module-mock caveat names a concrete fallback (split into `active-staff.ts`), not a TBD.

**Type consistency:** `ACTIVE_STAFF_COOKIE` defined in staff.ts (Task 1) and imported by the action (Task 2). `setActiveStaff` returns `{ ok } | { ok, error }` (Task 2) consumed in Task 3. `getActiveStaffId` used in Tasks 4–5. `StaffItem`/`useSession` shape matches the provider.
