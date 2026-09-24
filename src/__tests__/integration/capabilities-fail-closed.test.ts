/**
 * Round 2 (2026-09-24, D-S16-4 / D-S17-2, discussed, default) — C3b: THE
 * PERMISSION READ FAILS CLOSED.
 *
 * The S15 breaker's throwaway reproduction (evidence/S15-BREAKER-C.md,
 * appendix C, `zz-breaker-c3.test.ts`, C3b half) with its expectations
 * INVERTED. It showed the combined profiles select erroring (a statement
 * timeout) and the fallback re-reading the never-rewritten `display_role`, so a
 * demoted ex-ADMIN regained 16 capabilities incl. staff.manage and
 * stores.viewAll. Now only the genuinely missing pre-migration columns (42703)
 * take that fallback; any other error REJECTS — never the stale role, and never
 * an empty set (which would send an owner to the unassigned screen).
 */
jest.mock('@/lib/auth/store-gate', () => ({ actorIsUnassigned: jest.fn(async () => false) }))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn(async () => 'ex-admin') }))

type Row = { display_role: string; permission_role: string | null; permissions: string[] | null }
const EXADMIN_ROW: Row = { display_role: 'admin', permission_role: 'practitioner', permissions: null }
const OWNER_ROW: Row = { display_role: 'owner', permission_role: 'owner', permissions: null }
const db = {
  row: EXADMIN_ROW as Row | null,
  richError: null as { message: string; code: string } | null,
  baseError: null as { message: string; code: string } | null,
}
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      let cols = ''
      const b: Record<string, unknown> = {}
      b.select = (c: string) => {
        cols = c
        return b
      }
      b.eq = () => b
      b.maybeSingle = async () => {
        if (cols === 'display_role, permission_role, permissions') {
          return db.richError ? { data: null, error: db.richError } : { data: db.row, error: null }
        }
        if (cols === 'display_role') {
          return db.baseError
            ? { data: null, error: db.baseError }
            : { data: db.row ? { display_role: db.row.display_role } : null, error: null }
        }
        return { data: null, error: null }
      }
      return b
    },
  }),
}))

import { capabilitiesForUser, getMyCapabilities } from '@/lib/auth/require-permission'

const TIMEOUT = { message: 'canceling statement due to statement timeout', code: '57014' }
const MISSING_COLUMN = { message: 'column profiles.permission_role does not exist', code: '42703' }

beforeEach(() => {
  db.row = EXADMIN_ROW
  db.richError = null
  db.baseError = null
})

it('control — a healthy read gives the demoted ex-ADMIN the practitioner caps only', async () => {
  const caps = await capabilitiesForUser('ex-admin')
  expect([...caps].sort()).toEqual(['bookings.manage', 'customers.manage', 'customers.view', 'records.write'])
  expect(caps.has('staff.manage')).toBe(false)
})

it('the combined select erroring (statement timeout) REJECTS — no 16-capability regain', async () => {
  db.richError = TIMEOUT
  await expect(capabilitiesForUser('ex-admin')).rejects.toMatchObject({ code: 'upstream_unavailable' })
})

it('…and the cookie seam (getMyCapabilities) rejects with it — an outage, never an empty set', async () => {
  db.richError = TIMEOUT
  await expect(getMyCapabilities()).rejects.toMatchObject({ code: 'upstream_unavailable' })
})

it('42703 (the columns genuinely missing, pre-migration) → the display_role preset: the owner keeps full power', async () => {
  db.row = OWNER_ROW
  db.richError = MISSING_COLUMN
  const caps = await capabilitiesForUser('owner')
  expect(caps.has('business.manage')).toBe(true)
  expect(caps.has('stores.viewAll')).toBe(true)
})

it('42703 → the ex-ADMIN gets its display_role preset (manager) — the accepted pre-migration behaviour', async () => {
  db.richError = MISSING_COLUMN
  const caps = await capabilitiesForUser('ex-admin')
  expect(caps.has('staff.manage')).toBe(true)
})

it('42703 whose fallback read ALSO errors → rejects, never a guessed preset', async () => {
  db.richError = MISSING_COLUMN
  db.baseError = TIMEOUT
  await expect(capabilitiesForUser('ex-admin')).rejects.toMatchObject({ code: 'upstream_unavailable' })
})

it('the read SUCCEEDS with no row → an EMPTY set (nothing vouched for; was the practitioner preset)', async () => {
  db.row = null
  const caps = await capabilitiesForUser('ghost')
  expect(caps.size).toBe(0)
})
