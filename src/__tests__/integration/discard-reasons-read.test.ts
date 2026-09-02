/**
 * 破棄の記録 — the manager read (packet P5-A item A-6, ⚖ 8/25 ruling B).
 *
 * The GATE is the point of this file. P5-A makes staff write a reason for every
 * discard; this read is the only place those words are ever visible, and the
 * capability guarding it is what keeps "manager-only" true. The settings tab
 * filter is exposure reduction — it hides a door. THIS is the lock, so it is
 * asserted here directly against the action, not through the shell.
 *
 * `staff.manage` is deliberately the EXISTING owner/manager line rather than a
 * new capability: owner holds ALL and manager holds ALL minus five, so both
 * carry it while senior/practitioner/frontdesk do not (lib/auth/permissions.ts).
 * `integrity.view` is a B-5 item and would have shipped here with no UI to
 * grant it.
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-core-key'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))

interface LedgerRow {
  id: string
  recording_session_id: string
  source: 'STAFF' | 'SYSTEM'
  discarded_by: string | null
  reason: string | null
  created_at: string
}
const ledger: LedgerRow[] = []
const listSeen: Record<string, unknown>[] = []

/** Prototype method that reads `this` — a receiver-losing extraction rejects
 *  here exactly like prod (the bug discard.ts's own comment cites as having
 *  killed every probe in production once). */
class ThisSensitiveDiscardClient {
  async list(q: Record<string, unknown> = {}) {
    listSeen.push(q)
    const all = ledger.filter((r) => !q.source || r.source === q.source)
    // Pages for real: the read caps at MAX_PAGES, and a fake that hands back
    // the whole ledger on page 1 can never reach that cap.
    const page = Number(q.page ?? 1)
    const pageSize = Number(q.page_size ?? 200)
    const events = all.slice((page - 1) * pageSize, page * pageSize)
    return { events, total: all.length, page, page_size: pageSize }
  }
}
const fakeClient = { recordingDiscards: new ThisSensitiveDiscardClient() }
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))

/** THE CORE STAFF ROSTER — the CARD id space. Core normalises a discard's
 *  `discarded_by` to staff.id (the card), while `staffListByBusinessOrThrow`
 *  below is Supabase PROFILES keyed by login uuid. The whole names defect lived
 *  in the gap, so the fake has to hold both sides for real: cards that link to
 *  a profile, a card that links to none, and a roster read that fails. */
const staffCards = {
  current: [] as { id: string; user_id: string | null; email: string | null; name: string | null }[],
  listRejects: false,
}
/** Module-level so the WRITE is assertable. `staff.update` is the self-heal
 *  patch the old card lookup could fire from these read paths — the count now
 *  has to prove it never writes at all (fix round 1, FIX-1). */
const mockStaffUpdate = jest.fn(async () => ({}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({
    staff: {
      // Pages for real, mirroring the recordingDiscards fake above: a roster
      // fixture with more than one page's worth of cards is the only way to
      // catch a caller that reads page 1 and calls it done.
      list: jest.fn(async (q: Record<string, unknown> = {}) => {
        if (staffCards.listRejects) throw new Error('core roster unreachable')
        const page = Number(q.page ?? 1)
        const pageSize = Number(q.page_size ?? 200)
        const staff = staffCards.current.slice((page - 1) * pageSize, page * pageSize)
        return { staff, total: staffCards.current.length, page, page_size: pageSize }
      }),
      update: mockStaffUpdate,
    },
  })),
}))
/** staff-map's email fallback reads profiles through the service client.
 *  `profileRow.current` is normally null — a clean miss, which is what the
 *  user_id-link cases want. A test that needs the EMAIL branch (the one that
 *  self-heals) sets a row here. */
const profileRow = { current: null as { email: string | null } | null }
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileRow.current }) }) }),
    }),
  }),
}))

const capabilities = { current: new Set<string>(['staff.manage']) }
const staffId = { current: 'staff-A' as string | null }
/** The PROFILES roster (login-uuid space). Configurable so the blank-name
 *  population below is a real roster answer, not a stub of the join. */
const staffList = { current: [] as { id: string; full_name: string | null }[] }
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => staffId.current),
  staffListByBusinessOrThrow: jest.fn(async () => staffList.current),
}))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return {
    ...actual,
    getMyCapabilities: jest.fn(async () => capabilities.current),
  }
})

import { listDiscardReasons, myDiscardCountThisMonth } from '@/actions/recording-discards'

/** Fixture instants are anchored on the JST calendar, because the action's
 *  month floor is (⚖ M12) and the runtime's is not — on Vercel it is UTC. Built
 *  from Intl parts rather than the app's own jst helper, so a fixture cannot
 *  agree with a broken implementation by construction. Without this, a suite
 *  run in the last nine hours of a UTC month would seed rows the JST floor has
 *  already left behind and go red for no reason on screen. */
const jstNow = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())
const [JST_YEAR, JST_MONTH] = jstNow.split('-').map(Number)
const pad2 = (n: number) => String(n).padStart(2, '0')
const jstAt = (year: number, month: number, day: number) =>
  new Date(`${year}-${pad2(month)}-${pad2(day)}T10:00:00+09:00`).toISOString()

const thisMonth = (day: number) => jstAt(JST_YEAR, JST_MONTH, day)
/** Comfortably inside the PREVIOUS JST month, whatever today is. */
const lastMonth =
  JST_MONTH === 1 ? jstAt(JST_YEAR - 1, 12, 15) : jstAt(JST_YEAR, JST_MONTH - 1, 15)

function row(over: Partial<LedgerRow> & { id: string }): LedgerRow {
  return {
    recording_session_id: `rs-${over.id}`,
    source: 'STAFF',
    discarded_by: 'staff-A',
    reason: 'お客様を間違えて録音を開始してしまいました',
    created_at: thisMonth(2),
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ledger.length = 0
  listSeen.length = 0
  capabilities.current = new Set(['staff.manage'])
  staffId.current = 'staff-A'
  staffCards.listRejects = false
  profileRow.current = null
  staffList.current = [
    { id: 'staff-A', full_name: '原 奏恵' },
    { id: 'staff-B', full_name: '佐藤 美咲' },
  ]
  staffCards.current = [
    // Linked: the card the ledger stamps, pointing at the profile whose name
    // the rest of karute shows.
    { id: 'card-A', user_id: 'staff-A', email: 'hara@salon.test', name: '原 カナエ' },
    // Unlinked: a teammate created from Settings, or one whose profile is gone.
    { id: 'card-C', user_id: null, email: null, name: '退職 一郎' },
  ]
})

describe('the manager gate', () => {
  it('a holder of staff.manage (owner / manager) can read the reasons', async () => {
    ledger.push(row({ id: '1' }))
    const res = await listDiscardReasons()

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].reason).toBe('お客様を間違えて録音を開始してしまいました')
  })

  // The whole ruling in one assertion. A senior/practitioner holds records.write
  // and menus.manage but never staff.manage — their colleagues' written reasons
  // are not theirs to read, and the refusal happens BEFORE any core read.
  it.each([
    ['senior', ['records.write', 'menus.manage', 'stores.viewAll']],
    ['practitioner', ['records.write', 'customers.view']],
    ['frontdesk', ['customers.view', 'bookings.manage']],
    ['blank custom preset', []],
  ])('%s is refused, and nothing is read', async (_label, caps) => {
    ledger.push(row({ id: '1' }))
    capabilities.current = new Set(caps)

    expect(await listDiscardReasons()).toEqual({ ok: false, error: 'forbidden' })
    expect(listSeen).toHaveLength(0)
  })
})

describe('what the list carries', () => {
  it('asks core for STAFF rows only — SYSTEM cleanup rows are not a human’s reason', async () => {
    ledger.push(row({ id: '1' }))
    await listDiscardReasons()

    expect(listSeen[0]).toMatchObject({ source: 'STAFF' })
  })

  it('resolves staff names server-side and orders newest first', async () => {
    ledger.push(row({ id: 'old', created_at: thisMonth(1) }))
    ledger.push(row({ id: 'new', created_at: thisMonth(9), discarded_by: 'staff-B' }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')

    expect(res.rows.map((r) => r.id)).toEqual(['new', 'old'])
    expect(res.rows[0].staffName).toBe('佐藤 美咲')
    expect(res.rows[1].staffName).toBe('原 奏恵')
  })

  it('an unrecognised staff id still renders its row — only the NAME is unknown', async () => {
    ledger.push(row({ id: '1', discarded_by: 'departed-staffer' }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].staffName).toBeNull()
  })

  it('a row with no reason text is not a written reason, and is dropped', async () => {
    ledger.push(row({ id: '1', reason: null }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.rows).toHaveLength(0)
  })
})

// The names defect (fixed 2026-08-31). Every row this screen shows was written
// by core, and core stores the staff CARD id on `discarded_by` — never the
// login uuid the profiles roster is keyed by. The join read one id space and
// the rows carried the other, so a manager opening 破棄の記録 saw 担当者不明
// against every single reason and could not tell who had written what.
describe('the two id spaces the ledger and the roster live in', () => {
  it('a row stamped with the staff CARD id is named through the linked profile', async () => {
    ledger.push(row({ id: '1', discarded_by: 'card-A' }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.rows[0].staffName).toBe('原 奏恵')
  })

  it('a card that links to NO profile is still named, from the card itself', async () => {
    // Departed or Settings-created. Erasing them would hide who wrote the
    // reason on exactly the rows a manager is most likely to be checking.
    ledger.push(row({ id: '1', discarded_by: 'card-C' }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.rows[0].staffName).toBe('退職 一郎')
  })

  it('a linked profile whose name is BLANK falls through to the card’s own name', async () => {
    // `'' ?? card.name` is `''`, not the card name — a linked card whose
    // profile carries an empty (or whitespace-only) full_name therefore lost
    // BOTH names and read 担当者不明, on a row we could name honestly.
    staffCards.current = [
      { id: 'card-blank', user_id: 'staff-blank', email: null, name: '空欄 花子' },
    ]
    staffList.current = [{ id: 'staff-blank', full_name: '   ' }]
    ledger.push(row({ id: '1', discarded_by: 'card-blank' }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.rows[0].staffName).toBe('空欄 花子')
  })

  it('an id in NEITHER space stays unnamed — the fix invents no names', async () => {
    ledger.push(row({ id: '1', discarded_by: 'card-nobody' }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].staffName).toBeNull()
  })

  it('the per-staff counts name card-id rows too', async () => {
    ledger.push(row({ id: 'a', discarded_by: 'card-A', created_at: thisMonth(2) }))
    ledger.push(row({ id: 'b', discarded_by: 'card-A', created_at: thisMonth(3) }))
    ledger.push(row({ id: 'c', discarded_by: 'card-C', created_at: thisMonth(4) }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.counts.byStaff).toEqual([
      { staffId: 'card-A', staffName: '原 奏恵', thisMonth: 2 },
      { staffId: 'card-C', staffName: '退職 一郎', thisMonth: 1 },
    ])
  })

  it('a CARD roster that cannot be read costs names, never the read', async () => {
    // The pre-existing degrade contract, extended to the second roster: rows
    // render, only the name is unknown. Profile-keyed rows still name.
    staffCards.listRejects = true
    ledger.push(row({ id: '1', discarded_by: 'card-A' }))
    ledger.push(row({ id: '2', discarded_by: 'staff-B' }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.rows).toHaveLength(2)
    expect(res.rows.find((r) => r.id === '1')?.staffName).toBeNull()
    expect(res.rows.find((r) => r.id === '2')?.staffName).toBe('佐藤 美咲')
  })
})

// The pagination defect (fixed 2026-08-31). synqedStaffListByBusiness fetched
// staff.list ONCE at page_size 200; core paginates and its validator caps
// page_size at 200, so a business with a 200+ card roster (current +
// historical — departed staff keep cards) silently lost every card past the
// first page. Those cards' rows read 担当者不明 and their own self-count
// undercounted, with no error anywhere.
describe('the staff roster paginates past 200 cards', () => {
  it('a card that only exists on page 2 still names its row and its own count', async () => {
    // 250 cards total: 200 fill page 1, the viewer's own card sits at #201 —
    // page 2 — followed by 49 more filler cards. A single-page read drops the
    // viewer's card entirely.
    const filler = (label: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${label}-${i}`,
        user_id: null,
        email: null,
        name: null,
      }))
    const page2Card = { id: 'card-page2', user_id: 'staff-page2', email: null, name: '二頁 太郎' }
    staffCards.current = [...filler('filler-a', 200), page2Card, ...filler('filler-b', 49)]
    staffId.current = 'staff-page2'
    ledger.push(row({ id: 'row-page2', discarded_by: 'card-page2', created_at: thisMonth(2) }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.rows[0].staffName).toBe('二頁 太郎')

    expect(await myDiscardCountThisMonth()).toBe(1)
  })
})

// ⚖ 8/25 ruling B: counts are LABELLED PLAIN FACTS. These assert the numbers
// are right; the rendering law (no red, no threshold, no ranking colour) lives
// in the section component.
describe('the counts', () => {
  it('separates THIS month from the total, per staffer', async () => {
    ledger.push(row({ id: 'a', created_at: thisMonth(2) }))
    ledger.push(row({ id: 'b', created_at: thisMonth(3) }))
    ledger.push(row({ id: 'c', created_at: thisMonth(4), discarded_by: 'staff-B' }))
    ledger.push(row({ id: 'old', created_at: lastMonth }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')

    expect(res.counts.total).toBe(4)
    expect(res.counts.thisMonth).toBe(3)
    expect(res.counts.byStaff).toEqual([
      { staffId: 'staff-A', staffName: '原 奏恵', thisMonth: 2 },
      { staffId: 'staff-B', staffName: '佐藤 美咲', thisMonth: 1 },
    ])
  })

  it('the per-staff list is in NAME order, never highest-first', async () => {
    // ⚖ 8/25 ruling B. No sorting control is needed to make a leaderboard —
    // a list fixed highest-first IS one, and the redesign promotes this band
    // into the desktop header where it is now the first thing read. The
    // discriminating fixture is a staffer with MORE discards sorting SECOND:
    // 佐藤 has two, 原 has one, and 原 still leads because of the name.
    ledger.push(row({ id: 'a', discarded_by: 'staff-B', created_at: thisMonth(2) }))
    ledger.push(row({ id: 'b', discarded_by: 'staff-B', created_at: thisMonth(3) }))
    ledger.push(row({ id: 'c', discarded_by: 'staff-A', created_at: thisMonth(4) }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.counts.byStaff).toEqual([
      { staffId: 'staff-A', staffName: '原 奏恵', thisMonth: 1 },
      { staffId: 'staff-B', staffName: '佐藤 美咲', thisMonth: 2 },
    ])
  })

  it('staff we cannot name sort LAST — their position carries no information', async () => {
    ledger.push(row({ id: 'a', discarded_by: 'card-nobody', created_at: thisMonth(2) }))
    ledger.push(row({ id: 'b', discarded_by: 'card-nobody', created_at: thisMonth(3) }))
    ledger.push(row({ id: 'c', discarded_by: 'staff-A', created_at: thisMonth(4) }))

    const res = await listDiscardReasons()
    if (!res.ok) throw new Error('expected ok')
    expect(res.counts.byStaff.map((s) => s.staffName)).toEqual(['原 奏恵', null])
  })

  it('the month floor is JST, so a new Tokyo month starts at Tokyo midnight', async () => {
    // 2026-08-31 18:00 UTC IS 2026-09-01 03:00 in Tokyo. A floor built in the
    // RUNTIME's zone — Vercel runs UTC — computes 2026-08-01 and keeps counting
    // August while the salon is already trading in September, so for the first
    // nine hours of every month 今月の破棄 and every per-staff count describe
    // the month that ended, and a discard made at 03:00 on the 1st lands in it.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
    try {
      jest.setSystemTime(new Date('2026-08-31T18:00:00.000Z'))
      // 8/20 JST — squarely in the month that ended.
      ledger.push(row({ id: 'august', created_at: '2026-08-20T05:00:00.000Z' }))
      // 8/31 16:00 UTC is 9/1 01:00 JST — the only row inside the Tokyo month.
      ledger.push(row({ id: 'september', created_at: '2026-08-31T16:00:00.000Z' }))

      const res = await listDiscardReasons()
      if (!res.ok) throw new Error('expected ok')

      expect(res.counts.thisMonth).toBe(1)
      expect(res.counts.byStaff).toEqual([
        { staffId: 'staff-A', staffName: '原 奏恵', thisMonth: 1 },
      ])
      // The staffer's own half of ruling B reads the same floor, and it is a
      // SECOND month-floor site — a fix applied to one of them only would leave
      // a staffer's own header disagreeing with the manager's screen.
      expect(await myDiscardCountThisMonth()).toBe(1)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('the staffer’s own count (the staff half of ruling B)', () => {
  it('counts only THEIR OWN discards, only this month', async () => {
    ledger.push(row({ id: 'mine-1', created_at: thisMonth(2) }))
    ledger.push(row({ id: 'mine-2', created_at: thisMonth(5) }))
    ledger.push(row({ id: 'theirs', discarded_by: 'staff-B', created_at: thisMonth(6) }))
    ledger.push(row({ id: 'mine-old', created_at: lastMonth }))

    expect(await myDiscardCountThisMonth()).toBe(2)
  })

  // No capability gate on purpose — this is self-knowledge, and Liam's ruling is
  // that the number must never make someone hesitate to discard a recording
  // they should discard.
  it('needs no capability — a practitioner sees their own number', async () => {
    capabilities.current = new Set(['records.write'])
    ledger.push(row({ id: 'mine' }))

    expect(await myDiscardCountThisMonth()).toBe(1)
  })

  it('an unresolved identity yields null, never 0 (a 0 would be a claim)', async () => {
    staffId.current = null
    ledger.push(row({ id: 'mine' }))

    expect(await myDiscardCountThisMonth()).toBeNull()
  })

  // Same defect as the names join, one action over: the viewer's identity here
  // is their login uuid, and every row core wrote carries their CARD id — so a
  // staffer who had discarded takes all month was shown a 0.
  it('counts the rows stamped with their CARD id, not only their login uuid', async () => {
    ledger.push(row({ id: 'mine-card-1', discarded_by: 'card-A', created_at: thisMonth(2) }))
    ledger.push(row({ id: 'mine-card-2', discarded_by: 'card-A', created_at: thisMonth(5) }))
    ledger.push(row({ id: 'mine-uuid', discarded_by: 'staff-A', created_at: thisMonth(6) }))
    ledger.push(row({ id: 'theirs', discarded_by: 'card-C', created_at: thisMonth(6) }))
    ledger.push(row({ id: 'mine-old', discarded_by: 'card-A', created_at: lastMonth }))

    expect(await myDiscardCountThisMonth()).toBe(3)
  })

  it('an identity with no card resolves to the login-uuid behaviour, never an error', async () => {
    staffCards.current = []
    ledger.push(row({ id: 'mine', discarded_by: 'staff-A' }))
    ledger.push(row({ id: 'card', discarded_by: 'card-A' }))

    expect(await myDiscardCountThisMonth()).toBe(1)
  })

  // ── fix round 1, FIX-1: the count reads the roster, it does not resolve ────

  it('a viewer linked from TWO cards counts the rows under BOTH', async () => {
    // The old resolver answered with the FIRST card whose user_id matched and
    // stopped, so a staffer holding two cards (a re-invite, a store move, an
    // import) had half their own month silently missing.
    staffCards.current = [
      { id: 'card-A', user_id: 'staff-A', email: 'hara@salon.test', name: '原 カナエ' },
      { id: 'card-A2', user_id: 'staff-A', email: 'hara@salon.test', name: '原 カナエ' },
    ]
    ledger.push(row({ id: 'first', discarded_by: 'card-A', created_at: thisMonth(2) }))
    ledger.push(row({ id: 'second', discarded_by: 'card-A2', created_at: thisMonth(3) }))
    ledger.push(row({ id: 'uuid', discarded_by: 'staff-A', created_at: thisMonth(4) }))
    ledger.push(row({ id: 'theirs', discarded_by: 'card-C', created_at: thisMonth(5) }))

    expect(await myDiscardCountThisMonth()).toBe(3)
  })

  it('reading your own number writes NOTHING — no self-heal patch, no core write', async () => {
    // The old resolver's email fallback fired a core `staff.update` self-heal.
    // This read carries no capability gate at all, so any practitioner opening
    // their own history could reach a core WRITE — wider than the write's own
    // allowlist justification describes. The roster filter cannot: it reads the
    // cached card list and nothing else.
    staffCards.current = [
      { id: 'card-email-only', user_id: null, email: 'hara@salon.test', name: '原 カナエ' },
    ]
    profileRow.current = { email: 'hara@salon.test' }
    ledger.push(row({ id: 'mine', discarded_by: 'staff-A' }))

    expect(await myDiscardCountThisMonth()).toBe(1)
    expect(mockStaffUpdate).not.toHaveBeenCalled()
  })

  it('a card roster that cannot be read degrades to the login uuid — never null', async () => {
    // The degrade contract the names join already keeps, one action over: a
    // roster we cannot fetch costs the card-id half of the count, never the
    // number itself. Null here would blank a header the staffer can read.
    staffCards.listRejects = true
    ledger.push(row({ id: 'mine', discarded_by: 'staff-A', created_at: thisMonth(2) }))
    ledger.push(row({ id: 'card', discarded_by: 'card-A', created_at: thisMonth(3) }))

    expect(await myDiscardCountThisMonth()).toBe(1)
  })

  // Same rule one step further out: past the page cap the read has only seen
  // PART of the ledger, so the number it holds is a FLOOR. A floor rendered as
  // "your discards this month" is a claim we cannot back, so nothing is shown.
  it('past the read cap it yields null — a partial count is not the count', async () => {
    // 20 pages x 200 + 1: the loop exhausts MAX_PAGES with rows still unread.
    for (let i = 0; i < 4001; i++) ledger.push(row({ id: `d${i}` }))

    expect(await myDiscardCountThisMonth()).toBeNull()
  })
})
