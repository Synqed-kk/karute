// live-calendar.ts — S95: the store's live calendar from core, for plan()'s last pass (plan.ts applyLiveCalendar).
// Reads only: storePolicies.get (live weekly_hours + special_open_days) and storePolicies.listClosedDays (臨時休業 rows) over the
// plan's FULL window (epoch − pastDays … today + futureDays: past days are written too). A failed read throws — the caller
// fails that store loud, never plans unfiltered against live core. The closed-day rows are test data the loader respects.
import type { WeeklyHours } from '@synqed-kk/client'
import type { FillCore } from './fill'
import { addDays, type LiveCalendar, type Plan } from './plan'

type StoreBookingPolicy = Awaited<ReturnType<FillCore['storePolicies']['get']>>

const isYmd = (d: unknown): d is string =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d
// 24:00 is a real close (store 1's special-open 2026-11-17 closes 24:00); mins() and jstIso() take 1440
const isHhmm = (t: unknown): t is string => typeof t === 'string' && /^(([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?|24:00(:00)?)$/.test(t)

export async function readLiveCalendar(core: Pick<FillCore, 'storePolicies'>, storeId: string, window: { from: string; to: string },
  read: <T>(fn: () => Promise<T>) => Promise<T>, recipeHours: WeeklyHours, log: (l: string) => void, known?: StoreBookingPolicy): Promise<LiveCalendar> {
  const policy = known ?? (await read(() => core.storePolicies.get(storeId))) // fill apply passes the policy it read seconds before
  const res = await read(() => core.storePolicies.listClosedDays(storeId, { from: window.from, to: addDays(window.to, 1) })) // `to` is exclusive
  const rows: unknown = res?.closed_days
  if (!Array.isArray(rows)) throw new Error(`store ${storeId}: listClosedDays answered without a closed_days list`)
  // the SDK takes no page argument; a paged answer would be a silent partial calendar, so it fails loud instead
  const total = (res as { total?: unknown }).total
  if (typeof total === 'number' && total > rows.length) throw new Error(`store ${storeId}: listClosedDays returned ${rows.length} of ${total} rows`)
  const inWindow = (d: string) => d >= window.from && d <= window.to
  // special-open rows carry no id: the row is named by its position, and the whole row is printed
  const bad = (what: string, ref: string, r: unknown) => log(`live calendar: store ${storeId}: ${what} ${ref} has a malformed date or time (${JSON.stringify(r)}), ignored`)
  const closedDates = new Set<string>()
  for (const [i, r] of (rows as { id?: unknown; date?: unknown }[]).entries()) {
    if (!isYmd(r?.date)) bad('closed-day row', r?.id != null ? String(r.id) : `#${i}`, r)
    else if (inWindow(r.date)) closedDates.add(r.date)
  }
  const specialOpen = new Map<string, { open: string; close: string }>()
  for (const [i, s] of (policy.special_open_days ?? []).entries()) {
    if (!isYmd(s?.date) || !isHhmm(s?.open) || !isHhmm(s?.close)) bad('special-open day', `#${i}`, s)
    else if (inWindow(s.date)) specialOpen.set(s.date, { open: s.open, close: s.close })
  }
  // a default policy, or a row with no weekly_hours, is given the recipe hours by this same fill run (fill.ts, QUEUE-S93 b)
  const weeklyHours = policy.source === 'default' || policy.weekly_hours == null ? recipeHours : policy.weekly_hours
  return { weeklyHours, closedDates, specialOpen }
}

/** The one summary line per store (fill apply and `plan`); `before` is the plan without the calendar, `after` with it. */
export function liveLine(cal: LiveCalendar, before: Plan, after: Plan): string {
  const closed = [...cal.closedDates].sort()
  const dates = [...new Set(after.dropped.map((d) => d.date))].sort()
  return `live calendar: ${closed.length} closed days in window [${closed.join(', ')}] · ${cal.specialOpen.size} special-open days · dropped ${after.dropped.length} bookings + ${before.karutes.length - after.karutes.length} karutes [${dates.join(', ')}]`
}
