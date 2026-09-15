/**
 * The 担当/自分 filter has to cross an ID BORDER to reach the week and month.
 *
 * `appointments.staff_id` is a CORE staff id; the roster, the ?staff= param and
 * the viewer's own id are PROFILE (auth) ids. Sending a profile id straight
 * through as `staff_id` filters to nothing — which renders as a perfectly calm
 * empty week, the exact lie this lane exists to end. Six cases, one resolver.
 */
import { resolveFetchStaffId } from '@/lib/appointments/screen'

// profile id → core staff id, as synqed.staff.list reports it.
const MAP = new Map([
  ['auth-mika', 'staff-core-1'],
  ['auth-yuko', 'staff-core-2'],
])

describe('resolveFetchStaffId', () => {
  it("'all' → no filter", () => {
    expect(resolveFetchStaffId('all', 'auth-mika', MAP)).toEqual({
      staffId: null,
      unknown: false,
    })
  })

  it("'self' → the viewer's CORE id", () => {
    expect(resolveFetchStaffId('self', 'auth-mika', MAP)).toEqual({
      staffId: 'staff-core-1',
      unknown: false,
    })
  })

  it("'self' with no viewer id → unfiltered, exactly the day path's behaviour", () => {
    expect(resolveFetchStaffId('self', null, MAP)).toEqual({
      staffId: null,
      unknown: false,
    })
  })

  it('a profile id → its core id', () => {
    expect(resolveFetchStaffId('auth-yuko', 'auth-mika', MAP)).toEqual({
      staffId: 'staff-core-2',
      unknown: false,
    })
  })

  it('an UNLINKED core id (a roster card with no login) → itself', () => {
    expect(resolveFetchStaffId('staff-core-2', 'auth-mika', MAP)).toEqual({
      staffId: 'staff-core-2',
      unknown: false,
    })
  })

  it('an id the roster cannot place → unknown, so the caller ships an EMPTY window (mutant m8)', () => {
    // The dangerous alternative is returning { staffId: null } here, which is
    // "no filter" — the whole salon's week under a single stylist's name.
    expect(resolveFetchStaffId('nobody-at-all', 'auth-mika', MAP)).toEqual({
      staffId: null,
      unknown: true,
    })
  })

  it('an empty roster map: a named filter is unknown, never unfiltered', () => {
    expect(resolveFetchStaffId('auth-mika', 'auth-mika', new Map())).toEqual({
      staffId: null,
      unknown: true,
    })
  })
})
