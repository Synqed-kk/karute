/**
 * The window read pages to exhaustion, and when it cannot, it says so.
 *
 * The old range read asked for ONE page of 500 and returned whatever came back,
 * so a busy month silently lost its tail and rendered a plausible-but-low 件
 * number. A low number on a booking screen is worse than a failed read: nobody
 * questions it. So a cap hit now drops every row and reports `truncated`.
 */
import type { Appointment } from '@synqed-kk/client'
import {
  fetchAppointmentWindow,
  MAX_RANGE_PAGES,
} from '@/lib/appointments/by-date'

const FROM = '2026-09-01T00:00:00.000Z'
const TO = '2026-09-30T14:59:59.999Z'

function row(i: number, over: Partial<Appointment> = {}): Appointment {
  return {
    id: `a${i}`,
    kind: 'BOOKING',
    customer_id: `c${i}`,
    staff_id: 's1',
    starts_at: '2026-09-15T01:00:00Z',
    ends_at: '2026-09-15T02:00:00Z',
    duration_minutes: 60,
    title: null,
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as unknown as Appointment
}

/** A core stand-in that serves `total` rows in pages of `page_size`. */
function fakeClient(total: number) {
  const list = jest.fn(
    async (opts: { page?: number; page_size?: number; staff_id?: string }) => {
      const size = opts.page_size ?? 500
      const page = opts.page ?? 1
      const start = (page - 1) * size
      const count = Math.max(0, Math.min(size, total - start))
      return {
        appointments: Array.from({ length: count }, (_, i) => row(start + i)),
        total,
        page,
        page_size: size,
      }
    },
  )
  return { client: { appointments: { list } } as never, list }
}

describe('fetchAppointmentWindow — paging', () => {
  it('reads 1200 rows in 3 calls of 500', async () => {
    const { client, list } = fakeClient(1200)
    const win = await fetchAppointmentWindow(client, FROM, TO)
    expect(list).toHaveBeenCalledTimes(3)
    expect(win.counted).toHaveLength(1200)
    expect(win.truncated).toBe(false)
  })

  it('stops the moment the rows account for `total` — exactly 2 calls for 1000 (mutant m3)', async () => {
    // The `>= total` boundary: with `> total` the second full page would not
    // satisfy the break and a third, empty call would go out.
    const { client, list } = fakeClient(1000)
    const win = await fetchAppointmentWindow(client, FROM, TO)
    expect(list).toHaveBeenCalledTimes(2)
    expect(win.counted).toHaveLength(1000)
    expect(win.truncated).toBe(false)
  })

  it('an empty window is ONE call', async () => {
    const { client, list } = fakeClient(0)
    const win = await fetchAppointmentWindow(client, FROM, TO)
    expect(list).toHaveBeenCalledTimes(1)
    expect(win.counted).toEqual([])
    expect(win.truncated).toBe(false)
  })

  it('EXACTLY the cap — 3000 rows in 6 pages is whole, not truncated', async () => {
    // The boundary the cap is defined at: 6 × 500. One row either side of it
    // decides between a full month and a failed read, so both sides are pinned.
    const { client, list } = fakeClient(3000)
    const win = await fetchAppointmentWindow(client, FROM, TO)
    expect(list).toHaveBeenCalledTimes(MAX_RANGE_PAGES)
    expect(win.truncated).toBe(false)
    expect(win.counted).toHaveLength(3000)
  })

  it('one row past the cap — 3001 truncates', async () => {
    const { client, list } = fakeClient(3001)
    const win = await fetchAppointmentWindow(client, FROM, TO)
    expect(list).toHaveBeenCalledTimes(MAX_RANGE_PAGES)
    expect(win.truncated).toBe(true)
    expect(win.counted).toEqual([])
  })

  it('the cap: 4000 rows stop at MAX pages, truncated, with EVERY array empty (mutant m4)', async () => {
    const { client, list } = fakeClient(4000)
    const win = await fetchAppointmentWindow(client, FROM, TO)
    expect(list).toHaveBeenCalledTimes(MAX_RANGE_PAGES)
    expect(win.truncated).toBe(true)
    // Not "the first 3000" — a partial window would render as a low number.
    expect(win.counted).toEqual([])
    expect(win.cancelled).toEqual([])
    expect(win.noShow).toEqual([])
  })
})

describe('fetchAppointmentWindow — the staff filter rides the fetch', () => {
  it('forwards staff_id when given', async () => {
    const { client, list } = fakeClient(1)
    await fetchAppointmentWindow(client, FROM, TO, { staffId: 'staff-core-1' })
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'staff-core-1' }),
    )
  })

  it('sends no staff_id when the filter is off', async () => {
    const { client, list } = fakeClient(1)
    await fetchAppointmentWindow(client, FROM, TO, { staffId: null })
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: undefined }),
    )
  })

  it('carries the store lens', async () => {
    const { client, list } = fakeClient(1)
    await fetchAppointmentWindow(client, FROM, TO, { storeId: 'store-ginza' })
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
  })
})

describe('fetchAppointmentWindow — partitions', () => {
  it('splits counted / cancelled / no-show and drops BLOCK rows entirely', async () => {
    const rows = [
      row(1),
      row(2, { status: 'CANCELLED' }),
      row(3, { status: 'NO_SHOW' }),
      row(4, { kind: 'BLOCK', customer_id: null }),
      // A cancelled BLOCK is not a cancellation anybody wants counted.
      row(5, { kind: 'BLOCK', customer_id: null, status: 'CANCELLED' }),
      row(6, { customer_id: null }),
    ]
    const list = jest.fn(async () => ({
      appointments: rows,
      total: rows.length,
      page: 1,
      page_size: 500,
    }))
    const win = await fetchAppointmentWindow(
      { appointments: { list } } as never,
      FROM,
      TO,
    )
    expect(win.counted.map((a) => a.id)).toEqual(['a1'])
    expect(win.cancelled.map((a) => a.id)).toEqual(['a2'])
    expect(win.noShow.map((a) => a.id)).toEqual(['a3'])
  })
})
