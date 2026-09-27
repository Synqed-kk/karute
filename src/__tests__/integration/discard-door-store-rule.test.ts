/**
 * S46 closure 3 — the 破棄の記録 words door gets ONLY two added checks, and the
 * list it opens from gets the SAME store rule in the same change:
 *   1. is this recording actually discarded by a staff member? (readStaffDiscard)
 *   2. is it in a store this viewer can see? (canViewAllInStore over
 *      readDoorStoreId — all-store access = every store)
 * A manager still reads a DISCARDED recording's words in full (⚖ Liam 9/27);
 * with the default owner and manager permission sets nobody's view changes.
 *
 * Fixture ids only — no real business, store, session or person.
 */
import { presetCapabilities, type Capability } from '@/lib/auth/permissions'

type Discard = { id: string; recording_session_id: string; source: string; reason: string; created_at: string; discarded_by: string }
type Recording = { id: string; created_at: string; duration_seconds: number | null; customer_id: string | null; store_id: string | null }

const NOW = Date.now()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const S_A = '0a0a0a0a-0000-4000-8000-00000000000a' // recorded in store-a
const S_B = '0b0b0b0b-0000-4000-8000-00000000000b' // recorded in store-b
const S_N = '0c0c0c0c-0000-4000-8000-00000000000c' // no store (全店舗 / legacy)
const S_KEPT = '0d0d0d0d-0000-4000-8000-00000000000d' // a KEPT recording (no discard)

let ledger: Discard[] = []
let recordings: Recording[] = []
/** Session ids whose single-row read FAILS (not a 404) — an unknown store. */
let rowReadFails = new Set<string>()
const segmentsRead: string[] = []

const discard = (sessionId: string, id: string): Discard => ({
  id,
  recording_session_id: sessionId,
  source: 'STAFF',
  reason: '録り直します',
  created_at: iso(60_000),
  discarded_by: 'card-fixture',
})
const rec = (id: string, store_id: string | null): Recording => ({
  id,
  created_at: iso(120_000),
  duration_seconds: 90,
  customer_id: null,
  store_id,
})

const fakeClient = {
  recordingDiscards: {
    async list(q: Record<string, unknown> = {}) {
      const all = ledger.filter(
        (r) =>
          (!q.source || r.source === q.source) &&
          (!q.recording_session_id || r.recording_session_id === q.recording_session_id),
      )
      const page = Number(q.page ?? 1)
      const size = Number(q.page_size ?? 200)
      return { events: all.slice((page - 1) * size, page * size), total: all.length, page, page_size: size }
    },
  },
  recordings: {
    async list(q: Record<string, unknown> = {}) {
      const page = Number(q.page ?? 1)
      return { recordings: page === 1 ? recordings : [], total: recordings.length, page, page_size: 200 }
    },
    async get(id: string) {
      if (rowReadFails.has(id)) throw Object.assign(new Error('core 503'), { status: 503 })
      const hit = recordings.find((r) => r.id === id)
      if (!hit) throw Object.assign(new Error('nf'), { status: 404 })
      return hit
    },
    async listSegments(id: string) {
      segmentsRead.push(id)
      return { segments: [{ segment_index: 0, text: `words of ${id}`, start_time: 0 }] }
    },
  },
  customers: { async list() { return { customers: [], total: 0, page: 1, page_size: 200, total_pages: 1 } } },
  stores: { async list() { return { stores: [{ id: 'store-a', name: 'A店' }, { id: 'store-b', name: 'B店' }] } } },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-fixture'),
  getCurrentUserStaffId: jest.fn(async () => 'login-fixture'),
  staffListByBusinessOrThrow: jest.fn(async () => []),
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  synqedStaffCardsForBusiness: jest.fn(async () => []),
  staffNameByIdAcrossCardsAndProfiles: () => new Map<string, string>(),
}))
const caps = { current: new Set<Capability>() }
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, getMyCapabilities: jest.fn(async () => caps.current) }
})
/** The act scope a CLAMPED viewer resolves to (never asked for all-store reach). */
const actScope = { current: ['store-a'] as readonly string[] | null }
const viewerScopeForActs = jest.fn(async () => actScope.current)
jest.mock('@/lib/auth/store-scope', () => ({ viewerScopeForActs: () => viewerScopeForActs() }))

import {
  getDiscardTranscript,
  getDiscardTranscriptWithClient,
  listDiscardReasons,
  listDiscardReasonsWithClient,
} from '@/actions/recording-discards'

const client = fakeClient as unknown as Parameters<typeof getDiscardTranscriptWithClient>[0]
const ALL = { allowedStoreIds: null }
const CLAMPED_A = { allowedStoreIds: ['store-a'] as readonly string[] }

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  ledger = [discard(S_A, 'd-a'), discard(S_B, 'd-b'), discard(S_N, 'd-n')]
  recordings = [rec(S_A, 'store-a'), rec(S_B, 'store-b'), rec(S_N, null), rec(S_KEPT, 'store-a')]
  rowReadFails = new Set()
  segmentsRead.length = 0
  actScope.current = ['store-a']
})

describe('the words door — "is it actually discarded?"', () => {
  it('discarded + in reach → the words, in full', async () => {
    await expect(getDiscardTranscriptWithClient(client, S_A, CLAMPED_A)).resolves.toEqual({
      segments: [{ text: `words of ${S_A}`, startTime: 0 }],
      durationSeconds: 90,
    })
  })

  it('NOT discarded (a kept recording) → forbidden, and not a word is read', async () => {
    await expect(getDiscardTranscriptWithClient(client, S_KEPT, ALL)).resolves.toBe('forbidden')
    expect(segmentsRead).toEqual([])
  })

  it('a SYSTEM-only discard is not a staff discard → forbidden', async () => {
    ledger = [{ ...discard(S_A, 'd-sys'), source: 'SYSTEM' }]
    await expect(getDiscardTranscriptWithClient(client, S_A, ALL)).resolves.toBe('forbidden')
  })

  it('a ledger that cannot be read THROWS — "could not check" is never "discarded"', async () => {
    // A row core answered without its `source` (readStaffDiscard → 'unreadable').
    jest
      .spyOn(fakeClient.recordingDiscards, 'list')
      .mockResolvedValueOnce({ events: [{ recording_session_id: S_A }], total: 1, page: 1, page_size: 1 } as never)
    await expect(getDiscardTranscriptWithClient(client, S_A, ALL)).rejects.toThrow()
    expect(segmentsRead).toEqual([])
  })
})

describe('the words door — "is it in a store you can see?"', () => {
  it('discarded but OUT of reach → forbidden, and not a word is read', async () => {
    await expect(getDiscardTranscriptWithClient(client, S_B, CLAMPED_A)).resolves.toBe('forbidden')
    expect(segmentsRead).toEqual([])
  })

  it('a store-less (全店舗 / legacy) recording is open to a clamped viewer — canViewAllInStore’s own rule', async () => {
    await expect(getDiscardTranscriptWithClient(client, S_N, CLAMPED_A)).resolves.not.toBe('forbidden')
  })

  it('a row read that FAILED is an unknown store: closed for a clamped viewer', async () => {
    rowReadFails = new Set([S_A])
    await expect(getDiscardTranscriptWithClient(client, S_A, CLAMPED_A)).resolves.toBe('forbidden')
  })

  it.each([
    ['store-a', S_A],
    ['store-b', S_B],
    ['no store', S_N],
  ])('an ALL-STORE viewer passes on every store — %s', async (_label, sessionId) => {
    await expect(getDiscardTranscriptWithClient(client, sessionId, ALL)).resolves.toMatchObject({
      segments: [{ text: `words of ${sessionId}` }],
    })
  })

  it('an ALL-STORE viewer passes even when the row read fails (no store could have excluded her); the length is simply unknown', async () => {
    rowReadFails = new Set([S_B])
    await expect(getDiscardTranscriptWithClient(client, S_B, ALL)).resolves.toMatchObject({
      segments: [{ text: `words of ${S_B}` }],
      durationSeconds: null,
    })
  })
})

describe('the 破棄の記録 list — the SAME store rule, same change', () => {
  const ids = (res: Awaited<ReturnType<typeof listDiscardReasonsWithClient>>) =>
    res.rows.map((r) => r.recordingSessionId).sort()

  it('a clamped viewer is shown only rows whose words would open: her store and store-less rows', async () => {
    const res = await listDiscardReasonsWithClient(client, 'business-fixture', CLAMPED_A)
    expect(ids(res)).toEqual([S_A, S_N].sort())
    // …and every row it shows DOES open (no show-and-refuse).
    for (const id of ids(res)) {
      await expect(getDiscardTranscriptWithClient(client, id, CLAMPED_A)).resolves.not.toBe('forbidden')
    }
    // The counts follow the listed rows.
    expect(res.counts.total).toBe(2)
  })

  it('a row the list could not place (recording detail unreadable) is hidden from a clamped viewer', async () => {
    recordings = [rec(S_A, 'store-a')] // S_B and S_N are outside this read
    const res = await listDiscardReasonsWithClient(client, 'business-fixture', CLAMPED_A)
    expect(ids(res)).toEqual([S_A])
  })

  it('an ALL-STORE viewer sees every row, placed or not', async () => {
    recordings = [rec(S_A, 'store-a')]
    const res = await listDiscardReasonsWithClient(client, 'business-fixture', ALL)
    expect(ids(res)).toEqual([S_A, S_B, S_N].sort())
  })
})

// ── CHECK 6: "no one's actual view changes" ──────────────────────────────────
describe("the default OWNER and MANAGER permission sets — nobody's view changes, on any store", () => {
  it.each([['owner'], ['manager']] as const)(
    '%s: the list is exactly the unfiltered list (before = no store rule), and every row’s words open',
    async (preset) => {
      caps.current = new Set(presetCapabilities(preset))
      expect(caps.current.has('staff.manage')).toBe(true)
      expect(caps.current.has('stores.viewAll')).toBe(true)

      const before = await listDiscardReasonsWithClient(client, 'business-fixture', ALL)
      const after = await listDiscardReasons()
      if (!after.ok) throw new Error(`expected ok, got ${after.error}`)
      expect(after.rows).toEqual(before.rows)
      expect(after.counts).toEqual(before.counts)
      expect(after.rows.map((r) => r.recordingSessionId).sort()).toEqual([S_A, S_B, S_N].sort())

      for (const id of [S_A, S_B, S_N]) {
        await expect(getDiscardTranscript(id)).resolves.toEqual({
          ok: true,
          segments: [{ text: `words of ${id}`, startTime: 0 }],
          durationSeconds: 90,
        })
      }
      // All-store reach is answered from the capability: no scope read at all.
      expect(viewerScopeForActs).not.toHaveBeenCalled()
    },
  )

  it('a staff.manage holder WITHOUT all-store reach (a custom set) is clamped to her assigned store', async () => {
    caps.current = new Set<Capability>(['staff.manage'])
    const res = await listDiscardReasons()
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`)
    expect(res.rows.map((r) => r.recordingSessionId).sort()).toEqual([S_A, S_N].sort())
    await expect(getDiscardTranscript(S_B)).resolves.toEqual({ ok: false, error: 'forbidden' })
  })
})
