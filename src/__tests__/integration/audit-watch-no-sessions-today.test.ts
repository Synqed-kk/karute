/**
 * 監査ログ round 2, PR C — Group B d5: find-no-sessions-today (the pure
 * finder). Same shape as audit-watch-karute-missing.test.ts next door.
 */
import { findNoSessionsToday } from '@/lib/audit-watch/find-no-sessions-today'

// 2026-09-11 00:00 JST = 2026-09-10T15:00:00.000Z.
const TODAY_START = new Date('2026-09-10T15:00:00.000Z')
const NOW = new Date('2026-09-11T10:00:00.000Z').getTime() // midday JST
const DAY_MS = 24 * 60 * 60 * 1000
const isoHoursAgoFromTodayStart = (hoursBeforeTodayStart: number) =>
  new Date(TODAY_START.getTime() - hoursBeforeTodayStart * 60 * 60 * 1000).toISOString()
const isoHoursAfterTodayStart = (hoursAfterTodayStart: number) =>
  new Date(TODAY_START.getTime() + hoursAfterTodayStart * 60 * 60 * 1000).toISOString()

/** The two-way normalize-to-core-id map (L2 §1): `id → id` and, when a
 *  staffer has a linked profile, `user_id → id` too. */
const STAFF_MAP = new Map<string, string>([
  ['staff-a', 'staff-a'],
  ['user-a', 'staff-a'],
  ['staff-b', 'staff-b'],
  ['user-b', 'staff-b'],
  ['staff-c', 'staff-c'],
  ['user-c', 'staff-c'],
])

function session(over: { staffId: string; createdAt: string }) {
  return { staffId: over.staffId, createdAt: over.createdAt }
}

describe('findNoSessionsToday', () => {
  it('fires for the exact 9/9 shape: one staffer kept + recorded-last-week + zero-today, while two others minted fine today', () => {
    const appointments = [{ staff_id: 'staff-a' }, { staff_id: 'staff-b' }, { staff_id: 'staff-c' }]
    const sessions = [
      // staff-a: recorded 3 days ago, nothing today.
      session({ staffId: 'user-a', createdAt: isoHoursAgoFromTodayStart(3 * 24) }),
      // staff-b and staff-c: both minted fine TODAY.
      session({ staffId: 'staff-b', createdAt: isoHoursAfterTodayStart(2) }),
      session({ staffId: 'user-c', createdAt: isoHoursAfterTodayStart(4) }),
    ]
    const result = findNoSessionsToday({
      sessions,
      appointments,
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs: TODAY_START.getTime() - DAY_MS * 7,
    })
    expect(result).toEqual({
      day: '2026-09-11',
      staff_ids: ['staff-a'],
      kept_appointments: 1,
      sessions_today: 0,
      sessions_prev_7d: 1,
    })
  })

  it('silent when the staffer has NO kept appointment today', () => {
    const result = findNoSessionsToday({
      sessions: [session({ staffId: 'staff-a', createdAt: isoHoursAgoFromTodayStart(3 * 24) })],
      appointments: [], // no bookings at all today
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs: TODAY_START.getTime() - DAY_MS * 7,
    })
    expect(result).toBeNull()
  })

  it('silent when the staffer never recorded in the previous 7 days (not a recorder)', () => {
    const result = findNoSessionsToday({
      sessions: [], // nobody recorded, ever
      appointments: [{ staff_id: 'staff-a' }],
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs: TODAY_START.getTime() - DAY_MS * 7,
    })
    expect(result).toBeNull()
  })

  it('a session stamped with the AUTH id and one stamped with the CORE id both count for the SAME staffer', () => {
    const result = findNoSessionsToday({
      sessions: [
        session({ staffId: 'user-a', createdAt: isoHoursAgoFromTodayStart(2 * 24) }),
        session({ staffId: 'staff-a', createdAt: isoHoursAgoFromTodayStart(5 * 24) }),
      ],
      appointments: [{ staff_id: 'staff-a' }],
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs: TODAY_START.getTime() - DAY_MS * 7,
    })
    expect(result).toEqual({
      day: '2026-09-11',
      staff_ids: ['staff-a'],
      kept_appointments: 1,
      sessions_today: 0,
      sessions_prev_7d: 2,
    })
  })

  it("a future-stamped session (device/core clock skew, same JST day) does NOT count as recorded today — the staffer is still flagged (NB-6, mutant M18)", () => {
    const result = findNoSessionsToday({
      sessions: [
        // The genuine recorder proof, 3 days ago.
        session({ staffId: 'staff-a', createdAt: isoHoursAgoFromTodayStart(3 * 24) }),
        // Stamped an hour AFTER `now`, but still on today's JST calendar day.
        // `at <= now` is the upper bound that keeps a skewed clock from
        // reading this as "recorded today" — without it, this session alone
        // would silently silence the staffer.
        session({ staffId: 'staff-a', createdAt: new Date(NOW + 60 * 60 * 1000).toISOString() }),
      ],
      appointments: [{ staff_id: 'staff-a' }],
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs: TODAY_START.getTime() - DAY_MS * 7,
    })
    expect(result).toEqual({
      day: '2026-09-11',
      staff_ids: ['staff-a'],
      kept_appointments: 1,
      sessions_today: 0,
      sessions_prev_7d: 1,
    })
  })

  it('a session recorded today in EITHER id space silences the staffer', () => {
    const result = findNoSessionsToday({
      sessions: [
        session({ staffId: 'user-a', createdAt: isoHoursAgoFromTodayStart(3 * 24) }),
        session({ staffId: 'user-a', createdAt: isoHoursAfterTodayStart(1) }), // today, auth-id space
      ],
      appointments: [{ staff_id: 'staff-a' }],
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs: TODAY_START.getTime() - DAY_MS * 7,
    })
    expect(result).toBeNull()
  })

  it('a session whose staffId maps to NOTHING is ignored — never an invented join', () => {
    const result = findNoSessionsToday({
      sessions: [session({ staffId: 'ghost-id', createdAt: isoHoursAgoFromTodayStart(3 * 24) })],
      appointments: [{ staff_id: 'staff-a' }],
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs: TODAY_START.getTime() - DAY_MS * 7,
    })
    expect(result).toBeNull() // staff-a has a kept appointment but no mapped 7-day session
  })

  it('an appointment whose staff_id maps to nothing is ignored — never an invented join', () => {
    const result = findNoSessionsToday({
      sessions: [session({ staffId: 'staff-a', createdAt: isoHoursAgoFromTodayStart(3 * 24) })],
      appointments: [{ staff_id: 'ghost-id' }],
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs: TODAY_START.getTime() - DAY_MS * 7,
    })
    expect(result).toBeNull()
  })

  it('a session exactly at todayStart counts as TODAY, not previous-7d (inclusive lower bound)', () => {
    const result = findNoSessionsToday({
      sessions: [
        session({ staffId: 'staff-a', createdAt: isoHoursAgoFromTodayStart(24) }), // yesterday, prev-7d
        session({ staffId: 'staff-a', createdAt: TODAY_START.toISOString() }), // exactly today's start
      ],
      appointments: [{ staff_id: 'staff-a' }],
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs: TODAY_START.getTime() - DAY_MS * 7,
    })
    expect(result).toBeNull() // the todayStart-exact session silences it
  })

  it('a session exactly at lookbackStartMs is the inclusive floor; one ms earlier is invisible — the floor is the CALLER\'s read boundary, never a calendar constant', () => {
    // Deliberately NOT calendar-aligned to todayStart (unlike every other
    // test's default) — proves the finder trusts whatever floor it is given,
    // the caller's actual inbox-read floor, rather than deriving one itself.
    const lookbackStartMs = TODAY_START.getTime() - DAY_MS * 7 + 3 * 60 * 60 * 1000

    const atFloor = findNoSessionsToday({
      sessions: [session({ staffId: 'staff-a', createdAt: new Date(lookbackStartMs).toISOString() })],
      appointments: [{ staff_id: 'staff-a' }],
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs,
    })
    expect(atFloor).toEqual({
      day: '2026-09-11',
      staff_ids: ['staff-a'],
      kept_appointments: 1,
      sessions_today: 0,
      sessions_prev_7d: 1,
    })

    const beforeFloor = findNoSessionsToday({
      sessions: [session({ staffId: 'staff-a', createdAt: new Date(lookbackStartMs - 1).toISOString() })],
      appointments: [{ staff_id: 'staff-a' }],
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs,
    })
    expect(beforeFloor).toBeNull() // one ms before the floor — never read, never seen
  })

  it('multiple flagged staffers → staff_ids sorted, counts summed over the flagged only', () => {
    const result = findNoSessionsToday({
      sessions: [
        session({ staffId: 'staff-c', createdAt: isoHoursAgoFromTodayStart(2 * 24) }),
        session({ staffId: 'staff-a', createdAt: isoHoursAgoFromTodayStart(3 * 24) }),
        // staff-b recorded fine today — not flagged, and its history/kept
        // counts must NOT bleed into the flagged staffers' totals.
        session({ staffId: 'staff-b', createdAt: isoHoursAfterTodayStart(1) }),
        session({ staffId: 'staff-b', createdAt: isoHoursAgoFromTodayStart(4 * 24) }),
      ],
      appointments: [
        { staff_id: 'staff-c' },
        { staff_id: 'staff-a' },
        { staff_id: 'staff-a' }, // two kept appointments for staff-a today
        { staff_id: 'staff-b' },
      ],
      staffIdToCoreId: STAFF_MAP,
      now: NOW,
      todayStart: TODAY_START,
      lookbackStartMs: TODAY_START.getTime() - DAY_MS * 7,
    })
    expect(result).toEqual({
      day: '2026-09-11',
      staff_ids: ['staff-a', 'staff-c'],
      kept_appointments: 3, // 2 (staff-a) + 1 (staff-c) — staff-b's 1 excluded
      sessions_today: 0,
      sessions_prev_7d: 2, // 1 + 1 — staff-b's excluded
    })
  })
})
