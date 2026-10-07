import { unstable_cache } from 'next/cache'
import type { SynqedClient, StaffShift } from '@synqed-kk/client'
import type { ShiftRow } from '@/lib/capacity/capacity'

export const staffShiftsTag = (businessId: string, storeId: string) => `staff-shifts:${businessId}:${storeId}`
export const STAFF_SHIFTS_TTL = 60
export interface ShiftRead { rows: ShiftRow[]; readComplete: boolean }
const PAGE_SIZE = 200
const TIMEOUT_MS = 10_000

function rowFromCore(row: StaffShift): ShiftRow {
  const midnight = Date.parse(`${row.date}T00:00:00+09:00`)
  if (!Number.isFinite(midnight) || !Number.isInteger(row.start) || !Number.isInteger(row.end) || row.start < 0 || row.end > 1440 || row.end <= row.start) throw new Error('Invalid shift window')
  const interval = (i: { start: number; end: number }) => {
    if (!Number.isInteger(i.start) || !Number.isInteger(i.end) || i.start < row.start || i.end > row.end || i.end <= i.start) throw new Error('Invalid shift interval')
    return { startMs: midnight + i.start * 60_000, endMs: midnight + i.end * 60_000 }
  }
  return { staffId: row.staff_id, storeId: row.store_id, date: row.date, ...interval(row), breaks: row.breaks.map(interval), blocks: row.blocks.map(interval) }
}

/** Throws on any incomplete page; callers never cache a partial or failed read. */
export async function listStaffShiftRows(
  client: Pick<SynqedClient, 'staffShifts'>,
  businessId: string,
  storeId: string,
  from: string,
  to: string,
): Promise<ShiftRow[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const read = async () => {
    const early = new Date(Date.parse(`${from}T00:00:00+09:00`) - 86_400_000)
      .toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
    const options = { store_id: storeId, from: early, to, page_size: PAGE_SIZE }
    const first = await client.staffShifts.list({ ...options, page: 1 })
    if (!Number.isSafeInteger(first.total) || first.total < 0) throw new Error('Invalid shift total')
    const count = Math.max(1, Math.ceil(first.total / PAGE_SIZE))
    const rest = await Promise.all(Array.from({ length: count - 1 }, (_, i) => client.staffShifts.list({ ...options, page: i + 2 })))
    const pages = [first, ...rest]
    for (const [i, page] of pages.entries()) {
      const expected = Math.min(PAGE_SIZE, Math.max(0, first.total - i * PAGE_SIZE))
      if (page.total !== first.total || page.page !== i + 1 || page.page_size !== PAGE_SIZE || page.shifts.length !== expected) throw new Error('Incomplete shift page')
    }
    const rows = pages.flatMap(p => p.shifts)
    if (new Set(rows.map(r => r.id)).size !== rows.length || rows.some(r => r.business_id !== businessId || r.store_id !== storeId || r.date < early || r.date >= to)) throw new Error('Invalid shift scope')
    return rows.map(rowFromCore)
  }
  // On timeout the race rejects but the page requests already sent keep
  // running: the installed client's staffShifts.list(options) takes no
  // AbortSignal, so they cannot be aborted. Their results are discarded —
  // nothing awaits read() after the race settles, and a late rejection is
  // swallowed by the settled race.
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Shift read timed out')), TIMEOUT_MS) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** App cache + its own store-scoped tag; TTL covers writers outside this app. */
export async function readStaffShifts(
  client: Pick<SynqedClient, 'staffShifts'>,
  businessId: string,
  storeId: string,
  from: string,
  to: string,
): Promise<ShiftRead> {
  try {
    const rows = await unstable_cache(
      () => listStaffShiftRows(client, businessId, storeId, from, to),
      ['staff-shifts-v1', businessId, storeId, from, to],
      { revalidate: STAFF_SHIFTS_TTL, tags: [staffShiftsTag(businessId, storeId)] },
    )()
    return { rows, readComplete: true }
  } catch {
    return { rows: [], readComplete: false }
  }
}
