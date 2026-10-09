import type { Appointment } from '@synqed-kk/client'
import type { CapacityInput } from '@/lib/capacity/capacity'

export const DATE = '2026-10-08'
export const DAY = Date.parse(`${DATE}T00:00:00+09:00`)
export const minute = (n: number) => DAY + n * 60_000
export const span = (staffId: string | null, start: number, end: number) => ({ staffId, startMs: minute(start), endMs: minute(end) })
export const t1Spans = [span('s1', 600, 900), span('s2', 600, 900), span('s3', 600, 900)]
export const t4Spans = [span('s1', 600, 990), span('s2', 600, 990), span('s3', 600, 780)]
export function input(spans: CapacityInput['spans'] = t1Spans): CapacityInput {
  return { laneKind: 'staff', rosterLanes: 5, hours: { openMs: minute(600), closeMs: minute(1200), source: 'store', closed: false }, dayStartMs: DAY, dayEndMs: DAY + 86_400_000, spans }
}
export function appointments(spans = t1Spans): Appointment[] {
  return spans.map((s, i) => ({ id: `b${i}`, kind: 'BOOKING', customer_id: `c${i}`, staff_id: s.staffId, store_id: 'store', starts_at: new Date(s.startMs).toISOString(), ends_at: new Date(s.endMs).toISOString(), occupied_until: null, status: 'SCHEDULED', duration_minutes: (s.endMs - s.startMs) / 60_000 } as Appointment))
}
export const hoursFacts = new Map([[DATE, { openMinute: 600, closeMinute: 1200, minutes: 600, source: 'store' as const, saved: true, closed: false }]])
