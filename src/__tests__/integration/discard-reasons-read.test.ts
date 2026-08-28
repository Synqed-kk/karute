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
    const events = ledger.filter((r) => !q.source || r.source === q.source)
    return { events, total: events.length, page: 1, page_size: 200 }
  }
}
const fakeClient = { recordingDiscards: new ThisSensitiveDiscardClient() }
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))

const capabilities = { current: new Set<string>(['staff.manage']) }
const staffId = { current: 'staff-A' as string | null }
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => staffId.current),
  staffListByBusinessOrThrow: jest.fn(async () => [
    { id: 'staff-A', full_name: '原 奏恵' },
    { id: 'staff-B', full_name: '佐藤 美咲' },
  ]),
}))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return {
    ...actual,
    getMyCapabilities: jest.fn(async () => capabilities.current),
  }
})

import { listDiscardReasons, myDiscardCountThisMonth } from '@/actions/recording-discards'

const iso = (d: Date) => d.toISOString()
const now = new Date()
const thisMonth = (day: number) => iso(new Date(now.getFullYear(), now.getMonth(), day, 10, 0, 0))
/** Comfortably inside the PREVIOUS month, whatever today is. */
const lastMonth = iso(new Date(now.getFullYear(), now.getMonth(), 0, 10, 0, 0))

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
  ledger.length = 0
  listSeen.length = 0
  capabilities.current = new Set(['staff.manage'])
  staffId.current = 'staff-A'
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
})
