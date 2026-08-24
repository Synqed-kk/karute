/**
 * カルテ tab 日付チャンク読み込み — the date-window loader (PR-2a,
 * src/lib/karute/karute-window.ts). Verifies:
 *   - probe-then-fetch: empty 2-week windows are SKIPPED, not returned empty
 *   - the walk terminates (probe cap) and still advances its boundary
 *   - a non-empty window is paged to completion (page * page_size < total)
 *   - hasMore rides a FRESHLY re-read total, never a snapshot
 *   - the epoch floor fires the ONE-TIME legacy sweep, which ends the walk
 *   - month mode reads exactly the JST calendar month
 *   - the first-window + 今月-probe pairing degrades leg-INDEPENDENTLY
 *     (contract inherited from PR-1b's listSynqedKaruteRowsWithMonthProbe,
 *     which moved here when its main leg became a window read)
 */
import {
  KARUTE_MAX_PROBE_WINDOWS,
  KARUTE_SESSION_DATE_EPOCH,
  KARUTE_WINDOW_DAYS,
  KARUTE_WINDOW_PAGE_SIZE,
  karuteHasMore,
  loadKaruteWindowRows,
  loadKaruteWindowWithMonthProbe,
} from '@/lib/karute/karute-window'

type ListOpts = {
  store_id?: string
  from?: string
  to?: string
  page?: number
  page_size?: number
}
type Rec = { id: string; created_at: string; session_date: string | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (list: (o: ListOpts) => unknown) => ({ karuteRecords: { list } }) as any

const rec = (id: string, iso: string): Rec => ({
  id,
  created_at: iso,
  session_date: iso.slice(0, 10),
})

/** A fake core that answers from an in-memory set, filtering on created_at —
 *  the REAL server semantics (proved by source read, see
 *  evidence/karute-tab-build-20260825/pr2a/NULL-DATE-PROOF.md: from/to hit
 *  created_at, NOT session_date, both bounds inclusive). */
function fakeCore(records: Rec[]) {
  const calls: ListOpts[] = []
  const list = (opts: ListOpts) => {
    calls.push(opts)
    let rows = records
    if (opts.from) rows = rows.filter((r) => r.created_at >= opts.from!)
    if (opts.to) rows = rows.filter((r) => r.created_at <= opts.to!)
    const size = opts.page_size ?? 100
    const page = opts.page ?? 1
    return Promise.resolve({
      karute_records: rows.slice((page - 1) * size, page * size),
      total: rows.length,
    })
  }
  return { list, calls }
}

// Pinned "now" so a test never races the calendar.
const NOW = new Date('2026-08-25T03:00:00.000Z')

describe('loadKaruteWindowRows — probe-then-fetch', () => {
  it('skips EMPTY windows backward and returns the first non-empty one', async () => {
    // Nothing in the last 6 weeks; one record ~7 weeks back.
    const old = '2026-07-06T01:00:00.000Z'
    const core = fakeCore([rec('k-old', old)])
    const res = await loadKaruteWindowRows(asClient(core.list), { now: NOW })

    expect(res.rows.map((r) => r.id)).toEqual(['k-old'])
    // Windows probed: [08-12..now], [07-29..08-12), [07-15..07-29), then the
    // one that hits. Three empty probes skipped, never surfaced as an
    // "empty page" the viewer would read as the end of their history.
    const probes = core.calls.filter((c) => c.page_size === 1 && c.from)
    expect(probes.length).toBe(4)
    expect(res.windowStart).toBe('2026-07-01')
  })

  it('pages a non-empty window to COMPLETION — page * page_size < total', async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      rec(`k${i}`, `2026-08-2${i % 5}T01:00:00.000Z`),
    )
    const core = fakeCore(many)
    const res = await loadKaruteWindowRows(asClient(core.list), { now: NOW })

    expect(res.rows).toHaveLength(250)
    // 250 rows at page_size 200 = pages 1 and 2, and no third round trip.
    const pagedCalls = core.calls.filter((c) => c.page_size === 200 && c.from)
    expect(pagedCalls.map((c) => c.page)).toEqual([1, 2])
  })

  it('terminates at the probe cap with the boundary ADVANCED to the LAST PROBED window, so the next tap resumes at the first unprobed one', async () => {
    // Records exist, but far past the cap's reach — and past the epoch, so we
    // must NOT reach the sweep either: start the walk well after the epoch.
    const core = fakeCore([rec('k-1', '2020-01-01T00:00:00.000Z')])
    const res = await loadKaruteWindowRows(asClient(core.list), {
      now: new Date('2030-01-01T00:00:00.000Z'),
    })
    expect(res.rows).toEqual([])
    // 26 windows probed, 14 days each, walking back from the initial
    // 2029-12-19 window. windowStart is the start of the 26th (LAST
    // PROBED) window — NOT the 27th (unprobed) one the pre-fix bug
    // returned, which would silently skip that window on resume.
    expect(res.windowStart).toBe('2029-01-03')
    expect(res.hasMore).toBe(true)
  })

  it('probe-cap resume has NO GAP: feeding windowStart back as olderThan starts the next probe window exactly 14 days earlier', async () => {
    const core = fakeCore([rec('k-1', '2020-01-01T00:00:00.000Z')])
    const now = new Date('2030-01-01T00:00:00.000Z')
    const res = await loadKaruteWindowRows(asClient(core.list), { now })
    const probes = core.calls.filter((c) => c.page_size === 1 && c.from)
    expect(probes).toHaveLength(KARUTE_MAX_PROBE_WINDOWS)
    const lastProbed = probes[probes.length - 1]

    const core2 = fakeCore([rec('k-1', '2020-01-01T00:00:00.000Z')])
    await loadKaruteWindowRows(asClient(core2.list), { now, olderThan: res.windowStart })
    const resumedProbe = core2.calls.find((c) => c.page_size === 1 && c.from)!

    // Adjacent windows never share an instant (both bounds inclusive) — the
    // resumed window's `to` must land exactly 1ms before the last probed
    // window's `from`. A gap here means the fix regressed to skipping a
    // window again.
    expect(new Date(resumedProbe.to!).getTime()).toBe(
      new Date(lastProbed.from!).getTime() - 1,
    )
  })
})

// A concurrent DELETE between page fetches shifts every later row one slot
// forward, so a live row slides from the top of page 2 into page 1 — which the
// walk already read — and is never fetched at all. Dedupe cannot recover it.
// Page 1's `total` is the witness; a later page reporting a different one
// restarts the whole read ONCE from page 1.
describe('loadKaruteWindowRows — offset drift restarts the read once', () => {
  /** 250 rows inside the newest window, so the walk needs pages 1 and 2. */
  const window250 = () =>
    Array.from({ length: 250 }, (_, i) => rec(`k${String(i).padStart(3, '0')}`, `2026-08-2${i % 5}T01:00:00.000Z`))

  it('re-reads from page 1 when `total` moves mid-walk, and loses NO still-live row', async () => {
    const records = window250()
    const core = fakeCore(records)
    // Drop an EARLY row the instant page 1 of attempt 1 has been served: every
    // later row shifts down one, so k200 (the old top of page 2) now sits at
    // the bottom of page 1 — already passed.
    const list = (o: ListOpts) => {
      const res = core.list(o)
      if (o.page_size === KARUTE_WINDOW_PAGE_SIZE && o.page === 1 && records.length === 250) {
        records.splice(5, 1)
      }
      return res
    }
    const res = await loadKaruteWindowRows(asClient(list), { now: NOW })

    // Every row still in the store came back — including the one the naive
    // walk would have skipped straight past.
    const got = new Set(res.rows.map((r) => r.id))
    expect(records.every((r) => got.has(r.id))).toBe(true)
    expect(got.has('k200')).toBe(true)
    expect(got.size).toBe(249)

    // Exactly ONE retry: two page-1 reads, no third attempt.
    const pageOnes = core.calls.filter(
      (c) => c.page_size === KARUTE_WINDOW_PAGE_SIZE && c.from && c.page === 1,
    )
    expect(pageOnes).toHaveLength(2)
  })

  it('the no-drift path does ONE pass — page 1 is never re-read', async () => {
    const core = fakeCore(window250())
    await loadKaruteWindowRows(asClient(core.list), { now: NOW })
    const paged = core.calls.filter((c) => c.page_size === KARUTE_WINDOW_PAGE_SIZE && c.from)
    expect(paged.map((c) => c.page)).toEqual([1, 2])
  })
})

describe('loadKaruteWindowRows — hasMore is never a stale snapshot', () => {
  it('re-reads the store total on EVERY call and derives hasMore from it', async () => {
    const core = fakeCore([rec('k1', '2026-08-24T01:00:00.000Z')])
    const first = await loadKaruteWindowRows(asClient(core.list), { now: NOW })
    // 1 loaded of 1 → nothing older.
    expect(first.freshStoreTotal).toBe(1)
    expect(first.hasMore).toBe(false)

    // Someone else saves a karute between taps. The next call must SEE it.
    const core2 = fakeCore([
      rec('k1', '2026-08-24T01:00:00.000Z'),
      rec('k2', '2026-08-24T02:00:00.000Z'),
      rec('k3', '2026-07-20T02:00:00.000Z'),
    ])
    const second = await loadKaruteWindowRows(asClient(core2.list), {
      now: NOW,
      olderThan: '2026-08-12',
      loadedCount: 2,
    })
    expect(second.freshStoreTotal).toBe(3)
    expect(second.hasMore).toBe(false)

    // The store-total probe is a page_size:1 read with NO date window.
    const totalProbes = core2.calls.filter((c) => c.page_size === 1 && !c.from && !c.to)
    expect(totalProbes).toHaveLength(1)
  })

  it('karuteHasMore is the ONE formula — raw loaded rows vs the fresh store total', () => {
    expect(karuteHasMore(12, 62)).toBe(true)
    expect(karuteHasMore(62, 62)).toBe(false)
    expect(karuteHasMore(63, 62)).toBe(false)
  })
})

describe('loadKaruteWindowRows — epoch floor + legacy sweep', () => {
  it('fires the ONE-TIME date-unfiltered sweep and ends the walk', async () => {
    const legacy = [
      rec('legacy-1', '2025-03-01T00:00:00.000Z'),
      rec('legacy-2', '2024-11-11T00:00:00.000Z'),
    ]
    const core = fakeCore([rec('k-new', '2026-08-24T01:00:00.000Z'), ...legacy])
    const res = await loadKaruteWindowRows(asClient(core.list), {
      now: NOW,
      // Walk already at the epoch, with 1 of 3 rows loaded.
      olderThan: KARUTE_SESSION_DATE_EPOCH,
      loadedCount: 1,
    })

    // The sweep returns EVERY row (the caller's id-keyed map collapses the
    // overlap) and closes the walk — legacy rows can never orphan the button.
    expect(res.rows.map((r) => r.id).sort()).toEqual(['k-new', 'legacy-1', 'legacy-2'])
    expect(res.hasMore).toBe(false)
    expect(res.windowStart).toBe(KARUTE_SESSION_DATE_EPOCH)
    // Date-unfiltered: the sweep's page read carries NO from/to.
    const sweepCalls = core.calls.filter((c) => c.page_size === 200 && !c.from && !c.to)
    expect(sweepCalls.length).toBeGreaterThan(0)
  })

  it('does NOT sweep when everything is already loaded', async () => {
    const core = fakeCore([rec('k1', '2026-08-24T01:00:00.000Z')])
    const res = await loadKaruteWindowRows(asClient(core.list), {
      now: NOW,
      olderThan: KARUTE_SESSION_DATE_EPOCH,
      loadedCount: 1,
    })
    expect(res.rows).toEqual([])
    expect(res.hasMore).toBe(false)
    expect(core.calls.filter((c) => c.page_size === 200)).toHaveLength(0)
  })
})

describe('loadKaruteWindowRows — month mode (PR-2b sends it, PR-2a ships it)', () => {
  it('reads exactly the JST calendar month', async () => {
    const core = fakeCore([
      rec('jul', '2026-07-15T01:00:00.000Z'),
      rec('aug', '2026-08-15T01:00:00.000Z'),
    ])
    const res = await loadKaruteWindowRows(asClient(core.list), { now: NOW, month: '2026-07' })
    expect(res.rows.map((r) => r.id)).toEqual(['jul'])
    expect(res.windowStart).toBe('2026-07-01')
    // Month mode SWAPS the list, so there is nothing older to append.
    expect(res.hasMore).toBe(false)
    const windowed = core.calls.find((c) => c.page_size === 200 && c.from)!
    // JST month bounds, half-open on the wire (server bounds are inclusive).
    expect(windowed.from).toBe('2026-06-30T15:00:00.000Z')
    expect(windowed.to).toBe('2026-07-31T14:59:59.999Z')
  })

  it('handles the December → January rollover', async () => {
    const core = fakeCore([rec('dec', '2026-12-20T01:00:00.000Z')])
    const res = await loadKaruteWindowRows(asClient(core.list), { now: NOW, month: '2026-12' })
    expect(res.rows.map((r) => r.id)).toEqual(['dec'])
    const windowed = core.calls.find((c) => c.page_size === 200 && c.from)!
    expect(windowed.to).toBe('2026-12-31T14:59:59.999Z')
  })
})

describe('loadKaruteWindowRows — window arithmetic', () => {
  it('the first window covers KARUTE_WINDOW_DAYS ending now, and a resumed window abuts it without overlap', async () => {
    const core = fakeCore([])
    await loadKaruteWindowRows(asClient(core.list), { now: NOW })
    const firstProbe = core.calls.find((c) => c.page_size === 1 && c.from)!
    expect(firstProbe.from).toBe('2026-08-11T15:00:00.000Z') // JST 08-12 00:00
    expect(firstProbe.to).toBe(NOW.toISOString())
    expect(KARUTE_WINDOW_DAYS).toBe(14)

    const core2 = fakeCore([])
    await loadKaruteWindowRows(asClient(core2.list), { now: NOW, olderThan: '2026-08-12' })
    const resumed = core2.calls.find((c) => c.page_size === 1 && c.from)!
    // Ends 1ms before the previous window's start — server bounds are
    // INCLUSIVE on both ends, so a shared instant would double-count a row.
    expect(resumed.to).toBe('2026-08-11T14:59:59.999Z')
    expect(resumed.from).toBe('2026-07-28T15:00:00.000Z')
  })
})

// Round 1 (Greptile PR #775) gave both reads ONE shared try/catch so the header
// could never contradict the list — but that meant a 今月-probe failure
// DISCARDED already-successfully-loaded rows too (a false EMPTY list).
// SUPERSEDED by round 2's contract: the LIST is primary, the count is
// auxiliary. Each leg degrades INDEPENDENTLY to null. (Moved here from
// synqed-karute-rows.test.ts in PR-2a with the function it covers.)
describe('loadKaruteWindowWithMonthProbe', () => {
  const opts = {
    storeId: 'store-1',
    monthFrom: '2026-08-01T00:00:00.000Z',
    monthTo: '2026-08-25T04:00:00.000Z',
    now: NOW,
  }

  it('both legs succeed: window rows and the 今月 count come back independently', async () => {
    const core = fakeCore([rec('k1', '2026-08-24T01:00:00.000Z')])
    const result = await loadKaruteWindowWithMonthProbe(asClient(core.list), opts)
    expect(result.data?.rows).toHaveLength(1)
    expect(result.data?.freshStoreTotal).toBe(1)
    expect(result.monthProbe?.total).toBe(1)
  })

  it('the 今月 probe throwing does NOT discard the loaded window — only monthProbe goes null', async () => {
    const core = fakeCore([rec('k1', '2026-08-24T01:00:00.000Z')])
    const list = (o: ListOpts) => {
      // The month probe is the only page_size:1 read carrying BOTH bounds
      // from the caller's month window.
      if (o.page_size === 1 && o.from === opts.monthFrom) throw new Error('boom')
      return core.list(o)
    }
    const result = await loadKaruteWindowWithMonthProbe(asClient(list), opts)
    expect(result.data?.rows).toHaveLength(1)
    expect(result.monthProbe).toBeNull()
  })

  it('the window read throwing goes null WITHOUT being masked by a lucky probe success', async () => {
    const core = fakeCore([rec('k1', '2026-08-24T01:00:00.000Z')])
    const list = (o: ListOpts) => {
      if (!(o.page_size === 1 && o.from === opts.monthFrom)) throw new Error('boom')
      return core.list(o)
    }
    const result = await loadKaruteWindowWithMonthProbe(asClient(list), opts)
    expect(result.data).toBeNull()
    expect(result.monthProbe?.total).toBe(1)
  })

  it('both legs failing: both go null independently, no cross-contamination', async () => {
    const result = await loadKaruteWindowWithMonthProbe(
      asClient(() => {
        throw new Error('boom')
      }),
      opts,
    )
    expect(result).toEqual({ data: null, monthProbe: null })
  })
})
