/**
 * An in-memory `profiles` table for the removed-staffer pins.
 *
 * The fake query builder interprets exactly the operators deleteStaffCore
 * (src/actions/staff.ts) and staffListByBusinessOrThrow (src/lib/staff.ts)
 * issue — select / eq / not is-null / not ilike with SQL LIKE semantics /
 * order / maybeSingle / update — so the roster filter a pin exercises is the
 * real one, not a copy of it.
 * `seamOver(rows, installService)` returns the REAL businessIdForUser (the
 * identity seam both doors pass through) bound to the same table — a suite
 * delegates its mocked businessIdForUser to it for one call.
 *
 * `rosterOf(rows, installService)` runs the REAL staffListByBusinessOrThrow
 * over the rows. The door suites (karute save, appointments, invites,
 * recording-session mint) mock @/lib/staff, so the real module is taken with
 * requireActual in an isolated registry — nothing is doMock'ed (a doMock
 * factory outlives the isolation and would leak into the suite's own later
 * isolated requires). Each suite's own @/lib/supabase/service mock consults
 * the `installService` hook, set for the read only.
 */
type Row = Record<string, unknown>

const likeToRegex = (pattern: string) =>
  new RegExp(
    '^' +
      pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.') +
      '$',
    'is',
  )

export function fakeProfilesService(rows: Row[]) {
  const bans = new Map<string, string>()
  const updates: Array<{ patch: Row; eq: Array<[string, unknown]> }> = []
  function query() {
    const filters: Array<(r: Row) => boolean> = []
    const eqs: Array<[string, unknown]> = []
    let patch: Row | null = null
    let orderBy: string | null = null
    const matched = () => rows.filter((r) => filters.every((f) => f(r)))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      update: (p: Row) => {
        patch = p
        return b
      },
      eq: (c: string, v: unknown) => {
        eqs.push([c, v])
        filters.push((r) => r[c] === v)
        return b
      },
      not: (c: string, op: string, v: unknown) => {
        if (op === 'is') filters.push((r) => r[c] !== v)
        else if (op === 'ilike')
          // SQL: NULL ILIKE … is NULL, NOT NULL is NULL → the row is excluded.
          filters.push((r) => r[c] != null && !likeToRegex(String(v)).test(String(r[c])))
        else throw new Error(`fakeProfilesService: unsupported not(${op})`)
        return b
      },
      order: (c: string) => {
        orderBy = c
        return b
      },
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      // PostgREST's .single(): no row → PGRST116 (what businessIdForUser reads).
      single: async () => {
        const row = matched()[0]
        return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } }
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          if (patch) {
            updates.push({ patch, eq: eqs })
            for (const r of matched()) Object.assign(r, patch)
            return Promise.resolve(resolve({ data: null, error: null }))
          }
          const out = matched()
          if (orderBy) {
            const k = orderBy
            out.sort((x, y) => String(x[k]).localeCompare(String(y[k])))
          }
          return Promise.resolve(resolve({ data: out, error: null }))
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e)
        }
      },
    }
    return b
  }
  return {
    rows,
    bans,
    updates,
    client: {
      from: (table: string) => {
        if (table !== 'profiles') throw new Error(`fakeProfilesService: unexpected table ${table}`)
        return query()
      },
      auth: {
        admin: {
          updateUserById: async (id: string, attrs: { ban_duration?: string }) => {
            if (attrs.ban_duration) bans.set(id, attrs.ban_duration)
            return { data: { user: { id } }, error: null }
          },
        },
      },
    },
  }
}

export const BUSINESS = 'business-1'

/** A profile row as the REAL removal leaves it: the name behind the
 *  `_system_removed_` prefix (src/actions/staff.ts deleteStaffCore). */
export const removedRow = (id: string, name: string, businessId = BUSINESS): Row => ({
  id,
  full_name: `_system_removed_${name}`,
  customer_id: businessId,
})

/** A profile the roster cannot place WITHOUT the removed prefix (a null name):
 *  the seam lets it through, so only the per-door roster gate refuses it. */
export const unplaceableRow = (id: string, businessId = BUSINESS): Row => ({
  id,
  full_name: null,
  customer_id: businessId,
})

/** The REAL businessIdForUser over `rows`, through the suite's service hook. */
export function seamOver(rows: Row[], installService: (client: unknown) => void) {
  return async (userId: string): Promise<string> => {
    const fake = fakeProfilesService(rows)
    // NOT isolated: the seam's AppApiError must be the SAME class the route's
    // identity.ts checks with instanceof (an isolated copy would read as
    // 'internal', not membership_inactive).
    const lib: typeof import('@/lib/staff') = jest.requireActual('@/lib/staff')
    installService(fake.client)
    try {
      return await lib.businessIdForUser(userId)
    } finally {
      installService(null)
    }
  }
}

/** The REAL roster read over `rows`, through the suite's service hook. */
export async function rosterOf(
  rows: Row[],
  installService: (client: unknown) => void,
  businessId = BUSINESS,
): Promise<Array<{ id: string; full_name: string | null }>> {
  const fake = fakeProfilesService(rows)
  let lib!: typeof import('@/lib/staff')
  jest.isolateModules(() => {
    lib = jest.requireActual('@/lib/staff')
  })
  installService(fake.client)
  try {
    return await lib.staffListByBusinessOrThrow(businessId)
  } finally {
    installService(null)
  }
}
